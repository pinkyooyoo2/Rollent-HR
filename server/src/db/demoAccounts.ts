/**
 * 역할별 확인용 계정 (아이디 = 이름, 비밀번호 = 사번)
 *   관리자 / Admin · 팀원 / A000 · 팀장 / A0001 · 임원 / A0002
 *
 * 팀원·팀장·임원 세 사람을 진행 중인 차수에서 서로 평가하는 한 팀으로 배정한다.
 *   팀원: 자기평가 + 팀장평가(→ 팀장)
 *   팀장: 자기평가 + 팀원평가(→ 팀원)
 *   임원: 자기평가 + 팀장평가(→ 팀장) + 팀원평가(→ 팀원)
 * 여러 번 실행해도 결과가 같다(이미 있으면 건너뜀). 제출·작성 중인 배정은 바꾸지 않는다.
 */
import { all, get, run, tx } from './index.ts';
import { hashPassword } from '../auth.ts';
import { addRoundTargets, autoAssign } from '../services/rounds.ts';

export const ADMIN_LOGIN = { name: '관리자', empNo: 'Admin' };

export const DEMO_ACCOUNTS = [
  { key: 'member', empNo: 'A000', name: '팀원', position: '팀원', role: 'employee', isLeader: 0, isExecutive: 0 },
  { key: 'leader', empNo: 'A0001', name: '팀장', position: '팀장', role: 'leader', isLeader: 1, isExecutive: 0 },
  { key: 'exec', empNo: 'A0002', name: '임원', position: '임원', role: 'executive', isLeader: 0, isExecutive: 1 },
] as const;

export function ensureDemoAccounts() {
  return tx(() => {
    const dept = get<{ id: number }>("SELECT id FROM departments WHERE code = 'OFF' AND deleted_at IS NULL")
      ?? get<{ id: number }>('SELECT id FROM departments WHERE deleted_at IS NULL ORDER BY id LIMIT 1');
    const id: Record<string, number> = {};
    let created = 0;
    for (const d of DEMO_ACCOUNTS) {
      const exists = get<{ id: number }>('SELECT id FROM employees WHERE emp_no = ?', [d.empNo]);
      if (exists) { id[d.key] = exists.id; continue; }
      const email = `${d.empNo.toLowerCase()}@rollent.example`;
      id[d.key] = run(
        `INSERT INTO employees (emp_no, name, department_id, position, job_group, is_leader, is_executive, status, hire_date, email)
         VALUES (?, ?, ?, ?, 'office', ?, ?, 'active', '2026-01-02', ?)`,
        [d.empNo, d.name, dept?.id ?? null, d.position, d.isLeader, d.isExecutive, email]).lastInsertRowid;
      const role = get<{ id: number }>('SELECT id FROM roles WHERE code = ?', [d.role])!;
      run(`INSERT INTO users (emp_no, employee_id, display_name, email, password_hash, role_id, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        [d.empNo, id[d.key], d.name, email, hashPassword(d.empNo), role.id]);
      created++;
    }
    const { member, leader, exec } = id;
    let assigned = 0;
    for (const r of all<{ id: number }>("SELECT id FROM evaluation_rounds WHERE status = 'open' AND deleted_at IS NULL")) {
      addRoundTargets(r.id, [member, leader, exec]);
      autoAssign(r.id);
      const setEvaluator = (target: number, stage: string, evaluator: number) => {
        assigned += run(`UPDATE evaluation_assignments SET evaluator_employee_id = ?, updated_at = datetime('now')
          WHERE round_id = ? AND target_employee_id = ? AND stage = ? AND status = 'not_started' AND COALESCE(evaluator_employee_id, 0) <> ?`,
        [evaluator, r.id, target, stage, evaluator]).changes;
      };
      setEvaluator(member, 'leader', leader); // 팀장 → 팀원
      setEvaluator(member, 'exec', exec); // 임원 → 팀원
      setEvaluator(leader, 'exec', exec); // 임원 → 팀장
      // 팀원 → 팀장: 확인용 팀원은 확인용 팀장만 평가 (같은 부서 팀장에게 자동 배정된 건은 아직 시작 전이면 제외)
      assigned += run(`INSERT OR IGNORE INTO evaluation_assignments (round_id, target_employee_id, stage, evaluator_employee_id) VALUES (?, ?, 'upward', ?)`,
        [r.id, leader, member]).changes;
      run(`DELETE FROM evaluation_assignments WHERE round_id = ? AND stage = 'upward' AND evaluator_employee_id = ? AND target_employee_id <> ? AND status = 'not_started'`,
        [r.id, member, leader]);
    }
    return { created, assigned };
  });
}
