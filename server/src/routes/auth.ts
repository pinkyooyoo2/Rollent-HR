import { Router } from 'express';
import { z } from 'zod';
import { all, run, now } from '../db/index.ts';
import { ApiError, h, parse, audit, clientIp } from '../http.ts';
import { createSession, destroySession, requireAuth, loadSessionUser } from '../auth.ts';

export const authRouter = Router();

export const LANGUAGES = ['ko', 'en', 'ru', 'ja', 'zh'] as const;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// IP 단위 간이 레이트 리밋 (메모리)
const ipHits = new Map<string, { count: number; reset: number }>();
function ipLimit(ip: string, limit: number, windowMs: number) {
  const t = Date.now();
  const e = ipHits.get(ip);
  if (!e || e.reset < t) {
    ipHits.set(ip, { count: 1, reset: t + windowMs });
    return;
  }
  e.count++;
  if (e.count > limit) throw new ApiError(429, 'TOO_MANY_REQUESTS');
}

const plusMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString().replace('T', ' ').slice(0, 19);

/** 이름 정규화: 앞뒤·연속 공백 정리 + 유니코드 NFC (한글 자모 조합형 입력 대비) */
const normName = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ');

/** 사번 비교용 정규화 (앞뒤 공백 제거, 영문 대소문자 무시) */
const normEmpNo = (s: string) => s.trim().toUpperCase();

/**
 * 로그인: 아이디 = 이름, 비밀번호 = 사번.
 * 관리자 페이지에 등록된 직원 계정의 이름·사번과 대조하며, 사번은 사람마다 다르므로 동명이인도 정확히 구분된다.
 * 별도의 비밀번호 설정·변경 기능은 없다 (사번이 곧 비밀번호).
 */
authRouter.post('/login', h((req, res) => {
  ipLimit(`login:${clientIp(req)}`, 30, 15 * 60_000);
  const body = parse(z.object({
    name: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(200),
    language: z.enum(LANGUAGES).optional(),
  }), req.body);
  const name = normName(body.name);
  const candidates = all<any>('SELECT * FROM users WHERE display_name = ? COLLATE NOCASE AND is_active = 1', [name]);
  if (!candidates.length) {
    audit(req, 'auth.login_failed', 'user', null, { name });
    throw new ApiError(401, 'INVALID_CREDENTIALS');
  }
  const open = candidates.filter((c) => !(c.locked_until && c.locked_until > now()));
  if (!open.length) throw new ApiError(423, 'ACCOUNT_LOCKED', undefined, { until: candidates[0].locked_until });
  // 사번은 UNIQUE 이므로 이름 + 사번 조합은 최대 1명
  const u = open.find((c) => normEmpNo(c.emp_no) === normEmpNo(body.password));
  if (!u) {
    // 동명이인 모두 실패 횟수 증가 (5회 실패 시 15분 잠금)
    let minRemaining = MAX_FAILED;
    for (const c of open) {
      const failed = c.failed_attempts + 1;
      run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?',
        [failed >= MAX_FAILED ? 0 : failed, failed >= MAX_FAILED ? plusMinutes(LOCK_MINUTES) : null, c.id]);
      run('INSERT INTO activity_logs (user_id, action, entity_type, entity_id, ip) VALUES (?, ?, ?, ?, ?)',
        [c.id, 'auth.login_failed', 'user', String(c.id), clientIp(req)]);
      minRemaining = Math.min(minRemaining, MAX_FAILED - failed);
    }
    req.user = undefined;
    if (open.length === 1 && minRemaining <= 0) throw new ApiError(423, 'ACCOUNT_LOCKED');
    throw new ApiError(401, 'INVALID_CREDENTIALS', undefined, open.length === 1 ? { remaining: minRemaining } : undefined);
  }
  run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, language = COALESCE(?, language) WHERE id = ?',
    [now(), body.language ?? null, u.id]);
  createSession(req, res, u.id);
  req.user = loadSessionUser(u.id);
  audit(req, 'auth.login', 'user', u.id);
  res.json({ user: req.user });
}));

authRouter.post('/logout', h((req, res) => {
  if (req.user) audit(req, 'auth.logout', 'user', req.user.id);
  destroySession(req, res);
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, h((req, res) => {
  res.json({ user: req.user });
}));

authRouter.put('/language', requireAuth, h((req, res) => {
  const { language } = parse(z.object({ language: z.enum(LANGUAGES) }), req.body);
  run('UPDATE users SET language = ? WHERE id = ?', [language, req.user!.id]);
  res.json({ ok: true, language });
}));
