import { Router } from 'express';
import { z } from 'zod';
import { get, run, parseJson, now } from '../db/index.ts';
import { h, parse } from '../http.ts';
import { requirePerm, requireAuth } from '../auth.ts';
import { computeRoundResults, defaultRoundId } from '../scoring.ts';
import { compareOrg } from '../positions.ts';

export const dashboardRouter = Router();

dashboardRouter.get('/', requirePerm('dashboard.view'), h((req, res) => {
  const roundId = Number(req.query.roundId) || defaultRoundId();
  const totalEmployees = get<{ c: number }>(`SELECT COUNT(*) AS c FROM employees WHERE deleted_at IS NULL AND status <> 'resigned'`)!.c;
  const totalDepartments = get<{ c: number }>('SELECT COUNT(*) AS c FROM departments WHERE deleted_at IS NULL')!.c;
  if (!roundId) {
    res.json({ round: null, summary: { totalEmployees, totalDepartments, targets: 0, completed: 0, incomplete: 0, inProgress: 0, notStarted: 0, completionRate: 0 }, employees: [], departments: [] });
    return;
  }
  const round = get<any>('SELECT * FROM evaluation_rounds WHERE id = ? AND deleted_at IS NULL', [roundId]);
  // 부서 → 직급 → 직원명 순
  const results = computeRoundResults(roundId).sort(compareOrg);
  // 완료 = 그 직원에게 적용되는 단계(가중치 > 0)를 모두 제출. 임원은 자기평가 100%라 자기평가만으로 완료
  const done = (s: string) => s === 'completed' || s === 'finalized';
  const completed = results.filter((r) => done(r.state)).length;
  const inProgress = results.filter((r) => r.state === 'in_progress').length;
  const deptMap = new Map<string, { id: number | null; name: string; total: number; completed: number }>();
  for (const r of results) {
    const key = String(r.department_id ?? 0);
    if (!deptMap.has(key)) deptMap.set(key, { id: r.department_id, name: r.department_name ?? '-', total: 0, completed: 0 });
    const d = deptMap.get(key)!;
    d.total++;
    if (done(r.state)) d.completed++;
  }
  res.json({
    round,
    summary: {
      totalEmployees,
      totalDepartments,
      targets: results.length,
      completed,
      incomplete: results.length - completed,
      inProgress,
      notStarted: results.length - completed - inProgress,
      completionRate: results.length ? Math.round((completed / results.length) * 1000) / 10 : 0,
    },
    employees: results.map((r) => ({
      employee_id: r.employee_id, emp_no: r.emp_no, name: r.name, department_id: r.department_id,
      department_name: r.department_name, position: r.position, state: r.state,
      stages: { self: r.stages.self.state, leader: r.stages.leader.state, exec: r.stages.exec.state, upward: r.stages.upward.state },
      completed_stages: r.completed_stages, required_stages: r.required_stages,
      // 가중치가 0보다 큰 단계만 진행 단계로 계산 (화면의 1·2·3단계 번호 매기기용)
      weights: r.weights,
    })),
    departments: [...deptMap.values()].map((d) => ({ ...d, rate: d.total ? Math.round((d.completed / d.total) * 1000) / 10 : 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  });
}));

const layoutSchema = z.object({
  widgets: z.array(z.object({ id: z.string().max(40), visible: z.boolean() })).max(20),
});

dashboardRouter.get('/layout', requireAuth, h((req, res) => {
  const r = get<any>('SELECT dashboard_layout FROM user_settings WHERE user_id = ?', [req.user!.id]);
  res.json({ layout: parseJson(r?.dashboard_layout, null) });
}));

dashboardRouter.put('/layout', requireAuth, h((req, res) => {
  const layout = parse(layoutSchema, req.body);
  run(`INSERT INTO user_settings (user_id, dashboard_layout, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET dashboard_layout = excluded.dashboard_layout, updated_at = excluded.updated_at`,
    [req.user!.id, JSON.stringify(layout), now()]);
  res.json({ ok: true, layout });
}));
