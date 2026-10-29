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

/** CSV 등 외부 입력값을 직급으로 변환 (빈 값은 팀원, 알 수 없는 값은 null) */
export function normalizePosition(v: string | null | undefined): Position | null {
  const s = String(v ?? '').trim();
  if (!s) return DEFAULT_POSITION;
  return ALIASES[s] ?? ALIASES[s.toLowerCase()] ?? null;
}
