import { all, get, run, tx, now } from '../db/index.ts';
import { ApiError } from '../http.ts';
import { config } from '../config.ts';
import { jobGroupOf, STAGES, getRoundWeights, isLeaderGroup, type Stage } from '../scoring.ts';

/** 재직(휴직 포함) 중인 직원을 차수 평가 대상자로 등록. 직군은 등록 시점 기준 스냅샷 */
export function addRoundTargets(roundId: number, employeeIds?: number[]) {
  const emps = all<any>(
    `SELECT id, job_group, is_leader, is_executive FROM employees
     WHERE deleted_at IS NULL AND status <> 'resigned'`);
  const list = employeeIds ? emps.filter((e) => employeeIds.includes(e.id)) : emps;
  let added = 0;
  tx(() => {
    for (const e of list) {
      added += run('INSERT OR IGNORE INTO round_targets (round_id, employee_id, job_group) VALUES (?, ?, ?)',
        [roundId, e.id, jobGroupOf(e)]).changes;
    }
  });
  return added;
}

/** 팀원→팀장평가 기본 평가자: 대상자가 부서 팀장인 부서의 팀원·차장 (임원·팀장 제외) */
export function upwardEvaluators(targetId: number): number[] {
  return all<{ id: number }>(
    `SELECT e.id FROM employees e JOIN departments d ON d.id = e.department_id AND d.deleted_at IS NULL
     WHERE d.leader_employee_id = ? AND e.id <> ? AND e.deleted_at IS NULL AND e.status <> 'resigned'
       AND e.is_leader = 0 AND e.is_executive = 0 ORDER BY e.name`, [targetId, targetId]).map((x) => x.id);
}

/** 부서 정보로 기본 평가자 결정: 자기평가=본인, 팀장평가=부서 팀장, 임원평가=부서 담당임원 */
export function defaultEvaluator(stage: Stage, emp: any): number | null {
  if (stage === 'self') return emp.id;
  if (stage === 'leader') return emp.leader_employee_id && emp.leader_employee_id !== emp.id ? emp.leader_employee_id : null;
  return emp.exec_employee_id && emp.exec_employee_id !== emp.id ? emp.exec_employee_id : null;
}

/**
 * 대상자별 단계 배정 생성. overwrite=false 이면 평가자가 지정된 기존 배정은 유지.
 * 가중치가 0인 단계는 배정하지 않음.
 */
export function autoAssign(roundId: number, overwrite = false) {
  const weights = getRoundWeights(roundId);
  const round = get<any>('SELECT upward_enabled FROM evaluation_rounds WHERE id = ?', [roundId]);
  const targets = all<any>(
    `SELECT e.id, t.job_group, d.leader_employee_id, d.exec_employee_id
     FROM round_targets t JOIN employees e ON e.id = t.employee_id
     LEFT JOIN departments d ON d.id = e.department_id WHERE t.round_id = ?`, [roundId]);
  let created = 0;
  let updated = 0;
  tx(() => {
    for (const t of targets) {
      const w = weights[t.job_group] ?? weights.default;
      // 팀원→팀장평가: 실시하는 차수이면 팀장 대상자마다 소속 팀원 각자에게 배정 (가중치는 최종 점수 반영 여부만 결정)
      if (round?.upward_enabled && isLeaderGroup(t.job_group)) {
        for (const ev of upwardEvaluators(t.id)) {
          created += run(`INSERT OR IGNORE INTO evaluation_assignments (round_id, target_employee_id, stage, evaluator_employee_id) VALUES (?, ?, 'upward', ?)`,
            [roundId, t.id, ev]).changes;
        }
      }
      for (const stage of STAGES) {
        if (stage === 'upward' || w[stage] <= 0) continue;
        const evaluator = defaultEvaluator(stage, t);
        const existing = get<any>('SELECT id, evaluator_employee_id, status FROM evaluation_assignments WHERE round_id = ? AND target_employee_id = ? AND stage = ?',
          [roundId, t.id, stage]);
        if (!existing) {
          run('INSERT INTO evaluation_assignments (round_id, target_employee_id, stage, evaluator_employee_id) VALUES (?, ?, ?, ?)',
            [roundId, t.id, stage, evaluator]);
          created++;
        } else if (existing.status === 'not_started' && (overwrite || !existing.evaluator_employee_id) && evaluator !== existing.evaluator_employee_id) {
          run('UPDATE evaluation_assignments SET evaluator_employee_id = ?, updated_at = ? WHERE id = ?', [evaluator, now(), existing.id]);
          updated++;
        }
      }
    }
  });
  return { created, updated };
}

/**
 * 평가 유형별 마감: {stage}_end_date (없으면 차수 종료일) 의 23:59:59 (config.tzOffset 기준).
 * 서버 시간으로 판정하며, 관리자가 마감일을 바꾸면 즉시 반영된다.
 */
export function stageDeadline(round: Record<string, any>, stage: Stage): { date: string; at: string } {
  const date: string = round[`${stage}_end_date`] || round.end_date;
  return { date, at: new Date(`${date}T23:59:59${config.tzOffset}`).toISOString() };
}
export function deadlinePassed(round: Record<string, any>, stage: Stage, nowMs = Date.now()): boolean {
  return nowMs > Date.parse(stageDeadline(round, stage).at);
}

/** 평가 유형 (화면·결과 구분용): 저장 단계 + 대상자 직군 */
export type EvalType = 'self' | 'leader_to_member' | 'member_to_leader' | 'exec_to_member' | 'exec_to_leader';
export function evalTypeOf(stage: Stage, targetJobGroup: string): EvalType {
  if (stage === 'self') return 'self';
  if (stage === 'leader') return 'leader_to_member';
  if (stage === 'upward') return 'member_to_leader';
  return isLeaderGroup(targetJobGroup) ? 'exec_to_leader' : 'exec_to_member';
}

/** 응답 값 검증 (존재하지 않는 문항/선택지·범위 밖 값 차단). 위반 시 ApiError */
export function validateAnswers(questions: any[], answers: Record<string, any>) {
  const qMap = new Map<number, any>(questions.map((q: any) => [q.id, q]));
  for (const [qid, ans] of Object.entries(answers)) {
    const q = qMap.get(Number(qid));
    if (!q) throw new ApiError(400, 'INVALID_QUESTION');
    const optIds = q.options.map((o: any) => o.id);
    if (ans.optionId !== undefined && !optIds.includes(ans.optionId)) throw new ApiError(400, 'INVALID_OPTION');
    if (ans.optionIds && ans.optionIds.some((o: number) => !optIds.includes(o))) throw new ApiError(400, 'INVALID_OPTION');
    if (q.type === 'linear_scale' && ans.value !== undefined) {
      const min = q.settings?.min ?? 1;
      const max = q.settings?.max ?? 5;
      if (ans.value < min || ans.value > max) throw new ApiError(400, 'INVALID_OPTION');
    }
  }
}

/** row 는 round_status 와 {stage}_status 컬럼을 포함해야 함 */
export function stageIsOpen(row: { round_status: string } & Record<string, any>, stage: Stage): boolean {
  return row.round_status === 'open' && row[`${stage}_status`] === 'open';
}

/** 순차 진행 정책: 이전 단계(필수)가 제출되어야 다음 단계 작성 가능 */
export function previousStagesDone(roundId: number, targetId: number, stage: Stage): boolean {
  const idx = STAGES.indexOf(stage);
  if (idx === 0 || stage === 'upward') return true;
  const weights = getRoundWeights(roundId);
  const t = get<any>('SELECT job_group FROM round_targets WHERE round_id = ? AND employee_id = ?', [roundId, targetId]);
  const w = weights[t?.job_group] ?? weights.default;
  for (const prev of STAGES.slice(0, idx)) {
    // 팀원→팀장평가는 다른 단계와 독립적으로 진행 (선행 조건 아님)
    if (prev === 'upward' || w[prev] <= 0) continue;
    const a = get<any>('SELECT status FROM evaluation_assignments WHERE round_id = ? AND target_employee_id = ? AND stage = ?', [roundId, targetId, prev]);
    if (!a || a.status !== 'submitted') return false;
  }
  return true;
}
