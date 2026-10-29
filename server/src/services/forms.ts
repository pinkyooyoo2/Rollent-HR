import { all, get, run, tx, parseJson, now } from '../db/index.ts';
import { formGroupFor } from '../scoring.ts';
import type { FormTemplate } from '../db/formTemplates.ts';

export interface OptionInput { id?: number; label: string; score: number }
export interface QuestionInput {
  id?: number;
  type: string;
  text: string;
  description?: string | null;
  required: boolean;
  points: number;
  scored: boolean;
  settings?: Record<string, unknown> | null;
  is_sample?: boolean;
  is_suggestion?: boolean;
  options?: OptionInput[];
}
export interface SectionInput {
  id?: number;
  title: string;
  description?: string | null;
  questions: QuestionInput[];
}

const TEXT_TYPES = ['short_text', 'long_text'];

export function getFormFull(formId: number) {
  const form = get<any>(
    `SELECT f.*, u.display_name AS created_by_name,
       (SELECT COUNT(*) FROM evaluation_assignments a WHERE a.form_id = f.id) AS usage_count
     FROM evaluation_forms f LEFT JOIN users u ON u.id = f.created_by WHERE f.id = ?`, [formId]);
  if (!form) return undefined;
  const sections = all<any>('SELECT * FROM form_sections WHERE form_id = ? ORDER BY sort_order, id', [formId]);
  const questions = all<any>('SELECT * FROM form_questions WHERE form_id = ? ORDER BY sort_order, id', [formId]);
  const options = all<any>(
    `SELECT o.* FROM question_options o JOIN form_questions q ON q.id = o.question_id
     WHERE q.form_id = ? ORDER BY o.sort_order, o.id`, [formId]);
  const qs = questions.map((q) => ({
    ...q,
    required: !!q.required,
    scored: !!q.scored,
    is_sample: !!q.is_sample,
    is_suggestion: !!q.is_suggestion,
    settings: parseJson(q.settings, null),
    options: options.filter((o) => o.question_id === q.id),
  }));
  const secs = sections.map((s) => ({ ...s, questions: qs.filter((q) => q.section_id === s.id) }));
  const orphan = qs.filter((q) => !q.section_id || !sections.some((s) => s.id === q.section_id));
  if (orphan.length) secs.push({ id: 0, form_id: formId, title: '', description: null, sort_order: 9999, questions: orphan });
  const totalPoints = qs.filter((q) => q.scored).reduce((s, q) => s + q.points, 0);
  return { ...form, sections: secs, total_points: Math.round(totalPoints * 100) / 100, question_count: qs.length };
}

/** 양식 내용 전체 교체 (초안 상태에서만 호출) */
export function replaceFormContent(formId: number, sections: SectionInput[]) {
  tx(() => {
    run('DELETE FROM form_questions WHERE form_id = ?', [formId]);
    run('DELETE FROM form_sections WHERE form_id = ?', [formId]);
    sections.forEach((s, si) => {
      const sid = run('INSERT INTO form_sections (form_id, title, description, sort_order) VALUES (?, ?, ?, ?)',
        [formId, s.title, s.description ?? null, si]).lastInsertRowid;
      s.questions.forEach((q, qi) => {
        const scored = TEXT_TYPES.includes(q.type) ? false : q.scored;
        const qid = run(
          `INSERT INTO form_questions (form_id, section_id, sort_order, type, text, description, required, points, scored, settings, is_sample, is_suggestion)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [formId, sid, qi, q.type, q.text, q.description ?? null, q.required, scored ? q.points : 0, scored,
            q.settings ? JSON.stringify(q.settings) : null, q.is_sample ?? false, q.is_suggestion ?? false],
        ).lastInsertRowid;
        (q.options ?? []).forEach((o, oi) => {
          run('INSERT INTO question_options (question_id, sort_order, label, score) VALUES (?, ?, ?, ?)', [qid, oi, o.label, o.score]);
        });
      });
    });
    run('UPDATE evaluation_forms SET updated_at = ? WHERE id = ?', [now(), formId]);
  });
}

export function nextVersion(stage: string, jobGroup: string): number {
  const r = get<{ v: number }>('SELECT COALESCE(MAX(version), 0) AS v FROM evaluation_forms WHERE stage = ? AND job_group = ?', [stage, jobGroup]);
  return (r?.v ?? 0) + 1;
}

export function createFormFromTemplate(t: FormTemplate, userId: number | null, status: 'draft' | 'published') {
  return tx(() => {
    const id = run(
      `INSERT INTO evaluation_forms (stage, job_group, name, description, version, status, source, created_by, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.stage, t.job_group, t.name, t.description, nextVersion(t.stage, t.job_group), status, t.source, userId,
        status === 'published' ? now() : null],
    ).lastInsertRowid;
    replaceFormContent(id, t.sections.map((s) => ({
      title: s.title, description: s.description, questions: s.questions.map((q) => ({ ...q, options: q.options })),
    })));
    return id;
  });
}

/** 기존 양식을 복제하여 새 초안 버전 생성 */
export function cloneFormAsDraft(formId: number, userId: number) {
  const full = getFormFull(formId);
  if (!full) throw new Error('form not found');
  return tx(() => {
    const id = run(
      `INSERT INTO evaluation_forms (stage, job_group, name, description, version, status, parent_id, source, created_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [full.stage, full.job_group, full.name, full.description, nextVersion(full.stage, full.job_group), formId, full.source, userId],
    ).lastInsertRowid;
    replaceFormContent(id, full.sections.map((s: any) => ({
      title: s.title, description: s.description,
      questions: s.questions.map((q: any) => ({ ...q, options: q.options.map((o: any) => ({ label: o.label, score: o.score })) })),
    })));
    return id;
  });
}

export function publishForm(formId: number) {
  const f = get<any>('SELECT stage, job_group FROM evaluation_forms WHERE id = ?', [formId]);
  tx(() => {
    run(`UPDATE evaluation_forms SET status = 'archived', updated_at = ? WHERE stage = ? AND job_group = ? AND status = 'published'`,
      [now(), f.stage, f.job_group]);
    run(`UPDATE evaluation_forms SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?`, [now(), now(), formId]);
  });
}

export function publishedFormId(stage: string, jobGroup: string): number | null {
  return get<{ id: number }>(
    `SELECT id FROM evaluation_forms WHERE stage = ? AND job_group = ? AND status = 'published' ORDER BY version DESC LIMIT 1`,
    [stage, formGroupFor(stage, jobGroup)])?.id ?? null;
}
