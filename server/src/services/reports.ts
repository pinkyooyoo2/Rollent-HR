import { all, get, parseJson } from '../db/index.ts';
import { computeRoundResults, round2, STAGES, type EmployeeResult, type Answer, type Stage } from '../scoring.ts';

interface SectionScore { title: string; max: number; earned: Partial<Record<Stage, number>> }

/** 제출된 평가 1건의 섹션(평정요소)별 득점 */
function sectionScores(assignmentId: number, formId: number) {
  const qs = all<any>(`SELECT q.id, q.type, q.points, q.scored, q.settings, s.title, s.sort_order
    FROM form_questions q LEFT JOIN form_sections s ON s.id = q.section_id WHERE q.form_id = ? ORDER BY s.sort_order, q.sort_order`, [formId]);
  const opts = all<any>(`SELECT o.id, o.question_id, o.score FROM question_options o JOIN form_questions q ON q.id = o.question_id WHERE q.form_id = ?`, [formId]);
  const answers = new Map(all<any>('SELECT question_id, answer FROM evaluation_responses WHERE assignment_id = ?', [assignmentId])
    .map((r) => [r.question_id, parseJson<Answer>(r.answer, {})]));
  const out: { title: string; max: number; earned: number }[] = [];
  for (const q of qs) {
    if (!q.scored || q.points <= 0) continue;
    let sec = out.find((s) => s.title === q.title);
    if (!sec) { sec = { title: q.title ?? '-', max: 0, earned: 0 }; out.push(sec); }
    sec.max += q.points;
    const a = answers.get(q.id);
    const o = opts.filter((x) => x.question_id === q.id);
    let r = 0;
    if (a) {
      if (q.type === 'checkbox') {
        const total = o.filter((x) => x.score > 0).reduce((s, x) => s + x.score, 0);
        r = total > 0 ? Math.min(1, o.filter((x) => a.optionIds?.includes(x.id)).reduce((s, x) => s + x.score, 0) / total) : 0;
      } else if (q.type === 'linear_scale') {
        const max = parseJson<any>(q.settings, {}).max ?? 5;
        r = typeof a.value === 'number' && max > 0 ? a.value / max : 0;
      } else {
        const max = Math.max(0, ...o.map((x) => x.score));
        const sel = o.find((x) => x.id === a.optionId);
        r = sel && max > 0 ? Math.max(0, sel.score) / max : 0;
      }
    }
    sec.earned += r * q.points;
  }
  return out;
}

export interface ReportVisibility { selfLeader: boolean; exec: boolean }

export function employeeReport(roundId: number, employeeId: number, vis: ReportVisibility, cached?: EmployeeResult[]) {
  const results = cached ?? computeRoundResults(roundId);
  const result = results.find((r) => r.employee_id === employeeId);
  if (!result) return null;
  const round = get<any>('SELECT id, name, year, period_start, period_end, start_date, end_date, status FROM evaluation_rounds WHERE id = ?', [roundId]);
  const emp = get<any>(`SELECT e.emp_no, e.name, e.position, e.title, e.hire_date, e.is_leader, d.name AS department_name
    FROM employees e LEFT JOIN departments d ON d.id = e.department_id WHERE e.id = ?`, [employeeId]);
  const sections: SectionScore[] = [];
  const opinions: { stage: Stage; label: string; text: string }[] = [];
  const suggestions: { stage: Stage; text: string }[] = [];
  for (const st of STAGES) {
    const s = result.stages[st];
    // 팀원→팀장평가는 평가자가 여러 명: 제출된 평가 전체를 평정요소별 평균으로 표시
    const ids: number[] = st === 'upward'
      ? all<{ id: number }>(`SELECT id FROM evaluation_assignments WHERE round_id = ? AND target_employee_id = ? AND stage = 'upward' AND status = 'submitted'`,
        [roundId, employeeId]).map((x) => x.id)
      : s.state === 'submitted' && s.assignment_id ? [s.assignment_id] : [];
    const acc = new Map<string, { max: number; sum: number; n: number }>();
    for (const id of ids) {
      const a = get<any>('SELECT form_id FROM evaluation_assignments WHERE id = ?', [id]);
      if (!a?.form_id) continue; // CSV로 가져온 점수는 문항 응답 없음
      for (const sec of sectionScores(id, a.form_id)) {
        const cur = acc.get(sec.title) ?? { max: sec.max, sum: 0, n: 0 };
        cur.sum += sec.earned;
        cur.n++;
        acc.set(sec.title, cur);
      }
      const canText = st === 'exec' ? vis.exec : vis.selfLeader;
      if (!canText) continue;
      const texts = all<any>(`SELECT q.type, q.text, q.is_suggestion, r.answer FROM evaluation_responses r JOIN form_questions q ON q.id = r.question_id
        WHERE r.assignment_id = ? AND (q.type = 'descriptive' OR (q.type = 'long_text' AND (q.is_suggestion = 1 OR q.text LIKE '평가%의견' OR q.text LIKE '평가의견')))
        ORDER BY q.sort_order`, [id]);
      for (const t of texts) {
        const text = parseJson<Answer>(t.answer, {}).text?.trim();
        if (!text) continue;
        if (t.is_suggestion) suggestions.push({ stage: st, text });
        else opinions.push({ stage: st, label: t.text, text });
      }
    }
    for (const [title, v] of acc) {
      let row = sections.find((x) => x.title === title);
      if (!row) { row = { title, max: round2(v.max), earned: {} }; sections.push(row); }
      row.earned[st] = round2(v.sum / v.n);
    }
  }
  const adjustments = all<any>(`SELECT a.*, u.display_name AS adjusted_by_name, v.display_name AS reverted_by_name
    FROM score_adjustments a JOIN users u ON u.id = a.adjusted_by LEFT JOIN users v ON v.id = a.reverted_by
    WHERE a.round_id = ? AND a.employee_id = ? ORDER BY a.id DESC`, [roundId, employeeId]);
  const finalizations = all<any>(`SELECT f.*, u.display_name AS finalized_by_name, v.display_name AS reopened_by_name
    FROM result_finalizations f JOIN users u ON u.id = f.finalized_by LEFT JOIN users v ON v.id = f.reopened_by
    WHERE f.round_id = ? AND f.employee_id = ? ORDER BY f.id DESC`, [roundId, employeeId]);
  return { round, employee: { id: employeeId, ...emp }, result, sections, opinions, suggestions, adjustments, finalizations };
}

function stats(list: EmployeeResult[]) {
  const done = list.filter((r) => r.state === 'completed' || r.state === 'finalized');
  const scores = done.map((r) => r.final_score).filter((x): x is number => x !== null);
  const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const stageAvg = Object.fromEntries(STAGES.map((s) => [s, avg(list.map((r) => r.stages[s].score).filter((x): x is number => x !== null))]));
  const bands = [
    { label: '90+', count: scores.filter((x) => x >= 90).length },
    { label: '80–89', count: scores.filter((x) => x >= 80 && x < 90).length },
    { label: '70–79', count: scores.filter((x) => x >= 70 && x < 80).length },
    { label: '60–69', count: scores.filter((x) => x >= 60 && x < 70).length },
    { label: '<60', count: scores.filter((x) => x < 60).length },
  ];
  return {
    total: list.length,
    completed: done.length,
    finalized: list.filter((r) => r.finalized).length,
    rate: list.length ? round2((done.length / list.length) * 100) : 0,
    avg: avg(scores),
    max: scores.length ? Math.max(...scores) : null,
    min: scores.length ? Math.min(...scores) : null,
    stageAvg,
    bands,
  };
}

export function departmentReport(roundId: number, departmentId: number, cached?: EmployeeResult[]) {
  const results = (cached ?? computeRoundResults(roundId)).filter((r) => r.department_id === departmentId);
  const dept = get<any>(`SELECT d.id, d.code, d.name, l.name AS leader_name FROM departments d LEFT JOIN employees l ON l.id = d.leader_employee_id WHERE d.id = ?`, [departmentId]);
  const round = get<any>('SELECT id, name, year, period_start, period_end, start_date, end_date FROM evaluation_rounds WHERE id = ?', [roundId]);
  return {
    round, department: dept, stats: stats(results),
    members: results.map((r) => ({
      employee_id: r.employee_id, emp_no: r.emp_no, name: r.name, position: r.position, state: r.state,
      self: r.stages.self.score, leader: r.stages.leader.score, exec: r.stages.exec.score, upward: r.stages.upward.score, weighted: r.weighted_score, final: r.final_score,
    })).sort((a, b) => (b.final ?? -1) - (a.final ?? -1)),
  };
}

export function overallReport(roundId: number, cached?: EmployeeResult[]) {
  const results = cached ?? computeRoundResults(roundId);
  const round = get<any>('SELECT id, name, year, period_start, period_end, start_date, end_date FROM evaluation_rounds WHERE id = ?', [roundId]);
  const deptIds = [...new Set(results.map((r) => r.department_id))];
  const departments = deptIds.map((id) => {
    const list = results.filter((r) => r.department_id === id);
    return { id, name: list[0]?.department_name ?? '-', ...stats(list) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const ranked = results.filter((r) => r.final_score !== null).sort((a, b) => b.final_score! - a.final_score!);
  return {
    round, stats: stats(results), departments,
    top: ranked.slice(0, 5).map((r) => ({ emp_no: r.emp_no, name: r.name, department_name: r.department_name, final: r.final_score })),
    pending: results.filter((r) => r.state === 'not_started' || r.state === 'in_progress').length,
  };
}

/** 팀장 개인 리포트: 본인 결과 + 소속 팀 요약 */
export function leaderReport(roundId: number, employeeId: number, vis: ReportVisibility, cached?: EmployeeResult[]) {
  const results = cached ?? computeRoundResults(roundId);
  const base = employeeReport(roundId, employeeId, vis, results);
  if (!base) return null;
  const depts = all<any>('SELECT id, name FROM departments WHERE leader_employee_id = ? AND deleted_at IS NULL', [employeeId]);
  const team = results.filter((r) => depts.some((d) => d.id === r.department_id) && r.employee_id !== employeeId);
  return { ...base, team: { departments: depts.map((d) => d.name), ...stats(team) } };
}
