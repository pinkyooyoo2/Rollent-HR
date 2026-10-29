-- 대양롤랜트 인사평가 시스템 초기 스키마

-- 역할 및 권한
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);
CREATE TABLE permissions (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL
);
CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

-- 부서
CREATE TABLE departments (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  leader_employee_id INTEGER REFERENCES employees(id),
  exec_employee_id INTEGER REFERENCES employees(id),
  description TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 직원 (소프트 삭제: deleted_at)
CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  emp_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  position TEXT,
  title TEXT,
  job_group TEXT NOT NULL DEFAULT 'office' CHECK (job_group IN ('office','production')),
  is_leader INTEGER NOT NULL DEFAULT 0,
  is_executive INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','leave','resigned')),
  hire_date TEXT,
  email TEXT,
  phone TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_employees_dept ON employees(department_id);

-- 사용자 계정 (로그인 ID = 사번)
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  emp_no TEXT NOT NULL UNIQUE,
  employee_id INTEGER UNIQUE REFERENCES employees(id),
  display_name TEXT NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  language TEXT NOT NULL DEFAULT 'ko',
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dashboard_layout TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 평가 양식 및 버전
CREATE TABLE evaluation_forms (
  id INTEGER PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('self','leader','exec','upward')),
  job_group TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  parent_id INTEGER REFERENCES evaluation_forms(id),
  source TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT,
  UNIQUE (stage, job_group, version)
);

CREATE TABLE form_sections (
  id INTEGER PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES evaluation_forms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE form_questions (
  id INTEGER PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES evaluation_forms(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES form_sections(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL CHECK (type IN ('short_text','long_text','single_choice','checkbox','dropdown','score_scale','linear_scale','descriptive')),
  text TEXT NOT NULL,
  description TEXT,
  required INTEGER NOT NULL DEFAULT 1,
  points REAL NOT NULL DEFAULT 0,
  scored INTEGER NOT NULL DEFAULT 1,
  settings TEXT,
  is_sample INTEGER NOT NULL DEFAULT 0,
  is_suggestion INTEGER NOT NULL DEFAULT 0,
  source TEXT
);
CREATE INDEX idx_questions_form ON form_questions(form_id);

CREATE TABLE question_options (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES form_questions(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0
);

-- 평가 차수
CREATE TABLE evaluation_rounds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  year INTEGER NOT NULL,
  period_start TEXT,
  period_end TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  self_status TEXT NOT NULL DEFAULT 'pending' CHECK (self_status IN ('pending','open','closed')),
  leader_status TEXT NOT NULL DEFAULT 'pending' CHECK (leader_status IN ('pending','open','closed')),
  exec_status TEXT NOT NULL DEFAULT 'pending' CHECK (exec_status IN ('pending','open','closed')),
  enforce_sequence INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 평가 가중치 (job_group = 'default' 는 차수 기본값, 그 외는 직군별 오버라이드)
CREATE TABLE evaluation_weights (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES evaluation_rounds(id) ON DELETE CASCADE,
  job_group TEXT NOT NULL DEFAULT 'default',
  self_weight REAL NOT NULL,
  leader_weight REAL NOT NULL,
  exec_weight REAL NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (round_id, job_group),
  CHECK (abs(self_weight + leader_weight + exec_weight - 100) < 0.001)
);

CREATE TABLE weight_history (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES evaluation_rounds(id) ON DELETE CASCADE,
  job_group TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  changed_by INTEGER REFERENCES users(id),
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 차수별 평가 대상자 (직군 스냅샷)
CREATE TABLE round_targets (
  round_id INTEGER NOT NULL REFERENCES evaluation_rounds(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  job_group TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (round_id, employee_id)
);

-- 평가자 배정
CREATE TABLE evaluation_assignments (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES evaluation_rounds(id) ON DELETE CASCADE,
  target_employee_id INTEGER NOT NULL REFERENCES employees(id),
  stage TEXT NOT NULL CHECK (stage IN ('self','leader','exec')),
  evaluator_employee_id INTEGER REFERENCES employees(id),
  form_id INTEGER REFERENCES evaluation_forms(id),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','submitted')),
  submitted_at TEXT,
  submitted_by INTEGER REFERENCES users(id),
  reopen_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (round_id, target_employee_id, stage)
);
CREATE INDEX idx_assign_evaluator ON evaluation_assignments(evaluator_employee_id);

-- 평가 응답
CREATE TABLE evaluation_responses (
  id INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES evaluation_assignments(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES form_questions(id),
  answer TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assignment_id, question_id)
);

-- 평가 점수 (평가 1건당 100점 환산 점수)
CREATE TABLE evaluation_scores (
  assignment_id INTEGER PRIMARY KEY REFERENCES evaluation_assignments(id) ON DELETE CASCADE,
  raw_score REAL NOT NULL,
  max_score REAL NOT NULL,
  normalized_score REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form','import')),
  upload_id INTEGER REFERENCES csv_uploads(id),
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 최종 점수 보정 이력
CREATE TABLE score_adjustments (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES evaluation_rounds(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  computed_score REAL,
  before_score REAL,
  after_score REAL NOT NULL,
  reason TEXT NOT NULL,
  adjusted_by INTEGER NOT NULL REFERENCES users(id),
  adjusted_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reverted')),
  reverted_by INTEGER REFERENCES users(id),
  reverted_at TEXT,
  revert_reason TEXT
);
CREATE INDEX idx_adjust_emp ON score_adjustments(round_id, employee_id);

-- 최종 확정
CREATE TABLE result_finalizations (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES evaluation_rounds(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  final_score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'finalized' CHECK (status IN ('finalized','reopened')),
  finalized_by INTEGER NOT NULL REFERENCES users(id),
  finalized_at TEXT NOT NULL DEFAULT (datetime('now')),
  reopened_by INTEGER REFERENCES users(id),
  reopened_at TEXT,
  reopen_reason TEXT
);
CREATE INDEX idx_final_emp ON result_finalizations(round_id, employee_id);

-- CSV 업로드 기록
CREATE TABLE csv_uploads (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('employees','departments','questions','results')),
  file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','pending_approval','applied','rejected','cancelled','reverted')),
  row_count INTEGER NOT NULL DEFAULT 0,
  headers TEXT,
  mapping TEXT,
  rows TEXT,
  options TEXT,
  result TEXT,
  changes TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  applied_by INTEGER REFERENCES users(id),
  applied_at TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  reverted_by INTEGER REFERENCES users(id),
  reverted_at TEXT
);

-- 리포트 생성 기록
CREATE TABLE report_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  report_type TEXT NOT NULL,
  format TEXT NOT NULL,
  round_id INTEGER REFERENCES evaluation_rounds(id),
  target_desc TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 관리자 활동 로그 (감사 추적)
CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activity_created ON activity_logs(created_at);

-- API 접근 로그
CREATE TABLE access_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER,
  ip TEXT,
  user_agent TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_access_created ON access_logs(created_at);
