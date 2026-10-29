/**
 * 기존 DB에 역할별 확인용 계정 반영: npm run db:demo-accounts
 *   관리자 / Admin · 팀원 / A000 · 팀장 / A0001 · 임원 / A0002 (아이디 = 이름, 비밀번호 = 사번)
 * 예전 이름·사번으로 만들어진 계정은 새로 만들지 않고 이름·사번만 바꾼다 (평가 배정·응답은 그대로 유지).
 */
import { get, run, tx } from './index.ts';
import { migrate } from './migrate.ts';
import { ADMIN_LOGIN, DEMO_ACCOUNTS, ensureDemoAccounts } from './demoAccounts.ts';

migrate(false);

/** 직원·로그인 계정의 이름과 사번 변경 */
function rename(employeeId: number, empNo: string, name: string) {
  if (get('SELECT 1 FROM employees WHERE emp_no = ? AND id <> ?', [empNo, employeeId])) throw new Error(`사번 ${empNo} 이(가) 이미 사용 중입니다`);
  const before = get<{ emp_no: string; name: string }>('SELECT emp_no, name FROM employees WHERE id = ?', [employeeId])!;
  if (before.emp_no === empNo && before.name === name) return;
  run(`UPDATE employees SET emp_no = ?, name = ?, updated_at = datetime('now') WHERE id = ?`, [empNo, name, employeeId]);
  run('UPDATE users SET emp_no = ?, display_name = ? WHERE employee_id = ?', [empNo, name, employeeId]);
  run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE employee_id = ?)', [employeeId]);
  console.log(`[demo] ${before.name} / ${before.emp_no} → ${name} / ${empNo}`);
}

tx(() => {
  // 관리자: 예전 샘플 관리자(홍길동, 사번 A0001 또는 Adimin)
  const admin = get<{ id: number }>(`SELECT e.id FROM employees e JOIN users u ON u.employee_id = e.id JOIN roles r ON r.id = u.role_id
    WHERE r.code = 'admin' AND e.deleted_at IS NULL AND (e.emp_no IN (?, 'Adimin') OR (e.name = '홍길동' AND e.emp_no = 'A0001')) ORDER BY e.id LIMIT 1`, [ADMIN_LOGIN.empNo]);
  if (admin) rename(admin.id, ADMIN_LOGIN.empNo, ADMIN_LOGIN.name);
  // 이전 확인용 계정(홍길공 / A0000, 홍길일 / A0001, 홍길이 / A0002)
  const legacy: Record<string, string> = { member: 'A0000', leader: 'A0001', exec: 'A0002' };
  for (const d of DEMO_ACCOUNTS) {
    const old = get<{ id: number }>(`SELECT e.id FROM employees e JOIN users u ON u.employee_id = e.id JOIN roles r ON r.id = u.role_id
      WHERE e.emp_no IN (?, ?) AND r.code = ? AND e.deleted_at IS NULL ORDER BY e.id LIMIT 1`, [d.empNo, legacy[d.key], d.role]);
    if (old) rename(old.id, d.empNo, d.name);
  }
});
console.log('[demo]', ensureDemoAccounts());
