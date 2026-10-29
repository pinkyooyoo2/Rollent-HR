import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { run } from './db/index.ts';

/** 클라이언트에서 코드 기반으로 번역되는 API 오류 */
export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message?: string, details?: unknown) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'NOT_FOUND') => new ApiError(404, what);
export const badRequest = (code: string, details?: unknown) => new ApiError(400, code, code, details);

export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid input', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

/** async 핸들러 예외를 에러 미들웨어로 전달 */
export const h = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => {
    try {
      const r = fn(req, res, next);
      if (r instanceof Promise) r.catch(next);
    } catch (e) {
      next(e);
    }
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: err.issues });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed/.test(msg)) {
    res.status(409).json({ error: 'DUPLICATE', message: msg });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'SERVER_ERROR', message: 'Internal server error' });
}

export function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || '').replace('::ffff:', '');
}

/** 관리자 활동(감사) 로그 기록 */
export function audit(req: Request, action: string, entityType?: string, entityId?: string | number | null, details?: unknown) {
  run(
    'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user?.id ?? null, action, entityType ?? null, entityId == null ? null : String(entityId),
      details === undefined ? null : JSON.stringify(details), clientIp(req)],
  );
}

export function paginate<T>(rows: T[], req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 20));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

export const idParam = (req: Request, name = 'id'): number => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('INVALID_ID');
  return n;
};
