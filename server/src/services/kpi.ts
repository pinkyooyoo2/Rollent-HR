/**
 * 부서 KPI 계산
 *  - 지표 달성률: 높을수록 좋음 = 실적 / 목표 × 100, 낮을수록 좋음 = 목표 / 실적 × 100
 *  - 지표 점수 = min(달성률, 100)
 *  - 부서 KPI 환산점수 = 계산 가능한 지표 점수의 가중 평균 (목표·실적이 0 또는 미입력인 지표는 제외)
 */
import { all, get } from '../db/index.ts';

export interface KpiSettings { enabled: boolean; personal_ratio: number; kpi_ratio: number; updated_at: string | null }

export interface KpiItem {
  id: number;
  department_id: number;
  name: string;
  unit: string;
  direction: 'higher' | 'lower';
  target: number | null;
  actual: number | null;
  weight: number;
  achievement: number | null;
  score: number | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function kpiAchievement(k: { direction: string; target: number | null; actual: number | null }): number | null {
  if (!k.target || !k.actual) return null;
  return k.direction === 'lower' ? (k.target / k.actual) * 100 : (k.actual / k.target) * 100;
}

export function getKpiSettings(roundId: number): KpiSettings {
  const s = get<any>('SELECT * FROM kpi_settings WHERE round_id = ?', [roundId]);
  return s
    ? { enabled: !!s.enabled, personal_ratio: s.personal_ratio, kpi_ratio: s.kpi_ratio, updated_at: s.updated_at }
    : { enabled: false, personal_ratio: 80, kpi_ratio: 20, updated_at: null };
}

export function listKpis(roundId: number): KpiItem[] {
  return all<any>(
    `SELECT id, department_id, name, unit, direction, target, actual, weight FROM department_kpis
     WHERE round_id = ? AND deleted_at IS NULL ORDER BY department_id, sort_order, id`, [roundId],
  ).map((k) => {
    const a = kpiAchievement(k);
    return { ...k, achievement: a === null ? null : round1(a), score: a === null ? null : round1(Math.min(a, 100)) };
  });
}

/** 지표 목록 → 부서 KPI 환산점수 (계산 가능한 지표가 없으면 null) */
export function departmentKpiScore(items: KpiItem[]): number | null {
  const valid = items.filter((k) => k.score !== null && k.weight > 0);
  const wsum = valid.reduce((s, k) => s + k.weight, 0);
  if (!valid.length || wsum <= 0) return null;
  // 원 달성률 기준으로 계산 후 반올림 (표시용 지표 점수의 반올림 오차 누적 방지)
  const raw = valid.reduce((s, k) => s + Math.min(kpiAchievement(k)!, 100) * k.weight, 0) / wsum;
  return round1(raw);
}

/** 차수의 부서별 KPI 환산점수 */
export function departmentKpiScores(roundId: number): Map<number, number | null> {
  const byDept = new Map<number, KpiItem[]>();
  for (const k of listKpis(roundId)) {
    if (!byDept.has(k.department_id)) byDept.set(k.department_id, []);
    byDept.get(k.department_id)!.push(k);
  }
  const out = new Map<number, number | null>();
  for (const [id, items] of byDept) out.set(id, departmentKpiScore(items));
  return out;
}
