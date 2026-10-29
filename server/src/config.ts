import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// .env 파일 로드 (외부 패키지 없이 단순 KEY=VALUE 파싱)
const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  dbPath: path.resolve(ROOT_DIR, process.env.DB_PATH || 'data/hr.db'),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 8),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** 앞단 프록시 신뢰 단계 수 (Render 등 리버스 프록시 뒤에서는 1). 미설정 시 로컬 프록시만 신뢰 */
  trustProxy: /^d+$/.test(process.env.TRUST_PROXY ?? '') ? Number(process.env.TRUST_PROXY) : 'loopback',
  /** 마감 판정 기준 시간대 (마감일 23:59:59 까지 작성 가능). 기본 한국 표준시 */
  tzOffset: /^[+-]\d{2}:\d{2}$/.test(process.env.TZ_OFFSET ?? '') ? process.env.TZ_OFFSET! : '+09:00',
  isProduction: process.env.NODE_ENV === 'production',
};
