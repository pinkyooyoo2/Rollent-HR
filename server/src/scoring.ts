import { all, get, run, parseJson, now } from './db/index.ts';
import { getKpiSettings, departmentKpiScores } from './services/kpi.ts';

/**
 * 평가 단계(저장 단위)
 *  self   : 자기평가
 *  leader : 팀장 → 팀원 평가
 *  exec   : 임원 → 팀원 / 임원 → 팀장 평가 (대상자 직군으로 구분)
 *  upward : 팀원 → 팀장 평가 (대상 팀장 1명에 평가자 여러 명, 점수는 제출된 응답 평균)
 */
export type Stage = 'self' | 'leader' | 'exec' | 'upward';
export const STAGES: Stage[] = ['self', 'leader', 'exec', 'upward'];
/** 가중치를 설정하는 직군 (임원 직군은 자기평가 100% 고정이라 제외) */
export const JOB_GROUPS = ['office_member', 'office_leader', 'production_member', 'production_leader'] as const;
export const EXECUTIVE_GROUP = 'executive';
export const isLeaderGroup = (g: string) => g.endsWith('_leader');

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** 평가 대상 직군: 임원은 다른 직원에게 평가받지 않으므로 별도 직군(자기평가만) */
export function jobGroupOf(e: { job_group: string; is_leader: number; is_executive: number }): string {
  if (e.is_executive) return EXECUTIVE_GROUP;
  return `${e.job_group === 'production' ? 'production' : 'office'}_${e.is_leader ? 'leader' : 'member'}`;
}

/** 단계·직군 → 사용할 평가 양식의 직군 (팀원→팀장평가는 공통 양식, 임원 자기평가는 관리직 팀장&임원 양식) */
export function formGroupFor(stage: string, jobGroup: string): string {
  if (stage === 'upward') return 'common';
  if (jobGroup === EXECUTIVE_GROUP) return 'office_leader';
  return jobGroup;
}

interface QuestionRow {
  id: number;
  type: string;
  points: number;
  scored: number;
  required: number;
  settings: string | null;
}
interface OptionRow { id: number; question_id: number; score: number }

export interface Answer {
  text?: string;
  optionId?: number;
  optionIds?: number[];
  value?: number;
}

/** 문항 1개의 득점 비율(0~1). 응답이 없으면 null */
function ratio(q: QuestionRow, opts: OptionRow[], a: Answer | undefined): number | null {
  if (!a) return null;
  switch (q.type) {
    case 'score_scale':
    case 'single_choice':
    case 'dropdown':
    case 'descriptive': {
      const max = Math.max(0, ...opts.map((o) => o.score));
      const sel = opts.find((o) => o.id === a.optionId);
      if (!sel) return null;
      return max > 0 ? Math.max(0, sel.score) / max : 0;
    }
    case 'checkbox': {
      const total = opts.filter((o) => o.score > 0).reduce((s, o) => s + o.score, 0);
      const ids = a.optionIds ?? [];
      if (ids.length === 0) return null;
      const got = opts.filter((o) => ids.includes(o.id)).reduce((s, o) => s + o.score, 0);
      return total > 0 ? Math.min(1, Math.max(0, got / total)) : 0;
    }
    case 'linear_scale': {
      const st = parseJson<{ min?: number; max?: number }>(q.settings, {});
      const max = st.max ?? 5;
      if (typeof a.value !== 'number') return null;
      return max > 0 ? Math.min(1, Math.max(0, a.value / max)) : 0;
    }
    default:
      return null;
  }
}

/** 응답 객체가 '답변됨'인지 검사 (필수 응답 검증용) */
export function isAnswered(type: string, a: Answer | undefined): boolean {
  if (!a) return false;
  switch (type) {
    case 'short_text':
    case 'long_text':
      return !!a.text?.trim();
    case 'checkbox':
      return (a.optionIds?.length ?? 0) > 0;
    case 'linear_scale':
      return typeof a.value === 'number';
    case 'descriptive':
      return !!a.text?.trim() && typeof a.optionId === 'number';
    default:
      return typeof a.optionId === 'number';
  }
}

export function loadFormScoring(formId: number) {
  const questions = all<QuestionRow>(
    'SELECT id, type, points, scored, required, settings FROM form_questions WHERE form_id = ?', [formId]);
  const options = all<OptionRow>(
    `SELECT o.id, o.question_id, o.score FROM question_options o
     JOIN form_questions q ON q.id = o.question_id WHERE q.form_id = ?`, [formId]);
  return { questions, options };
}

/** 응답 기반으로 평가 1건 점수 계산 (100점 환산) */
export function scoreAnswers(formId: number, answers: Map<number, Answer>) {
  const { questions, options } = loadFormScoring(formId);
  let raw = 0;
  let max = 0;
  for (const q of questions) {
    if (!q.scored || q.points <= 0) continue;
    max += q.points;
    const r = ratio(q, options.filter((o) => o.question_id === q.id), answers.get(q.id));
    if (r !== null) raw += r * q.points;
  }
  return { raw: round2(raw), max: round2(max), normalized: max > 0 ? round2((raw / max) * 100) : 0 };
}

export function loadAnswers(assignmentId: number): Map<number, Answer> {
  const rows = all<{ question_id: number; answer: string }>(
    'SELECT question_id, answer FROM evaluation_responses WHERE assignment_id = ?', [assignmentId]);
  return new Map(rows.map((r) => [r.question_id, parseJson<Answer>(r.answer, {})]));
}

export function saveAssignmentScore(assignmentId: number, formId: number) {
  const s = scoreAnswers(formId, loadAnswers(assignmentId));
  run(`INSERT INTO evaluation_scores (assignment_id, raw_score, max_score, normalized_score, source, computed_at)
       VALUES (?, ?, ?, ?, 'form', ?)
       ON CONFLICT(assignment_id) DO UPDATE SET raw_score = excluded.raw_score, max_score = excluded.max_score,
         normalized_score = excluded.normalized_score, source = 'form', upload_id = NULL, computed_at = excluded.computed_at`,
    [assignmentId, s.raw, s.max, s.normalized, now()]);
  return s;
}

export interface Weights { self: number; leader: number; exec: number; upward: number }
/** 임원: 자기평가 100% (다른 직원의 평가 단계 없음) */
export const EXECUTIVE_WEIGHTS: Weights = { self: 100, leader: 0, exec: 0, upward: 0 };

export function getRoundWeights(roundId: number): Record<string, Weights & { overridden: boolean; fixed?: boolean }> {
  const rows = all<{ job_group: string; self_weight: number; leader_weight: number; exec_weight: number; upward_weight: number }>(
    'SELECT job_group, self_weight, leader_weight, exec_weight, upward_weight FROM evaluation_weights WHERE round_id = ?', [roundId]);
  const toW = (r: (typeof rows)[number]): Weights => ({ self: r.self_weight, leader: r.leader_weight, exec: r.exec_weight, upward: r.upward_weight ?? 0 });
  const def = rows.find((r) => r.job_group === 'default');
  const base: Weights = def ? toW(def) : { self: 20, leader: 40, exec: 40, upward: 0 };
  const out: Record<string, Weights & { overridden: boolean; fixed?: boolean }> = { default: { ...base, overridden: false } };
  for (const g of JOB_GROUPS) {
    const r = rows.find((x) => x.job_group === g);
    out[g] = r ? { ...toW(r), overridden: true } : { ...base, overridden: false };
  }
  out[EXECUTIVE_GROUP] = { ...EXECUTIVE_WEIGHTS, overridden: false, fixed: true };
  return out;
}

export type StageState = 'na' | 'unassigned' | 'not_started' | 'in_progress' | 'submitted';
export type OverallState = 'not_started' | 'in_progress' | 'completed' | 'finalized';

export interface EmployeeResult {
  employee_id: number;
  emp_no: string;
  name: string;
  department_id: number | null;
  department_name: string | null;
  position: string | null;
  title: string | null;
  job_group: string;
  weights: Weights;
  stages: Record<Stage, {
    state: StageState;
    assignment_id: number | null;
    evaluator_id: number | null;
    evaluator_name: string | null;
    score: number | null;
    submitted_at: string | null;
    /** 팀원→팀장평가: 제출 수 / 배정 수 */
    submitted_count?: number;
    total_count?: number;
  }>;
  completed_stages: number;
  required_stages: number;
  /** 개인 평가 환산점수 (평가 단계 가중 합산) */
  weighted_score: number | null;
  /** 소속 부서 KPI 환산점수 (KPI 미반영 또는 계산 불가 시 null) */
  kpi_score: number | null;
  /** KPI 반영 비율. KPI가 최종 점수에 반영된 경우에만 값이 있음 */
  kpi_ratio: { personal: number; kpi: number } | null;
  /** 보정 전 계산 점수 = KPI 반영 시 개인×비율 + KPI×비율, 아니면 개인 환산점수 */
  computed_score: number | null;
  adjusted_score: number | null;
  adjustment_id: number | null;
  final_score: number | null;
  finalized: boolean;
  finalized_at: string | null;
  state: OverallState;
}

/** 차수 전체 결과 계산: DB의 실제 응답 점수 + 현재 가중치로 즉시 계산(가중치 변경 시 자동 재계산) */
export function computeRoundResults(roundId: number): EmployeeResult[] {
  const weights = getRoundWeights(roundId);
  const kpi = getKpiSettings(roundId);
  const kpiScores = kpi.enabled ? departmentKpiScores(roundId) : new Map<number, number | null>();
  const targets = all<any>(
    `SELECT t.employee_id, t.job_group, e.emp_no, e.name, e.department_id, e.position, e.title, d.name AS department_name
     FROM round_targets t JOIN employees e ON e.id = t.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE t.round_id = ? ORDER BY d.name, e.name`, [roundId]);
  const assigns = all<any>(
    `SELECT a.id, a.target_employee_id, a.stage, a.status, a.submitted_at, a.evaluator_employee_id,
            ev.name AS evaluator_name, s.normalized_score
     FROM evaluation_assignments a
     LEFT JOIN employees ev ON ev.id = a.evaluator_employee_id
     LEFT JOIN evaluation_scores s ON s.assignment_id = a.id
     WHERE a.round_id = ?`, [roundId]);
  const adjustments = all<any>(
    `SELECT id, employee_id, after_score FROM score_adjustments
     WHERE round_id = ? AND status = 'active' ORDER BY adjusted_at, id`, [roundId]);
  const finals = all<any>(
    `SELECT employee_id, final_score, finalized_at FROM result_finalizations
     WHERE round_id = ? AND status = 'finalized'`, [roundId]);

  const byTarget = new Map<number, any[]>();
  for (const a of assigns) {
    if (!byTarget.has(a.target_employee_id)) byTarget.set(a.target_employee_id, []);
    byTarget.get(a.target_employee_id)!.push(a);
  }
  const adjMap = new Map<number, any>();
  for (const a of adjustments) adjMap.set(a.employee_id, a); // 최신 보정이 마지막
  const finalMap = new Map<number, any>(finals.map((f) => [f.employee_id, f]));

  return targets.map((t) => {
    const w = weights[t.job_group] ?? weights.default;
    const list = byTarget.get(t.employee_id) ?? [];
    const stages = {} as EmployeeResult['stages'];
    let required = 0;
    let completed = 0;
    let started = false;
    let weighted = 0;
    for (const st of STAGES) {
      const weight = w[st];
      if (st === 'upward') {
        // 팀원→팀장평가: 평가자별 응답의 평균. 가중치가 있으면 배정된 평가가 모두 제출되어야 완료
        const ups = list.filter((x) => x.stage === 'upward' && x.evaluator_employee_id);
        const subs = ups.filter((x) => x.status === 'submitted' && x.normalized_score !== null);
        let state: StageState;
        if (!ups.length) state = weight > 0 ? 'unassigned' : 'na';
        else if (subs.length === ups.length) state = 'submitted';
        else state = ups.some((x) => x.status !== 'not_started') ? 'in_progress' : 'not_started';
        if (ups.some((x) => x.status !== 'not_started')) started = true;
        const avg = subs.length ? round2(subs.reduce((s, x) => s + x.normalized_score, 0) / subs.length) : null;
        if (weight > 0) {
          required++;
          if (state === 'submitted' && avg !== null) {
            completed++;
            weighted += (avg * weight) / 100;
          }
        }
        stages[st] = {
          state, assignment_id: null, evaluator_id: null, evaluator_name: null, score: avg,
          submitted_at: subs.map((x) => x.submitted_at).sort().pop() ?? null, submitted_count: subs.length, total_count: ups.length,
        };
        continue;
      }
      const a = list.find((x) => x.stage === st);
      let state: StageState;
      if (weight <= 0) state = 'na';
      else if (!a || !a.evaluator_employee_id) state = 'unassigned';
      else state = a.status;
      if (a && a.status !== 'not_started') started = true;
      if (weight > 0) {
        required++;
        if (state === 'submitted' && a.normalized_score !== null) {
          completed++;
          weighted += (a.normalized_score * weight) / 100;
        }
      }
      stages[st] = {
        state,
        assignment_id: a?.id ?? null,
        evaluator_id: a?.evaluator_employee_id ?? null,
        evaluator_name: a?.evaluator_name ?? null,
        score: a && a.status === 'submitted' && a.normalized_score !== null ? round2(a.normalized_score) : null,
        submitted_at: a?.submitted_at ?? null,
      };
    }
    const complete = required > 0 && completed === required;
    const adj = adjMap.get(t.employee_id);
    const fin = finalMap.get(t.employee_id);
    const weightedScore = complete ? round2(weighted) : null;
    // 부서 KPI 반영: 소속 부서에 계산 가능한 KPI가 없으면 개인 환산점수만 사용
    const kpiScore = kpi.enabled && t.department_id ? kpiScores.get(t.department_id) ?? null : null;
    const kpiApplied = kpiScore !== null;
    const computed = weightedScore === null ? null
      : kpiApplied ? round2((weightedScore * kpi.personal_ratio + kpiScore * kpi.kpi_ratio) / 100) : weightedScore;
    const adjusted = adj ? round2(adj.after_score) : null;
    let state: OverallState = complete ? 'completed' : started ? 'in_progress' : 'not_started';
    if (fin) state = 'finalized';
    return {
      employee_id: t.employee_id,
      emp_no: t.emp_no,
      name: t.name,
      department_id: t.department_id,
      department_name: t.department_name,
      position: t.position,
      title: t.title,
      job_group: t.job_group,
      weights: { self: w.self, leader: w.leader, exec: w.exec, upward: w.upward },
      stages,
      completed_stages: completed,
      required_stages: required,
      weighted_score: weightedScore,
      kpi_score: kpiScore,
      kpi_ratio: kpiApplied ? { personal: kpi.personal_ratio, kpi: kpi.kpi_ratio } : null,
      computed_score: computed,
      adjusted_score: adjusted,
      adjustment_id: adj?.id ?? null,
      final_score: fin ? round2(fin.final_score) : adjusted ?? computed,
      finalized: !!fin,
      finalized_at: fin?.finalized_at ?? null,
      state,
    };
  });
}

export function computeEmployeeResult(roundId: number, employeeId: number): EmployeeResult | undefined {
  return computeRoundResults(roundId).find((r) => r.employee_id === employeeId);
}

/** 대시보드 등에서 기본으로 사용할 차수: 진행 중 → 최신 */
export function defaultRoundId(): number | null {
  const r = get<{ id: number }>(
    `SELECT id FROM evaluation_rounds WHERE deleted_at IS NULL
     ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, start_date DESC, id DESC LIMIT 1`);
  return r?.id ?? null;
}
