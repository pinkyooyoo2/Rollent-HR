-- 로그인 비밀번호 = 사번 (개인 비밀번호 설정·변경 없음). 최초 로그인 비밀번호 변경 강제 해제
UPDATE users SET must_change_password = 0;
