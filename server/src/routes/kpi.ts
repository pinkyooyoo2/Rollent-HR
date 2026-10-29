import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, now } from '../db/index.ts';
import { h, parse, audit, ApiError, notFound, idParam } from '../http.ts';
import { requirePerm } from '../auth.ts';
import { getKpiSettings, listKpis, departmentKpiScore } from '../services/kpi.ts';
import { sendCsv } from '../csv.ts';

/** 부서 KPI 관리: 조회는 평가 진행 조회 권한, 변경은 가중치 변경 권한(최종 점수 산식에 영향) */
export const kpiRouter = Router();

function roundOr404(id: number) {
  const r = get<any>('SELECT id, name, year, status FROM evaluation_rounds WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!r) throw notFound();
  return r;
}

kpiRouter.get('/:roundId', requirePerm('rounds.view'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  const round = roundOr404(roundId);
  const items = listKpis(roundId);
  const departments = all<any>('SELECT id, name FROM departments WHERE deleted_at IS NULL ORDER BY name').map((d) => {
    const kpis = items.filter((k) => k.department_id === d.id);
    return {
      ...d,
      kpis,
      score: departmentKpiScore(kpis),
      weight_sum: Math.round(kpis.reduce((s, k) => s + k.weight, 0) * 100) / 100,
    };
  });
  res.json({ round, settings: getKpiSettings(roundId), departments });
}));

kpiRouter.put('/:roundId/settings', requirePerm('weights.manage'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  roundOr404(roundId);
  const b = parse(z.object({
    enabled: z.boolean(),
    personal_ratio: z.number().min(0).max(100),
    kpi_ratio: z.number().min(0).max(100),
  }), req.body);
  if (Math.abs(b.personal_ratio + b.kpi_ratio - 100) > 0.001) throw new ApiError(400, 'KPI_RATIO_SUM');
  const before = getKpiSettings(roundId);
  run(`INSERT INTO kpi_settings (round_id, enabled, personal_ratio, kpi_ratio, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(round_id) DO UPDATE SET enabled = excluded.enabled, personal_ratio = excluded.personal_ratio,
         kpi_ratio = excluded.kpi_ratio, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [roundId, b.enabled ? 1 : 0, b.personal_ratio, b.kpi_ratio, req.user!.id, now()]);
  audit(req, 'kpi.settings', 'round', roundId, { before, after: b });
  res.json({ settings: getKpiSettings(roundId) });
}));

const itemSchema = z.object({
  department_id: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  unit: z.string().trim().max(20).default(''),
  direction: z.enum(['higher', 'lower']),
  target: z.number().min(0).nullable(),
  actual: z.number().min(0).nullable(),
  weight: z.number().min(0).max(100),
});

function checkDept(id: number) {
  if (!get('SELECT id FROM departments WHERE id = ? AND deleted_at IS NULL', [id])) throw new ApiError(400, 'DEPARTMENT_NOT_FOUND');
}

kpiRouter.post('/:roundId/items', requirePerm('weights.manage'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  roundOr404(roundId);
  const b = parse(itemSchema, req.body);
  checkDept(b.department_id);
  const order = get<{ n: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM department_kpis WHERE round_id = ? AND department_id = ?', [roundId, b.department_id])!.n;
  const id = run(`INSERT INTO department_kpis (round_id, department_id, name, unit, direction, target, actual, weight, sort_order, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [roundId, b.department_id, b.name, b.unit, b.direction, b.target, b.actual, b.weight, order, req.user!.id]).lastInsertRowid;
  audit(req, 'kpi.create', 'kpi', id, b);
  res.status(201).json({ id });
}));

function itemOr404(id: number) {
  const k = get<any>('SELECT * FROM department_kpis WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!k) throw notFound();
  return k;
}

kpiRouter.put('/items/:id', requirePerm('weights.manage'), h((req, res) => {
  const id = idParam(req);
  const before = itemOr404(id);
  const b = parse(itemSchema, req.body);
  checkDept(b.department_id);
  run(`UPDATE department_kpis SET department_id = ?, name = ?, unit = ?, direction = ?, target = ?, actual = ?, weight = ?, updated_at = ? WHERE id = ?`,
    [b.department_id, b.name, b.unit, b.direction, b.target, b.actual, b.weight, now(), id]);
  audit(req, 'kpi.update', 'kpi', id, { before, after: b });
  res.json({ ok: true });
}));

kpiRouter.delete('/items/:id', requirePerm('weights.manage'), h((req, res) => {
  const id = idParam(req);
  const k = itemOr404(id);
  run('UPDATE department_kpis SET deleted_at = ? WHERE id = ?', [now(), id]);
  audit(req, 'kpi.delete', 'kpi', id, { name: k.name, department_id: k.department_id });
  res.json({ ok: true });
}));

/** 현재 KPI를 업로드 템플릿과 같은 열로 내보내기 (내려받아 수정 후 다시 업로드 가능) */
kpiRouter.get('/:roundId/export.csv', requirePerm('rounds.view'), h((req, res) => {
  const roundId = idParam(req, 'roundId');
  const round = roundOr404(roundId);
  const depts = new Map(all<any>('SELECT id, name FROM departments').map((d) => [d.id, d.name]));
  const DIR_KO: Record<string, string> = { higher: '높을수록 좋음', lower: '낮을수록 좋음' };
  const items = listKpis(roundId);
  audit(req, 'kpi.export', 'round', roundId, { count: items.length });
  sendCsv(res, `부서KPI_${round.year}.csv`, ['부서명', '지표명', '단위', '평가방향', '목표', '실적', '가중치', '달성률(%)', '지표점수'],
    items.map((k) => [depts.get(k.department_id), k.name, k.unit, DIR_KO[k.direction], k.target ?? '', k.actual ?? '', k.weight, k.achievement?.toFixed(1) ?? '', k.score?.toFixed(1) ?? '']));
}));
