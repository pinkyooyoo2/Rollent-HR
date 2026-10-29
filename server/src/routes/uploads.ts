import { Router, type Request } from 'express';
import { z } from 'zod';
import { all, get, run, parseJson, now } from '../db/index.ts';
import { h, parse, audit, ApiError, notFound, idParam } from '../http.ts';
import { requireAuth, hasPerm } from '../auth.ts';
import { sendCsv } from '../csv.ts';
import { KIND_FIELDS, validateUpload, summarize, applyUpload, revertUpload, type Kind, type UploadOptions } from '../services/csvKinds.ts';

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

const KINDS = ['employees', 'departments', 'questions', 'results', 'kpis'] as const;
const KIND_PERM: Record<Kind, string> = {
  employees: 'org.manage', departments: 'org.manage', questions: 'forms.manage', results: 'results.import', kpis: 'weights.manage',
};

function checkKind(req: Request, kind: Kind, approve = false) {
  const ok = approve ? hasPerm(req, 'results.import.approve') : hasPerm(req, KIND_PERM[kind]) || (kind === 'results' && hasPerm(req, 'results.import.approve'));
  if (!ok) throw new ApiError(403, 'FORBIDDEN');
}

const TEMPLATES: Record<Kind, { headers: string[]; rows: string[][] }> = {
  employees: {
    headers: ['사번', '이름', '부서명', '직급', '직군', '재직상태', '입사일', '이메일', '연락처'],
    rows: [['R9001', '홍예시', '관리직', '팀원', '관리직', '재직', '2026-01-02', 'r9001@rollent.example', '010-0000-0000']],
  },
  departments: {
    headers: ['부서명', '팀장사번', '설명'],
    rows: [['신규팀', '', '예시 부서']],
  },
  kpis: {
    headers: ['부서명', '지표명', '단위', '평가방향', '목표', '실적', '가중치'],
    rows: [
      ['관리직', '과제 달성률', '%', '높을수록 좋음', '85', '80', '60'],
      ['관리직', '고객 만족도', '점', '높을수록 좋음', '4.5', '4.7', '40'],
      ['생산직', '운영 장애 건수', '건', '낮을수록 좋음', '8', '6', '40'],
    ],
  },
  questions: {
    headers: ['섹션', '질문', '유형', '선택지', '배점', '필수', '점수반영', '설명'],
    rows: [
      ['업무성과 · 업무관리', '업무를 규정된 시간 내에 처리하려고 노력한다', '점수척도형', 'A:5|B:4|C:3|D:2|E:1', '1.75', 'Y', 'Y', ''],
      ['자기관찰', '업무의 양', '객관식', '너무 많다|약간 많다|알맞다|약간 적다|너무 적다', '0', 'Y', 'N', ''],
    ],
  },
  results: {
    headers: ['사번', '이름', '평가유형', '점수'],
    rows: [['R2001', '정민호', '자기평가', '85.5'], ['R2001', '정민호', '팀장평가', '80'], ['R2001', '정민호', '임원평가', '82']],
  },
};

uploadsRouter.get('/fields', h((req, res) => {
  res.json(KIND_FIELDS);
}));

uploadsRouter.get('/template/:kind', h((req, res) => {
  const kind = req.params.kind as Kind;
  if (!KINDS.includes(kind)) throw notFound();
  const t = TEMPLATES[kind];
  sendCsv(res, `${kind}_template.csv`, t.headers, t.rows);
}));

uploadsRouter.get('/', h((req, res) => {
  const kinds = String(req.query.kind ?? '').split(',').filter((k) => KINDS.includes(k as Kind)) as Kind[];
  if (!kinds.length) throw new ApiError(400, 'KIND_REQUIRED');
  kinds.forEach((k) => checkKind(req, k));
  const rows = all<any>(`
    SELECT c.id, c.kind, c.file_name, c.status, c.row_count, c.options, c.result, c.created_at, c.applied_at, c.reviewed_at, c.review_note, c.reverted_at,
      u.display_name AS uploaded_by_name, a.display_name AS applied_by_name, r.display_name AS reviewed_by_name, c.uploaded_by
    FROM csv_uploads c
    LEFT JOIN users u ON u.id = c.uploaded_by LEFT JOIN users a ON a.id = c.applied_by LEFT JOIN users r ON r.id = c.reviewed_by
    WHERE c.kind IN (${kinds.map(() => '?').join(',')}) ORDER BY c.id DESC LIMIT 200`, kinds);
  res.json({ items: rows.map((r) => ({ ...r, options: parseJson(r.options, {}), result: parseJson(r.result, null) })) });
}));

function loadUpload(id: number) {
  const u = get<any>('SELECT * FROM csv_uploads WHERE id = ?', [id]);
  if (!u) throw notFound();
  return {
    ...u,
    headers: parseJson<string[]>(u.headers, []),
    mapping: parseJson<Record<string, string>>(u.mapping, {}),
    rows: parseJson<Record<string, string>[]>(u.rows, []),
    options: parseJson<UploadOptions>(u.options, {}),
    result: parseJson(u.result, null),
    changes: parseJson<any[]>(u.changes, []),
  };
}

function withValidation(u: ReturnType<typeof loadUpload>) {
  const validation = validateUpload(u.kind, u.rows, u.mapping, u.options);
  const { changes, ...rest } = u;
  return { ...rest, has_changes: changes.length > 0, validation, summary: summarize(validation) };
}

const rowsSchema = z.array(z.record(z.string().max(5000))).max(10000);
const optionsSchema = z.object({
  mode: z.enum(['overwrite', 'add_only']).optional(),
  createDepartments: z.boolean().optional(),
  skipInvalid: z.boolean().optional(),
  formId: z.number().int().positive().optional(),
  questionMode: z.enum(['append', 'replace']).optional(),
  roundId: z.number().int().positive().optional(),
});

uploadsRouter.post('/', h((req, res) => {
  const b = parse(z.object({
    kind: z.enum(KINDS),
    fileName: z.string().trim().min(1).max(255),
    headers: z.array(z.string().max(200)).max(200),
    rows: rowsSchema,
    mapping: z.record(z.string()),
    options: optionsSchema.optional(),
  }), req.body);
  checkKind(req, b.kind);
  const id = run(`INSERT INTO csv_uploads (kind, file_name, status, row_count, headers, mapping, rows, options, uploaded_by) VALUES (?, ?, 'staged', ?, ?, ?, ?, ?, ?)`,
    [b.kind, b.fileName, b.rows.length, JSON.stringify(b.headers), JSON.stringify(b.mapping), JSON.stringify(b.rows), JSON.stringify(b.options ?? {}), req.user!.id]).lastInsertRowid;
  audit(req, 'upload.stage', 'csv_upload', id, { kind: b.kind, fileName: b.fileName, rows: b.rows.length });
  res.status(201).json(withValidation(loadUpload(id)));
}));

uploadsRouter.get('/:id', h((req, res) => {
  const u = loadUpload(idParam(req));
  checkKind(req, u.kind);
  res.json(withValidation(u));
}));

/** 스테이징 파일 데이터/매핑/옵션 수정 (적용 전에만) */
uploadsRouter.put('/:id', h((req, res) => {
  const id = idParam(req);
  const u = loadUpload(id);
  checkKind(req, u.kind);
  if (u.status !== 'staged') throw new ApiError(409, 'UPLOAD_NOT_EDITABLE');
  const b = parse(z.object({ rows: rowsSchema.optional(), mapping: z.record(z.string()).optional(), options: optionsSchema.optional() }), req.body);
  run('UPDATE csv_uploads SET rows = COALESCE(?, rows), row_count = COALESCE(?, row_count), mapping = COALESCE(?, mapping), options = COALESCE(?, options), updated_at = ? WHERE id = ?',
    [b.rows ? JSON.stringify(b.rows) : null, b.rows?.length ?? null, b.mapping ? JSON.stringify(b.mapping) : null, b.options ? JSON.stringify(b.options) : null, now(), id]);
  res.json(withValidation(loadUpload(id)));
}));

/** 적용: 결과(results) 업로드는 승인 대기로 전환 */
uploadsRouter.post('/:id/apply', h((req, res) => {
  const id = idParam(req);
  const u = loadUpload(id);
  checkKind(req, u.kind);
  if (u.status !== 'staged') throw new ApiError(409, 'UPLOAD_NOT_EDITABLE');
  const validation = validateUpload(u.kind, u.rows, u.mapping, u.options);
  const summary = summarize(validation);
  if (summary.errorRows > 0 && !u.options.skipInvalid) throw new ApiError(400, 'UPLOAD_HAS_ERRORS', undefined, summary);
  if (summary.total - summary.errorRows === 0) throw new ApiError(400, 'UPLOAD_NO_VALID_ROWS');
  if (u.kind === 'results') {
    run(`UPDATE csv_uploads SET status = 'pending_approval', result = ?, applied_by = ?, applied_at = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(summary), req.user!.id, now(), now(), id]);
    audit(req, 'upload.request_approval', 'csv_upload', id, summary);
  } else {
    const changes = applyUpload(u.kind, validation, u.options, req.user!.id);
    run(`UPDATE csv_uploads SET status = 'applied', result = ?, changes = ?, applied_by = ?, applied_at = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(summary), JSON.stringify(changes), req.user!.id, now(), now(), id]);
    audit(req, 'upload.apply', 'csv_upload', id, { kind: u.kind, ...summary });
  }
  res.json(withValidation(loadUpload(id)));
}));

/** 평가 결과 CSV 승인 (업로더와 다른 승인권자 필요) */
uploadsRouter.post('/:id/approve', h((req, res) => {
  const id = idParam(req);
  const u = loadUpload(id);
  checkKind(req, u.kind, true);
  if (u.status !== 'pending_approval') throw new ApiError(409, 'UPLOAD_NOT_PENDING');
  if (u.uploaded_by === req.user!.id || u.applied_by === req.user!.id) throw new ApiError(403, 'APPROVER_MUST_DIFFER');
  const note = parse(z.object({ note: z.string().max(500).optional() }), req.body).note ?? null;
  const validation = validateUpload(u.kind, u.rows, u.mapping, u.options);
  const summary = summarize(validation);
  if (summary.errorRows > 0 && !u.options.skipInvalid) throw new ApiError(400, 'UPLOAD_HAS_ERRORS', undefined, summary);
  const changes = applyUpload(u.kind, validation, { ...u.options, uploadId: id }, req.user!.id);
  run(`UPDATE csv_uploads SET status = 'applied', result = ?, changes = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(summary), JSON.stringify(changes), req.user!.id, now(), note, now(), id]);
  audit(req, 'upload.approve', 'csv_upload', id, { ...summary, note });
  res.json(withValidation(loadUpload(id)));
}));

uploadsRouter.post('/:id/reject', h((req, res) => {
  const id = idParam(req);
  const u = loadUpload(id);
  checkKind(req, u.kind, true);
  if (u.status !== 'pending_approval') throw new ApiError(409, 'UPLOAD_NOT_PENDING');
  const { note } = parse(z.object({ note: z.string().trim().min(1).max(500) }), req.body);
  run(`UPDATE csv_uploads SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?`, [req.user!.id, now(), note, now(), id]);
  audit(req, 'upload.reject', 'csv_upload', id, { note });
  res.json(withValidation(loadUpload(id)));
}));

/** 잘못 적용한 업로드 되돌리기 */
uploadsRouter.post('/:id/revert', h((req, res) => {
  const id = idParam(req);
  const u = loadUpload(id);
  checkKind(req, u.kind, u.kind === 'results');
  if (u.status !== 'applied') throw new ApiError(409, 'UPLOAD_NOT_APPLIED');
  try {
    revertUpload(u.kind, u.changes);
  } catch (e) {
    if (e instanceof Error && e.message === 'FORM_NOT_DRAFT') throw new ApiError(409, 'FORM_NOT_DRAFT');
    throw e;
  }
  run(`UPDATE csv_uploads SET status = 'reverted', reverted_by = ?, reverted_at = ?, updated_at = ? WHERE id = ?`, [req.user!.id, now(), now(), id]);
  audit(req, 'upload.revert', 'csv_upload', id, { kind: u.kind, changes: u.changes.length });
  res.json(withValidation(loadUpload(id)));
}));

/** 스테이징/승인대기 파일 취소 */
uploadsRouter.delete('/:id', h((req, res) => {
  const id = idParam(req);
  const u = loadUpload(id);
  checkKind(req, u.kind);
  if (!['staged', 'pending_approval'].includes(u.status)) throw new ApiError(409, 'UPLOAD_NOT_EDITABLE');
  run(`UPDATE csv_uploads SET status = 'cancelled', rows = '[]', updated_at = ? WHERE id = ?`, [now(), id]);
  audit(req, 'upload.cancel', 'csv_upload', id, { fileName: u.file_name });
  res.json({ ok: true });
}));
