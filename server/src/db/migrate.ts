import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, all } from './index.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** migrations/*.sql 을 파일명 순서대로 1회씩 적용 */
export function migrate(log = true): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(all<{ version: string }>('SELECT version FROM schema_migrations').map((r) => r.version));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const done: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // 테이블 재생성(CHECK 제약 변경 등)이 필요한 마이그레이션은 첫 줄에 "-- @no-foreign-keys" 표시.
    // SQLite 권장 절차대로 외래 키 검사를 끄고 적용한 뒤, 커밋 전에 무결성을 확인한다.
    const noFk = sql.startsWith('-- @no-foreign-keys');
    if (noFk) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      if (noFk) {
        const broken = all('PRAGMA foreign_key_check');
        if (broken.length) throw new Error(`foreign key check failed after ${file}: ${JSON.stringify(broken.slice(0, 5))}`);
      }
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
      db.exec('COMMIT');
      done.push(file);
      if (log) console.log(`[migrate] applied ${file}`);
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      if (noFk) db.exec('PRAGMA foreign_keys = ON');
    }
  }
  if (log && done.length === 0) console.log('[migrate] up to date');
  return done;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate();
}
