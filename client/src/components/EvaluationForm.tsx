import { useI18n } from '../i18n';
import { Badge, cx } from './ui';

export interface Option { id: number; label: string; score: number }
export interface Question {
  id: number; type: string; text: string; description?: string | null; required: boolean; points: number; scored: boolean;
  settings?: { min?: number; max?: number; minLabel?: string; maxLabel?: string } | null; is_sample?: boolean; is_suggestion?: boolean; options: Option[];
}
export interface Section { id: number; title: string; description?: string | null; questions: Question[] }
export interface Answer { text?: string; optionId?: number; optionIds?: number[]; value?: number }

const pts = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * 등급 배점 문구 제거 (상단 A~E 안내와 중복): "A: 5점, B: 4점 …", "A(5) B(4) …", "(A~E 5단계)".
 * 섹션 설명이 "배점 8점 (A~E 5단계)" 뿐이면 섹션 배점 배지와 같으므로 통째로 숨김. 저장된 양식 데이터는 바꾸지 않음
 */
const GRADE_TEXT = /\s*[(\[]?\s*A\s*[:=(]\s*\d+(?:\.\d+)?\s*점?\s*\)?(?:\s*[,/·|]?\s*[B-E]\s*[:=(]\s*\d+(?:\.\d+)?\s*점?\s*\)?)+\s*[)\]]?/g;
const GRADE_RANGE = /\s*\(?\s*A\s*[~∼-]\s*E\s*\d*\s*단계\s*\)?/g;
export const stripGrades = (text?: string | null) => {
  const s = (text ?? '').trim();
  if (/^배점\s*[\d.]+\s*점\s*\(\s*A\s*[~∼-]\s*E[^)]*\)$/.test(s)) return '';
  return s.replace(GRADE_TEXT, ' ').replace(GRADE_RANGE, '').replace(/\s*[·,]\s*$/, '').trim();
};

export function QuestionInput({ q, value, onChange, readOnly }: { q: Question; value?: Answer; onChange?: (a: Answer | undefined) => void; readOnly?: boolean }) {
  const { t } = useI18n();
  const set = (a: Answer) => onChange?.(a);
  const name = `q-${q.id}`;
  switch (q.type) {
    case 'short_text':
      return <input className="input" disabled={readOnly} value={value?.text ?? ''} maxLength={500} onChange={(e) => set({ text: e.target.value })} placeholder={t('form.shortAnswer')} />;
    case 'long_text':
      return <textarea className="input" rows={4} disabled={readOnly} value={value?.text ?? ''} maxLength={10000} onChange={(e) => set({ text: e.target.value })} placeholder={t('form.longAnswer')} />;
    case 'single_choice':
      return (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {q.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="radio" name={name} disabled={readOnly} checked={value?.optionId === o.id} onChange={() => set({ optionId: o.id })} />{o.label}
            </label>
          ))}
        </div>
      );
    case 'checkbox': {
      const sel = value?.optionIds ?? [];
      return (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {q.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={readOnly} checked={sel.includes(o.id)}
                onChange={(e) => set({ optionIds: e.target.checked ? [...sel, o.id] : sel.filter((x) => x !== o.id) })} />{o.label}
            </label>
          ))}
        </div>
      );
    }
    case 'dropdown':
      return (
        <select className="input max-w-sm" disabled={readOnly} value={value?.optionId ?? ''} onChange={(e) => (e.target.value ? set({ optionId: Number(e.target.value) }) : onChange?.(undefined))}>
          <option value="">{t('form.select')}</option>
          {q.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      );
    case 'score_scale':
    case 'descriptive': {
      const grades = (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.text}>
          {q.options.map((o) => {
            const on = value?.optionId === o.id;
            return (
              <button key={o.id} type="button" role="radio" aria-checked={on} disabled={readOnly}
                onClick={() => set({ ...value, optionId: o.id })}
                className={cx('min-w-[52px] rounded-lg border px-3 py-1.5 text-sm font-semibold transition',
                  on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-brand-500', readOnly && !on && 'opacity-50')}>
                {o.label}
              </button>
            );
          })}
        </div>
      );
      if (q.type === 'score_scale') return grades;
      return (
        <div className="space-y-2">
          <textarea className="input" rows={4} disabled={readOnly} value={value?.text ?? ''} maxLength={10000} onChange={(e) => set({ ...value, text: e.target.value })} placeholder={t('form.descriptivePlaceholder')} />
          <div className="flex items-center gap-2 text-xs text-slate-500">{t('form.grade')}: {grades}</div>
        </div>
      );
    }
    case 'linear_scale': {
      const min = q.settings?.min ?? 1;
      const max = q.settings?.max ?? 5;
      const nums = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          {q.settings?.minLabel && <span>{q.settings.minLabel}</span>}
          {nums.map((n) => (
            <label key={n} className="flex flex-col items-center gap-1">
              <span>{n}</span>
              <input type="radio" name={name} disabled={readOnly} checked={value?.value === n} onChange={() => set({ value: n })} />
            </label>
          ))}
          {q.settings?.maxLabel && <span>{q.settings.maxLabel}</span>}
        </div>
      );
    }
    default:
      return null;
  }
}

/**
 * A~E 등급 배점 기준: 양식에 실제 설정된 등급형 문항(점수척도형·서술형평가)의 선택지 점수를 그대로 사용.
 * 문항마다 다르면 가장 많이 쓰인 기준을 표시. 관리자가 선택지 점수를 바꾸면 자동으로 바뀜 (점수 계산 로직은 그대로)
 */
export function gradeScale(sections: Section[]): Option[] {
  const tally = new Map<string, { opts: Option[]; n: number }>();
  for (const s of sections) {
    for (const q of s.questions) {
      if (!['score_scale', 'descriptive'].includes(q.type) || !q.scored || !q.options.length) continue;
      const key = q.options.map((o) => `${o.label}:${o.score}`).join('|');
      const cur = tally.get(key) ?? { opts: q.options, n: 0 };
      cur.n++;
      tally.set(key, cur);
    }
  }
  return [...tally.values()].sort((a, b) => b.n - a.n)[0]?.opts ?? [];
}

export function GradeLegend({ sections }: { sections: Section[] }) {
  const { t } = useI18n();
  const grades = gradeScale(sections);
  if (!grades.length) return null;
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 px-5 py-3.5" data-testid="grade-legend">
      <div className="text-sm font-semibold text-navy-900">{t('form.gradeScale')}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {grades.map((o) => (
          <span key={o.id} className="rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-700">
            {t('form.gradeItem', { label: o.label, score: pts(o.score) })}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function EvaluationForm({ sections, answers, onChange, readOnly, missing }:
  { sections: Section[]; answers: Record<number, Answer>; onChange?: (qid: number, a: Answer | undefined) => void; readOnly?: boolean; missing?: Set<number> }) {
  const { t } = useI18n();
  let n = 0;
  return (
    <div className="space-y-5">
      <GradeLegend sections={sections} />
      {sections.map((s) => {
        const secPts = s.questions.filter((q) => q.scored).reduce((a, q) => a + q.points, 0);
        return (
          <section key={s.id} className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-50 to-white px-5 py-3">
              <div>
                <h3 className="font-semibold text-navy-900">{s.title}</h3>
                {stripGrades(s.description) && <p className="text-xs text-slate-500">{stripGrades(s.description)}</p>}
              </div>
              {secPts > 0 && <Badge color="blue">{t('form.sectionPoints', { n: pts(secPts) })}</Badge>}
            </header>
            <ol className="divide-y divide-slate-100">
              {s.questions.map((q) => {
                n++;
                const miss = missing?.has(q.id);
                return (
                  <li key={q.id} id={`q-${q.id}`} className={cx('px-5 py-4', miss && 'bg-red-50')}>
                    <div className="mb-2 flex flex-wrap items-start gap-2">
                      <span className="text-xs font-semibold text-slate-400">{n}.</span>
                      <span className="flex-1 text-sm font-medium text-slate-800">{q.text}{q.required && <span className="text-red-500"> *</span>}</span>
                      {q.is_sample && <Badge color="violet">{t('form.sample')}</Badge>}
                    </div>
                    {stripGrades(q.description) && <p className="mb-2 text-xs text-slate-500">{stripGrades(q.description)}</p>}
                    <QuestionInput q={q} value={answers[q.id]} readOnly={readOnly} onChange={(a) => onChange?.(q.id, a)} />
                    {miss && <p className="mt-1 text-xs text-red-600">{t('form.requiredMissing')}</p>}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
