import { CheckCircle2, Circle, CircleDashed, MinusCircle, UserX, Lock, Clock } from 'lucide-react';
import { Badge } from '../components/ui';
import type { TFn } from '../i18n';

export type StageState = 'na' | 'unassigned' | 'not_started' | 'in_progress' | 'submitted';
export type OverallState = 'not_started' | 'in_progress' | 'completed' | 'finalized';
/** 평가 단계: 자기 / 팀장→팀원 / 임원→팀원·팀장 / 팀원→팀장 */
export const STAGES = ['self', 'leader', 'exec', 'upward'] as const;
export type Stage = (typeof STAGES)[number];

/** 상태는 항상 아이콘 + 텍스트로 표시 (색상 단독 의존 금지) */
export function StageBadge({ state, t }: { state: StageState; t: TFn }) {
  const map = {
    na: { c: 'slate', i: <MinusCircle className="h-3 w-3" /> },
    unassigned: { c: 'red', i: <UserX className="h-3 w-3" /> },
    not_started: { c: 'slate', i: <Circle className="h-3 w-3" /> },
    in_progress: { c: 'amber', i: <CircleDashed className="h-3 w-3" /> },
    submitted: { c: 'green', i: <CheckCircle2 className="h-3 w-3" /> },
  } as const;
  const m = map[state] ?? map.not_started;
  return <Badge color={m.c} icon={m.i}>{t(`stageState.${state}`)}</Badge>;
}

export function OverallBadge({ state, t }: { state: OverallState; t: TFn }) {
  const map = {
    not_started: { c: 'slate', i: <Circle className="h-3 w-3" /> },
    in_progress: { c: 'amber', i: <Clock className="h-3 w-3" /> },
    completed: { c: 'green', i: <CheckCircle2 className="h-3 w-3" /> },
    finalized: { c: 'navy', i: <Lock className="h-3 w-3" /> },
  } as const;
  const m = map[state] ?? map.not_started;
  return <Badge color={m.c} icon={m.i}>{t(`state.${state}`)}</Badge>;
}

export const fmtScore = (v: number | null | undefined) => (v === null || v === undefined ? '–' : v.toFixed(2));
/** KPI 점수·달성률: 소수점 둘째 자리에서 반올림해 첫째 자리까지 표시 (예: 96.47 → 96.5) */
export const fmtKpi = (v: number | null | undefined) => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toFixed(1));

export function fmtDate(s: string | null | undefined, locale: string, withTime = false) {
  if (!s) return '–';
  const d = new Date(s.includes('T') || s.length <= 10 ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return withTime ? d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(locale);
}

export const JOB_GROUPS = ['office_member', 'office_leader', 'production_member', 'production_leader'] as const;

/** 직급 (DB 값은 한글 고정, 화면 표시는 번역) */
export const POSITIONS = ['임원', '팀장', '차장', '팀원'] as const;
const POSITION_KEY: Record<string, string> = { 임원: 'executive', 팀장: 'leader', 차장: 'deputy', 팀원: 'member' };
export function posLabel(t: TFn, p: string | null | undefined): string {
  if (!p) return '–';
  return POSITION_KEY[p] ? t(`position.${POSITION_KEY[p]}`) : p;
}
