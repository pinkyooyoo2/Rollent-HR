-- @no-foreign-keys
-- 팀원·팀장·임원용 평가 사이트 지원
--  1) 평가 배정: 팀원→팀장평가(upward) 추가. upward 는 대상자 1명에 평가자 여러 명 (평가자별 1건)
--     자동저장 순번(save_seq)·마지막 저장 시각 추가
--  2) 가중치: 팀원→팀장평가 가중치(upward_weight) 추가 → 네 단계 합계 100%
--  3) 차수: 팀원→팀장평가 진행 상태/실시 여부, 평가 유형별 마감일
--  4) 계정: 최초 로그인 시 비밀번호 변경 강제
--  5) 평가 재오픈 이력
--  6) 임원은 자기평가만 실시 (임원 대상 팀장·임원평가 배정 제거)
--  7) 역할 권한: 임원 = 평가 작성 전용, 관리자 = 전체 권한

-- 1) evaluation_assignments 재생성
CREATE TABLE evaluation_assignments_new (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES evaluation_rounds(id) ON DELETE CASCADE,
  target_employee_id INTEGER NOT NULL REFERENCES employees(id),
  stage TEXT NOT NULL CHECK (stage IN ('self','leader','exec','upward')),
  evaluator_employee_id INTEGER REFERENCES employees(id),
  form_id INTEGER REFERENCES evaluation_forms(id),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','submitted')),
  submitted_at TEXT,
  submitted_by INTEGER REFERENCES users(id),
  reopen_count INTEGER NOT NULL DEFAULT 0,
  save_seq INTEGER NOT NULL DEFAULT 0,
  last_saved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO evaluation_assignments_new (id, round_id, target_employee_id, stage, evaluator_employee_id, form_id, status, submitted_at, submitted_by,
  reopen_count, last_saved_at, created_at, updated_at)
SELECT id, round_id, target_employee_id, stage, evaluator_employee_id, form_id, status, submitted_at, submitted_by,
  reopen_count, CASE WHEN status <> 'not_started' THEN updated_at END, created_at, updated_at FROM evaluation_assignments;
DROP TABLE evaluation_assignments;
ALTER TABLE evaluation_assignments_new RENAME TO evaluation_assignments;
CREATE INDEX idx_assign_evaluator ON evaluation_assignments(evaluator_employee_id);
-- 자기·팀장·임원평가는 대상자당 1건, 팀원→팀장평가는 대상자·평가자 조합당 1건
CREATE UNIQUE INDEX ux_assign_single ON evaluation_assignments(round_id, target_employee_id, stage) WHERE stage <> 'upward';
CREATE UNIQUE INDEX ux_assign_upward ON evaluation_assignments(round_id, target_employee_id, evaluator_employee_id) WHERE stage = 'upward';

-- 2) evaluation_weights 재생성
CREATE TABLE evaluation_weights_new (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES evaluation_rounds(id) ON DELETE CASCADE,
  job_group TEXT NOT NULL DEFAULT 'default',
  self_weight REAL NOT NULL,
  leader_weight REAL NOT NULL,
  exec_weight REAL NOT NULL,
  upward_weight REAL NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (round_id, job_group),
  CHECK (abs(self_weight + leader_weight + exec_weight + upward_weight - 100) < 0.001)
);
INSERT INTO evaluation_weights_new (id, round_id, job_group, self_weight, leader_weight, exec_weight, updated_by, updated_at)
SELECT id, round_id, job_group, self_weight, leader_weight, exec_weight, updated_by, updated_at FROM evaluation_weights;
DROP TABLE evaluation_weights;
ALTER TABLE evaluation_weights_new RENAME TO evaluation_weights;

-- 3) 차수: 팀원→팀장평가 상태·실시 여부, 평가 유형별 마감일 (비어 있으면 차수 종료일)
ALTER TABLE evaluation_rounds ADD COLUMN upward_status TEXT NOT NULL DEFAULT 'pending' CHECK (upward_status IN ('pending','open','closed'));
ALTER TABLE evaluation_rounds ADD COLUMN upward_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE evaluation_rounds ADD COLUMN self_end_date TEXT;
ALTER TABLE evaluation_rounds ADD COLUMN leader_end_date TEXT;
ALTER TABLE evaluation_rounds ADD COLUMN exec_end_date TEXT;
ALTER TABLE evaluation_rounds ADD COLUMN upward_end_date TEXT;
UPDATE evaluation_rounds SET upward_status = CASE status WHEN 'open' THEN 'open' WHEN 'closed' THEN 'closed' ELSE 'pending' END;

-- 4) 최초 로그인 비밀번호 변경
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
UPDATE users SET must_change_password = 1;

-- 5) 평가 재오픈 이력
CREATE TABLE assignment_reopens (
  id INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES evaluation_assignments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  previous_submitted_at TEXT,
  reopened_by INTEGER REFERENCES users(id),
  reopened_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reopens_assignment ON assignment_reopens(assignment_id);

-- 6) 임원: 직군 'executive' (자기평가만). 임원 대상 팀장·임원평가 배정과 응답 제거
UPDATE round_targets SET job_group = 'executive'
WHERE employee_id IN (SELECT id FROM employees WHERE is_executive = 1)
  AND round_id NOT IN (SELECT id FROM evaluation_rounds WHERE status = 'closed');
DELETE FROM evaluation_scores WHERE assignment_id IN (
  SELECT a.id FROM evaluation_assignments a JOIN round_targets t ON t.round_id = a.round_id AND t.employee_id = a.target_employee_id
  WHERE t.job_group = 'executive' AND a.stage <> 'self');
DELETE FROM evaluation_responses WHERE assignment_id IN (
  SELECT a.id FROM evaluation_assignments a JOIN round_targets t ON t.round_id = a.round_id AND t.employee_id = a.target_employee_id
  WHERE t.job_group = 'executive' AND a.stage <> 'self');
DELETE FROM evaluation_assignments WHERE id IN (
  SELECT a.id FROM evaluation_assignments a JOIN round_targets t ON t.round_id = a.round_id AND t.employee_id = a.target_employee_id
  WHERE t.job_group = 'executive' AND a.stage <> 'self');

-- 7) 역할 권한
DELETE FROM role_permissions WHERE role_id = (SELECT id FROM roles WHERE code = 'executive') AND permission_code <> 'evaluate';
INSERT OR IGNORE INTO role_permissions (role_id, permission_code) SELECT id, 'evaluate' FROM roles WHERE code = 'executive';
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r, permissions p WHERE r.code = 'admin';
