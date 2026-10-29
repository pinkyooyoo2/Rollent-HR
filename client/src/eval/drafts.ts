/**
 * 오프라인 임시 저장소 (서버에 아직 반영되지 못한 응답만 보관).
 * - sessionStorage 사용: 탭을 닫으면 사라지므로 공유 PC에 평가 내용이 남지 않음
 * - 서버 저장 성공·제출·로그아웃 시 즉시 삭제
 */
const PREFIX = 'hr-eval-draft:';

export interface DraftBackup { answers: Record<number, unknown>; ts: number }

const key = (userId: number, assignmentId: number) => `${PREFIX}${userId}:${assignmentId}`;

export function readDraft(userId: number, assignmentId: number): DraftBackup | null {
  try {
    const raw = sessionStorage.getItem(key(userId, assignmentId));
    return raw ? (JSON.parse(raw) as DraftBackup) : null;
  } catch { return null; }
}

export function writeDraft(userId: number, assignmentId: number, answers: Record<number, unknown>) {
  try { sessionStorage.setItem(key(userId, assignmentId), JSON.stringify({ answers, ts: Date.now() })); } catch { /* 저장 공간 없음·비활성화 → 메모리 재시도만 */ }
}

export function removeDraft(userId: number, assignmentId: number) {
  try { sessionStorage.removeItem(key(userId, assignmentId)); } catch { /* 무시 */ }
}

export function clearAllDrafts() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch { /* 무시 */ }
}
