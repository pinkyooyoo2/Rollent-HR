import { Router, type Request } from 'express';
import { z } from 'zod';
import { all, get, run, tx, now, parseJson } from '../db/index.ts';
import { h, parse, audit, ApiError, notFound, idParam } from '../http.ts';
import { requirePerm, requireAuth, hasPerm } from '../auth.ts';
import { TEMPLATE_WEIGHTS } from '../db/formTemplates.ts';
import { addRoundTargets, autoAssign, stageIsOpen, previousStagesDone, validateAnswers, deadlinePassed } from '../services/rounds.ts';
import { publishedFormId, getFormFull } from '../services/forms.ts';
import { computeRoundResults, getRoundWeights, saveAssignmentScore, isAnswered, loadAnswers, JOB_GROUPS, STAGES, type Stage, type Answer, EXECUTIVE_GROUP, isLeaderGroup } from '../scoring.ts';

export const roundsRouter = Router();
roundsRouter.use(requireAuth);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const roundSchema = z.object({
  name: z.string().trim().min(1).max(200),
  year: z.number().int().min(2000).max(2100),
  period_start: dateStr.nullable().optional(),
  period_end: dateStr.nullable().optional(),
  start_date: dateStr,
  end_date: dateStr,
  enforce_sequence: z.boolean(),
  upward_enabled: z.boolean().optional(),
  // 평가 유형별 마감일 (비우면 차수 종료일)
  self_end_date: dateStr.nullable().optional(),
  leader_end_date: dateStr.nullable().optional(),
  exec_end_date: dateStr.nullable().optional(),
  upward_end_date: dateStr.nullable().optional(),
}).refine((r) => r.start_date <= r.end_date, { message: 'END_BEFORE_START', path: ['end_date'] })
  .refine((r) => STAGES.every((s) => !r[`${s}_end_date`] || r[`${s}_end_date`]! >= r.start_date), { message: 'END_BEFORE_START', path: ['end_date'] });
const stageEnds = (b: z.infer<typeof roundSchema>) => STAGES.map((s) => b[`${s}_end_date`] ?? null);

function loadRound(id: number) {
  const r = get<any>('SELECT * FROM evaluation_rounds WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!r) throw notFound();
  return r;
}

roundsRouter.get('/', requirePerm('rounds.view', 'results.view', 'dashboard.view'), h((_req, res) => {
  const rows = all<any>(`
    SELECT r.*, (SELECT COUNT(*) FROM round_targets t WHERE t.round_id = r.id) AS target_count,
      (SELECT COUNT(*) FROM evaluation_assignments a WHERE a.round_id = r.id AND a.status = 'submitted') AS submitted_count,
      (SELECT COUNT(*) FROM evaluation_assignments a WHERE a.round_id = r.id) AS assignment_count
    FROM evaluation_rounds r WHERE r.deleted_at IS NULL ORDER BY r.start_date DESC, r.id DESC`);
  res.json({ items: rows });
}));

roundsRouter.post('/', requirePerm('rounds.manage'), h((req, res) => {
  const b = parse(roundSchema.and(z.object({ autoTargets: z.boolean().optional(), copyWeightsFrom: z.number().int().optional() })), req.body);
  const id = tx(() => {
    const rid = run(`INSERT INTO evaluation_rounds (name, year, period_start, period_end, start_date, end_date, enforce_sequence, upward_enabled,
        self_end_date, leader_end_date, exec_end_date, upward_end_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [b.name, b.year, b.period_start ?? null, b.period_end ?? null, b.start_date, b.end_date, b.enforce_sequence,
      b.upward_enabled ?? true, ...stageEnds(b), req.user!.id]).lastInsertRowid;
    const src = b.copyWeightsFrom ? all<any>('SELECT * FROM evaluation_weights WHERE round_id = ?', [b.copyWeightsFrom]) : [];
    if (src.length) {
      for (const w of src) run('INSERT INTO evaluation_weights (round_id, job_group, self_weight, leader_weight, exec_weight, upward_weight, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [rid, w.job_group, w.self_weight, w.leader_weight, w.exec_weight, w.upward_weight ?? 0, req.user!.id]);
    } else {
      for (const [g, w] of Object.entries(TEMPLATE_WEIGHTS)) run('INSERT INTO evaluation_weights (round_id, job_group, self_weight, leader_weight, exec_weight, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
        [rid, g, w[0], w[1], w[2], req.user!.id]);
    }
    if (b.autoTargets !== false) {
      addRoundTargets(rid);
      autoAssign(rid);
    }
    return rid;
  });
  audit(req, 'round.create', 'round', id, b);
  res.status(201).json(loadRound(id));
}));

roundsRouter.put('/:id', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  const before = loadRound(id);
  const b = parse(roundSchema, req.body);
  const upward = b.upward_enabled ?? !!before.upward_enabled;
  tx(() => {
    run(`UPDATE evaluation_rounds SET name = ?, year = ?, period_start = ?, period_end = ?, start_date = ?, end_date = ?, enforce_sequence = ?, upward_enabled = ?,
         self_end_date = ?, leader_end_date = ?, exec_end_date = ?, upward_end_date = ?, updated_at = ? WHERE id = ?`,
      [b.name, b.year, b.period_start ?? null, b.period_end ?? null, b.start_date, b.end_date, b.enforce_sequence, upward, ...stageEnds(b), now(), id]);
    // 팀원→팀장평가 실시 여부 변경: 켜면 배정 생성, 끄면 아직 시작하지 않은 배정만 제거 (작성 중·제출된 응답은 보존)
    if (upward && !before.upward_enabled) autoAssign(id);
    if (!upward && before.upward_enabled) run(`DELETE FROM evaluation_assignments WHERE round_id = ? AND stage = 'upward' AND status = 'not_started'`, [id]);
  });
  audit(req, 'round.update', 'round', id, { before, after: b });
  res.json(loadRound(id));
}));

roundsRouter.delete('/:id', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  const r = loadRound(id);
  const used = get<{ c: number }>(`SELECT COUNT(*) AS c FROM evaluation_assignments WHERE round_id = ? AND status <> 'not_started'`, [id])!.c;
  if (used > 0) throw new ApiError(409, 'ROUND_HAS_RESPONSES');
  run('UPDATE evaluation_rounds SET deleted_at = ? WHERE id = ?', [now(), id]);
  audit(req, 'round.delete', 'round', id, { name: r.name });
  res.json({ ok: true });
}));

/** 차수 상태: draft(준비) / open(진행) / closed(마감) */
roundsRouter.post('/:id/status', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  const r = loadRound(id);
  const { status } = parse(z.object({ status: z.enum(['draft', 'open', 'closed']) }), req.body);
  tx(() => {
    run('UPDATE evaluation_rounds SET status = ?, updated_at = ? WHERE id = ?', [status, now(), id]);
    if (status === 'closed') run(`UPDATE evaluation_rounds SET self_status = 'closed', leader_status = 'closed', exec_status = 'closed', upward_status = 'closed' WHERE id = ?`, [id]);
    if (status === 'open' && r.self_status === 'pending') run(`UPDATE evaluation_rounds SET self_status = 'open' WHERE id = ?`, [id]);
    if (status === 'open' && r.upward_status === 'pending') run(`UPDATE evaluation_rounds SET upward_status = 'open' WHERE id = ?`, [id]);
  });
  audit(req, status === 'closed' ? 'round.close' : status === 'open' ? (r.status === 'closed' ? 'round.reopen' : 'round.open') : 'round.set_draft', 'round', id, { from: r.status, to: status });
  res.json(loadRound(id));
}));

/** 단계별 오픈/마감 (운영 정책에 따라 자유롭게 변경) */
roundsRouter.post('/:id/stage', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  const r = loadRound(id);
  const b = parse(z.object({ stage: z.enum(['self', 'leader', 'exec', 'upward']), status: z.enum(['pending', 'open', 'closed']) }), req.body);
  run(`UPDATE evaluation_rounds SET ${b.stage}_status = ?, updated_at = ? WHERE id = ?`, [b.status, now(), id]);
  audit(req, 'round.stage_status', 'round', id, { stage: b.stage, from: r[`${b.stage}_status`], to: b.status });
  res.json(loadRound(id));
}));

roundsRouter.post('/:id/policy', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  loadRound(id);
  const { enforce_sequence } = parse(z.object({ enforce_sequence: z.boolean() }), req.body);
  run('UPDATE evaluation_rounds SET enforce_sequence = ?, updated_at = ? WHERE id = ?', [enforce_sequence, now(), id]);
  audit(req, 'round.policy', 'round', id, { enforce_sequence });
  res.json(loadRound(id));
}));

/* ───────────── 가중치 ───────────── */

roundsRouter.get('/:id/weights', requirePerm('rounds.view', 'results.view', 'forms.view'), h((req, res) => {
  const id = idParam(req);
  loadRound(id);
  const history = all<any>(`SELECT h.*, u.display_name AS changed_by_name FROM weight_history h LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.round_id = ? ORDER BY h.id DESC LIMIT 100`, [id]).map((x) => ({ ...x, before: parseJson(x.before_json, null), after: parseJson(x.after_json, null) }));
  res.json({ weights: getRoundWeights(id), history });
}));

const weightTriple = z.object({
  self: z.number().min(0).max(100), leader: z.number().min(0).max(100), exec: z.number().min(0).max(100),
  upward: z.number().min(0).max(100).default(0),
});
type WeightIn = { self: number; leader: number; exec: number; upward?: number };

roundsRouter.put('/:id/weights', requirePerm('weights.manage'), h((req, res) => {
  const id = idParam(req);
  loadRound(id);
  const b = parse(z.object({
    default: weightTriple,
    overrides: z.record(z.enum(JOB_GROUPS), weightTriple.nullable()),
    reason: z.string().max(500).optional(),
  }), req.body);
  const sumOk = (w: WeightIn) => Math.abs(w.self + w.leader + w.exec + (w.upward ?? 0) - 100) < 0.001;
  if (!sumOk(b.default) || Object.values(b.overrides).some((w) => w && !sumOk(w))) throw new ApiError(400, 'WEIGHT_SUM_NOT_100');
  // 팀원→팀장평가는 팀장 대상자에게만 적용 (기본값·팀원 직군은 0이어야 함)
  if ((b.default.upward ?? 0) > 0 || Object.entries(b.overrides).some(([g, w]) => w && (w.upward ?? 0) > 0 && !isLeaderGroup(g))) throw new ApiError(400, 'UPWARD_ONLY_FOR_LEADERS');
  const before = getRoundWeights(id);
  tx(() => {
    const upsert = (g: string, w: WeightIn) => {
      run(`INSERT INTO evaluation_weights (round_id, job_group, self_weight, leader_weight, exec_weight, upward_weight, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(round_id, job_group) DO UPDATE SET self_weight = excluded.self_weight, leader_weight = excluded.leader_weight,
           exec_weight = excluded.exec_weight, upward_weight = excluded.upward_weight, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [id, g, w.self, w.leader, w.exec, w.upward ?? 0, req.user!.id, now()]);
    };
    upsert('default', b.default);
    for (const g of JOB_GROUPS) {
      const w = b.overrides[g];
      if (w) upsert(g, w);
      else if (w === null) run('DELETE FROM evaluation_weights WHERE round_id = ? AND job_group = ?', [id, g]);
    }
    const after = getRoundWeights(id);
    for (const g of ['default', ...JOB_GROUPS]) {
      const x = before[g];
      const y = after[g];
      if (x.self !== y.self || x.leader !== y.leader || x.exec !== y.exec || x.upward !== y.upward || x.overridden !== y.overridden) {
        run('INSERT INTO weight_history (round_id, job_group, before_json, after_json, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?)',
          [id, g, JSON.stringify(x), JSON.stringify(y), b.reason ?? null, req.user!.id]);
      }
    }
    // 새로 필요한 단계의 배정 생성 (기존 배정은 유지)
    autoAssign(id);
  });
  audit(req, 'weights.update', 'round', id, { default: b.default, overrides: b.overrides, reason: b.reason });
  res.json({ weights: getRoundWeights(id) });
}));

/* ───────────── 대상자 / 배정 ───────────── */

roundsRouter.get('/:id/progress', requirePerm('rounds.view'), h((req, res) => {
  const id = idParam(req);
  const round = loadRound(id);
  const results = computeRoundResults(id);
  // 점수는 결과 조회 권한이 있는 경우에만 포함
  const showScores = hasPerm(req, 'results.view');
  res.json({
    round,
    items: results.map((r) => ({
      ...r,
      weighted_score: showScores ? r.weighted_score : undefined,
      final_score: showScores ? r.final_score : undefined,
      adjusted_score: showScores ? r.adjusted_score : undefined,
      stages: Object.fromEntries(STAGES.map((s) => [s, { ...r.stages[s], score: showScores ? r.stages[s].score : undefined }])),
    })),
  });
}));

roundsRouter.post('/:id/targets', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  loadRound(id);
  const b = parse(z.object({ employeeIds: z.array(z.number().int().positive()).optional(), all: z.boolean().optional() }), req.body);
  const added = addRoundTargets(id, b.all ? undefined : b.employeeIds ?? []);
  const assigned = autoAssign(id);
  audit(req, 'round.add_targets', 'round', id, { added, ...assigned });
  res.json({ added, ...assigned });
}));

roundsRouter.delete('/:id/targets/:employeeId', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  const empId = idParam(req, 'employeeId');
  const started = get<{ c: number }>(`SELECT COUNT(*) AS c FROM evaluation_assignments WHERE round_id = ? AND target_employee_id = ? AND status <> 'not_started'`, [id, empId])!.c;
  if (started > 0) throw new ApiError(409, 'TARGET_HAS_RESPONSES');
  tx(() => {
    run('DELETE FROM evaluation_assignments WHERE round_id = ? AND target_employee_id = ?', [id, empId]);
    run('DELETE FROM round_targets WHERE round_id = ? AND employee_id = ?', [id, empId]);
  });
  audit(req, 'round.remove_target', 'round', id, { employeeId: empId });
  res.json({ ok: true });
}));

roundsRouter.post('/:id/auto-assign', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  loadRound(id);
  const { overwrite } = parse(z.object({ overwrite: z.boolean().optional() }), req.body);
  const r = autoAssign(id, !!overwrite);
  audit(req, 'round.auto_assign', 'round', id, { overwrite, ...r });
  res.json(r);
}));

/** 평가자 지정/변경 (대상자 + 단계) */
roundsRouter.post('/:id/assignments', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  loadRound(id);
  const b = parse(z.object({
    targetEmployeeId: z.number().int().positive(), stage: z.enum(['self', 'leader', 'exec', 'upward']), evaluatorEmployeeId: z.number().int().positive().nullable(),
  }), req.body);
  const target = get<any>('SELECT job_group FROM round_targets WHERE round_id = ? AND employee_id = ?', [id, b.targetEmployeeId]);
  if (!target) throw new ApiError(400, 'NOT_ROUND_TARGET');
  if (b.evaluatorEmployeeId && !get('SELECT 1 FROM employees WHERE id = ? AND deleted_at IS NULL', [b.evaluatorEmployeeId])) throw new ApiError(400, 'EMPLOYEE_NOT_FOUND');
  if (b.stage !== 'self' && b.evaluatorEmployeeId === b.targetEmployeeId) throw new ApiError(400, 'SELF_AS_EVALUATOR');
  // 임원은 다른 직원에게 평가받지 않음
  if (target.job_group === EXECUTIVE_GROUP && b.stage !== 'self') throw new ApiError(400, 'EXECUTIVE_SELF_ONLY');
  if (b.stage === 'upward') {
    if (!isLeaderGroup(target.job_group)) throw new ApiError(400, 'UPWARD_ONLY_FOR_LEADERS');
    if (!b.evaluatorEmployeeId) throw new ApiError(400, 'EVALUATOR_REQUIRED');
    const added = run(`INSERT OR IGNORE INTO evaluation_assignments (round_id, target_employee_id, stage, evaluator_employee_id) VALUES (?, ?, 'upward', ?)`,
      [id, b.targetEmployeeId, b.evaluatorEmployeeId]).changes;
    audit(req, 'assignment.add_upward_evaluator', 'round', id, b);
    res.json({ ok: true, added });
    return;
  }
  const a = get<any>('SELECT * FROM evaluation_assignments WHERE round_id = ? AND target_employee_id = ? AND stage = ?', [id, b.targetEmployeeId, b.stage]);
  if (a && a.status === 'submitted') throw new ApiError(409, 'ASSIGNMENT_SUBMITTED');
  if (a) {
    tx(() => {
      // 평가자 변경 시 기존 작성 중 응답은 폐기 (다른 평가자의 응답이 섞이지 않도록)
      if (a.evaluator_employee_id !== b.evaluatorEmployeeId && a.status === 'in_progress') {
        run('DELETE FROM evaluation_responses WHERE assignment_id = ?', [a.id]);
      }
      run(`UPDATE evaluation_assignments SET evaluator_employee_id = ?, status = CASE WHEN ? THEN 'not_started' ELSE status END, updated_at = ? WHERE id = ?`,
        [b.evaluatorEmployeeId, a.evaluator_employee_id !== b.evaluatorEmployeeId, now(), a.id]);
    });
  } else {
    run('INSERT INTO evaluation_assignments (round_id, target_employee_id, stage, evaluator_employee_id) VALUES (?, ?, ?, ?)', [id, b.targetEmployeeId, b.stage, b.evaluatorEmployeeId]);
  }
  audit(req, 'assignment.set_evaluator', 'round', id, { ...b, previous: a?.evaluator_employee_id ?? null });
  res.json({ ok: true });
}));

/** 팀원→팀장평가 평가자 목록 (대상 팀장별) */
roundsRouter.get('/:id/upward/:targetId', requirePerm('rounds.view'), h((req, res) => {
  const id = idParam(req);
  loadRound(id);
  res.json({
    items: all(`SELECT a.id, a.evaluator_employee_id, a.status, a.submitted_at, a.last_saved_at, e.name AS evaluator_name, e.emp_no AS evaluator_emp_no,
        d.name AS evaluator_department, e.position AS evaluator_position
      FROM evaluation_assignments a JOIN employees e ON e.id = a.evaluator_employee_id LEFT JOIN departments d ON d.id = e.department_id
      WHERE a.round_id = ? AND a.target_employee_id = ? AND a.stage = 'upward' ORDER BY e.name`, [id, idParam(req, 'targetId')]),
  });
}));

/** 팀원→팀장평가 평가자 제외 (제출된 평가는 제외 불가, 작성 중 응답은 함께 삭제) */
roundsRouter.delete('/:id/assignments/:assignmentId', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  const a = get<any>('SELECT * FROM evaluation_assignments WHERE id = ? AND round_id = ?', [idParam(req, 'assignmentId'), id]);
  if (!a) throw notFound();
  if (a.stage !== 'upward') throw new ApiError(400, 'ONLY_UPWARD_REMOVABLE');
  if (a.status === 'submitted') throw new ApiError(409, 'ASSIGNMENT_SUBMITTED');
  run('DELETE FROM evaluation_assignments WHERE id = ?', [a.id]);
  audit(req, 'assignment.remove_upward_evaluator', 'round', id, { assignmentId: a.id, target: a.target_employee_id, evaluator: a.evaluator_employee_id, status: a.status });
  res.json({ ok: true });
}));

/* ───────────── 배정 상세 / 응답 ───────────── */

export const assignmentsRouter = Router();
assignmentsRouter.use(requireAuth);

function loadAssignment(id: number) {
  const a = get<any>(`
    SELECT a.*, t.job_group, e.name AS target_name, e.emp_no AS target_emp_no, d.name AS target_department,
      e.position AS target_position, ev.name AS evaluator_name, r.name AS round_name, r.status AS round_status,
      r.self_status, r.leader_status, r.exec_status, r.upward_status, r.enforce_sequence, r.deleted_at AS round_deleted,
      r.end_date, r.self_end_date, r.leader_end_date, r.exec_end_date, r.upward_end_date
    FROM evaluation_assignments a
    JOIN evaluation_rounds r ON r.id = a.round_id
    JOIN round_targets t ON t.round_id = a.round_id AND t.employee_id = a.target_employee_id
    JOIN employees e ON e.id = a.target_employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN employees ev ON ev.id = a.evaluator_employee_id
    WHERE a.id = ?`, [id]);
  if (!a || a.round_deleted) throw notFound();
  return a;
}

function isFinalized(roundId: number, employeeId: number) {
  return !!get(`SELECT 1 FROM result_finalizations WHERE round_id = ? AND employee_id = ? AND status = 'finalized'`, [roundId, employeeId]);
}

/** 접근 모드: own(본인 평가자) / proxy(대리 입력) / view(열람) */
function accessFor(req: Request, a: any) {
  const own = !!req.user!.employee_id && req.user!.employee_id === a.evaluator_employee_id && hasPerm(req, 'evaluate');
  const execOk = a.stage !== 'exec' || hasPerm(req, 'responses.view_exec');
  const canView = own || (hasPerm(req, 'responses.view') && execOk);
  const roundRunning = a.round_status !== 'closed';
  const sequenceOk = !a.enforce_sequence || previousStagesDone(a.round_id, a.target_employee_id, a.stage);
  const finalized = isFinalized(a.round_id, a.target_employee_id);
  const editableState = a.status !== 'submitted' && !finalized;
  const pastDeadline = deadlinePassed(a, a.stage);
  const canEditOwn = own && editableState && stageIsOpen(a, a.stage) && sequenceOk && !pastDeadline;
  const canProxy = !own && hasPerm(req, 'responses.proxy') && execOk && editableState && roundRunning && sequenceOk && !!a.evaluator_employee_id;
  let blockReason: string | null = null;
  if (a.status === 'submitted') blockReason = 'SUBMITTED';
  else if (finalized) blockReason = 'RESULT_FINALIZED';
  else if (!sequenceOk) blockReason = 'PREVIOUS_STAGE_PENDING';
  else if (own && !stageIsOpen(a, a.stage)) blockReason = 'STAGE_NOT_OPEN';
  else if (own && pastDeadline) blockReason = 'DEADLINE_PASSED';
  return { own, canView, canEdit: canEditOwn || canProxy, proxy: canProxy && !canEditOwn, blockReason };
}

function resolveFormId(a: any) {
  return a.form_id ?? publishedFormId(a.stage, a.job_group);
}

assignmentsRouter.get('/:id', h((req, res) => {
  const a = loadAssignment(idParam(req));
  const access = accessFor(req, a);
  if (!access.canView && !access.canEdit) throw new ApiError(403, 'FORBIDDEN');
  const formId = resolveFormId(a);
  const form = formId ? getFormFull(formId) : null;
  const answers = Object.fromEntries(loadAnswers(a.id));
  // 점수와 피평가자의 자기평가 서술은 관리자(응답 열람 권한)에게만 제공. 평가자 본인에게는 노출하지 않음
  const adminView = hasPerm(req, 'responses.view');
  const score = adminView ? get<any>('SELECT * FROM evaluation_scores WHERE assignment_id = ?', [a.id]) : null;
  let selfNarrative: string | null = null;
  if (adminView && a.stage !== 'self') {
    const sa = get<any>(`SELECT a.id, a.form_id FROM evaluation_assignments a WHERE a.round_id = ? AND a.target_employee_id = ? AND a.stage = 'self' AND a.status = 'submitted'`, [a.round_id, a.target_employee_id]);
    if (sa?.form_id) {
      const q = get<any>(`SELECT id FROM form_questions WHERE form_id = ? AND type = 'descriptive' ORDER BY sort_order LIMIT 1`, [sa.form_id]);
      const ans = q && get<any>('SELECT answer FROM evaluation_responses WHERE assignment_id = ? AND question_id = ?', [sa.id, q.id]);
      selfNarrative = ans ? parseJson<Answer>(ans.answer, {}).text ?? null : null;
    }
  }
  res.json({ assignment: a, access, form, answers, score: score ?? null, selfNarrative });
}));

const answerSchema = z.object({
  text: z.string().max(10000).optional(),
  optionId: z.number().int().optional(),
  optionIds: z.array(z.number().int()).max(50).optional(),
  value: z.number().optional(),
});

assignmentsRouter.put('/:id/responses', h((req, res) => {
  const id = idParam(req);
  const a = loadAssignment(id);
  const access = accessFor(req, a);
  if (!access.canEdit) throw new ApiError(403, access.blockReason ?? 'FORBIDDEN');
  const b = parse(z.object({ answers: z.record(answerSchema), submit: z.boolean() }), req.body);
  const formId = resolveFormId(a);
  if (!formId) throw new ApiError(409, 'NO_PUBLISHED_FORM');
  const form = getFormFull(formId)!;
  const questions = form.sections.flatMap((s: any) => s.questions);
  validateAnswers(questions, b.answers);
  if (b.submit) {
    const missing = questions.filter((q: any) => q.required && !isAnswered(q.type, b.answers[q.id])).map((q: any) => q.id);
    if (missing.length) throw new ApiError(400, 'REQUIRED_MISSING', undefined, { questionIds: missing });
  }
  tx(() => {
    run('DELETE FROM evaluation_responses WHERE assignment_id = ?', [id]);
    for (const [qid, ans] of Object.entries(b.answers)) {
      run('INSERT INTO evaluation_responses (assignment_id, question_id, answer, updated_at) VALUES (?, ?, ?, ?)', [id, Number(qid), JSON.stringify(ans), now()]);
    }
    run(`UPDATE evaluation_assignments SET form_id = ?, status = ?, submitted_at = ?, submitted_by = ?, updated_at = ? WHERE id = ?`,
      [formId, b.submit ? 'submitted' : 'in_progress', b.submit ? now() : null, b.submit ? req.user!.id : null, now(), id]);
    if (b.submit) saveAssignmentScore(id, formId);
  });
  audit(req, b.submit ? (access.proxy ? 'assignment.proxy_submit' : 'assignment.submit') : 'assignment.save_draft', 'assignment', id,
    { round: a.round_id, target: a.target_employee_id, stage: a.stage });
  res.json({ ok: true, status: b.submit ? 'submitted' : 'in_progress' });
}));

/** 제출된 평가 재오픈 (점수 삭제 후 작성 중 상태로 복귀) */
assignmentsRouter.post('/:id/reopen', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  const a = loadAssignment(id);
  const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body);
  if (a.status !== 'submitted') throw new ApiError(409, 'ASSIGNMENT_NOT_SUBMITTED');
  if (isFinalized(a.round_id, a.target_employee_id)) throw new ApiError(409, 'RESULT_FINALIZED');
  tx(() => {
    run('INSERT INTO assignment_reopens (assignment_id, reason, previous_submitted_at, reopened_by, reopened_at) VALUES (?, ?, ?, ?, ?)',
      [id, reason, a.submitted_at, req.user!.id, now()]);
    run(`UPDATE evaluation_assignments SET status = 'in_progress', submitted_at = NULL, reopen_count = reopen_count + 1, updated_at = ? WHERE id = ?`, [now(), id]);
    run('DELETE FROM evaluation_scores WHERE assignment_id = ?', [id]);
  });
  audit(req, 'assignment.reopen', 'assignment', id, { reason, round: a.round_id, target: a.target_employee_id, stage: a.stage });
  res.json({ ok: true });
}));

/** 작성 중 평가 강제 마감(제출 처리): 필수 문항이 모두 응답된 경우만 */
assignmentsRouter.post('/:id/close', requirePerm('rounds.manage'), h((req, res) => {
  const id = idParam(req);
  const a = loadAssignment(id);
  if (a.status !== 'in_progress') throw new ApiError(409, 'ASSIGNMENT_NOT_IN_PROGRESS');
  if (a.stage === 'exec' && !hasPerm(req, 'responses.view_exec')) throw new ApiError(403, 'FORBIDDEN');
  const formId = resolveFormId(a);
  const form = getFormFull(formId)!;
  const answers = loadAnswers(id);
  const missing = form.sections.flatMap((s: any) => s.questions).filter((q: any) => q.required && !isAnswered(q.type, answers.get(q.id)));
  if (missing.length) throw new ApiError(400, 'REQUIRED_MISSING', undefined, { questionIds: missing.map((q: any) => q.id) });
  tx(() => {
    run(`UPDATE evaluation_assignments SET form_id = ?, status = 'submitted', submitted_at = ?, submitted_by = ?, updated_at = ? WHERE id = ?`, [formId, now(), req.user!.id, now(), id]);
    saveAssignmentScore(id, formId);
  });
  audit(req, 'assignment.force_close', 'assignment', id, { round: a.round_id, target: a.target_employee_id, stage: a.stage });
  res.json({ ok: true });
}));

/* ───────────── 평가 작성 (평가자 본인) ───────────── */

export const myRouter = Router();
myRouter.use(requireAuth);

myRouter.get('/assignments', h((req, res) => {
  const empId = req.user!.employee_id;
  if (!empId) { res.json({ items: [] }); return; }
  const rows = all<any>(`
    SELECT a.id, a.stage, a.status, a.submitted_at, a.updated_at, a.round_id, a.target_employee_id, r.name AS round_name, r.status AS round_status, r.end_date,
      r.self_status, r.leader_status, r.exec_status, r.upward_status, r.enforce_sequence,
      e.name AS target_name, e.emp_no AS target_emp_no, d.name AS target_department, e.position AS target_position
    FROM evaluation_assignments a
    JOIN evaluation_rounds r ON r.id = a.round_id AND r.deleted_at IS NULL
    JOIN employees e ON e.id = a.target_employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE a.evaluator_employee_id = ?
    ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.start_date DESC,
      CASE a.stage WHEN 'self' THEN 0 WHEN 'upward' THEN 1 WHEN 'leader' THEN 2 ELSE 3 END, e.name`, [empId]);
  res.json({
    items: rows.map((x) => ({
      ...x,
      stage_open: stageIsOpen(x, x.stage as Stage),
      sequence_ok: !x.enforce_sequence || previousStagesDone(x.round_id, x.target_employee_id, x.stage),
    })),
  });
}));
