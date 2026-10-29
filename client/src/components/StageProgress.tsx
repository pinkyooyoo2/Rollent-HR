/**
 * 직원별 평가 진행 단계 요약
 *  - 그 직원에게 적용되는 단계(가중치 > 0)만 순서대로 1·2·3단계로 번호를 매김
 *    (예: 팀원 = 자기 → 팀장 → 임원, 팀장 = 자기 → 임원, 임원 = 자기)
 *  - 요약: 미시작 / 1단계 진행 중 / N단계 완료 (다음 단계 안내) / 평가 완료 / 최종 확정
 */
import { Check, Loader2, UserX } from 'lucide-react';
import type { TFn } from '../i18n';
import { cx } from './ui';
import type { OverallState, StageState } from '../lib/status';

const ORDER = ['self', 'leader', 'exec', 'upward'] as const;
type Stage = (typeof ORDER)[number];

export interface ProgressRow {
  state: OverallState;
  stages: Record<Stage, StageState>;
  weights?: Record<Stage, number>;
}

/** 적용되는 단계 (가중치 정보가 없으면 '해당 없음'이 아닌 단계) */
export function stageSequence(e: ProgressRow): Stage[] {
  return ORDER.filter((s) => (e.weights ? e.weights[s] > 0 : e.stages[s] !== 'na' && s !== 'upward'));
}

export type SummaryKind = 'not_started' | 'in_progress' | 'step_done' | 'completed' | 'finalized';

export function progressSummary(e: ProgressRow) {
  const seq = stageSequence(e);
  let done = 0;
  while (done < seq.length && e.stages[seq[done]] === 'submitted') done++;
  const next = seq[done];
  if (e.state === 'finalized') return { kind: 'finalized' as SummaryKind, done, total: seq.length, next: undefined };
  if (seq.length > 0 && done === seq.length) return { kind: 'completed' as SummaryKind, done, total: seq.length, next: undefined };
  if (done > 0) return { kind: 'step_done' as SummaryKind, done, total: seq.length, next };
  const started = seq.some((s) => e.stages[s] === 'in_progress' || e.stages[s] === 'submitted');
  return { kind: (started ? 'in_progress' : 'not_started') as SummaryKind, done, total: seq.length, next };
}

const TONE: Record<SummaryKind, string> = {
  not_started: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-amber-100 text-amber-800',
  step_done: 'bg-sky-100 text-sky-800',
  completed: 'bg-emerald-100 text-emerald-700',
  finalized: 'bg-navy-900 text-white',
};

/** 한 줄 요약 배지: "1단계 완료" 등 + 다음 단계 안내 */
export function ProgressSummary({ e, t }: { e: ProgressRow; t: TFn }) {
  const s = progressSummary(e);
  const label = s.kind === 'step_done' ? t('dashboard.summary.stepDone', { n: s.done })
    : s.kind === 'in_progress' ? t('dashboard.summary.stepInProgress', { n: 1 })
      : t(`dashboard.summary.${s.kind}`);
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cx('inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold', TONE[s.kind])}>{label}</span>
      {s.next && s.kind === 'step_done' && <span className="text-[11px] text-slate-400">{t('dashboard.summary.next', { stage: t(`stage.${s.next}`) })}</span>}
    </div>
  );
}

/** 단계 칩: ① 자기 ✓ → ② 팀장 … → ③ 임원 */
export function StageSteps({ e, t }: { e: ProgressRow; t: TFn }) {
  const seq = stageSequence(e);
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label={t('dashboard.steps')}>
      {seq.map((s, i) => {
        const st = e.stages[s];
        const cls = st === 'submitted' ? 'border-emerald-500 bg-emerald-500 text-white'
          : st === 'in_progress' ? 'border-amber-400 bg-amber-50 text-amber-800'
            : st === 'unassigned' ? 'border-red-300 bg-red-50 text-red-600'
              : 'border-slate-200 bg-white text-slate-500';
        return (
          <li key={s} className="flex items-center gap-1">
            {i > 0 && <span className={cx('h-px w-3', e.stages[seq[i - 1]] === 'submitted' ? 'bg-emerald-400' : 'bg-slate-200')} aria-hidden />}
            <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', cls)}
              title={`${i + 1}. ${t(`stage.${s}`)} · ${t(`stageState.${st}`)}`}>
              <b>{i + 1}</b>{t(`dashboard.stageShort.${s}`)}
              {st === 'submitted' && <Check className="h-3 w-3" />}
              {st === 'in_progress' && <Loader2 className="h-3 w-3" />}
              {st === 'unassigned' && <UserX className="h-3 w-3" />}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
