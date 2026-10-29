import { Router, type Request } from 'express';
import { z } from 'zod';
import { all, get, run, tx, now } from '../db/index.ts';
import { h, parse, audit, ApiError, notFound, idParam } from '../http.ts';
import { requirePerm, requireAuth, hasPerm } from '../auth.ts';
import { sendCsv } from '../csv.ts';
import { computeRoundResults, computeEmployeeResult, round2 } from '../scoring.ts';
import { employeeReport, departmentReport, overallReport, leaderReport } from '../services/reports.ts';

export const resultsRouter = Router();
resultsRouter.use(requireAuth);

const vis = (req: Request) => ({ selfLeader: hasPerm(req, 'responses.view'), exec: hasPerm(req, 'responses.view_exec') });

function roundOr404(id: number) {
  const r = get<any>('SELECT * FROM evaluation_rounds WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!r) throw notFound();
  return r;
}

const STATE_KO: Record<string, string> = { not_started: '미시작', in_progress: '진행 중', completed: '평가 완료', finalized: '최종 확정' };

resultsRouter.get('/:roundId', requirePerm('results.view'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  const round = roundOr404(roundId);
  res.json({ round, items: computeRoundResults(roundId) });
}));

resultsRouter.get('/:roundId/export.csv', requirePerm('results.view'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  const round = roundOr404(roundId);
  const items = computeRoundResults(roundId);
  const detail = req.query.mode === 'detail';
  const f = (x: number | null) => (x === null ? '' : x.toFixed(2));
  const f1 = (x: number | null) => (x === null ? '' : x.toFixed(1)); // KPI: 소수 첫째 자리
  audit(req, 'results.export', 'round', roundId, { mode: detail ? 'detail' : 'simple' });
  if (detail) {
    sendCsv(res, `results_detail_${round.year}.csv`,
      ['사번', '직원명', '부서명', '직급', '자기평가', '팀장평가', '임원평가', '팀원→팀장평가', '가중치(자기/팀장/임원/팀원→팀장)', '개인환산점수', '부서KPI점수', 'KPI반영비율(개인/KPI)', '계산점수', '보정점수', '최종확정점수', '평가상태'],
      items.map((r) => [r.emp_no, r.name, r.department_name, r.position, f(r.stages.self.score), f(r.stages.leader.score), f(r.stages.exec.score), f(r.stages.upward.score),
        `${r.weights.self}/${r.weights.leader}/${r.weights.exec}/${r.weights.upward}`, f(r.weighted_score), f1(r.kpi_score), r.kpi_ratio ? `${r.kpi_ratio.personal}/${r.kpi_ratio.kpi}` : '',
        f(r.computed_score), f(r.adjusted_score), f(r.final_score), STATE_KO[r.state]]));
  } else {
    sendCsv(res, `results_${round.year}.csv`, ['사번', '직원명', '부서명', '직급', '최종점수', '최종평가상태'],
      items.map((r) => [r.emp_no, r.name, r.department_name, r.position, f(r.final_score), STATE_KO[r.state]]));
  }
}));

resultsRouter.get('/:roundId/employees/:employeeId', requirePerm('results.view'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  roundOr404(roundId);
  const rep = employeeReport(roundId, idParam(req, 'employeeId'), vis(req));
  if (!rep) throw notFound();
  res.json(rep);
}));

resultsRouter.get('/:roundId/adjustments', requirePerm('results.view'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  res.json({
    items: all(`SELECT a.*, e.name AS employee_name, e.emp_no, u.display_name AS adjusted_by_name, v.display_name AS reverted_by_name
      FROM score_adjustments a JOIN employees e ON e.id = a.employee_id JOIN users u ON u.id = a.adjusted_by LEFT JOIN users v ON v.id = a.reverted_by
      WHERE a.round_id = ? ORDER BY a.id DESC`, [roundId]),
  });
}));

/** 최종 점수 보정 (관리자·임원). 보정 점수를 직접 입력하며 계산 점수와 보정 이력은 모두 보존 */
resultsRouter.post('/:roundId/employees/:employeeId/adjust', requirePerm('results.adjust'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  const employeeId = idParam(req, 'employeeId');
  roundOr404(roundId);
  const b = parse(z.object({ score: z.number().min(0).max(100), reason: z.string().trim().max(1000).optional().default('') }), req.body);
  const r = computeEmployeeResult(roundId, employeeId);
  if (!r) throw notFound();
  if (r.finalized) throw new ApiError(409, 'RESULT_FINALIZED');
  if (r.computed_score === null) throw new ApiError(409, 'RESULT_INCOMPLETE');
  const before = r.adjusted_score ?? r.computed_score;
  const id = run(`INSERT INTO score_adjustments (round_id, employee_id, computed_score, before_score, after_score, reason, adjusted_by, adjusted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [roundId, employeeId, r.computed_score, before, round2(b.score), b.reason, req.user!.id, now()]).lastInsertRowid;
  audit(req, 'score.adjust', 'employee', employeeId, { round: roundId, before, after: round2(b.score), computed: r.computed_score, reason: b.reason });
  res.json({ id, result: computeEmployeeResult(roundId, employeeId) });
}));

/** 보정 취소 → 이전 점수(직전 보정 또는 계산 점수)로 복원 */
resultsRouter.post('/adjustments/:id/revert', requirePerm('results.adjust'), h((req, res) => {
  const id = idParam(req);
  const a = get<any>('SELECT * FROM score_adjustments WHERE id = ?', [id]);
  if (!a) throw notFound();
  if (a.status !== 'active') throw new ApiError(409, 'ADJUSTMENT_NOT_ACTIVE');
  const r = computeEmployeeResult(a.round_id, a.employee_id);
  if (r?.finalized) throw new ApiError(409, 'RESULT_FINALIZED');
  const { reason } = parse(z.object({ reason: z.string().trim().min(2).max(1000) }), req.body);
  run(`UPDATE score_adjustments SET status = 'reverted', reverted_by = ?, reverted_at = ?, revert_reason = ? WHERE id = ?`, [req.user!.id, now(), reason, id]);
  audit(req, 'score.adjust_revert', 'employee', a.employee_id, { round: a.round_id, adjustmentId: id, reason });
  res.json({ result: computeEmployeeResult(a.round_id, a.employee_id) });
}));

/** 최종 확정 (평가 완료자만). 확정 후 점수 변경은 재오픈 절차 필요 */
resultsRouter.post('/:roundId/finalize', requirePerm('results.finalize'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  roundOr404(roundId);
  const { employeeIds } = parse(z.object({ employeeIds: z.array(z.number().int().positive()).min(1).max(5000) }), req.body);
  const results = computeRoundResults(roundId);
  const done: number[] = [];
  const skipped: number[] = [];
  tx(() => {
    for (const id of employeeIds) {
      const r = results.find((x) => x.employee_id === id);
      if (!r || r.finalized || r.final_score === null) { skipped.push(id); continue; }
      run('INSERT INTO result_finalizations (round_id, employee_id, final_score, finalized_by, finalized_at) VALUES (?, ?, ?, ?, ?)',
        [roundId, id, r.final_score, req.user!.id, now()]);
      done.push(id);
    }
  });
  audit(req, 'result.finalize', 'round', roundId, { finalized: done, skipped });
  res.json({ finalized: done.length, skipped: skipped.length });
}));

resultsRouter.post('/:roundId/employees/:employeeId/reopen', requirePerm('results.finalize'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  const employeeId = idParam(req, 'employeeId');
  const { reason } = parse(z.object({ reason: z.string().trim().min(2).max(1000) }), req.body);
  const f = get<any>(`SELECT * FROM result_finalizations WHERE round_id = ? AND employee_id = ? AND status = 'finalized'`, [roundId, employeeId]);
  if (!f) throw new ApiError(409, 'RESULT_NOT_FINALIZED');
  run(`UPDATE result_finalizations SET status = 'reopened', reopened_by = ?, reopened_at = ?, reopen_reason = ? WHERE id = ?`, [req.user!.id, now(), reason, f.id]);
  audit(req, 'result.reopen', 'employee', employeeId, { round: roundId, reason, finalScore: f.final_score });
  res.json({ result: computeEmployeeResult(roundId, employeeId) });
}));

/* ───────────── 리포트 ───────────── */

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requirePerm('reports.generate'), requirePerm('results.view'));

const TYPES = ['all', 'department', 'employee', 'leader'] as const;

reportsRouter.get('/data', h((req, res) => {
  const q = parse(z.object({ roundId: z.coerce.number().int().positive(), type: z.enum(TYPES), ids: z.string().optional() }), req.query);
  roundOr404(q.roundId);
  const ids = (q.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  const results = computeRoundResults(q.roundId);
  let reports: unknown[] = [];
  if (q.type === 'all') reports = [overallReport(q.roundId, results)];
  else if (q.type === 'department') reports = ids.map((id) => departmentReport(q.roundId, id, results));
  else if (q.type === 'employee') reports = ids.map((id) => employeeReport(q.roundId, id, vis(req), results)).filter(Boolean);
  else reports = ids.map((id) => leaderReport(q.roundId, id, vis(req), results)).filter(Boolean);
  res.json({ type: q.type, reports });
}));

reportsRouter.get('/csv', h((req, res) => {
  const q = parse(z.object({ roundId: z.coerce.number().int().positive(), type: z.enum(TYPES), ids: z.string().optional() }), req.query);
  const round = roundOr404(q.roundId);
  const ids = (q.ids ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const results = computeRoundResults(q.roundId);
  const f = (x: number | null | undefined) => (x === null || x === undefined ? '' : x.toFixed(2));
  const f1 = (x: number | null | undefined) => (x === null || x === undefined ? '' : x.toFixed(1)); // KPI: 소수 첫째 자리
  const STAGE_KO: Record<string, string> = { self: '자기평가', leader: '팀장평가', exec: '임원평가', upward: '팀원→팀장평가' };
  run('INSERT INTO report_logs (user_id, report_type, format, round_id, target_desc) VALUES (?, ?, ?, ?, ?)',
    [req.user!.id, q.type, 'csv', q.roundId, ids.length ? `ids:${ids.join(',')}` : 'all']);
  audit(req, 'report.download', 'round', q.roundId, { type: q.type, format: 'csv', ids });
  const header = ['사번', '직원명', '부서명', '직급', '자기평가', '팀장평가', '임원평가', '팀원→팀장평가', '가중치(자기/팀장/임원/팀원→팀장)', '개인환산점수', '부서KPI점수', '계산점수', '보정점수', '최종확정점수', '평가상태', '확정일'];
  const row = (r: (typeof results)[number]) => [r.emp_no, r.name, r.department_name, r.position, f(r.stages.self.score), f(r.stages.leader.score), f(r.stages.exec.score),
    f(r.stages.upward.score), `${r.weights.self}/${r.weights.leader}/${r.weights.exec}/${r.weights.upward}`, f(r.weighted_score), f1(r.kpi_score), f(r.computed_score), f(r.adjusted_score), f(r.final_score), STATE_KO[r.state], r.finalized_at ?? ''];
  if (q.type === 'all') {
    sendCsv(res, `report_all_${round.year}.csv`, header, results.map(row));
  } else if (q.type === 'department') {
    sendCsv(res, `report_departments_${round.year}.csv`, header, results.filter((r) => ids.includes(r.department_id ?? -1)).map(row));
  } else {
    // 개별/팀장 리포트: 평정요소별 상세(롱 포맷)
    const rows: unknown[][] = [];
    for (const id of ids) {
      const rep = employeeReport(q.roundId, id, vis(req), results);
      if (!rep) continue;
      const r = rep.result;
      rows.push([r.emp_no, r.name, r.department_name, '종합', '100', f(r.stages.self.score), f(r.stages.leader.score), f(r.stages.exec.score), f(r.stages.upward.score), f(r.weighted_score), f1(r.kpi_score), f(r.computed_score), f(r.adjusted_score), f(r.final_score), STATE_KO[r.state]]);
      if (r.kpi_ratio) rows.push([r.emp_no, r.name, r.department_name, `최종 계산식: 개인 ${r.kpi_ratio.personal}% + 부서 KPI ${r.kpi_ratio.kpi}%`, '', '', '', '', '', '', '', '', '', '', '']);
      for (const s of rep.sections) rows.push([r.emp_no, r.name, r.department_name, s.title, s.max.toFixed(2), f(s.earned.self), f(s.earned.leader), f(s.earned.exec), f(s.earned.upward), '', '', '', '', '', '']);
      for (const o of rep.opinions) rows.push([r.emp_no, r.name, r.department_name, `의견(${STAGE_KO[o.stage]}) ${o.label}`, '', o.text, '', '', '', '', '', '', '', '', '']);
      for (const s of rep.suggestions) rows.push([r.emp_no, r.name, r.department_name, `기타 건의사항(${STAGE_KO[s.stage]})`, '', s.text, '', '', '', '', '', '', '', '', '']);
    }
    // 직원 1명 리포트는 파일명에 사번·이름 포함
    const one = ids.length === 1 ? results.find((r) => r.employee_id === ids[0]) : undefined;
    sendCsv(res, one ? `평가결과_${one.emp_no}_${one.name}_${round.year}.csv` : `report_${q.type}_${round.year}.csv`,
      ['사번', '직원명', '부서명', '항목', '배점', '자기평가', '팀장평가', '임원평가', '팀원→팀장평가', '개인환산점수', '부서KPI점수', '계산점수', '보정점수', '최종확정점수', '평가상태'], rows);
  }
}));

reportsRouter.post('/log', h((req, res) => {
  const b = parse(z.object({ type: z.enum(TYPES), format: z.enum(['pdf', 'csv']), roundId: z.number().int().positive(), targetDesc: z.string().max(2000).optional() }), req.body);
  run('INSERT INTO report_logs (user_id, report_type, format, round_id, target_desc) VALUES (?, ?, ?, ?, ?)', [req.user!.id, b.type, b.format, b.roundId, b.targetDesc ?? null]);
  audit(req, 'report.download', 'round', b.roundId, { type: b.type, format: b.format, target: b.targetDesc });
  res.json({ ok: true });
}));

reportsRouter.get('/logs', h((_req, res) => {
  res.json({
    items: all(`SELECT l.*, u.display_name AS user_name, r.name AS round_name FROM report_logs l LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN evaluation_rounds r ON r.id = l.round_id ORDER BY l.id DESC LIMIT 200`),
  });
}));

/* ───────────── 로그 ───────────── */

export const logsRouter = Router();
logsRouter.use(requireAuth, requirePerm('logs.view'));

logsRouter.get('/activity', h((req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 30);
  const q = String(req.query.q ?? '').trim();
  const where = q ? `WHERE l.action LIKE ? OR l.entity_type LIKE ? OR u.display_name LIKE ? OR l.details LIKE ?` : '';
  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`] : [];
  const total = get<{ c: number }>(`SELECT COUNT(*) AS c FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id ${where}`, params)!.c;
  const items = all(`SELECT l.*, u.display_name AS user_name, u.emp_no FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id ${where}
    ORDER BY l.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  res.json({ items, total, page, pageSize });
}));

logsRouter.get('/access', h((req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Number(req.query.pageSize) || 30);
  const total = get<{ c: number }>('SELECT COUNT(*) AS c FROM access_logs')!.c;
  const items = all(`SELECT l.*, u.display_name AS user_name FROM access_logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    [pageSize, (page - 1) * pageSize]);
  res.json({ items, total, page, pageSize });
}));

