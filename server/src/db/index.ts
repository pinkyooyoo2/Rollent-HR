import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from '../config.ts';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

type Params = unknown[] | Record<string, unknown>;
type Row = Record<string, any>;

function norm(v: unknown): SQLInputValue {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as SQLInputValue;
}

function bind(params?: Params): SQLInputValue[] | [Record<string, SQLInputValue>] {
  if (!params) return [];
  if (Array.isArray(params)) return params.map(norm);
  const o: Record<string, SQLInputValue> = {};
  for (const [k, v] of Object.entries(params)) o[k] = norm(v);
  return [o];
}

export function all<T = Row>(sql: string, params?: Params): T[] {
  return db.prepare(sql).all(...(bind(params) as SQLInputValue[])) as T[];
}

export function get<T = Row>(sql: string, params?: Params): T | undefined {
  return db.prepare(sql).get(...(bind(params) as SQLInputValue[])) as T | undefined;
}

export function run(sql: string, params?: Params): { changes: number; lastInsertRowid: number } {
  const r = db.prepare(sql).run(...(bind(params) as SQLInputValue[]));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

let txDepth = 0;
/** 트랜잭션 실행 (중첩 호출 시 SAVEPOINT 사용) */
export function tx<T>(fn: () => T): T {
  const sp = `sp${txDepth}`;
  db.exec(txDepth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  txDepth++;
  try {
    const result = fn();
    txDepth--;
    db.exec(txDepth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (e) {
    txDepth--;
    db.exec(txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
