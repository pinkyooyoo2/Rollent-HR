/**
 * 직급: 임원 / 팀장 / 차장 / 팀원 (DB에는 한글 값 그대로 저장, 화면에서 번역)
 * 직급이 평가 양식(직군의 팀원/팀장 구분)과 임원 여부를 결정한다.
 */
export const POSITIONS = ['임원', '팀장', '차장', '팀원'] as const;
export type Position = (typeof POSITIONS)[number];
export const DEFAULT_POSITION: Position = '팀원';

/** 직급 → 임원/팀장 플래그 (employees.is_executive / is_leader) */
export function positionFlags(p: string | null | undefined) {
  return { is_executive: p === '임원' ? 1 : 0, is_leader: p === '팀장' ? 1 : 0 };
}

const ALIASES: Record<string, Position> = {
  임원: '임원', executive: '임원', 전무: '임원', 상무: '임원', 이사: '임원', 대표: '임원',
  팀장: '팀장', leader: '팀장', 'team leader': '팀장',
  차장: '차장', 'deputy general manager': '차장',
  팀원: '팀원', member: '팀원', 'team member': '팀원',
};

/** 직급 정렬 순서 (임원 → 팀장 → 차장 → 팀원, 그 외 값은 뒤로) */
export function positionRank(p: string | null | undefined): number {
  const i = (POSITIONS as readonly string[]).indexOf(String(p ?? ''));
  return i < 0 ? POSITIONS.length : i;
}

/** 모든 직원 목록의 공통 정렬: 부서 → 직급 → 직원명 (부서 없음은 맨 뒤) */
export function compareOrg(
  a: { department_name?: string | null; position?: string | null; name: string },
  b: { department_name?: string | null; position?: string | null; name: string },
): number {
  const da = a.department_name ?? '';
  const db = b.department_name ?? '';
  if (!da !== !db) return da ? -1 : 1;
  return da.localeCompare(db, 'ko') || positionRank(a.position) - positionRank(b.position) || a.name.localeCompare(b.name, 'ko');
}

/** CSV 등 외부 입력값을 직급으로 변환 (빈 값은 팀원, 알 수 없는 값은 null) */
export function normalizePosition(v: string | null | undefined): Position | null {
  const s = String(v ?? '').trim();
  if (!s) return DEFAULT_POSITION;
  return ALIASES[s] ?? ALIASES[s.toLowerCase()] ?? null;
}
