-- 부서 KPI: 차수별 반영 설정 + 부서별 KPI 지표
-- 최종 점수 = 개인 평가 환산점수 × personal_ratio% + 부서 KPI 환산점수 × kpi_ratio% (enabled = 1 일 때)
CREATE TABLE kpi_settings (
  round_id INTEGER PRIMARY KEY REFERENCES evaluation_rounds(id),
  enabled INTEGER NOT NULL DEFAULT 0,
  personal_ratio REAL NOT NULL DEFAULT 80,
  kpi_ratio REAL NOT NULL DEFAULT 20,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- direction: higher = 높을수록 좋음(실적/목표), lower = 낮을수록 좋음(목표/실적)
-- 목표 또는 실적이 0/미입력인 지표는 계산 불가로 부서 점수에서 제외
CREATE TABLE department_kpis (
  id INTEGER PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES evaluation_rounds(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '%',
  direction TEXT NOT NULL DEFAULT 'higher' CHECK (direction IN ('higher','lower')),
  target REAL,
  actual REAL,
  weight REAL NOT NULL DEFAULT 100,
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_department_kpis_round ON department_kpis(round_id, department_id);
