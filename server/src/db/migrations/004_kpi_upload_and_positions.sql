-- @no-foreign-keys
-- 1) CSV 업로드 종류에 부서 KPI(kpis) 추가: CHECK 제약 변경을 위해 테이블 재생성
CREATE TABLE csv_uploads_new (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('employees','departments','questions','results','kpis')),
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
INSERT INTO csv_uploads_new SELECT * FROM csv_uploads;
DROP TABLE csv_uploads;
ALTER TABLE csv_uploads_new RENAME TO csv_uploads;

-- 2) 직급을 임원 / 팀장 / 차장 / 팀원 4단계로 정리 (임원·팀장 여부는 직급에서 결정)
UPDATE employees SET position = CASE
  WHEN is_executive = 1 THEN '임원'
  WHEN is_leader = 1 THEN '팀장'
  WHEN position = '차장' THEN '차장'
  ELSE '팀원' END;
