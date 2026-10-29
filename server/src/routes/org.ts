import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, tx, now } from '../db/index.ts';
import { h, parse, audit, ApiError, notFound, idParam, paginate } from '../http.ts';
import { requirePerm, hashPassword } from '../auth.ts';
import { sendCsv } from '../csv.ts';
import { computeEmployeeResult } from '../scoring.ts';
import { newDeptCode } from '../services/csvKinds.ts';
import { POSITIONS, DEFAULT_POSITION, positionFlags } from '../positions.ts';

export const orgRouter = Router();

/* ───────────── 부서 ───────────── */

const deptSelect = `
  SELECT d.*, l.name AS leader_name, l.emp_no AS leader_emp_no, x.name AS exec_name, x.emp_no AS exec_emp_no,
    (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.deleted_at IS NULL AND e.status <> 'resigned') AS member_count
  FROM departments d
  LEFT JOIN employees l ON l.id = d.leader_employee_id
  LEFT JOIN employees x ON x.id = d.exec_employee_id`;

orgRouter.get('/departments', requirePerm('org.view'), h((req, res) => {
  const q = String(req.query.q ?? '').trim();
  const sort = String(req.query.sort ?? 'name');
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const col = ({ name: 'd.name', code: 'd.code', members: 'member_count', leader: 'leader_name' } as Record<string, string>)[sort] ?? 'd.name';
  const rows = all(`${deptSelect} WHERE d.deleted_at IS NULL AND (? = '' OR d.name LIKE ? OR d.code LIKE ?) ORDER BY ${col} ${dir}, d.id`,
    [q, `%${q}%`, `%${q}%`]);
  res.json({ items: rows });
}));

orgRouter.get('/departments/export.csv', requirePerm('org.view'), h((req, res) => {
  const rows = all<any>(`${deptSelect} WHERE d.deleted_at IS NULL ORDER BY d.name`);
  audit(req, 'department.export', 'department', null, { count: rows.length });
  sendCsv(res, `departments_${now().slice(0, 10)}.csv`, ['부서명', '팀장사번', '팀장', '인원', '설명'],
    rows.map((d) => [d.name, d.leader_emp_no, d.leader_name, d.member_count, d.description]));
}));

orgRouter.get('/departments/:id', requirePerm('org.view'), h((req, res) => {
  const id = idParam(req);
  const d = get(`${deptSelect} WHERE d.id = ? AND d.deleted_at IS NULL`, [id]);
  if (!d) throw notFound();
  const members = all(`SELECT id, emp_no, name, position, title, is_leader, is_executive, status, job_group
    FROM employees WHERE department_id = ? AND deleted_at IS NULL ORDER BY is_leader DESC, name`, [id]);
  res.json({ ...d, members });
}));

const deptSchema = z.object({
  // 부서코드는 화면에서 입력받지 않음 (생략 시 자동 생성 / 기존 값 유지)
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/).optional(),
  name: z.string().trim().min(1).max(100),
  leader_employee_id: z.number().int().positive().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

function setLeader(deptId: number, empId: number | null | undefined) {
  if (empId === undefined) return;
  if (empId) {
    const e = get<any>('SELECT id, department_id FROM employees WHERE id = ? AND deleted_at IS NULL', [empId]);
    if (!e) throw new ApiError(400, 'EMPLOYEE_NOT_FOUND');
    if (e.department_id !== deptId) run('UPDATE employees SET department_id = ?, updated_at = ? WHERE id = ?', [deptId, now(), empId]);
    // 부서 팀장으로 지정하면 직급도 팀장으로 맞춤 (임원은 그대로). 지정 해제 시 직급은 바꾸지 않음
    run(`UPDATE employees SET position = '팀장', is_leader = 1, updated_at = ? WHERE id = ? AND COALESCE(position, '') <> '임원'`, [now(), empId]);
  }
  run('UPDATE departments SET leader_employee_id = ?, updated_at = ? WHERE id = ?', [empId, now(), deptId]);
}

orgRouter.post('/departments', requirePerm('org.manage'), h((req, res) => {
  const b = parse(deptSchema, req.body);
  const code = b.code ?? newDeptCode();
  if (get('SELECT id FROM departments WHERE code = ? AND deleted_at IS NULL', [code])) throw new ApiError(409, 'DUPLICATE_DEPT_CODE');
  // 삭제된 동일 코드가 있으면 코드 재사용을 위해 이름을 변경
  run(`UPDATE departments SET code = code || '#' || id WHERE code = ? AND deleted_at IS NOT NULL`, [code]);
  const id = tx(() => {
    const newId = run('INSERT INTO departments (code, name, description) VALUES (?, ?, ?)',
      [code, b.name, b.description ?? null]).lastInsertRowid;
    setLeader(newId, b.leader_employee_id ?? null);
    return newId;
  });
  audit(req, 'department.create', 'department', id, b);
  res.status(201).json(get(`${deptSelect} WHERE d.id = ?`, [id]));
}));

orgRouter.put('/departments/:id', requirePerm('org.manage'), h((req, res) => {
  const id = idParam(req);
  const before = get<any>('SELECT * FROM departments WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!before) throw notFound();
  const b = parse(deptSchema, req.body);
  const code = b.code ?? before.code;
  if (get('SELECT id FROM departments WHERE code = ? AND id <> ? AND deleted_at IS NULL', [code, id])) throw new ApiError(409, 'DUPLICATE_DEPT_CODE');
  tx(() => {
    run('UPDATE departments SET code = ?, name = ?, description = ?, updated_at = ? WHERE id = ?',
      [code, b.name, b.description ?? null, now(), id]);
    setLeader(id, b.leader_employee_id ?? null);
  });
  audit(req, 'department.update', 'department', id, { before, after: b });
  res.json(get(`${deptSelect} WHERE d.id = ?`, [id]));
}));

orgRouter.put('/departments/:id/leader', requirePerm('org.manage'), h((req, res) => {
  const id = idParam(req);
  const b = parse(z.object({ employeeId: z.number().int().positive().nullable() }), req.body);
  if (!get('SELECT id FROM departments WHERE id = ? AND deleted_at IS NULL', [id])) throw notFound();
  tx(() => setLeader(id, b.employeeId));
  audit(req, 'department.set_leader', 'department', id, b);
  res.json(get(`${deptSelect} WHERE d.id = ?`, [id]));
}));

/* ───────────── 직원 ───────────── */

const empSelect = `
  SELECT e.*, d.name AS department_name, d.code AS department_code, u.id AS user_id, r.code AS role, u.is_active AS account_active,
    u.last_login_at
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN users u ON u.employee_id = e.id
  LEFT JOIN roles r ON r.id = u.role_id`;

orgRouter.get('/employees', requirePerm('org.view'), h((req, res) => {
  const q = String(req.query.q ?? '').trim();
  const where: string[] = [];
  const params: unknown[] = [];
  if (req.query.includeDeleted !== '1') where.push('e.deleted_at IS NULL');
  else if (req.query.onlyDeleted === '1') where.push('e.deleted_at IS NOT NULL');
  if (q) {
    where.push('(e.name LIKE ? OR e.emp_no LIKE ? OR e.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (req.query.departmentId) { where.push('e.department_id = ?'); params.push(Number(req.query.departmentId)); }
  if (req.query.status) { where.push('e.status = ?'); params.push(String(req.query.status)); }
  if (req.query.jobGroup) { where.push('e.job_group = ?'); params.push(String(req.query.jobGroup)); }
  if (req.query.position) { where.push('e.position = ?'); params.push(String(req.query.position)); }
  const sortCols: Record<string, string> = {
    name: 'e.name', emp_no: 'e.emp_no', department: 'department_name', position: 'e.position', hire_date: 'e.hire_date', status: 'e.status',
  };
  const col = sortCols[String(req.query.sort)] ?? 'e.emp_no';
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const rows = all(`${empSelect} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${col} ${dir}, e.id`, params);
  if (req.query.all === '1') {
    res.json({ items: rows, total: rows.length });
    return;
  }
  res.json(paginate(rows, req));
}));

const STATUS_KO: Record<string, string> = { active: '재직', leave: '휴직', resigned: '퇴사' };
const GROUP_KO: Record<string, string> = { office: '관리직', production: '생산직' };

orgRouter.get('/employees/export.csv', requirePerm('org.view'), h((req, res) => {
  const rows = all<any>(`${empSelect} WHERE e.deleted_at IS NULL ORDER BY e.emp_no`);
  audit(req, 'employee.export', 'employee', null, { count: rows.length });
  sendCsv(res, `employees_${now().slice(0, 10)}.csv`,
    ['사번', '이름', '부서명', '직급', '직군', '재직상태', '입사일', '이메일', '연락처'],
    rows.map((e) => [e.emp_no, e.name, e.department_name, e.position, GROUP_KO[e.job_group],
      STATUS_KO[e.status], e.hire_date, e.email, e.phone]));
}));

orgRouter.get('/employees/:id', requirePerm('org.view'), h((req, res) => {
  const id = idParam(req);
  const e = get<any>(`${empSelect} WHERE e.id = ?`, [id]);
  if (!e) throw notFound();
  const rounds = all<any>(`SELECT r.id, r.name, r.year, r.status FROM round_targets t JOIN evaluation_rounds r ON r.id = t.round_id
    WHERE t.employee_id = ? AND r.deleted_at IS NULL ORDER BY r.start_date DESC`, [id]);
  const canSeeScores = req.user!.permissions.includes('results.view');
  const history = rounds.map((r) => {
    const result = computeEmployeeResult(r.id, id);
    return {
      round_id: r.id, round_name: r.name, round_status: r.status, state: result?.state,
      final_score: canSeeScores ? result?.final_score ?? null : undefined,
    };
  });
  res.json({ ...e, history });
}));

const empSchema = z.object({
  emp_no: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(100),
  department_id: z.number().int().positive().nullable(),
  position: z.enum(POSITIONS).optional(),
  job_group: z.enum(['office', 'production']),
  status: z.enum(['active', 'leave', 'resigned']),
  hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('')),
  email: z.string().trim().email().nullable().optional().or(z.literal('')),
  phone: z.string().trim().max(30).nullable().optional(),
});

orgRouter.post('/employees', requirePerm('org.manage'), h((req, res) => {
  const b = parse(empSchema, req.body);
  if (get('SELECT id FROM employees WHERE emp_no = ?', [b.emp_no])) throw new ApiError(409, 'DUPLICATE_EMP_NO');
  // 임원·팀장 여부는 직급에서 결정
  const position = b.position ?? DEFAULT_POSITION;
  const flags = positionFlags(position);
  const id = run(
    `INSERT INTO employees (emp_no, name, department_id, position, job_group, is_executive, is_leader, status, hire_date, email, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.emp_no, b.name, b.department_id, position, b.job_group, flags.is_executive, flags.is_leader,
      b.status, b.hire_date || null, b.email || null, b.phone ?? null]).lastInsertRowid;
  audit(req, 'employee.create', 'employee', id, b);
  res.status(201).json(get(`${empSelect} WHERE e.id = ?`, [id]));
}));

orgRouter.put('/employees/:id', requirePerm('org.manage'), h((req, res) => {
  const id = idParam(req);
  const before = get<any>('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!before) throw notFound();
  const b = parse(empSchema, req.body);
  if (get('SELECT id FROM employees WHERE emp_no = ? AND id <> ?', [b.emp_no, id])) throw new ApiError(409, 'DUPLICATE_EMP_NO');
  tx(() => {
    const position = b.position ?? before.position ?? DEFAULT_POSITION; // 직급 생략 시 기존 값 유지
    const flags = positionFlags(position);
    run(`UPDATE employees SET emp_no = ?, name = ?, department_id = ?, position = ?, job_group = ?, is_executive = ?, is_leader = ?,
         status = ?, hire_date = ?, email = ?, phone = ?, updated_at = ? WHERE id = ?`,
      [b.emp_no, b.name, b.department_id, position, b.job_group, flags.is_executive, flags.is_leader,
        b.status, b.hire_date || null, b.email || null, b.phone ?? null, now(), id]);
    // 부서를 옮기면 기존 부서의 팀장(평가자) 지정은 해제. 직급은 입력값 그대로
    if (before.department_id !== b.department_id) run('UPDATE departments SET leader_employee_id = NULL WHERE leader_employee_id = ?', [id]);
    run('UPDATE users SET emp_no = ?, display_name = ?, email = COALESCE(?, email) WHERE employee_id = ?', [b.emp_no, b.name, b.email || null, id]);
    if (b.status === 'resigned') run('UPDATE users SET is_active = 0 WHERE employee_id = ?', [id]);
  });
  audit(req, 'employee.update', 'employee', id, { before, after: b });
  res.json(get(`${empSelect} WHERE e.id = ?`, [id]));
}));

orgRouter.post('/employees/:id/move', requirePerm('org.manage'), h((req, res) => {
  const id = idParam(req);
  const b = parse(z.object({ departmentId: z.number().int().positive() }), req.body);
  const e = get<any>('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!e) throw notFound();
  if (!get('SELECT id FROM departments WHERE id = ? AND deleted_at IS NULL', [b.departmentId])) throw new ApiError(400, 'DEPARTMENT_NOT_FOUND');
  tx(() => {
    run('UPDATE departments SET leader_employee_id = NULL WHERE leader_employee_id = ?', [id]);
    run('UPDATE employees SET department_id = ?, updated_at = ? WHERE id = ?', [b.departmentId, now(), id]);
  });
  audit(req, 'employee.move', 'employee', id, { from: e.department_id, to: b.departmentId });
  res.json(get(`${empSelect} WHERE e.id = ?`, [id]));
}));

/** 소프트 삭제: 과거 평가 기록 보존, 로그인 계정 비활성화 */
orgRouter.delete('/employees/:id', requirePerm('org.manage'), h((req, res) => {
  const id = idParam(req);
  const e = get<any>('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!e) throw notFound();
  if (req.user!.employee_id === id) throw new ApiError(400, 'CANNOT_DELETE_SELF');
  tx(() => {
    run('UPDATE employees SET deleted_at = ?, updated_at = ? WHERE id = ?', [now(), now(), id]);
    run('UPDATE departments SET leader_employee_id = NULL WHERE leader_employee_id = ?', [id]);
    run('UPDATE users SET is_active = 0 WHERE employee_id = ?', [id]);
    run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE employee_id = ?)', [id]);
  });
  audit(req, 'employee.delete', 'employee', id, { emp_no: e.emp_no, name: e.name });
  res.json({ ok: true });
}));

orgRouter.post('/employees/:id/restore', requirePerm('org.manage'), h((req, res) => {
  const id = idParam(req);
  const e = get<any>('SELECT * FROM employees WHERE id = ? AND deleted_at IS NOT NULL', [id]);
  if (!e) throw notFound();
  run('UPDATE employees SET deleted_at = NULL, updated_at = ? WHERE id = ?', [now(), id]);
  audit(req, 'employee.restore', 'employee', id, { emp_no: e.emp_no });
  res.json(get(`${empSelect} WHERE e.id = ?`, [id]));
}));

/** 로그인 계정 발급/수정 (역할, 임시 비밀번호, 활성 상태) */
orgRouter.put('/employees/:id/account', requirePerm('users.manage'), h((req, res) => {
  const id = idParam(req);
  const b = parse(z.object({
    role: z.enum(['executive', 'admin', 'leader', 'employee']),
    isActive: z.boolean(),
  }), req.body);
  const e = get<any>('SELECT * FROM employees WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!e) throw notFound();
  const role = get<{ id: number }>('SELECT id FROM roles WHERE code = ?', [b.role])!;
  const u = get<any>('SELECT u.*, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE employee_id = ?', [id]);
  // 본인 계정의 관리자 권한을 스스로 해제하거나 비활성화하면 관리자가 없어질 수 있으므로 차단
  if (u && u.id === req.user!.id && (b.role !== 'admin' || !b.isActive)) throw new ApiError(400, 'CANNOT_DEMOTE_SELF');
  if (u) {
    run('UPDATE users SET role_id = ?, is_active = ? WHERE id = ?', [role.id, b.isActive, u.id]);
    if (!b.isActive) run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
  } else {
    // 로그인 비밀번호는 사번 (password_hash 는 스키마 호환용으로 사번 해시를 보관)
    run('INSERT INTO users (emp_no, employee_id, display_name, email, password_hash, role_id, is_active, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [e.emp_no, id, e.name, e.email, hashPassword(e.emp_no), role.id, b.isActive, now()]);
  }
  audit(req, 'user.account_update', 'employee', id, { role: b.role, isActive: b.isActive });
  res.json(get(`${empSelect} WHERE e.id = ?`, [id]));
}));
