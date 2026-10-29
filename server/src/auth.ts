import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, run, now } from './db/index.ts';
import { config } from './config.ts';
import { ApiError, clientIp } from './http.ts';

export const SESSION_COOKIE = 'hr_sid';

export interface SessionUser {
  id: number;
  emp_no: string;
  employee_id: number | null;
  display_name: string;
  email: string | null;
  role: string;
  role_name: string;
  language: string;
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: number;
    }
  }
}

export const PERMISSIONS: Record<string, string> = {
  'dashboard.view': '대시보드 조회',
  'org.view': '부서/직원 조회',
  'org.manage': '부서/직원 관리',
  'forms.view': '평가항목 조회',
  'forms.manage': '평가항목 편집',
  'weights.manage': '평가 가중치 변경',
  'rounds.view': '평가 진행 조회',
  'rounds.manage': '평가 차수/배정 관리',
  'responses.view': '자기·팀장평가 응답 열람',
  'responses.view_exec': '임원평가 응답 열람',
  'responses.proxy': '평가 대리 입력(서면 평가표 입력)',
  'results.view': '평가 결과 조회',
  'results.adjust': '최종 점수 보정',
  'results.finalize': '최종 확정/재오픈',
  'results.import': '평가 결과 CSV 업로드',
  'results.import.approve': '평가 결과 CSV 승인',
  'reports.generate': '리포트 생성',
  'logs.view': '활동/접근 로그 조회',
  'users.manage': '사용자 계정 관리',
  'evaluate': '본인 배정 평가 작성',
};

/**
 * 역할: 관리자만 관리 페이지(전체 권한)를 사용. 임원·팀장·직원은 평가 전용 사이트에서 본인 평가 작성만 가능
 * (임원은 다른 직원의 응답·결과·점수 보정에 접근할 수 없음)
 */
export const ROLES: { code: string; name: string; perms: string[] }[] = [
  { code: 'admin', name: '관리자', perms: Object.keys(PERMISSIONS) },
  { code: 'executive', name: '임원', perms: ['evaluate'] },
  { code: 'leader', name: '팀장', perms: ['evaluate'] },
  { code: 'employee', name: '직원', perms: ['evaluate'] },
];

export const hashPassword = (pw: string) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compareSync(pw, hash);
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** 비밀번호 정책: 8자 이상, 영문+숫자 포함 */
export function validatePasswordPolicy(pw: string): boolean {
  return pw.length >= 8 && pw.length <= 100 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

export function loadSessionUser(userId: number): SessionUser | undefined {
  const u = get<any>(
    `SELECT u.id, u.emp_no, u.employee_id, u.display_name, u.email, u.language, r.code AS role, r.name AS role_name, r.id AS role_id
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.is_active = 1`, [userId]);
  if (!u) return undefined;
  const perms = all<{ permission_code: string }>('SELECT permission_code FROM role_permissions WHERE role_id = ?', [u.role_id])
    .map((p) => p.permission_code);
  return {
    id: u.id, emp_no: u.emp_no, employee_id: u.employee_id, display_name: u.display_name, email: u.email,
    role: u.role, role_name: u.role_name, language: u.language, permissions: perms,
  };
}

export function createSession(req: Request, res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  run('INSERT INTO sessions (token_hash, user_id, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
    [sha256(token), userId, clientIp(req), String(req.headers['user-agent'] ?? '').slice(0, 300), expires]);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    maxAge: config.sessionTtlHours * 3600_000,
    path: '/',
  });
}

export function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** 세션 쿠키 → req.user (만료/비활성 계정 자동 차단) */
export function sessionMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const s = get<{ id: number; user_id: number; expires_at: string }>(
      'SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ?', [sha256(token)]);
    if (s && s.expires_at > now()) {
      const user = loadSessionUser(s.user_id);
      if (user) {
        req.user = user;
        req.sessionId = s.id;
        run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now(), s.id]);
      }
    } else if (s) {
      run('DELETE FROM sessions WHERE id = ?', [s.id]);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
    }
  }
  next();
}

/** CSRF 방어: 상태 변경 요청은 커스텀 헤더 필수 (SameSite=Strict 쿠키와 병행) */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
    next(new ApiError(403, 'CSRF_REJECTED'));
    return;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    next(new ApiError(401, 'UNAUTHORIZED'));
    return;
  }
  next();
}

export const hasPerm = (req: Request, perm: string) => !!req.user?.permissions.includes(perm);


/** 서버 측 권한 검증 미들웨어 */
export const requirePerm = (...perms: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) {
    next(new ApiError(401, 'UNAUTHORIZED'));
    return;
  }
  if (!perms.some((p) => req.user!.permissions.includes(p))) {
    next(new ApiError(403, 'FORBIDDEN'));
    return;
  }
  next();
};
