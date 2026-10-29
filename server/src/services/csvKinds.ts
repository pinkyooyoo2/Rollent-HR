/**
 * 페이지별 CSV 가져오기 정의 및 처리
 *  - employees   : 직원 데이터 (팀/사원관리)
 *  - departments : 부서 데이터 (팀/사원관리)
 *  - questions   : 평가 질문 데이터 (평가항목)
 *  - results     : 평가 결과 점수 (응답&결과, 별도 승인 필요)
 *  - kpis        : 부서 KPI 지표 (부서 KPI 관리, 차수별)
 */
import { all, get, run, tx, now } from '../db/index.ts';
import { getFormFull, replaceFormContent, type SectionInput } from './forms.ts';
import { GRADE_OPTIONS } from '../db/formTemplates.ts';
import { getRoundWeights, computeRoundResults, type Stage } from '../scoring.ts';
import { normalizePosition, positionFlags } from '../positions.ts';

export type Kind = 'employees' | 'departments' | 'questions' | 'results' | 'kpis';

export interface FieldDef { key: string; required?: boolean; aliases: string[] }

export const KIND_FIELDS: Record<Kind, FieldDef[]> = {
  employees: [
    { key: 'emp_no', required: true, aliases: ['사번', 'emp_no', 'employee no', 'employee_no', 'id', 'табельный номер'] },
    { key: 'name', required: true, aliases: ['이름', '성명', '직원명', 'name', 'имя', 'фио'] },
    { key: 'department_code', aliases: ['부서코드', 'department_code', 'dept code', 'dept_code'] },
    { key: 'department_name', aliases: ['부서명', '부서', 'department', 'department_name', 'dept', 'отдел'] },
    { key: 'position', aliases: ['직급', 'position', 'grade', 'должность'] },
    { key: 'job_group', aliases: ['직군', 'job_group', 'job group'] },
    { key: 'status', aliases: ['재직상태', '상태', 'status'] },
    { key: 'hire_date', aliases: ['입사일', 'hire_date', 'hire date', 'joined'] },
    { key: 'email', aliases: ['이메일', 'email', 'e-mail', 'mail'] },
    { key: 'phone', aliases: ['연락처', '전화번호', '휴대폰', 'phone', 'mobile'] },
  ],
  departments: [
    { key: 'code', aliases: ['부서코드', 'code', 'department_code', 'dept code'] },
    { key: 'name', required: true, aliases: ['부서명', 'name', 'department', 'department_name'] },
    { key: 'leader_emp_no', aliases: ['팀장사번', 'leader_emp_no', 'leader'] },
    { key: 'description', aliases: ['설명', 'description', 'note'] },
  ],
  questions: [
    { key: 'section', required: true, aliases: ['섹션', 'section', '평정요소', '구분'] },
    { key: 'text', required: true, aliases: ['질문', 'question', 'text', '평가내용', '문항'] },
    { key: 'type', required: true, aliases: ['유형', 'type', '질문유형'] },
    { key: 'options', aliases: ['선택지', 'options', 'choices'] },
    { key: 'points', aliases: ['배점', 'points', 'score', '점수'] },
    { key: 'required', aliases: ['필수', 'required'] },
    { key: 'scored', aliases: ['점수반영', 'scored'] },
    { key: 'description', aliases: ['설명', 'description', 'help'] },
  ],
  kpis: [
    { key: 'department_name', required: true, aliases: ['부서명', '부서', 'department', 'department_name', 'dept', 'отдел'] },
    { key: 'name', required: true, aliases: ['지표명', 'KPI', 'kpi', '지표', 'kpi명', 'name', 'indicator'] },
    { key: 'unit', aliases: ['단위', 'unit'] },
    { key: 'direction', aliases: ['평가방향', '방향', 'direction'] },
    { key: 'target', aliases: ['목표', '목표값', 'target'] },
    { key: 'actual', aliases: ['실적', '실적값', 'actual', 'result'] },
    { key: 'weight', aliases: ['가중치', '가중치(%)', 'weight'] },
  ],
  results: [
    { key: 'emp_no', required: true, aliases: ['사번', 'emp_no', 'employee no'] },
    { key: 'name', aliases: ['이름', '성명', 'name'] },
    { key: 'stage', required: true, aliases: ['평가유형', '평가단계', '단계', 'stage', 'type'] },
    { key: 'score', required: true, aliases: ['점수', '환산점수', 'score', 'normalized_score'] },
  ],
};

/** 부서코드는 화면에 노출하지 않으므로 내부 식별용 코드를 자동 생성 (D001, D002 …) */
export function newDeptCode(): string {
  let n = (get<{ n: number }>('SELECT COALESCE(MAX(id), 0) AS n FROM departments')?.n ?? 0) + 1;
  while (get('SELECT id FROM departments WHERE code = ?', [`D${String(n).padStart(3, '0')}`])) n++;
  return `D${String(n).padStart(3, '0')}`;
}

export const TYPE_LABEL_KO: Record<string, string> = {
  short_text: '단답형', long_text: '장문형', single_choice: '객관식', checkbox: '체크박스', dropdown: '드롭다운',
  score_scale: '점수척도형', linear_scale: '선형배율형', descriptive: '서술형평가',
};
const TYPE_ALIASES: Record<string, string> = {
  단답형: 'short_text', 장문형: 'long_text', 객관식: 'single_choice', '객관식(단일선택)': 'single_choice', 체크박스: 'checkbox',
  드롭다운: 'dropdown', 점수척도형: 'score_scale', 점수척도: 'score_scale', 선형배율형: 'linear_scale', 선형배율: 'linear_scale',
  서술형평가: 'descriptive', 서술형: 'descriptive',
};

export function formatOptions(q: any): string {
  if (q.type === 'linear_scale') return `${q.settings?.min ?? 1}:${q.settings?.max ?? 5}`;
  return (q.options ?? []).map((o: any) => (o.score ? `${o.label}:${o.score}` : o.label)).join('|');
}

export interface CellError { field: string; code: string }
export interface ValidatedRow {
  index: number;
  record: Record<string, any>;
  errors: CellError[];
  warnings: CellError[];
  action: 'create' | 'update' | 'skip' | 'import';
}

const yes = (v: string) => /^(y|yes|true|1|o|예|네|팀장|임원|да)$/i.test(v.trim());
const isBoolText = (v: string) => /^(y|yes|true|1|o|예|네|n|no|false|0|x|아니오|아니요|да|нет|팀장|임원)$/i.test(v.trim());

function normDate(v: string): string | null {
  const m = v.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (!m) return null;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(d)) ? null : d;
}

function mapRow(raw: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, header] of Object.entries(mapping)) {
    if (header) out[field] = String(raw[header] ?? '').trim();
  }
  return out;
}

export interface UploadOptions {
  mode?: 'overwrite' | 'add_only';
  createDepartments?: boolean;
  skipInvalid?: boolean;
  formId?: number;
  questionMode?: 'append' | 'replace';
  roundId?: number;
  uploadId?: number;
}

export function validateUpload(kind: Kind, rawRows: Record<string, string>[], mapping: Record<string, string>, options: UploadOptions): ValidatedRow[] {
  const fields = KIND_FIELDS[kind];
  const rows = rawRows.map((r) => mapRow(r, mapping));
  const out: ValidatedRow[] = rows.map((r, index) => {
    const errors: CellError[] = [];
    for (const f of fields) if (f.required && !r[f.key]) errors.push({ field: f.key, code: 'REQUIRED' });
    return { index, record: { ...r }, errors, warnings: [], action: 'create' };
  });

  if (kind === 'employees') {
    const depts = all<any>('SELECT id, code, name FROM departments WHERE deleted_at IS NULL');
    const seen = new Map<string, number>();
    for (const v of out) {
      const r = v.record;
      if (r.emp_no) {
        if (!/^[A-Za-z0-9_-]+$/.test(r.emp_no)) v.errors.push({ field: 'emp_no', code: 'INVALID_FORMAT' });
        if (seen.has(r.emp_no)) v.errors.push({ field: 'emp_no', code: 'DUPLICATE_IN_FILE' });
        seen.set(r.emp_no, v.index);
        const exists = get<any>('SELECT id FROM employees WHERE emp_no = ?', [r.emp_no]);
        if (exists) {
          v.action = options.mode === 'add_only' ? 'skip' : 'update';
          v.warnings.push({ field: 'emp_no', code: options.mode === 'add_only' ? 'EXISTS_SKIP' : 'EXISTS_OVERWRITE' });
          r.id = exists.id;
        }
      }
      if (r.department_code || r.department_name) {
        const d = depts.find((x) => (r.department_code && x.code === r.department_code) || (!r.department_code && x.name === r.department_name));
        if (d) r.department_id = d.id;
        else if (options.createDepartments && r.department_name) v.warnings.push({ field: 'department_name', code: 'DEPT_WILL_CREATE' });
        else v.errors.push({ field: r.department_code ? 'department_code' : 'department_name', code: 'DEPT_NOT_FOUND' });
      } else {
        v.warnings.push({ field: 'department_name', code: 'EMPTY_DEPT' });
      }
      if (r.job_group) {
        if (/^(관리직|사무직|office|관리)$/i.test(r.job_group)) r.job_group = 'office';
        else if (/^(생산직|production|생산|현장직)$/i.test(r.job_group)) r.job_group = 'production';
        else v.errors.push({ field: 'job_group', code: 'INVALID_VALUE' });
      } else r.job_group = 'office';
      // 직급: 임원 / 팀장 / 차장 / 팀원 (빈 값은 팀원)
      const pos = normalizePosition(r.position);
      if (!pos) v.errors.push({ field: 'position', code: 'INVALID_POSITION' });
      else r.position = pos;
      if (r.status) {
        const s = ({ 재직: 'active', 재직중: 'active', active: 'active', 휴직: 'leave', leave: 'leave', 퇴사: 'resigned', 퇴직: 'resigned', resigned: 'resigned' } as Record<string, string>)[r.status.toLowerCase()];
        if (s) r.status = s;
        else v.errors.push({ field: 'status', code: 'INVALID_VALUE' });
      } else r.status = 'active';
      if (r.hire_date) {
        const d = normDate(r.hire_date);
        if (d) r.hire_date = d;
        else v.errors.push({ field: 'hire_date', code: 'INVALID_DATE' });
      }
      if (r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) v.errors.push({ field: 'email', code: 'INVALID_EMAIL' });
      if (r.name && r.name.length > 100) v.errors.push({ field: 'name', code: 'TOO_LONG' });
    }
  }

  if (kind === 'departments') {
    const seen = new Set<string>();
    for (const v of out) {
      const r = v.record;
      // 부서코드는 선택 항목: 있으면 코드로, 없으면 부서명으로 기존 부서를 찾음
      const key = r.code ? `code:${r.code}` : `name:${r.name}`;
      if (r.code && !/^[A-Za-z0-9_-]+$/.test(r.code)) v.errors.push({ field: 'code', code: 'INVALID_FORMAT' });
      if (r.code || r.name) {
        const field = r.code ? 'code' : 'name';
        if (seen.has(key)) v.errors.push({ field, code: 'DUPLICATE_IN_FILE' });
        seen.add(key);
        const exists = r.code
          ? get<any>('SELECT id FROM departments WHERE code = ? AND deleted_at IS NULL', [r.code])
          : get<any>('SELECT id FROM departments WHERE name = ? AND deleted_at IS NULL', [r.name]);
        if (exists) {
          r.id = exists.id;
          v.action = options.mode === 'add_only' ? 'skip' : 'update';
          v.warnings.push({ field, code: options.mode === 'add_only' ? 'EXISTS_SKIP' : 'EXISTS_OVERWRITE' });
        }
      }
      for (const k of ['leader_emp_no']) {
        if (r[k]) {
          const e = get<any>('SELECT id FROM employees WHERE emp_no = ? AND deleted_at IS NULL', [r[k]]);
          if (e) r[k.replace('_emp_no', '_employee_id')] = e.id;
          else v.errors.push({ field: k, code: 'EMPLOYEE_NOT_FOUND' });
        }
      }
    }
  }

  if (kind === 'questions') {
    const form = options.formId ? get<any>('SELECT status FROM evaluation_forms WHERE id = ?', [options.formId]) : null;
    for (const v of out) {
      const r = v.record;
      if (!form) v.errors.push({ field: 'section', code: 'FORM_REQUIRED' });
      else if (form.status !== 'draft') v.errors.push({ field: 'section', code: 'FORM_NOT_DRAFT' });
      const t = r.type ? (TYPE_ALIASES[r.type.replace(/\s/g, '')] ?? (TYPE_LABEL_KO[r.type] ? r.type : null)) : null;
      if (r.type && !t) v.errors.push({ field: 'type', code: 'INVALID_TYPE' });
      r.type = t;
      const pts = r.points ? Number(r.points) : 0;
      if (Number.isNaN(pts) || pts < 0) v.errors.push({ field: 'points', code: 'INVALID_NUMBER' });
      r.points = Number.isNaN(pts) ? 0 : pts;
      r.required = r.required ? yes(r.required) : true;
      const textType = t === 'short_text' || t === 'long_text';
      r.scored = textType ? false : r.scored ? yes(r.scored) : r.points > 0;
      r.optionList = [];
      if (t === 'linear_scale') {
        const m = String(r.options || '1:5').match(/^(\d+)\s*[:~-]\s*(\d+)$/);
        if (!m || Number(m[1]) >= Number(m[2])) v.errors.push({ field: 'options', code: 'INVALID_SCALE' });
        else r.settings = { min: Number(m[1]), max: Number(m[2]) };
      } else if (t && !textType) {
        const parts = String(r.options || '').split('|').map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0 && (t === 'score_scale' || t === 'descriptive')) r.optionList = GRADE_OPTIONS;
        else if (parts.length === 0) v.errors.push({ field: 'options', code: 'OPTIONS_REQUIRED' });
        else {
          r.optionList = parts.map((p) => {
            const m = p.match(/^(.*?):\s*(-?\d+(?:\.\d+)?)$/);
            return m ? { label: m[1].trim(), score: Number(m[2]) } : { label: p, score: 0 };
          });
        }
      }
    }
  }

  if (kind === 'results') {
    const round = options.roundId ? get<any>('SELECT id FROM evaluation_rounds WHERE id = ? AND deleted_at IS NULL', [options.roundId]) : null;
    const weights = round ? getRoundWeights(round.id) : null;
    const finals = round ? new Set(computeRoundResults(round.id).filter((x) => x.finalized).map((x) => x.employee_id)) : new Set<number>();
    const seen = new Set<string>();
    for (const v of out) {
      const r = v.record;
      v.action = 'import';
      if (!round) { v.errors.push({ field: 'emp_no', code: 'ROUND_REQUIRED' }); continue; }
      const stage = ({ self: 'self', 자기평가: 'self', '1차': 'self', leader: 'leader', 팀장평가: 'leader', '2차': 'leader', exec: 'exec', 임원평가: 'exec', '3차': 'exec' } as Record<string, string>)[String(r.stage).replace(/\s/g, '').toLowerCase()];
      if (r.stage && !stage) v.errors.push({ field: 'stage', code: 'INVALID_VALUE' });
      r.stage = stage;
      const score = Number(r.score);
      if (r.score && (Number.isNaN(score) || score < 0 || score > 100)) v.errors.push({ field: 'score', code: 'SCORE_RANGE' });
      r.score = score;
      if (r.emp_no) {
        const t = get<any>(`SELECT t.employee_id, t.job_group, e.name FROM round_targets t JOIN employees e ON e.id = t.employee_id
          WHERE t.round_id = ? AND e.emp_no = ?`, [round.id, r.emp_no]);
        if (!t) { v.errors.push({ field: 'emp_no', code: 'NOT_ROUND_TARGET' }); continue; }
        r.employee_id = t.employee_id;
        if (r.name && r.name !== t.name) v.warnings.push({ field: 'name', code: 'NAME_MISMATCH' });
        if (stage && (weights![t.job_group] ?? weights!.default)[stage as Stage] <= 0) v.errors.push({ field: 'stage', code: 'STAGE_NOT_APPLICABLE' });
        if (finals.has(t.employee_id)) v.errors.push({ field: 'emp_no', code: 'RESULT_FINALIZED' });
        const key = `${r.emp_no}:${stage}`;
        if (seen.has(key)) v.errors.push({ field: 'emp_no', code: 'DUPLICATE_IN_FILE' });
        seen.add(key);
        const a = stage && get<any>('SELECT status FROM evaluation_assignments WHERE round_id = ? AND target_employee_id = ? AND stage = ?', [round.id, t.employee_id, stage]);
        if (a && a.status === 'submitted') v.warnings.push({ field: 'score', code: 'OVERWRITE_SUBMITTED' });
      }
    }
  }
  if (kind === 'kpis') {
    const round = options.roundId ? get<any>('SELECT id FROM evaluation_rounds WHERE id = ? AND deleted_at IS NULL', [options.roundId]) : null;
    const depts = all<any>('SELECT id, code, name FROM departments WHERE deleted_at IS NULL');
    const seen = new Set<string>();
    // "85%", "1,200", "4.5점" 처럼 단위가 붙은 숫자도 허용. 빈 값은 미입력(null)
    const numOf = (v: string) => {
      const s = String(v ?? '').replace(/[,\s]/g, '').replace(/[^\d.\-]+$/, '');
      return s === '' ? null : Number(s);
    };
    for (const v of out) {
      const r = v.record;
      if (!round) { v.errors.push({ field: 'department_name', code: 'ROUND_REQUIRED' }); continue; }
      const d = r.department_name ? depts.find((x) => x.name === r.department_name || x.code === r.department_name) : null;
      if (r.department_name && !d) v.errors.push({ field: 'department_name', code: 'DEPT_NOT_FOUND' });
      r.department_id = d?.id;
      const dir = String(r.direction ?? '').replace(/\s/g, '').toLowerCase();
      if (!dir || /^(higher|높을수록좋음|높을수록|높음|상향|↑|up)$/.test(dir)) r.direction = 'higher';
      else if (/^(lower|낮을수록좋음|낮을수록|낮음|하향|↓|down)$/.test(dir)) r.direction = 'lower';
      else v.errors.push({ field: 'direction', code: 'INVALID_VALUE' });
      for (const k of ['target', 'actual']) {
        const n = numOf(r[k]);
        if (n !== null && (Number.isNaN(n) || n < 0)) v.errors.push({ field: k, code: 'INVALID_NUMBER' });
        r[k] = n;
      }
      const w = r.weight === undefined || String(r.weight).trim() === '' ? 100 : numOf(r.weight);
      if (w === null || Number.isNaN(w) || w < 0 || w > 100) v.errors.push({ field: 'weight', code: 'WEIGHT_RANGE' });
      r.weight = w;
      if (!r.unit) r.unit = '';
      if (r.target === null || r.actual === null || r.target === 0 || r.actual === 0) v.warnings.push({ field: r.target ? 'actual' : 'target', code: 'KPI_NOT_CALCULABLE' });
      if (d && r.name) {
        const key = `${d.id}:${r.name}`;
        if (seen.has(key)) v.errors.push({ field: 'name', code: 'DUPLICATE_IN_FILE' });
        seen.add(key);
        const exists = get<any>('SELECT id FROM department_kpis WHERE round_id = ? AND department_id = ? AND name = ? AND deleted_at IS NULL', [round.id, d.id, r.name]);
        if (exists) {
          r.id = exists.id;
          v.action = options.mode === 'add_only' ? 'skip' : 'update';
          v.warnings.push({ field: 'name', code: options.mode === 'add_only' ? 'EXISTS_SKIP' : 'EXISTS_OVERWRITE' });
        }
      }
    }
  }
  return out;
}

export function summarize(rows: ValidatedRow[]) {
  return {
    total: rows.length,
    errorRows: rows.filter((r) => r.errors.length).length,
    create: rows.filter((r) => !r.errors.length && r.action === 'create').length,
    update: rows.filter((r) => !r.errors.length && r.action === 'update').length,
    skip: rows.filter((r) => !r.errors.length && r.action === 'skip').length,
    import: rows.filter((r) => !r.errors.length && r.action === 'import').length,
  };
}

/* ───────────── 적용 ───────────── */

export function applyUpload(kind: Kind, rows: ValidatedRow[], options: UploadOptions, userId: number) {
  const valid = rows.filter((r) => !r.errors.length && r.action !== 'skip');
  const changes: any[] = [];
  tx(() => {
    if (kind === 'employees') {
      for (const { record: r } of valid) {
        let deptId = r.department_id ?? null;
        if (!deptId && r.department_name && options.createDepartments) {
          const d = get<any>('SELECT id FROM departments WHERE name = ? AND deleted_at IS NULL', [r.department_name]);
          if (d) deptId = d.id;
          else {
            deptId = run('INSERT INTO departments (code, name) VALUES (?, ?)', [newDeptCode(), r.department_name]).lastInsertRowid;
            changes.push({ type: 'department_created', id: deptId });
          }
        }
        // 팀장 여부는 CSV로 받지 않음: 부서 관리에서 지정한 부서 팀장만 팀장으로 처리
        const flags = positionFlags(r.position);
        const vals = [r.name, deptId, r.position, r.job_group, flags.is_executive, flags.is_leader, r.status, r.hire_date || null, r.email || null, r.phone || null];
        if (r.id) {
          const before = get<any>('SELECT * FROM employees WHERE id = ?', [r.id]);
          run(`UPDATE employees SET name = ?, department_id = ?, position = ?, job_group = ?, is_executive = ?, is_leader = ?, status = ?,
               hire_date = ?, email = ?, phone = ?, deleted_at = NULL, updated_at = ? WHERE id = ?`, [...vals, now(), r.id]);
          if (before.department_id !== deptId) run('UPDATE departments SET leader_employee_id = NULL WHERE leader_employee_id = ?', [r.id]);
          changes.push({ type: 'employee_updated', id: r.id, before });
        } else {
          const id = run(`INSERT INTO employees (emp_no, name, department_id, position, job_group, is_executive, is_leader, status, hire_date, email, phone)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [r.emp_no, ...vals]).lastInsertRowid;
          changes.push({ type: 'employee_created', id });
        }
      }
    }
    if (kind === 'departments') {
      for (const { record: r } of valid) {
        if (r.id) {
          const before = get<any>('SELECT * FROM departments WHERE id = ?', [r.id]);
          run('UPDATE departments SET name = ?, leader_employee_id = COALESCE(?, leader_employee_id), description = COALESCE(?, description), updated_at = ? WHERE id = ?',
            [r.name, r.leader_employee_id ?? null, r.description || null, now(), r.id]);
          changes.push({ type: 'department_updated', id: r.id, before });
        } else {
          const code = r.code || newDeptCode();
          run(`UPDATE departments SET code = code || '#' || id WHERE code = ? AND deleted_at IS NOT NULL`, [code]);
          const id = run('INSERT INTO departments (code, name, leader_employee_id, description) VALUES (?, ?, ?, ?)',
            [code, r.name, r.leader_employee_id ?? null, r.description || null]).lastInsertRowid;
          changes.push({ type: 'department_created', id });
        }
        if (r.leader_employee_id) run(`UPDATE employees SET position = '팀장', is_leader = 1 WHERE id = ? AND COALESCE(position, '') <> '임원'`, [r.leader_employee_id]);
      }
    }
    if (kind === 'questions') {
      const before = getFormFull(options.formId!)!;
      const sections: SectionInput[] = options.questionMode === 'replace' ? [] : before.sections.map((s: any) => ({
        title: s.title, description: s.description,
        questions: s.questions.map((q: any) => ({ ...q, options: q.options.map((o: any) => ({ label: o.label, score: o.score })) })),
      }));
      for (const { record: r } of valid) {
        let sec = sections.find((s) => s.title === r.section);
        if (!sec) { sec = { title: r.section, questions: [] }; sections.push(sec); }
        sec.questions.push({
          type: r.type, text: r.text, description: r.description || null, required: r.required, points: r.scored ? r.points : 0,
          scored: r.scored, settings: r.settings ?? null, options: r.optionList, is_suggestion: r.text === '기타 건의사항',
        });
      }
      // 기타 건의사항 섹션은 항상 마지막
      sections.sort((a, b) => Number(a.title === '기타 건의사항') - Number(b.title === '기타 건의사항'));
      replaceFormContent(options.formId!, sections);
      changes.push({ type: 'form_replaced', id: options.formId, before: before.sections });
    }
    if (kind === 'kpis') {
      for (const { record: r } of valid) {
        if (r.id) {
          const before = get<any>('SELECT * FROM department_kpis WHERE id = ?', [r.id]);
          run('UPDATE department_kpis SET unit = ?, direction = ?, target = ?, actual = ?, weight = ?, updated_at = ? WHERE id = ?',
            [r.unit, r.direction, r.target, r.actual, r.weight, now(), r.id]);
          changes.push({ type: 'kpi_updated', id: r.id, before });
        } else {
          const order = get<{ n: number }>('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM department_kpis WHERE round_id = ? AND department_id = ?', [options.roundId, r.department_id])!.n;
          const id = run(`INSERT INTO department_kpis (round_id, department_id, name, unit, direction, target, actual, weight, sort_order, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [options.roundId, r.department_id, r.name, r.unit, r.direction, r.target, r.actual, r.weight, order, userId]).lastInsertRowid;
          changes.push({ type: 'kpi_created', id });
        }
      }
    }
    if (kind === 'results') {
      for (const { record: r } of valid) {
        const a = get<any>('SELECT * FROM evaluation_assignments WHERE round_id = ? AND target_employee_id = ? AND stage = ?', [options.roundId, r.employee_id, r.stage]);
        const score = a ? get<any>('SELECT * FROM evaluation_scores WHERE assignment_id = ?', [a.id]) : null;
        let aid = a?.id;
        if (!a) {
          aid = run(`INSERT INTO evaluation_assignments (round_id, target_employee_id, stage, status, submitted_at, submitted_by) VALUES (?, ?, ?, 'submitted', ?, ?)`,
            [options.roundId, r.employee_id, r.stage, now(), userId]).lastInsertRowid;
        } else {
          run(`UPDATE evaluation_assignments SET status = 'submitted', submitted_at = ?, submitted_by = ?, updated_at = ? WHERE id = ?`, [now(), userId, now(), aid]);
        }
        run(`INSERT INTO evaluation_scores (assignment_id, raw_score, max_score, normalized_score, source, upload_id, computed_at) VALUES (?, ?, 100, ?, 'import', ?, ?)
             ON CONFLICT(assignment_id) DO UPDATE SET raw_score = excluded.raw_score, max_score = 100, normalized_score = excluded.normalized_score,
             source = 'import', upload_id = excluded.upload_id, computed_at = excluded.computed_at`,
          [aid, r.score, r.score, options.uploadId ?? null, now()]);
        changes.push({ type: 'result_imported', assignmentId: aid, createdAssignment: !a, beforeAssignment: a ?? null, beforeScore: score ?? null });
      }
    }
  });
  return changes;
}

/** 적용된 업로드 되돌리기 */
export function revertUpload(kind: Kind, changes: any[]) {
  tx(() => {
    for (const c of [...changes].reverse()) {
      switch (c.type) {
        case 'employee_created': {
          const used = get('SELECT 1 FROM round_targets WHERE employee_id = ? UNION SELECT 1 FROM users WHERE employee_id = ?', [c.id, c.id]);
          run('UPDATE departments SET leader_employee_id = NULL WHERE leader_employee_id = ?', [c.id]);
          if (used) run('UPDATE employees SET deleted_at = ? WHERE id = ?', [now(), c.id]);
          else run('DELETE FROM employees WHERE id = ?', [c.id]);
          break;
        }
        case 'employee_updated': {
          const b = c.before;
          run(`UPDATE employees SET name = ?, department_id = ?, position = ?, title = ?, job_group = ?, is_leader = ?, is_executive = ?, status = ?,
               hire_date = ?, email = ?, phone = ?, deleted_at = ?, updated_at = ? WHERE id = ?`,
            [b.name, b.department_id, b.position, b.title, b.job_group, b.is_leader, b.is_executive, b.status, b.hire_date, b.email, b.phone, b.deleted_at, now(), c.id]);
          break;
        }
        case 'department_created': {
          const hasMembers = get('SELECT 1 FROM employees WHERE department_id = ? AND deleted_at IS NULL', [c.id]);
          if (hasMembers) run('UPDATE departments SET deleted_at = ? WHERE id = ?', [now(), c.id]);
          else run('DELETE FROM departments WHERE id = ? AND NOT EXISTS (SELECT 1 FROM employees WHERE department_id = ?)', [c.id, c.id]);
          run(`UPDATE departments SET code = code || '#' || id WHERE id = ? AND deleted_at IS NOT NULL`, [c.id]);
          break;
        }
        case 'department_updated': {
          const b = c.before;
          run('UPDATE departments SET name = ?, leader_employee_id = ?, exec_employee_id = ?, description = ?, updated_at = ? WHERE id = ?',
            [b.name, b.leader_employee_id, b.exec_employee_id, b.description, now(), c.id]);
          break;
        }
        case 'form_replaced': {
          const f = get<any>('SELECT status FROM evaluation_forms WHERE id = ?', [c.id]);
          if (!f || f.status !== 'draft') throw new Error('FORM_NOT_DRAFT');
          replaceFormContent(c.id, c.before.map((s: any) => ({
            title: s.title, description: s.description,
            questions: s.questions.map((q: any) => ({ ...q, options: q.options.map((o: any) => ({ label: o.label, score: o.score })) })),
          })));
          break;
        }
        case 'result_imported': {
          if (c.createdAssignment) {
            run('DELETE FROM evaluation_assignments WHERE id = ?', [c.assignmentId]);
            break;
          }
          const a = c.beforeAssignment;
          run('UPDATE evaluation_assignments SET status = ?, submitted_at = ?, submitted_by = ?, updated_at = ? WHERE id = ?',
            [a.status, a.submitted_at, a.submitted_by, now(), c.assignmentId]);
          if (c.beforeScore) {
            const s = c.beforeScore;
            run('UPDATE evaluation_scores SET raw_score = ?, max_score = ?, normalized_score = ?, source = ?, upload_id = ?, computed_at = ? WHERE assignment_id = ?',
              [s.raw_score, s.max_score, s.normalized_score, s.source, s.upload_id, s.computed_at, c.assignmentId]);
          } else run('DELETE FROM evaluation_scores WHERE assignment_id = ?', [c.assignmentId]);
          break;
        }
        case 'kpi_created':
          run('UPDATE department_kpis SET deleted_at = ? WHERE id = ?', [now(), c.id]);
          break;
        case 'kpi_updated': {
          const b = c.before;
          run('UPDATE department_kpis SET unit = ?, direction = ?, target = ?, actual = ?, weight = ?, deleted_at = ?, updated_at = ? WHERE id = ?',
            [b.unit, b.direction, b.target, b.actual, b.weight, b.deleted_at, now(), c.id]);
          break;
        }
        default: break;
      }
    }
  });
}
