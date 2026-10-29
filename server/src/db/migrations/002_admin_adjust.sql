-- 관리자도 최종 점수 보정 가능 (기존 DB 반영용. 새 DB는 seed 의 ROLES 정의로 부여됨)
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT id, 'results.adjust' FROM roles WHERE code = 'admin';
