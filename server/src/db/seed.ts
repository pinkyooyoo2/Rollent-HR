/**
 * 초기 샘플 데이터 생성. 사용법:
 *   npm run db:seed          - 비어 있는 DB에만 샘플 데이터 생성
 *   npm run db:reset         - DB 파일을 삭제 후 마이그레이션 + 샘플 데이터 재생성
 * 직원/부서 데이터는 모두 샘플이며 CSV 업로드로 실제 데이터로 교체할 수 있습니다.
 */
import fs from 'node:fs';
import { config } from '../config.ts';

const reset = process.argv.includes('--reset');
if (reset) {
  for (const f of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
}

const { all, get, run, tx, now } = await import('./index.ts');
const { migrate } = await import('./migrate.ts');
const { buildTemplates, TEMPLATE_WEIGHTS } = await import('./formTemplates.ts');
const { PERMISSIONS, ROLES, hashPassword } = await import('../auth.ts');
const { createFormFromTemplate, publishedFormId, getFormFull } = await import('../services/forms.ts');
const { addRoundTargets, autoAssign } = await import('../services/rounds.ts');
const { saveAssignmentScore, computeRoundResults } = await import('../scoring.ts');
const { ensureDemoAccounts } = await import('./demoAccounts.ts');

migrate();


if (get('SELECT id FROM roles LIMIT 1')) {
  console.log('[seed] 이미 데이터가 존재합니다. 초기화하려면 npm run db:reset 을 실행하세요.');
  process.exit(0);
}

// 결정적 난수 (매번 같은 샘플 생성)
let seedState = 20261027;
function rand() {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

type Emp = {
  no: string; name: string; dept: string; position: string; title: string;
  group?: 'office' | 'production'; leader?: boolean; exec?: boolean; role?: string; hire: string;
};

const DEPTS = [
  { code: 'OFF', name: '관리직', group: 'office', leader: 'R1001', exec: 'E0001' },
  { code: 'PRD', name: '생산직', group: 'production', leader: 'R1005', exec: 'E0002' },
] as const;

const EMPLOYEES: Emp[] = [
  { no: 'E0001', name: '김대양', dept: 'OFF', position: '임원', title: '총괄본부장', exec: true, role: 'executive', hire: '2005-03-02' },
  { no: 'E0002', name: '박해진', dept: 'OFF', position: '임원', title: '생산본부장', exec: true, role: 'executive', hire: '2008-07-01' },
  { no: 'R1001', name: '최수진', dept: 'OFF', position: '팀장', title: '팀장', leader: true, hire: '2012-02-01' },
  { no: 'Admin', name: '관리자', dept: 'OFF', position: '팀원', title: '인사담당', role: 'admin', hire: '2016-04-01' },
  { no: 'R2001', name: '정민호', dept: 'OFF', position: '팀원', title: '팀원', hire: '2019-01-07' },
  { no: 'R2002', name: '강하늘', dept: 'OFF', position: '팀원', title: '팀원', hire: '2021-03-02' },
  { no: 'R2003', name: '윤서연', dept: 'OFF', position: '팀원', title: '팀원', hire: '2023-07-03' },
  { no: 'R1002', name: '오준혁', dept: 'OFF', position: '팀원', title: '팀장', hire: '2010-05-03' },
  { no: 'R2004', name: '이도윤', dept: 'OFF', position: '팀원', title: '팀원', hire: '2015-09-01' },
  { no: 'R2005', name: '김서준', dept: 'OFF', position: '팀원', title: '팀원', hire: '2018-11-05' },
  { no: 'R2006', name: '박지우', dept: 'OFF', position: '팀원', title: '팀원', hire: '2022-01-03' },
  { no: 'R2007', name: '최하은', dept: 'OFF', position: '팀원', title: '팀원', hire: '2024-02-01' },
  { no: 'R1003', name: '한지민', dept: 'OFF', position: '팀원', title: '연구소장', hire: '2011-08-01' },
  { no: 'R2008', name: '장예린', dept: 'OFF', position: '팀원', title: '팀원', hire: '2016-03-02' },
  { no: 'R2009', name: '송민재', dept: 'OFF', position: '팀원', title: '팀원', hire: '2019-06-03' },
  { no: 'R2010', name: '조유나', dept: 'OFF', position: '팀원', title: '팀원', hire: '2021-09-01' },
  { no: 'R2011', name: '신우진', dept: 'OFF', position: '팀원', title: '팀원', hire: '2024-07-01' },
  { no: 'R1004', name: '서동현', dept: 'PRD', position: '차장', title: '팀장', hire: '2013-01-02' },
  { no: 'R3001', name: '문태호', dept: 'PRD', position: '팀원', title: '팀원', hire: '2018-04-02' },
  { no: 'R3002', name: '황보람', dept: 'PRD', position: '팀원', title: '팀원', hire: '2020-10-05' },
  { no: 'R3003', name: '유성민', dept: 'PRD', position: '팀원', title: '팀원', hire: '2023-03-02' },
  { no: 'R1005', name: '임재훈', dept: 'PRD', position: '팀장', title: '팀장', leader: true, hire: '2009-06-01' },
  { no: 'R3004', name: '남궁철', dept: 'PRD', position: '팀원', title: '팀원', hire: '2011-02-01' },
  { no: 'R3005', name: '고은비', dept: 'PRD', position: '팀원', title: '팀원', hire: '2019-08-01' },
  { no: 'R3006', name: '안재석', dept: 'PRD', position: '팀원', title: '팀원', hire: '2021-05-03' },
  { no: 'R3007', name: '권도현', dept: 'PRD', position: '팀원', title: '팀원', hire: '2022-09-01' },
  { no: 'R3008', name: '양희수', dept: 'PRD', position: '팀원', title: '팀원', hire: '2024-01-02' },
  { no: 'R1006', name: '배성우', dept: 'PRD', position: '팀원', title: '팀장', hire: '2012-10-01' },
  { no: 'R3009', name: '전민수', dept: 'PRD', position: '팀원', title: '팀원', hire: '2013-04-01' },
  { no: 'R3010', name: '류지훈', dept: 'PRD', position: '팀원', title: '팀원', hire: '2018-02-01' },
  { no: 'R3011', name: '백승호', dept: 'PRD', position: '팀원', title: '팀원', hire: '2020-06-01' },
  { no: 'R3012', name: 'Иван Петров', dept: 'PRD', position: '팀원', title: '팀원', hire: '2022-03-02' },
  { no: 'R3013', name: 'Алексей Смирнов', dept: 'PRD', position: '팀원', title: '팀원', hire: '2023-05-02' },
  { no: 'R3014', name: '하준영', dept: 'PRD', position: '팀원', title: '팀원', hire: '2025-01-02' },
];

const SELF_TEXTS = [
  '상반기 신규 거래처 3곳을 확보하고 기존 고객 유지율을 개선했습니다.',
  '생산 라인 불량률을 전년 대비 1.2%p 낮추기 위해 공정 점검표를 개선했습니다.',
  '사내 인사·총무 업무 프로세스를 정비하고 문서 관리 체계를 수립했습니다.',
  '신제품 롤러 시제품 개발 및 테스트를 주도하여 일정 내 완료했습니다.',
  '설비 예방정비 일정을 수립하여 비가동 시간을 줄였습니다.',
];
const EVAL_TEXTS = [
  '책임감 있게 업무를 수행하며 팀 내 협업에 적극적입니다.',
  '업무 정확도가 높으나 일정 관리 측면에서 개선이 필요합니다.',
  '어려운 과제에도 꾸준히 해결책을 찾는 자세가 돋보입니다.',
  '후배 지도에 적극적이며 팀 분위기 개선에 기여했습니다.',
];
const SUGGESTIONS = ['', '', '', '휴게 공간 개선을 건의합니다.', '직무 교육 기회 확대를 희망합니다.', ''];

function genAnswers(form: any, quality: number) {
  const out: { qid: number; answer: unknown }[] = [];
  for (const s of form.sections) {
    for (const q of s.questions) {
      const opts = q.options as { id: number; score: number }[];
      const grade = () => {
        // quality(0~1)가 높을수록 A에 가까운 등급
        const idx = Math.min(4, Math.max(0, Math.round((1 - quality) * 4 + (rand() - 0.5) * 2)));
        return opts[idx]?.id;
      };
      switch (q.type) {
        case 'score_scale': out.push({ qid: q.id, answer: { optionId: grade() } }); break;
        case 'descriptive': out.push({ qid: q.id, answer: { text: pick(form.stage === 'self' ? SELF_TEXTS : EVAL_TEXTS), optionId: grade() } }); break;
        case 'single_choice':
        case 'dropdown': out.push({ qid: q.id, answer: { optionId: pick(opts.slice(0, Math.min(opts.length, 4))).id } }); break;
        case 'short_text': if (q.required) out.push({ qid: q.id, answer: { text: '-' } }); break;
        case 'long_text': {
          const text = q.is_suggestion ? pick(SUGGESTIONS) : q.text.includes('담당 업무') ? pick(SELF_TEXTS) : q.text.includes('평가') ? pick(EVAL_TEXTS) : '';
          if (text) out.push({ qid: q.id, answer: { text } });
          break;
        }
        default: break;
      }
    }
  }
  return out;
}

tx(() => {
  // 1) 권한/역할
  for (const [code, desc] of Object.entries(PERMISSIONS)) run('INSERT INTO permissions (code, description) VALUES (?, ?)', [code, desc]);
  for (const r of ROLES) {
    const id = run('INSERT INTO roles (code, name) VALUES (?, ?)', [r.code, r.name]).lastInsertRowid;
    for (const p of r.perms) run('INSERT INTO role_permissions (role_id, permission_code) VALUES (?, ?)', [id, p]);
  }
  const roleId = (code: string) => get<{ id: number }>('SELECT id FROM roles WHERE code = ?', [code])!.id;

  // 2) 부서/직원/계정
  const deptId: Record<string, number> = {};
  for (const d of DEPTS) {
    deptId[d.code] = run('INSERT INTO departments (code, name, description) VALUES (?, ?, ?)', [d.code, d.name, `${d.name} (샘플 데이터)`]).lastInsertRowid;
  }
  const empId: Record<string, number> = {};
  for (const e of EMPLOYEES) {
    const group = e.group ?? DEPTS.find((d) => d.code === e.dept)!.group;
    const email = `${e.no.toLowerCase()}@rollent.example`;
    empId[e.no] = run(
      `INSERT INTO employees (emp_no, name, department_id, position, title, job_group, is_leader, is_executive, status, hire_date, email, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [e.no, e.name, deptId[e.dept], e.position, e.title, group, !!e.leader, !!e.exec, e.hire, email, `010-${1000 + Math.floor(rand() * 8999)}-${1000 + Math.floor(rand() * 8999)}`],
    ).lastInsertRowid;
    const role = e.role ?? (e.leader ? 'leader' : 'employee');
    run(`INSERT INTO users (emp_no, employee_id, display_name, email, password_hash, role_id, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [e.no, empId[e.no], e.name, email, hashPassword(e.no), roleId(role), now()]);
  }
  // 부서장 / 담당 임원
  for (const d of DEPTS) {
    run('UPDATE departments SET leader_employee_id = ?, exec_employee_id = ? WHERE id = ?', [empId[d.leader], empId[d.exec], deptId[d.code]]);
  }

  // 3) 평가 양식 (첨부 PDF 기반) - 게시 상태
  const adminUser = get<{ id: number }>("SELECT id FROM users WHERE emp_no = 'Admin'")!.id;
  for (const t of buildTemplates()) createFormFromTemplate(t, adminUser, 'published');

  // 4) 평가 차수 2개 (2025 완료, 2026 진행 중)
  const execUser = get<{ id: number }>("SELECT id FROM users WHERE emp_no = 'E0001'")!.id;
  const rounds = [
    { name: '2025년 정기 인사평가', year: 2025, ps: '2025-01-01', pe: '2025-12-31', sd: '2025-11-03', ed: '2025-12-12', status: 'closed', stage: 'closed', progress: [1, 1, 1] },
    { name: '2026년 정기 인사평가', year: 2026, ps: '2026-01-01', pe: '2026-12-31', sd: '2026-10-01', ed: '2026-11-30', status: 'open', stage: 'open', progress: [0.85, 0.7, 0.55] },
  ];
  for (const r of rounds) {
    const rid = run(
      `INSERT INTO evaluation_rounds (name, year, period_start, period_end, start_date, end_date, status, self_status, leader_status, exec_status, upward_status, enforce_sequence, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [r.name, r.year, r.ps, r.pe, r.sd, r.ed, r.status, r.stage, r.stage, r.stage, r.stage, adminUser],
    ).lastInsertRowid;
    for (const [g, w] of Object.entries(TEMPLATE_WEIGHTS)) {
      run('INSERT INTO evaluation_weights (round_id, job_group, self_weight, leader_weight, exec_weight, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
        [rid, g, w[0], w[1], w[2], adminUser]);
    }
    addRoundTargets(rid);
    autoAssign(rid);

    // 응답 생성: 순차 진행 정책을 지키도록 단계 순서대로 진행 확률 적용
    const assigns = all<any>(
      `SELECT a.*, t.job_group FROM evaluation_assignments a
       JOIN round_targets t ON t.round_id = a.round_id AND t.employee_id = a.target_employee_id
       WHERE a.round_id = ? AND a.evaluator_employee_id IS NOT NULL
       ORDER BY a.target_employee_id, CASE a.stage WHEN 'self' THEN 0 WHEN 'leader' THEN 1 WHEN 'exec' THEN 2 ELSE 3 END`, [rid]);
    const submittedPrev = new Map<number, boolean>();
    const quality = new Map<number, number>();
    for (const a of assigns) {
      if (!quality.has(a.target_employee_id)) quality.set(a.target_employee_id, 0.45 + rand() * 0.5);
      // 팀원→팀장평가는 다른 단계와 독립적으로 진행
      const prevOk = a.stage === 'self' || a.stage === 'upward' ? true : submittedPrev.get(a.target_employee_id) ?? false;
      const stageIdx = a.stage === 'self' ? 0 : a.stage === 'leader' ? 1 : a.stage === 'exec' ? 2 : 1;
      const p = r.progress[stageIdx];
      const roll = rand();
      const formId = publishedFormId(a.stage, a.job_group)!;
      const form = getFormFull(formId);
      const submit = prevOk && roll < p;
      const draft = prevOk && !submit && roll < p + 0.15;
      if (submit || draft) {
        const answers = genAnswers(form, quality.get(a.target_employee_id)! + (a.stage === 'self' ? 0.08 : 0));
        const list = draft ? answers.slice(0, Math.ceil(answers.length / 2)) : answers;
        for (const x of list) {
          run('INSERT INTO evaluation_responses (assignment_id, question_id, answer) VALUES (?, ?, ?)', [a.id, x.qid, JSON.stringify(x.answer)]);
        }
        const evaluatorUser = get<{ id: number }>('SELECT id FROM users WHERE employee_id = ?', [a.evaluator_employee_id])?.id ?? null;
        const ts = r.year === 2025 ? `2025-12-0${1 + Math.floor(rand() * 9)} 1${Math.floor(rand() * 8)}:00:00` : now();
        run('UPDATE evaluation_assignments SET form_id = ?, status = ?, submitted_at = ?, submitted_by = ?, updated_at = ? WHERE id = ?',
          [formId, submit ? 'submitted' : 'in_progress', submit ? ts : null, submit ? evaluatorUser : null, ts, a.id]);
        if (submit) saveAssignmentScore(a.id, formId);
      }
      // 이후 단계 진행 여부: 해당 단계가 제출된 경우에만 (가중치 0 단계는 배정 자체가 없음)
      if (a.stage !== 'upward') submittedPrev.set(a.target_employee_id, submit);
    }

    if (r.year === 2025) {
      // 보정 1건 + 최종 확정 (일부 제외)
      const results = computeRoundResults(rid).filter((x) => x.weighted_score !== null);
      const adjTarget = results[3];
      if (adjTarget) {
        run(`INSERT INTO score_adjustments (round_id, employee_id, computed_score, before_score, after_score, reason, adjusted_by, adjusted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, '2025-12-15 10:00:00')`,
          [rid, adjTarget.employee_id, adjTarget.weighted_score, adjTarget.weighted_score, Math.min(100, (adjTarget.weighted_score ?? 0) + 3),
            '연간 프로젝트 기여도 추가 반영 (샘플 보정)', execUser]);
      }
      for (const x of computeRoundResults(rid).filter((x) => x.final_score !== null).slice(0, -2)) {
        run(`INSERT INTO result_finalizations (round_id, employee_id, final_score, finalized_by, finalized_at) VALUES (?, ?, ?, ?, '2025-12-20 09:00:00')`,
          [rid, x.employee_id, x.final_score, execUser]);
      }
    }
  }
  // 역할별 확인용 계정 (팀원 / 팀장 / 임원) — 진행 중 차수에서 서로 평가하는 한 팀
  ensureDemoAccounts();

  // 5) 부서 KPI (2026 차수, 샘플 지표) — 개인 80% + 부서 KPI 20%
  const kpiRound = get<{ id: number }>('SELECT id FROM evaluation_rounds WHERE year = 2026')!.id;
  run('INSERT INTO kpi_settings (round_id, enabled, personal_ratio, kpi_ratio, updated_by) VALUES (?, 1, 80, 20, ?)', [kpiRound, adminUser]);
  const KPIS = [
    { dept: 'OFF', name: '과제 달성률 (샘플)', unit: '%', direction: 'higher', target: 85, actual: 80, weight: 60 },
    { dept: 'OFF', name: '고객 만족도 (샘플)', unit: '점', direction: 'higher', target: 4.5, actual: 4.7, weight: 40 },
    { dept: 'PRD', name: '생산 계획 달성률 (샘플)', unit: '%', direction: 'higher', target: 90, actual: 92, weight: 60 },
    { dept: 'PRD', name: '불량·설비 장애 건수 (샘플)', unit: '건', direction: 'lower', target: 8, actual: 6, weight: 40 },
  ];
  KPIS.forEach((k, i) => run(
    `INSERT INTO department_kpis (round_id, department_id, name, unit, direction, target, actual, weight, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [kpiRound, deptId[k.dept], k.name, k.unit, k.direction, k.target, k.actual, k.weight, i, adminUser]));

  run(`INSERT INTO activity_logs (user_id, action, entity_type, details) VALUES (?, 'seed.init', 'system', ?)`,
    [adminUser, JSON.stringify({ note: '샘플 데이터 생성' })]);
});

console.log('[seed] 완료');
console.log('  로그인: 아이디 = 이름, 비밀번호 = 사번');
console.log('  관리자 페이지  관리자 / Admin');
console.log('  팀원 페이지    팀원 / A000');
console.log('  팀장 페이지    팀장 / A0001');
console.log('  임원 페이지    임원 / A0002');
