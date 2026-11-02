-- 1) 직원 메모 (관리자만 열람·작성)
ALTER TABLE employees ADD COLUMN memo TEXT;

-- 2) 평가 결과 일괄 삭제 권한 (관리자). 신규 DB는 seed 가 PERMISSIONS 전체를 넣으므로 기존 DB에만 추가
INSERT OR IGNORE INTO permissions (code, description)
SELECT 'results.delete', '평가 결과 삭제' WHERE EXISTS (SELECT 1 FROM roles);
INSERT OR IGNORE INTO role_permissions (role_id, permission_code)
SELECT id, 'results.delete' FROM roles WHERE code = 'admin';
