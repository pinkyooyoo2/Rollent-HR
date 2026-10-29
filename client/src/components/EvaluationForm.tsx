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
                {o.label}{q.scored && <span className={cx('ml-1 text-[10px] font-normal', on ? 'text-white/80' : 'text-slate-400')}>{o.score}</span>}
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

export default function EvaluationForm({ sections, answers, onChange, readOnly, missing }:
  { sections: Section[]; answers: Record<number, Answer>; onChange?: (qid: number, a: Answer | undefined) => void; readOnly?: boolean; missing?: Set<number> }) {
  const { t } = useI18n();
  let n = 0;
  return (
    <div className="space-y-5">
      {sections.map((s) => {
        const secPts = s.questions.filter((q) => q.scored).reduce((a, q) => a + q.points, 0);
        return (
          <section key={s.id} className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-brand-50 to-white px-5 py-3">
              <div>
                <h3 className="font-semibold text-navy-900">{s.title}</h3>
                {s.description && <p className="text-xs text-slate-500">{s.description}</p>}
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
                      {q.scored ? <Badge color="teal">{t('form.points', { n: pts(q.points) })}</Badge> : <Badge>{t('form.notScored')}</Badge>}
                    </div>
                    {q.description && <p className="mb-2 text-xs text-slate-500">{q.description}</p>}
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
