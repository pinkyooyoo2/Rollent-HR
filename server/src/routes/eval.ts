/**
 * 팀원·팀장·임원용 평가 사이트 API (/api/eval)
 *
 * 원칙: 로그인한 사용자 "본인이 평가자인" 배정만 다루며, 평가 작성에 필요한 최소 정보만 반환한다.
 *  - 대상자 정보: 이름·부서·직급만 (사번·연락처·인사정보 없음)
 *  - 점수·가중치·결과·다른 평가자의 응답·대상자의 자기평가 내용은 반환하지 않음
 *  - 제출된 평가는 응답 내용도 다시 보여주지 않고 제출 완료 상태만 반환
 *  - 다른 사람의 배정 ID 를 넣으면 존재 여부도 알 수 없도록 404
 *
 * 자동저장: 클라이언트가 보내는 seq(단조 증가 값)가 저장된 값보다 클 때만 반영 →
 *          늦게 도착한 이전 요청이 최신 응답을 덮어쓰지 않음.
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import { all, get, run, tx, now } from '../db/index.ts';
import { h, parse, audit, ApiError, notFound, idParam } from '../http.ts';
import { requirePerm } from '../auth.ts';
import { config } from '../config.ts';
import { getFormFull, publishedFormId } from '../services/forms.ts';
import {
  stageIsOpen, previousStagesDone, stageDeadline, deadlinePassed, evalTypeOf, validateAnswers,
} from '../services/rounds.ts';
import { isAnswered, loadAnswers, saveAssignmentScore, type Stage } from '../scoring.ts';

export const evalRouter = Router();
evalRouter.use(requirePerm('evaluate'));

const SELECT = `
  SELECT a.id, a.round_id, a.stage, a.status, a.form_id, a.submitted_at, a.last_saved_at, a.save_seq, a.evaluator_employee_id,
    a.target_employee_id, t.job_group,
    r.name AS round_name, r.status AS round_status, r.enforce_sequence, r.end_date,
    r.self_status, r.leader_status, r.exec_status, r.upward_status,
    r.self_end_date, r.leader_end_date, r.exec_end_date, r.upward_end_date,
    e.name AS target_name, d.name AS target_department, e.position AS target_position,
    (SELECT 1 FROM result_finalizations f WHERE f.round_id = a.round_id AND f.employee_id = a.target_employee_id AND f.status = 'finalized') AS finalized
  FROM evaluation_assignments a
  JOIN evaluation_rounds r ON r.id = a.round_id AND r.deleted_at IS NULL
  JOIN round_targets t ON t.round_id = a.round_id AND t.employee_id = a.target_employee_id
  JOIN employees e ON e.id = a.target_employee_id
  LEFT JOIN departments d ON d.id = e.department_id`;

type EvalState = 'not_started' | 'in_progress' | 'submitted' | 'closed' | 'not_open' | 'waiting';

/** 평가자 화면 상태: 미시작/작성 중/제출 완료/마감 + 시작 전(단계 미오픈)/대기(선행 평가 미완료) */
function stateOf(a: any): { state: EvalState; editable: boolean } {
  if (a.status === 'submitted') return { state: 'submitted', editable: false };
  const stage = a.stage as Stage;
  if (a.round_status === 'closed' || a[`${stage}_status`] === 'closed' || deadlinePassed(a, stage) || a.finalized) return { state: 'closed', editable: false };
  if (!stageIsOpen(a, stage)) return { state: 'not_open', editable: false };
  if (a.enforce_sequence && !previousStagesDone(a.round_id, a.target_employee_id, stage)) return { state: 'waiting', editable: false };
  return { state: a.status as EvalState, editable: true };
}

/** 목록·상세 공통 요약 (최소 정보) */
function summary(a: any) {
  const { state, editable } = stateOf(a);
  const dl = stageDeadline(a, a.stage);
  return {
    id: a.id,
    round_id: a.round_id,
    round_name: a.round_name,
    eval_type: evalTypeOf(a.stage, a.job_group),
    target: a.stage === 'self' ? null : { name: a.target_name, department: a.target_department, position: a.target_position },
    state,
    editable,
    deadline_date: dl.date,
    deadline_at: dl.at,
    submitted_at: a.submitted_at,
    last_saved_at: state === 'submitted' ? null : a.last_saved_at,
  };
}

/** 본인 배정만 조회. 남의 배정이면 존재 여부를 숨기기 위해 404 */
function ownAssignment(req: Request, id: number) {
  const empId = req.user!.employee_id;
  const a = empId ? get<any>(`${SELECT} WHERE a.id = ? AND a.evaluator_employee_id = ?`, [id, empId]) : undefined;
  if (!a || a.round_status === 'draft') throw notFound();
  return a;
}

/** 평가자에게 보여줄 양식: 문항·선택지·배점·필수 여부만 (작성자·버전 메모 등 관리 정보 제외) */
function formForEvaluator(formId: number) {
  const f = getFormFull(formId);
  if (!f) return null;
  return {
    name: f.name,
    description: f.description,
    sections: f.sections.map((s: any) => ({
      id: s.id, title: s.title, description: s.description,
      questions: s.questions.map((q: any) => ({
        id: q.id, type: q.type, text: q.text, description: q.description, required: !!q.required, points: q.points, scored: !!q.scored,
        settings: q.settings, is_suggestion: !!q.is_suggestion, options: q.options.map((o: any) => ({ id: o.id, label: o.label, score: o.score })),
      })),
    })),
  };
}

const timeInfo = () => ({ server_now: new Date().toISOString(), tz_offset: config.tzOffset });

/** 내 평가 목록: 진행 중(open) 차수의 본인 배정 */
evalRouter.get('/home', h((req, res) => {
  const empId = req.user!.employee_id;
  const rows = empId ? all<any>(`${SELECT} WHERE a.evaluator_employee_id = ? AND r.status = 'open'
    ORDER BY r.start_date DESC, CASE a.stage WHEN 'self' THEN 0 WHEN 'upward' THEN 1 WHEN 'leader' THEN 2 ELSE 3 END, e.name`, [empId]) : [];
  res.json({
    me: { name: req.user!.display_name, role: req.user!.role },
    ...timeInfo(),
    items: rows.map(summary),
  });
}));

/** 평가 작성 화면: 작성 가능할 때만 양식과 본인이 저장한 응답을 반환 */
evalRouter.get('/assignments/:id', h((req, res) => {
  const a = ownAssignment(req, idParam(req));
  const s = summary(a);
  if (!s.editable) { res.json({ ...timeInfo(), assignment: s }); return; }
  const formId = a.form_id ?? publishedFormId(a.stage, a.job_group);
  if (!formId) throw new ApiError(409, 'NO_PUBLISHED_FORM');
  res.json({
    ...timeInfo(),
    assignment: s,
    form: formForEvaluator(formId),
    answers: Object.fromEntries(loadAnswers(a.id)),
    save_seq: a.save_seq,
  });
}));

const answerSchema = z.object({
  text: z.string().max(10000).optional(),
  optionId: z.number().int().optional(),
  optionIds: z.array(z.number().int()).max(50).optional(),
  value: z.number().optional(),
});
const bodySchema = z.object({ answers: z.record(answerSchema), seq: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });

/** 작성 가능 여부 재검증 (서버 시간 기준 마감 포함) */
function assertEditable(a: any) {
  const { state, editable } = stateOf(a);
  if (editable) return;
  const code = state === 'submitted' ? 'ALREADY_SUBMITTED' : state === 'closed' ? 'DEADLINE_PASSED' : state === 'waiting' ? 'PREVIOUS_STAGE_PENDING' : 'STAGE_NOT_OPEN';
  throw new ApiError(409, code);
}

/** 응답 저장 (자동저장·제출 공통): 양식 버전 고정 + 응답 교체 */
function storeAnswers(a: any, answers: Record<string, any>, seq: number) {
  const formId = a.form_id ?? publishedFormId(a.stage, a.job_group);
  if (!formId) throw new ApiError(409, 'NO_PUBLISHED_FORM');
  const form = getFormFull(formId)!;
  const questions = form.sections.flatMap((s: any) => s.questions);
  validateAnswers(questions, answers);
  run('DELETE FROM evaluation_responses WHERE assignment_id = ?', [a.id]);
  for (const [qid, ans] of Object.entries(answers)) {
    run('INSERT INTO evaluation_responses (assignment_id, question_id, answer, updated_at) VALUES (?, ?, ?, ?)', [a.id, Number(qid), JSON.stringify(ans), now()]);
  }
  // 첫 저장 시점의 게시 양식 버전으로 고정 → 이후 관리자가 새 버전을 게시해도 작성 중 응답이 손상되지 않음
  run(`UPDATE evaluation_assignments SET form_id = ?, status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
       save_seq = ?, last_saved_at = ?, updated_at = ? WHERE id = ?`, [formId, seq, now(), now(), a.id]);
  return { formId, questions };
}

/** 자동저장: 최종 제출과 구분 (상태는 '작성 중') */
evalRouter.put('/assignments/:id/draft', h((req, res) => {
  const id = idParam(req);
  const b = parse(bodySchema, req.body);
  const out = tx(() => {
    const a = ownAssignment(req, id);
    assertEditable(a);
    // 이미 더 최신 내용이 저장되어 있으면 무시 (요청 순서 역전 대비)
    if (b.seq <= a.save_seq) return { stale: true, seq: a.save_seq, saved_at: a.last_saved_at };
    storeAnswers(a, b.answers, b.seq);
    return { stale: false, seq: b.seq, saved_at: now() };
  });
  res.json({ ok: true, ...out });
}));

/** 최종 제출: 필수 응답 검증 → 최신 응답 저장 → 제출 시각 기록 → 이후 수정 불가 (관리자 재오픈 시에만 가능) */
evalRouter.post('/assignments/:id/submit', h((req, res) => {
  const id = idParam(req);
  const b = parse(bodySchema, req.body);
  const submittedAt = tx(() => {
    const a = ownAssignment(req, id);
    assertEditable(a);
    // 다른 창에서 더 최신 내용이 저장된 경우 제출하지 않고 새로고침 안내
    if (b.seq < a.save_seq) throw new ApiError(409, 'STALE_DRAFT');
    const formId = a.form_id ?? publishedFormId(a.stage, a.job_group);
    const form = formId ? getFormFull(formId) : null;
    if (!form) throw new ApiError(409, 'NO_PUBLISHED_FORM');
    const questions = form.sections.flatMap((s: any) => s.questions);
    const missing = questions.filter((q: any) => q.required && !isAnswered(q.type, b.answers[q.id])).map((q: any) => q.id);
    if (missing.length) throw new ApiError(400, 'REQUIRED_MISSING', undefined, { questionIds: missing });
    const stored = storeAnswers(a, b.answers, Math.max(b.seq, a.save_seq + 1));
    const at = now();
    run(`UPDATE evaluation_assignments SET status = 'submitted', submitted_at = ?, submitted_by = ?, updated_at = ? WHERE id = ?`, [at, req.user!.id, at, id]);
    saveAssignmentScore(id, stored.formId);
    return at;
  });
  const a = get<any>(`${SELECT} WHERE a.id = ?`, [id]);
  audit(req, 'assignment.submit', 'assignment', id, { round: a.round_id, stage: a.stage, eval_type: evalTypeOf(a.stage, a.job_group), via: 'evaluator_site' });
  res.json({ ok: true, submitted_at: submittedAt });
}));
