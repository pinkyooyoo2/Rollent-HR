/**
 * API 통합 스모크 테스트: 별도 테스트 DB(data/test.db)를 생성해 주요 기능을 실제 호출로 검증
 * 실행: npm run test:api
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

process.env.DB_PATH = 'data/test.db';
process.env.NO_LISTEN = '1';
const root = path.resolve(import.meta.dirname, '..', '..');
execFileSync(process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/src/db/seed.ts', '--reset'],
  { cwd: root, env: { ...process.env }, stdio: 'ignore' });

const { app } = await import('../src/index.ts');
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

let passed = 0;
let failed = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  ✘ ${name}`, extra ?? ''); }
}

class Client {
  cookie = '';
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' }) {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', ...headers, ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const buf = new Uint8Array(await res.arrayBuffer());
    const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    const text = new TextDecoder().decode(buf);
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, data, text, bom, disposition: decodeURIComponent(res.headers.get('content-disposition') ?? '') };
  }
  /** 로그인: 아이디 = 이름, 비밀번호 = 사번 */
  login(name: string, empNo: string) { return this.req('POST', '/auth/login', { name, password: empNo }); }
  ready(name: string, empNo: string) { return this.login(name, empNo); }
}

const admin = new Client();
const exec = new Client();
const emp = new Client();

console.log('\n[1] 인증 (아이디 = 이름, 비밀번호 = 사번)');
check('잘못된 비밀번호 → 401', (await admin.login('관리자', 'wrong')).status === 401);
check('미인증 접근 → 401', (await admin.req('GET', '/dashboard')).status === 401);
const adminLogin = await admin.login('관리자', 'Admin');
check('관리자 로그인 (이름 + 사번) → 바로 사용 가능', adminLogin.status === 200 && (await admin.req('GET', '/dashboard')).status === 200);
check('로그인 정보에 비밀번호 변경 요구 없음', !('must_change_password' in adminLogin.data.user));
check('비밀번호 설정·변경·찾기 API 없음', (await admin.req('POST', '/auth/password/change', { currentPassword: 'Admin', newPassword: 'NewPass123' })).status === 404
  && (await new Client().req('POST', '/auth/password/forgot', { name: '관리자', email: 'admin@rollent.example' })).status === 404);
check('여러 번 로그인해도 항상 사번으로 로그인', (await new Client().login('관리자', 'Admin')).status === 200);
check('CSRF 헤더 없는 변경 요청 차단', (await admin.req('POST', '/auth/logout', {}, {})).status === 403);
check('임원 로그인', (await exec.login('김대양', 'E0001')).status === 200);
check('직원 로그인', (await emp.login('정민호', 'R2001')).status === 200);
check('임원은 관리 기능 접근 불가 (대시보드·결과·직원·보정)', (await exec.req('GET', '/dashboard')).status === 403 && (await exec.req('GET', '/employees')).status === 403
  && (await exec.req('GET', '/rounds')).status === 403);
check('직원은 대시보드 접근 불가(403)', (await emp.req('GET', '/dashboard')).status === 403);
check('언어 저장', (await emp.req('PUT', '/auth/language', { language: 'ru' })).status === 200 && (await emp.req('GET', '/auth/me')).data.user.language === 'ru');
check('사번으로는 아이디 로그인 불가 (아이디 = 이름)', (await new Client().login('A0001', 'A0001')).status === 401);
check('다른 사람 사번으로 로그인 불가', (await new Client().login('관리자', 'E0001')).status === 401);
check('이름 앞뒤 공백·사번 대소문자 허용', (await new Client().login('  관리자 ', ' admin ')).status === 200);
check('러시아어 이름 로그인', (await new Client().login('Иван Петров', 'R3012')).status === 200);
// 역할별 확인용 계정: 관리자/Admin, 팀원/A000, 팀장/A0001, 임원/A0002
const demoAdmin = new Client();
check('관리자 페이지 계정 관리자 / Admin', (await demoAdmin.login('관리자', 'Admin')).data.user?.role === 'admin' && (await demoAdmin.req('GET', '/dashboard')).status === 200);
const demoHome = async (name: string, empNo: string) => {
  const c = new Client();
  const l = await c.login(name, empNo);
  const h = await c.req('GET', '/eval/home');
  return { role: l.data.user?.role, items: (h.data.items ?? []).map((i: any) => `${i.eval_type}:${i.target?.name ?? '본인'}`).sort().join(',') };
};
const dMember = await demoHome('팀원', 'A000');
check('팀원 페이지 계정 팀원 / A000 (자기평가 + 팀장평가→팀장)', dMember.role === 'employee' && dMember.items === 'member_to_leader:팀장,self:본인', dMember);
const dLeader = await demoHome('팀장', 'A0001');
check('팀장 페이지 계정 팀장 / A0001 (자기평가 + 팀원평가→팀원)', dLeader.role === 'leader' && dLeader.items === 'leader_to_member:팀원,self:본인', dLeader);
const dExec = await demoHome('임원', 'A0002');
check('임원 페이지 계정 임원 / A0002 (자기평가 + 팀장평가→팀장 + 팀원평가→팀원)', dExec.role === 'executive'
  && dExec.items === 'exec_to_leader:팀장,exec_to_member:팀원,self:본인', dExec);
// 동명이인: 같은 이름 '정민호' 직원을 추가하고 각자 사번으로 로그인 → 각자 계정으로 구분
const twin = await admin.req('POST', '/employees', { emp_no: 'T9001', name: '정민호', department_id: null, job_group: 'production', status: 'active', position: '팀원' });
check('계정 생성 (비밀번호 입력 없음 → 사번)', (await admin.req('PUT', `/employees/${twin.data.id}/account`, { role: 'employee', isActive: true })).status === 200);
const twinLogin = await new Client().login('정민호', 'T9001');
const origLogin = await new Client().login('정민호', 'R2001');
check('동명이인 구분 로그인 (이름 + 사번)', twinLogin.data.user?.emp_no === 'T9001' && origLogin.data.user?.emp_no === 'R2001', { twin: twinLogin.data, orig: origLogin.data });
const twinEdit = await admin.req('PUT', `/employees/${twin.data.id}`, { emp_no: 'T9002', name: '정민호', department_id: null, job_group: 'production', status: 'active', position: '팀원' });
check('사번을 바꾸면 바뀐 사번으로 로그인', twinEdit.status === 200 && (await new Client().login('정민호', 'T9002')).status === 200
  && (await new Client().login('정민호', 'T9001')).status === 401);
await admin.req('DELETE', `/employees/${twin.data.id}`);

console.log('\n[2] 대시보드');
const dash = await admin.req('GET', '/dashboard');
check('요약 위젯 데이터', dash.data.summary.totalEmployees === 37 && dash.data.summary.targets > 0, dash.data.summary);
check('부서별 진행률', dash.data.departments.length === 2);
check('레이아웃 저장', (await admin.req('PUT', '/dashboard/layout', { widgets: [{ id: 'summary', visible: true }] })).status === 200);

console.log('\n[3] 부서/직원');
const dept = await admin.req('POST', '/departments', { code: 'TST', name: '테스트팀', description: 'smoke' });
check('부서 추가', dept.status === 201, dept.data);
check('부서 코드 중복 → 409', (await admin.req('POST', '/departments', { code: 'TST', name: 'x' })).status === 409);
const newEmp = await admin.req('POST', '/employees', { emp_no: 'T0001', name: '테스트', department_id: dept.data.id, job_group: 'office', status: 'active', position: '팀원' });
check('직원 추가', newEmp.status === 201, newEmp.data);
check('사번 중복 → 409', (await admin.req('POST', '/employees', { emp_no: 'T0001', name: 'x', department_id: null, job_group: 'office', status: 'active' })).status === 409);
check('팀장 지정', (await admin.req('PUT', `/departments/${dept.data.id}/leader`, { employeeId: newEmp.data.id })).data.leader_name === '테스트');
const list = await admin.req('GET', '/employees?q=테스트');
check('직원 검색', list.data.total === 1);
check('직원 소프트 삭제', (await admin.req('DELETE', `/employees/${newEmp.data.id}`)).status === 200);
check('삭제 직원 목록 제외', (await admin.req('GET', '/employees?q=T0001')).data.total === 0);
check('부서 삭제 불가(API 없음)', (await admin.req('DELETE', `/departments/${dept.data.id}`)).status === 404);
check('부서 수정', (await admin.req('PUT', `/departments/${dept.data.id}`, { code: 'TST', name: '테스트팀2' })).data.name === '테스트팀2');
const autoDept = await admin.req('POST', '/departments', { name: '코드없는부서' });
check('부서 추가 (코드 자동 생성)', autoDept.status === 201 && /^D\d{3,}$/.test(autoDept.data.code), autoDept.data);
check('부서 수정 시 코드 유지', (await admin.req('PUT', `/departments/${autoDept.data.id}`, { name: '코드없는부서2' })).data.code === autoDept.data.code);
const mover = await admin.req('POST', '/employees', { emp_no: 'T0002', name: '이동테스트', department_id: autoDept.data.id, job_group: 'office', status: 'active' });
await admin.req('PUT', `/departments/${autoDept.data.id}/leader`, { employeeId: mover.data.id });
const moved = await admin.req('PUT', `/employees/${mover.data.id}`, { emp_no: 'T0002', name: '이동테스트', department_id: dept.data.id, job_group: 'office', status: 'active' });
const autoAfter = await admin.req('GET', `/departments/${autoDept.data.id}`);
check('부서 팀장 지정 → 직급 팀장, 부서 이동 시 팀장(평가자) 지정 해제', moved.data.position === '팀장' && moved.data.is_leader === 1 && autoAfter.data.leader_employee_id === null, { moved: moved.data, autoAfter: autoAfter.data });
const deptCsv = await admin.req('GET', '/departments/export.csv');
check('부서 CSV에 부서코드·담당임원 없음', !deptCsv.text.includes('부서코드') && !deptCsv.text.includes('담당임원'));
const csv = await admin.req('GET', '/employees/export.csv');
check('직원 CSV 내보내기 (UTF-8 BOM)', csv.bom && csv.text.includes('사번'));
check('직원 CSV에 직책·팀장여부 없음', !csv.text.includes('직책') && !csv.text.includes('팀장여부'));
check('직급은 임원/팀장/차장/팀원만 허용', (await admin.req('POST', '/employees', { emp_no: 'T0003', name: 'x', department_id: dept.data.id, job_group: 'office', status: 'active', position: '사원' })).status === 400);
const execEmp = await admin.req('POST', '/employees', { emp_no: 'T0004', name: '임원테스트', department_id: dept.data.id, job_group: 'office', status: 'active', position: '임원' });
check('직급 임원 → 임원 여부 자동 설정', execEmp.data.is_executive === 1 && execEmp.data.is_leader === 0, execEmp.data);
const toDeputy = await admin.req('PUT', `/employees/${execEmp.data.id}`, { emp_no: 'T0004', name: '임원테스트', department_id: dept.data.id, job_group: 'office', status: 'active', position: '차장' });
check('직급 수정 (임원 → 차장)', toDeputy.data.position === '차장' && toDeputy.data.is_executive === 0 && toDeputy.data.is_leader === 0, toDeputy.data);
const seededPositions = (await admin.req('GET', '/employees?all=1')).data.items.map((e: any) => e.position);
check('샘플 직원 직급이 4단계로 정리됨', seededPositions.every((p: string) => ['임원', '팀장', '차장', '팀원'].includes(p)), [...new Set(seededPositions)]);

console.log('\n[4] CSV 업로드 (직원)');
const up = await admin.req('POST', '/uploads', {
  kind: 'employees', fileName: 'new.csv', headers: ['사번', '이름', '부서명', '입사일'],
  rows: [{ 사번: 'N0001', 이름: '신규1', 부서명: '관리직', 입사일: '2026/03/02' }, { 사번: 'N0001', 이름: '중복', 부서명: '관리직', 입사일: 'bad' }],
  mapping: { emp_no: '사번', name: '이름', department_name: '부서명', hire_date: '입사일' },
});
check('스테이징 + 검증 오류 감지(중복/날짜)', up.status === 201 && up.data.summary.errorRows === 1, up.data.summary);
check('오류 있으면 적용 차단', (await admin.req('POST', `/uploads/${up.data.id}/apply`)).status === 400);
const edited = await admin.req('PUT', `/uploads/${up.data.id}`, { rows: [up.data.rows[0], { 사번: 'N0002', 이름: '신규2', 부서명: '관리직', 입사일: '2026-03-02' }] });
check('파일 데이터 편집 후 재검증', edited.data.summary.errorRows === 0 && edited.data.summary.create === 2, edited.data.summary);
check('적용', (await admin.req('POST', `/uploads/${up.data.id}/apply`)).data.status === 'applied');
check('적용 결과 반영', (await admin.req('GET', '/employees?q=신규')).data.total === 2);
check('되돌리기', (await admin.req('POST', `/uploads/${up.data.id}/revert`)).data.status === 'reverted');
check('되돌리기 결과 반영', (await admin.req('GET', '/employees?q=신규')).data.total === 0);

console.log('\n[5] 평가 양식');
const forms = await admin.req('GET', '/forms?stage=self');
const pub = forms.data.items.find((f: any) => f.job_group === 'office_member' && f.status === 'published');
check('PDF 기반 게시 양식 존재 (배점 100)', pub && Math.round(pub.total_points) === 100, pub);
check('게시 양식 직접 수정 차단', (await admin.req('PUT', `/forms/${pub.id}`, { name: 'x', sections: [] })).status === 409);
const draft = await admin.req('POST', `/forms/${pub.id}/clone`);
check('새 버전(초안) 생성', draft.status === 201 && draft.data.version === 2);
const content = draft.data;
content.sections[0].questions.push({ type: 'linear_scale', text: '(샘플) 몰입도', required: false, points: 0, scored: false, settings: { min: 1, max: 5 }, is_sample: true, options: [] });
const saved = await admin.req('PUT', `/forms/${draft.data.id}`, { name: content.name, description: content.description, sections: content.sections });
check('초안 저장', saved.status === 200 && saved.data.question_count === pub.question_count + 1, saved.data?.error);
const qcsv = await admin.req('POST', '/uploads', {
  kind: 'questions', fileName: 'q.csv', headers: ['섹션', '질문', '유형', '선택지', '배점'],
  rows: [{ 섹션: '샘플', 질문: '추가 문항', 유형: '점수척도형', 선택지: '', 배점: '2' }],
  mapping: { section: '섹션', text: '질문', type: '유형', options: '선택지', points: '배점' }, options: { formId: draft.data.id, questionMode: 'append' },
});
check('질문 CSV 검증', qcsv.data.summary.errorRows === 0, qcsv.data.validation?.[0]);
check('질문 CSV 적용', (await admin.req('POST', `/uploads/${qcsv.data.id}/apply`)).data.status === 'applied');
check('질문 CSV 되돌리기', (await admin.req('POST', `/uploads/${qcsv.data.id}/revert`)).data.status === 'reverted');
check('질문 CSV 내보내기', (await admin.req('GET', `/forms/${pub.id}/export.csv`)).text.includes('점수척도형'));
check('초안 삭제', (await admin.req('DELETE', `/forms/${draft.data.id}`)).status === 200);

console.log('\n[6] 차수/가중치/배정');
const rounds = await admin.req('GET', '/rounds');
const r2 = rounds.data.items.find((r: any) => r.year === 2026);
const r1 = rounds.data.items.find((r: any) => r.year === 2025);
check('평가 차수 목록', r1 && r2);
check('가중치 합계 검증 (≠100 → 400)', (await admin.req('PUT', `/rounds/${r2.id}/weights`, { default: { self: 30, leader: 40, exec: 40 }, overrides: {} })).status === 400);
const prog = await admin.req('GET', `/rounds/${r2.id}/progress`);
check('진행 현황', prog.data.items.length === 37);
const newRound = await admin.req('POST', '/rounds', { name: '테스트 차수', year: 2027, start_date: '2027-01-01', end_date: '2027-01-31', enforce_sequence: true });
check('차수 생성 + 자동 배정', newRound.status === 201);
check('차수 오픈', (await admin.req('POST', `/rounds/${newRound.data.id}/status`, { status: 'open' })).data.self_status === 'open');
check('단계 마감', (await admin.req('POST', `/rounds/${newRound.data.id}/stage`, { stage: 'self', status: 'closed' })).data.self_status === 'closed');
check('차수 삭제(응답 없음)', (await admin.req('DELETE', `/rounds/${newRound.data.id}`)).status === 200);

console.log('\n[7] 평가 작성 (직원 본인)');
// 관리자는 모든 응답·점수를 볼 수 있으므로 일반 직원 중에서 선택
const pending = prog.data.items.find((x: any) => x.emp_no !== 'Admin' && (x.stages.self.state === 'not_started' || x.stages.self.state === 'in_progress'));
const writer = new Client();
check(`미제출 직원 로그인 (${pending.emp_no})`, (await writer.ready(pending.name, pending.emp_no)).status === 200);
const mine = await writer.req('GET', '/my/assignments');
const myOpen = mine.data.items.find((a: any) => a.round_id === r2.id && a.stage === 'self');
check('내 평가 목록', !!myOpen, mine.data);
const det = await writer.req('GET', `/assignments/${myOpen.id}`);
check('평가 양식 조회', det.status === 200 && det.data.form?.sections?.length > 0);
if (det.data.access.canEdit) {
  const answers: Record<string, any> = {};
  for (const s of det.data.form.sections) for (const q of s.questions) {
    if (['score_scale', 'single_choice', 'dropdown'].includes(q.type)) answers[q.id] = { optionId: q.options[0].id };
    if (q.type === 'descriptive') answers[q.id] = { text: '성과 서술', optionId: q.options[0].id };
    if (q.type === 'long_text' && q.required) answers[q.id] = { text: '담당 업무' };
  }
  check('필수 누락 제출 차단', (await writer.req('PUT', `/assignments/${myOpen.id}/responses`, { answers: {}, submit: true })).status === 400);
  const sub = await writer.req('PUT', `/assignments/${myOpen.id}/responses`, { answers, submit: true });
  check('자기평가 제출 (전 문항 A → 100점)', sub.status === 200, sub.data);
  const after = await admin.req('GET', `/assignments/${myOpen.id}`);
  check('제출 점수 100 환산 (관리자 조회)', after.data.score?.normalized_score === 100, after.data.score);
  const ownView = await writer.req('GET', `/assignments/${myOpen.id}`);
  check('평가자 본인에게는 점수 미노출', ownView.status === 200 && ownView.data.score === null, ownView.data.score);
} else {
  check('편집 가능해야 함', false, det.data.access);
}
check('타인 평가 열람 차단', (await writer.req('GET', `/assignments/${prog.data.items.find((x: any) => x.emp_no !== pending.emp_no).stages.self.assignment_id}`)).status === 403);

// 승인·확정은 관리자 권한. 업로더와 다른 관리자가 승인해야 하므로 두 번째 관리자 계정 준비
const a2emp = (await admin.req('GET', '/employees?q=R1002')).data.items[0];
await admin.req('PUT', `/employees/${a2emp.id}/account`, { role: 'admin', isActive: true });
const admin2 = new Client();
await admin2.login(a2emp.name, a2emp.emp_no);

console.log('\n[8] 결과 CSV 가져오기 + 승인 + 점수 공식 검증');
const target = prog.data.items.find((x: any) => x.emp_no === 'R2003');
const rup = await admin.req('POST', '/uploads', {
  kind: 'results', fileName: 'scores.csv', headers: ['사번', '평가유형', '점수'],
  rows: [{ 사번: 'R2003', 평가유형: '자기평가', 점수: '90' }, { 사번: 'R2003', 평가유형: '팀장평가', 점수: '80' }, { 사번: 'R2003', 평가유형: '임원평가', 점수: '85' }],
  mapping: { emp_no: '사번', stage: '평가유형', score: '점수' }, options: { roundId: r2.id },
});
check('결과 CSV 검증', rup.data.summary.errorRows === 0, rup.data.validation?.find((v: any) => v.errors.length));
check('적용 → 승인 대기', (await admin.req('POST', `/uploads/${rup.data.id}/apply`)).data.status === 'pending_approval');
check('업로드한 관리자 본인은 승인 불가(403)', (await admin.req('POST', `/uploads/${rup.data.id}/approve`, {})).data.error === 'APPROVER_MUST_DIFFER');
check('임원은 승인 불가(403)', (await exec.req('POST', `/uploads/${rup.data.id}/approve`, {})).status === 403);
check('다른 관리자 승인', (await admin2.req('POST', `/uploads/${rup.data.id}/approve`, { note: 'ok' })).data.status === 'applied');
const res2 = await admin.req('GET', `/results/${r2.id}`);
const t2 = res2.data.items.find((x: any) => x.employee_id === target.employee_id);
check('최종점수 = 90×20% + 80×40% + 85×40% = 84', t2.weighted_score === 84, t2);

console.log('\n[9] 가중치 변경 → 자동 재계산');
await admin.req('PUT', `/rounds/${r2.id}/weights`, { default: { self: 0, leader: 50, exec: 50 }, overrides: {}, reason: 'test' });
const t3 = (await admin.req('GET', `/results/${r2.id}`)).data.items.find((x: any) => x.employee_id === target.employee_id);
check('0/50/50 재계산 = 82.5', t3.weighted_score === 82.5, t3.weighted_score);
const wh = await admin.req('GET', `/rounds/${r2.id}/weights`);
check('가중치 변경 이력', wh.data.history.length >= 1);
await admin.req('PUT', `/rounds/${r2.id}/weights`, { default: { self: 20, leader: 40, exec: 40 }, overrides: {}, reason: 'restore' });

console.log('\n[9-2] 부서 KPI');
const kpi = await admin.req('GET', `/kpi/${r2.id}`);
const off = kpi.data.departments.find((d: any) => d.name === '관리직');
// 과제 달성률 80/85 = 94.1% (가중 60) + 고객 만족도 4.7/4.5 = 104% → 100 (가중 40) = 96.5
check('부서 KPI 환산점수 (달성률 100 상한, 가중 평균) = 96.5', off.score === 96.5, off);
const kt = () => admin.req('GET', `/results/${r2.id}`).then((x) => x.data.items.find((i: any) => i.employee_id === target.employee_id));
let k1 = await kt();
check('최종 = 개인 84 × 80% + KPI 96.5 × 20% = 86.5', k1.weighted_score === 84 && k1.kpi_score === 96.5 && k1.computed_score === 86.5 && k1.final_score === 86.5, k1);
check('KPI 반영 비율 합계 100 아니면 400', (await admin.req('PUT', `/kpi/${r2.id}/settings`, { enabled: true, personal_ratio: 70, kpi_ratio: 20 })).status === 400);
await admin.req('PUT', `/kpi/${r2.id}/settings`, { enabled: false, personal_ratio: 80, kpi_ratio: 20 });
k1 = await kt();
check('KPI 미반영 시 개인 환산점수만 사용', k1.final_score === 84 && k1.kpi_score === null, k1);
await admin.req('PUT', `/kpi/${r2.id}/settings`, { enabled: true, personal_ratio: 80, kpi_ratio: 20 });
const lowKpi = await admin.req('POST', `/kpi/${r2.id}/items`, { department_id: off.id, name: '장애 건수', unit: '건', direction: 'lower', target: 8, actual: 6, weight: 50 });
const zeroKpi = await admin.req('POST', `/kpi/${r2.id}/items`, { department_id: off.id, name: '실적 미입력', unit: '%', direction: 'higher', target: 90, actual: 0, weight: 50 });
const off2 = (await admin.req('GET', `/kpi/${r2.id}`)).data.departments.find((d: any) => d.id === off.id);
const low = off2.kpis.find((k: any) => k.id === lowKpi.data.id);
const zero = off2.kpis.find((k: any) => k.id === zeroKpi.data.id);
check('낮을수록 좋은 지표 달성률 = 목표/실적 (8/6 = 133.3%)', low.achievement === 133.3 && low.score === 100, low);
check('실적 0 지표는 계산 제외', zero.achievement === null && off2.score === Math.round(((80 / 85) * 100 * 60 + 100 * 40 + 100 * 50) / 150 * 10) / 10, off2);
check('KPI 지표 수정', (await admin.req('PUT', `/kpi/items/${zeroKpi.data.id}`, { department_id: off.id, name: '실적 입력', unit: '%', direction: 'higher', target: 90, actual: 45, weight: 50 })).status === 200);
check('KPI 지표 삭제', (await admin.req('DELETE', `/kpi/items/${zeroKpi.data.id}`)).status === 200 && (await admin.req('DELETE', `/kpi/items/${lowKpi.data.id}`)).status === 200);
check('KPI 원복 후 96.5', (await admin.req('GET', `/kpi/${r2.id}`)).data.departments.find((d: any) => d.id === off.id).score === 96.5);
// KPI 파일 업로드: 신규 지표 1건 + 기존 지표 덮어쓰기 1건 + 오류 1건
const kup = await admin.req('POST', '/uploads', {
  kind: 'kpis', fileName: 'kpi.csv', headers: ['부서명', '지표명', '단위', '평가방향', '목표', '실적', '가중치'],
  rows: [
    { 부서명: '관리직', 지표명: '업로드 장애 건수', 단위: '건', 평가방향: '낮을수록 좋음', 목표: '10', 실적: '8', 가중치: '20' },
    { 부서명: '관리직', 지표명: '과제 달성률 (샘플)', 단위: '%', 평가방향: '높을수록 좋음', 목표: '85%', 실적: '85%', 가중치: '60' },
    { 부서명: '없는부서', 지표명: 'x', 단위: '', 평가방향: '옆으로', 목표: '1', 실적: '1', 가중치: '150' },
  ],
  mapping: { department_name: '부서명', name: '지표명', unit: '단위', direction: '평가방향', target: '목표', actual: '실적', weight: '가중치' },
  options: { roundId: r2.id, mode: 'overwrite' },
});
check('KPI CSV 검증 (신규 1 · 덮어쓰기 1 · 오류 1)', kup.status === 201 && kup.data.summary.create === 1 && kup.data.summary.update === 1 && kup.data.summary.errorRows === 1, kup.data.summary);
await admin.req('PUT', `/uploads/${kup.data.id}`, { rows: kup.data.rows.slice(0, 2) });
check('KPI CSV 적용', (await admin.req('POST', `/uploads/${kup.data.id}/apply`)).data.status === 'applied');
const offUp = (await admin.req('GET', `/kpi/${r2.id}`)).data.departments.find((d: any) => d.id === off.id);
const upKpi = offUp.kpis.find((k: any) => k.name === '업로드 장애 건수');
check('KPI CSV 적용 결과 (낮을수록 좋음 10/8 = 125%, 기존 지표 실적 85 반영)', upKpi?.achievement === 125 && upKpi.direction === 'lower'
  && offUp.kpis.find((k: any) => k.name === '과제 달성률 (샘플)').actual === 85, offUp.kpis);
check('KPI CSV 되돌리기', (await admin.req('POST', `/uploads/${kup.data.id}/revert`)).data.status === 'reverted'
  && (await admin.req('GET', `/kpi/${r2.id}`)).data.departments.find((d: any) => d.id === off.id).score === 96.5);
check('KPI CSV 내보내기 (BOM)', (await admin.req('GET', `/kpi/${r2.id}/export.csv`)).bom);
check('직원은 KPI 업로드 불가', (await emp.req('POST', '/uploads', { kind: 'kpis', fileName: 'k.csv', headers: [], rows: [], mapping: {} })).status === 403);
check('직원은 KPI 조회 불가', (await emp.req('GET', `/kpi/${r2.id}`)).status === 403);

console.log('\n[10] 점수 보정 / 확정');
check('직원 보정 불가(403)', (await emp.req('POST', `/results/${r2.id}/employees/${target.employee_id}/adjust`, { score: 90 })).status === 403);
check('보정 점수 범위 초과 차단', (await admin.req('POST', `/results/${r2.id}/employees/${target.employee_id}/adjust`, { score: 120 })).status === 400);
const adminAdj = await admin.req('POST', `/results/${r2.id}/employees/${target.employee_id}/adjust`, { score: 90 });
check('관리자 보정 (사유 없이 점수 직접 입력 84 → 90)', adminAdj.status === 200 && adminAdj.data.result?.final_score === 90 && adminAdj.data.result?.weighted_score === 84, adminAdj.data);
check('관리자 보정 취소 → 계산점수 복원', (await admin.req('POST', `/results/adjustments/${adminAdj.data.id}/revert`, { reason: '원복' })).data.result.final_score === 86.5);
const oneCsv = await admin.req('GET', `/reports/csv?roundId=${r2.id}&type=employee&ids=${target.employee_id}`);
check('직원 1명 CSV 파일명에 사번 포함', oneCsv.bom && oneCsv.disposition.includes(target.emp_no), oneCsv.disposition);
check('임원은 점수 보정 불가(403)', (await exec.req('POST', `/results/${r2.id}/employees/${target.employee_id}/adjust`, { score: 88.5 })).status === 403);
const adj = await admin2.req('POST', `/results/${r2.id}/employees/${target.employee_id}/adjust`, { score: 88.5, reason: '프로젝트 기여 반영' });
check('관리자 보정 (사유 포함)', adj.data.result?.final_score === 88.5 && adj.data.result?.weighted_score === 84, adj.data);
check('보정 취소 → 계산점수 복원', (await admin2.req('POST', `/results/adjustments/${adj.data.id}/revert`, { reason: '취소 테스트' })).data.result.final_score === 86.5);
check('최종 확정 (관리자)', (await admin2.req('POST', `/results/${r2.id}/finalize`, { employeeIds: [target.employee_id] })).data.finalized === 1);
check('확정 후 보정 차단', (await admin2.req('POST', `/results/${r2.id}/employees/${target.employee_id}/adjust`, { score: 70, reason: '변경' })).status === 409);
check('확정 재오픈', (await admin2.req('POST', `/results/${r2.id}/employees/${target.employee_id}/reopen`, { reason: '재검토' })).data.result.finalized === false);
const detail = await admin.req('GET', `/results/${r1.id}/employees/${res2.data.items[0].employee_id}`);
check('결과 상세 (평정요소별)', detail.status === 200 && detail.data.sections.length > 0);

console.log('\n[11] 리포트');
const rep = await admin.req('GET', `/reports/data?roundId=${r1.id}&type=all`);
check('전체 리포트 데이터', rep.data.reports[0].stats.total === 34);
const deptRep = await admin.req('GET', `/reports/data?roundId=${r1.id}&type=department&ids=${dash.data.departments[1].id}`);
check('부서 리포트 데이터', deptRep.data.reports[0].members.length > 0);
const repCsv = await admin.req('GET', `/reports/csv?roundId=${r1.id}&type=employee&ids=${res2.data.items[0].employee_id}`);
check('개별 리포트 CSV (BOM)', repCsv.bom);
check('리포트 다운로드 기록', (await admin.req('GET', '/reports/logs')).data.items.length >= 1);
check('직원은 리포트 접근 불가', (await emp.req('GET', `/reports/data?roundId=${r1.id}&type=all`)).status === 403);

console.log('\n[12] 로그');
check('활동 로그', (await admin.req('GET', '/logs/activity')).data.total > 10);
check('접근 로그', (await admin.req('GET', '/logs/access')).data.total > 10);

console.log('\n[13] 평가 사이트 (팀원·팀장·임원)');
/** 양식의 모든 문항에 첫 번째 선택지/텍스트로 응답 */
function fillAll(form: any) {
  const out: Record<string, any> = {};
  for (const s of form.sections) for (const q of s.questions) {
    if (['score_scale', 'single_choice', 'dropdown'].includes(q.type)) out[q.id] = { optionId: q.options[0].id };
    else if (q.type === 'descriptive') out[q.id] = { text: '의견', optionId: q.options[0].id };
    else if (q.type === 'checkbox') out[q.id] = { optionIds: [q.options[0].id] };
    else if (q.type === 'linear_scale') out[q.id] = { value: q.settings?.max ?? 5 };
    else if (q.type === 'short_text' || q.type === 'long_text') out[q.id] = { text: '응답' };
  }
  return out;
}
const typesOf = (items: any[]) => new Set(items.map((i) => i.eval_type));
const home = await emp.req('GET', '/eval/home');
const memberTypes = typesOf(home.data.items);
check('팀원: 자기평가 + 팀장평가(팀원→팀장)만', home.status === 200 && memberTypes.has('self') && memberTypes.has('member_to_leader')
  && [...memberTypes].every((x) => ['self', 'member_to_leader'].includes(x)), [...memberTypes]);
const upItem = home.data.items.find((i: any) => i.eval_type === 'member_to_leader');
check('평가 대상자는 이름·부서·직급만 제공 (사번·인사정보 없음)', upItem && Object.keys(upItem.target).sort().join() === 'department,name,position' && upItem.target.name === '최수진', upItem?.target);
check('평가 목록에 점수·가중치·결과 없음', !/score|weight|final|kpi/i.test(JSON.stringify(home.data)));
check('D-DAY용 마감 시각 + 서버 시간 제공', !!upItem.deadline_at && !!upItem.deadline_date && !!home.data.server_now);

const leader = new Client();
await leader.ready('최수진', 'R1001');
const lh = await leader.req('GET', '/eval/home');
const leaderTypes = typesOf(lh.data.items);
check('팀장: 자기평가 + 팀원평가(팀장→팀원)만', leaderTypes.has('self') && leaderTypes.has('leader_to_member')
  && [...leaderTypes].every((x) => ['self', 'leader_to_member'].includes(x)), [...leaderTypes]);
check('팀장평가 대상 = 배정된 팀원 여러 명', lh.data.items.filter((i: any) => i.eval_type === 'leader_to_member').length > 1);
const eh = await exec.req('GET', '/eval/home');
const execTypes = typesOf(eh.data.items);
check('임원: 자기평가 + 임원→팀장 + 임원→팀원', execTypes.has('self') && execTypes.has('exec_to_leader') && execTypes.has('exec_to_member')
  && [...execTypes].every((x) => ['self', 'exec_to_leader', 'exec_to_member'].includes(x)), [...execTypes]);

const progNow = await admin.req('GET', `/rounds/${r2.id}/progress`);
const execRow = progNow.data.items.find((x: any) => x.emp_no === 'E0001');
check('임원은 평가받지 않음 (자기평가만, 다른 단계 미생성)', execRow.job_group === 'executive'
  && ['leader', 'exec', 'upward'].every((s) => execRow.stages[s].state === 'na'), execRow.stages);
const leaderRow = progNow.data.items.find((x: any) => x.emp_no === 'R1001');
check('팀장 대상 팀원→팀장평가 배정 (평가자 여러 명, 평가자별 독립 저장)', leaderRow.stages.upward.total_count > 1, leaderRow.stages.upward);

const leaderAssign = lh.data.items.find((i: any) => i.eval_type === 'leader_to_member');
check('다른 사람의 평가 ID 직접 접근 차단 (404)', (await emp.req('GET', `/eval/assignments/${leaderAssign.id}`)).status === 404
  && (await emp.req('PUT', `/eval/assignments/${leaderAssign.id}/draft`, { answers: {}, seq: Date.now() })).status === 404);
const denied = await Promise.all([`/results/${r2.id}`, '/employees', `/kpi/${r2.id}`, `/reports/data?roundId=${r2.id}&type=all`, '/rounds', `/rounds/${r2.id}/weights`]
  .map((u) => emp.req('GET', u).then((x) => x.status)));
check('평가자는 결과·직원·KPI·리포트·가중치 API 접근 불가', denied.every((s) => s === 403), denied);

// 아직 시작하지 않은 팀원으로 자동저장·제출 흐름 검증
const upCandidates = (await admin.req('GET', `/rounds/${r2.id}/upward/${leaderRow.employee_id}`)).data.items;
const freshEv = upCandidates.find((i: any) => i.status === 'not_started');
const member = new Client();
await member.ready(freshEv.evaluator_name, freshEv.evaluator_emp_no);
const memberUp = (await member.req('GET', '/eval/home')).data.items.find((i: any) => i.eval_type === 'member_to_leader');
const upUrl = `/eval/assignments/${memberUp.id}`;
const upForm = await member.req('GET', upUrl);
check('팀원→팀장평가 양식(관리자 평가항목) 조회', upForm.status === 200 && upForm.data.form.sections.length > 0 && upForm.data.assignment.editable === true);
const qList = upForm.data.form.sections.flatMap((s: any) => s.questions);
const q1 = qList.find((q: any) => q.options.length >= 2);
const seq0 = Date.now();
const d1 = await member.req('PUT', `${upUrl}/draft`, { answers: { [q1.id]: { optionId: q1.options[1].id } }, seq: seq0 + 10 });
check('자동저장 (서버 DB 저장)', d1.status === 200 && d1.data.stale === false && !!d1.data.saved_at, d1.data);
const stale = await member.req('PUT', `${upUrl}/draft`, { answers: { [q1.id]: { optionId: q1.options[0].id } }, seq: seq0 });
check('늦게 도착한 이전 저장 요청은 최신 응답을 덮어쓰지 않음', stale.data.stale === true);
const reloaded = await member.req('GET', upUrl);
check('새로고침 후 최신 응답 유지 + 작성 중 상태', reloaded.data.answers[q1.id]?.optionId === q1.options[1].id && reloaded.data.assignment.state === 'in_progress'
  && !!reloaded.data.assignment.last_saved_at);
const empAgain = new Client();
await empAgain.ready(freshEv.evaluator_name, freshEv.evaluator_emp_no);
check('로그아웃 후 재로그인해도 이어서 작성', (await empAgain.req('GET', upUrl)).data.answers[q1.id]?.optionId === q1.options[1].id);
check('필수 미응답 제출 차단', (await member.req('POST', `${upUrl}/submit`, { answers: {}, seq: seq0 + 20 })).data.error === 'REQUIRED_MISSING');
const subUp = await member.req('POST', `${upUrl}/submit`, { answers: fillAll(upForm.data.form), seq: seq0 + 30 });
check('최종 제출 (제출 시각 기록, 점수 미반환)', subUp.status === 200 && !!subUp.data.submitted_at && !/score/i.test(JSON.stringify(subUp.data)), subUp.data);
const afterSub = await member.req('GET', upUrl);
check('제출 후 응답·양식 미제공, 제출 완료 상태만', afterSub.data.assignment.state === 'submitted' && !afterSub.data.form && !afterSub.data.answers);
check('제출 후 수정 불가', (await member.req('PUT', `${upUrl}/draft`, { answers: {}, seq: seq0 + 40 })).data.error === 'ALREADY_SUBMITTED');
const resUp = (await admin.req('GET', `/results/${r2.id}`)).data.items.find((x: any) => x.emp_no === 'R1001');
check('관리자 응답&결과에 팀원→팀장평가 반영', resUp.stages.upward.submitted_count >= 1 && resUp.stages.upward.score !== null, resUp.stages.upward);
check('관리자 재오픈', (await admin.req('POST', `/assignments/${memberUp.id}/reopen`, { reason: '수정 요청' })).status === 200);
check('재오픈 후에만 다시 수정 가능', (await member.req('GET', upUrl)).data.assignment.editable === true);

const rr = (await admin.req('GET', '/rounds')).data.items.find((x: any) => x.id === r2.id);
const roundBody = {
  name: rr.name, year: rr.year, period_start: rr.period_start, period_end: rr.period_end, start_date: rr.start_date, end_date: rr.end_date,
  enforce_sequence: !!rr.enforce_sequence, upward_enabled: true, self_end_date: null, leader_end_date: null, exec_end_date: null, upward_end_date: null,
};
await admin.req('PUT', `/rounds/${r2.id}`, { ...roundBody, upward_end_date: rr.start_date });
const closedView = await member.req('GET', upUrl);
check('평가 유형별 마감일 적용 (마감 지나면 마감 상태)', closedView.data.assignment.state === 'closed' && closedView.data.assignment.deadline_date === rr.start_date, closedView.data.assignment);
check('자기평가는 차수 마감일 그대로', (await member.req('GET', '/eval/home')).data.items.find((i: any) => i.eval_type === 'self').deadline_date === rr.end_date);
check('서버 시간 기준 마감 후 저장 거부', (await member.req('PUT', `${upUrl}/draft`, { answers: {}, seq: seq0 + 50 })).data.error === 'DEADLINE_PASSED');
await admin.req('PUT', `/rounds/${r2.id}`, roundBody);
check('관리자 마감일 변경 즉시 반영', (await member.req('GET', upUrl)).data.assignment.editable === true);

const wUrl = `/rounds/${r2.id}/weights`;
check('팀원 직군에는 팀원→팀장 가중치 설정 불가', (await admin.req('PUT', wUrl, { default: { self: 20, leader: 40, exec: 40 },
  overrides: { office_member: { self: 20, leader: 30, exec: 40, upward: 10 } } })).data.error === 'UPWARD_ONLY_FOR_LEADERS');
const wOk = await admin.req('PUT', wUrl, { default: { self: 20, leader: 40, exec: 40 }, overrides: { office_leader: { self: 20, leader: 0, exec: 60, upward: 20 } }, reason: 'test' });
check('팀장 직군 팀원→팀장평가 반영 비율 설정', wOk.status === 200 && wOk.data.weights.office_leader.upward === 20 && wOk.data.weights.executive.self === 100, wOk.data);
await admin.req('PUT', wUrl, { default: { self: 20, leader: 40, exec: 40 }, overrides: { office_leader: { self: 20, leader: 0, exec: 80, upward: 0 } }, reason: 'restore' });

const upList = await admin.req('GET', `/rounds/${r2.id}/upward/${leaderRow.employee_id}`);
check('팀원→팀장평가 평가자 목록 (관리자)', upList.data.items.length === leaderRow.stages.upward.total_count);
const notStarted = upList.data.items.find((i: any) => i.status === 'not_started');
check('팀원→팀장평가 평가자 제외·추가', !notStarted || ((await admin.req('DELETE', `/rounds/${r2.id}/assignments/${notStarted.id}`)).status === 200
  && (await admin.req('POST', `/rounds/${r2.id}/assignments`, { targetEmployeeId: leaderRow.employee_id, stage: 'upward', evaluatorEmployeeId: notStarted.evaluator_employee_id })).data.added === 1));
check('임원에게 평가자 배정 불가', (await admin.req('POST', `/rounds/${r2.id}/assignments`,
  { targetEmployeeId: execRow.employee_id, stage: 'exec', evaluatorEmployeeId: leaderRow.employee_id })).data.error === 'EXECUTIVE_SELF_ONLY');

server.close();
console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
