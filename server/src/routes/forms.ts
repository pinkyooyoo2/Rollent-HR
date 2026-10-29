import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, now } from '../db/index.ts';
import { h, parse, audit, ApiError, notFound, idParam } from '../http.ts';
import { requirePerm } from '../auth.ts';
import { sendCsv } from '../csv.ts';
import { getFormFull, replaceFormContent, cloneFormAsDraft, publishForm, nextVersion } from '../services/forms.ts';
import { TYPE_LABEL_KO, formatOptions } from '../services/csvKinds.ts';

export const formsRouter = Router();

const QTYPES = ['short_text', 'long_text', 'single_choice', 'checkbox', 'dropdown', 'score_scale', 'linear_scale', 'descriptive'] as const;
const STAGES = ['self', 'leader', 'exec', 'upward'] as const;
const GROUPS = ['office_member', 'office_leader', 'production_member', 'production_leader', 'common'] as const;

formsRouter.get('/', requirePerm('forms.view', 'rounds.view'), h((req, res) => {
  const where: string[] = [];
  const params: unknown[] = [];
  if (req.query.stage) { where.push('f.stage = ?'); params.push(String(req.query.stage)); }
  if (req.query.jobGroup) { where.push('f.job_group = ?'); params.push(String(req.query.jobGroup)); }
  const rows = all(`
    SELECT f.id, f.stage, f.job_group, f.name, f.version, f.status, f.updated_at, f.published_at, f.parent_id, f.source,
      (SELECT COUNT(*) FROM form_questions q WHERE q.form_id = f.id) AS question_count,
      (SELECT COALESCE(SUM(points), 0) FROM form_questions q WHERE q.form_id = f.id AND q.scored = 1) AS total_points,
      (SELECT COUNT(*) FROM evaluation_assignments a WHERE a.form_id = f.id) AS usage_count,
      u.display_name AS created_by_name
    FROM evaluation_forms f LEFT JOIN users u ON u.id = f.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY f.stage, f.job_group, f.version DESC`, params);
  res.json({ items: rows });
}));

formsRouter.get('/template.csv', requirePerm('forms.view'), h((_req, res) => {
  sendCsv(res, 'question_template.csv', ['섹션', '질문', '유형', '선택지', '배점', '필수', '점수반영', '설명'], [
    ['업무성과 · 업무의 양과 질', '평가대상기간 중 수행한 업무량이 다른 직원들에 비해 상대적으로 많다', '점수척도형', 'A:5|B:4|C:3|D:2|E:1', '1.6', 'Y', 'Y', ''],
    ['자기관찰', '업무의 양', '객관식', '너무 많다|약간 많다|알맞다|약간 적다|너무 적다', '0', 'Y', 'N', ''],
    ['자기관찰', '현재 주요 담당 업무', '장문형', '', '0', 'Y', 'N', ''],
    ['샘플', '(샘플) 업무 몰입도', '선형배율형', '1:5', '2', 'N', 'Y', '1~5 선형 배율 예시'],
  ]);
}));

formsRouter.get('/:id', requirePerm('forms.view', 'rounds.view', 'evaluate'), h((req, res) => {
  const f = getFormFull(idParam(req));
  if (!f) throw notFound();
  res.json(f);
}));

formsRouter.get('/:id/export.csv', requirePerm('forms.view'), h((req, res) => {
  const f = getFormFull(idParam(req));
  if (!f) throw notFound();
  const rows: unknown[][] = [];
  for (const s of f.sections) {
    for (const q of s.questions) {
      rows.push([s.title, q.text, TYPE_LABEL_KO[q.type], formatOptions(q), q.points, q.required ? 'Y' : 'N', q.scored ? 'Y' : 'N', q.description ?? '']);
    }
  }
  audit(req, 'form.export', 'form', f.id);
  sendCsv(res, `questions_${f.stage}_${f.job_group}_v${f.version}.csv`, ['섹션', '질문', '유형', '선택지', '배점', '필수', '점수반영', '설명'], rows);
}));

formsRouter.post('/', requirePerm('forms.manage'), h((req, res) => {
  const b = parse(z.object({
    stage: z.enum(STAGES), job_group: z.enum(GROUPS), name: z.string().trim().min(1).max(200), description: z.string().max(1000).optional(),
  }), req.body);
  const id = run(`INSERT INTO evaluation_forms (stage, job_group, name, description, version, status, created_by) VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
    [b.stage, b.job_group, b.name, b.description ?? null, nextVersion(b.stage, b.job_group), req.user!.id]).lastInsertRowid;
  replaceFormContent(id, [{
    title: '기타 건의사항',
    questions: [{ type: 'long_text', text: '기타 건의사항', description: '* 예) 부패, 횡령 등 고발 / 비윤리적 이슈 제보 / 이해관계 상충, 고충 등 (점수 미반영)', required: false, points: 0, scored: false, is_suggestion: true }],
  }]);
  audit(req, 'form.create', 'form', id, b);
  res.status(201).json(getFormFull(id));
}));

const optionSchema = z.object({ label: z.string().trim().min(1).max(200), score: z.number().min(-1000).max(1000) });
const questionSchema = z.object({
  type: z.enum(QTYPES),
  text: z.string().trim().min(1).max(1000),
  description: z.string().max(2000).nullable().optional(),
  required: z.boolean(),
  points: z.number().min(0).max(1000),
  scored: z.boolean(),
  settings: z.record(z.unknown()).nullable().optional(),
  is_sample: z.boolean().optional(),
  is_suggestion: z.boolean().optional(),
  options: z.array(optionSchema).max(50).optional(),
});
const contentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  sections: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(1000).nullable().optional(),
    questions: z.array(questionSchema).max(200),
  })).max(100),
});

const CHOICE_TYPES = ['single_choice', 'checkbox', 'dropdown', 'score_scale', 'descriptive'];

formsRouter.put('/:id', requirePerm('forms.manage'), h((req, res) => {
  const id = idParam(req);
  const f = get<any>('SELECT * FROM evaluation_forms WHERE id = ?', [id]);
  if (!f) throw notFound();
  if (f.status !== 'draft') throw new ApiError(409, 'FORM_NOT_DRAFT');
  const b = parse(contentSchema, req.body);
  const issues: { path: string; message: string }[] = [];
  b.sections.forEach((s, si) => s.questions.forEach((q, qi) => {
    if (CHOICE_TYPES.includes(q.type) && (q.options?.length ?? 0) < 1) issues.push({ path: `sections.${si}.questions.${qi}.options`, message: 'OPTIONS_REQUIRED' });
  }));
  if (issues.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid form', issues);
  run('UPDATE evaluation_forms SET name = ?, description = ?, updated_at = ? WHERE id = ?', [b.name, b.description ?? null, now(), id]);
  replaceFormContent(id, b.sections);
  audit(req, 'form.update', 'form', id, { sections: b.sections.length, questions: b.sections.reduce((n, s) => n + s.questions.length, 0) });
  res.json(getFormFull(id));
}));

formsRouter.post('/:id/clone', requirePerm('forms.manage'), h((req, res) => {
  const id = idParam(req);
  if (!get('SELECT id FROM evaluation_forms WHERE id = ?', [id])) throw notFound();
  const existingDraft = get<any>(`SELECT d.id FROM evaluation_forms d JOIN evaluation_forms f ON f.stage = d.stage AND f.job_group = d.job_group
    WHERE f.id = ? AND d.status = 'draft'`, [id]);
  if (existingDraft) throw new ApiError(409, 'DRAFT_EXISTS', undefined, { draftId: existingDraft.id });
  const newId = cloneFormAsDraft(id, req.user!.id);
  audit(req, 'form.new_version', 'form', newId, { from: id });
  res.status(201).json(getFormFull(newId));
}));

formsRouter.post('/:id/publish', requirePerm('forms.manage'), h((req, res) => {
  const id = idParam(req);
  const f = getFormFull(id);
  if (!f) throw notFound();
  if (f.status !== 'draft') throw new ApiError(409, 'FORM_NOT_DRAFT');
  if (f.question_count === 0) throw new ApiError(400, 'FORM_EMPTY');
  publishForm(id);
  audit(req, 'form.publish', 'form', id, { stage: f.stage, job_group: f.job_group, version: f.version });
  res.json(getFormFull(id));
}));

formsRouter.delete('/:id', requirePerm('forms.manage'), h((req, res) => {
  const id = idParam(req);
  const f = get<any>(`SELECT f.*, (SELECT COUNT(*) FROM evaluation_assignments a WHERE a.form_id = f.id) AS usage_count FROM evaluation_forms f WHERE id = ?`, [id]);
  if (!f) throw notFound();
  if (f.status !== 'draft' || f.usage_count > 0) throw new ApiError(409, 'FORM_IN_USE');
  run('UPDATE evaluation_forms SET parent_id = NULL WHERE parent_id = ?', [id]);
  run('DELETE FROM evaluation_forms WHERE id = ?', [id]);
  audit(req, 'form.delete', 'form', id, { name: f.name, version: f.version });
  res.json({ ok: true });
}));
