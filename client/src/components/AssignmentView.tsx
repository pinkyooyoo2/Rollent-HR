import { useCallback, useEffect, useState } from 'react';
import { Save, Send, Info, Lock, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useToast } from './Toast';
import { Badge, Button, ConfirmDialog, ErrorState, Spinner } from './ui';
import EvaluationForm, { type Answer } from './EvaluationForm';
import { fmtDate, fmtScore } from '../lib/status';

export default function AssignmentView({ id, onDone, compact }: { id: number; onDone?: () => void; compact?: boolean }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [d, setD] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [missing, setMissing] = useState<Set<number>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'submit' | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  const load = useCallback(() => {
    setError('');
    api.get(`/assignments/${id}`).then((x) => { setD(x); setAnswers(x.answers ?? {}); setDirty(false); setMissing(new Set()); })
      .catch((e) => setError(errorMessage(t, e)));
  }, [id, t]);
  useEffect(() => { load(); }, [load]);

  const send = async (submit: boolean) => {
    const clean = Object.fromEntries(Object.entries(answers).filter(([, a]) => a && Object.values(a).some((v) => v !== undefined && v !== '')));
    if (submit && d?.form) {
      const miss = new Set<number>();
      for (const s of d.form.sections) for (const q of s.questions) {
        const a = clean[q.id] as Answer | undefined;
        const ok = !q.required || (a && (
          q.type === 'short_text' || q.type === 'long_text' ? !!a.text?.trim()
            : q.type === 'checkbox' ? (a.optionIds?.length ?? 0) > 0
              : q.type === 'linear_scale' ? typeof a.value === 'number'
                : q.type === 'descriptive' ? !!a.text?.trim() && typeof a.optionId === 'number'
                  : typeof a.optionId === 'number'));
        if (!ok) miss.add(q.id);
      }
      setMissing(miss);
      if (miss.size) {
        toast('error', t('form.missingN', { n: miss.size }));
        document.getElementById(`q-${[...miss][0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    setBusy(submit ? 'submit' : 'save');
    try {
      await api.put(`/assignments/${id}/responses`, { answers: clean, submit });
      toast('success', submit ? t('form.submitted') : t('form.draftSaved'));
      setDirty(false);
      if (submit) { onDone?.(); load(); }
      else load();
    } catch (e: any) {
      if (e.code === 'REQUIRED_MISSING') setMissing(new Set(e.details?.questionIds ?? []));
      toast('error', errorMessage(t, e));
    } finally { setBusy(null); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!d) return <Spinner />;
  const a = d.assignment;
  const canEdit = d.access.canEdit;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <div><div className="text-xs text-slate-500">{t('common.round')}</div><div className="font-semibold">{a.round_name}</div></div>
        <div><div className="text-xs text-slate-500">{t('my.target')}</div><div className="font-semibold">{a.target_name} <span className="text-xs font-normal text-slate-400">{a.target_emp_no} · {a.target_department ?? '–'}</span></div></div>
        <div><div className="text-xs text-slate-500">{t('my.stage')}</div><Badge color="blue">{t(`stage.${a.stage}`)}</Badge></div>
        <div><div className="text-xs text-slate-500">{t('my.evaluator')}</div><div>{a.evaluator_name ?? '–'}</div></div>
        <div><div className="text-xs text-slate-500">{t('common.status')}</div><Badge color={a.status === 'submitted' ? 'green' : a.status === 'in_progress' ? 'amber' : 'slate'}>{t(`stageState.${a.status}`)}</Badge></div>
        {a.submitted_at && <div><div className="text-xs text-slate-500">{t('my.submittedAt')}</div><div>{fmtDate(a.submitted_at, locale, true)}</div></div>}
        {d.score && <div><div className="text-xs text-slate-500">{t('my.score')}</div><div className="font-bold text-brand-700">{fmtScore(d.score.normalized_score)}</div></div>}
      </div>
      {d.access.proxy && <div className="flex items-start gap-2 rounded-lg bg-violet-50 p-3 text-sm text-violet-800"><Info className="mt-0.5 h-4 w-4 shrink-0" />{t('my.proxyNote')}</div>}
      {!canEdit && d.access.blockReason && a.status !== 'submitted' && (
        <div className="flex items-start gap-2 rounded-lg bg-slate-100 p-3 text-sm text-slate-600"><Lock className="mt-0.5 h-4 w-4 shrink-0" />{t(`my.block.${d.access.blockReason}`)}</div>
      )}
      {d.selfNarrative && (
        <div className="rounded-lg border border-teal-200 bg-cyan-50/50 p-4 text-sm">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-teal-600"><FileText className="h-4 w-4" />{t('my.selfNarrativeRef')}</div>
          <p className="whitespace-pre-wrap text-slate-700">{d.selfNarrative}</p>
        </div>
      )}
      {!d.form ? <ErrorState message={t('errors.NO_PUBLISHED_FORM')} /> : (
        <EvaluationForm sections={d.form.sections} answers={answers} readOnly={!canEdit} missing={missing}
          onChange={(qid, v) => { setAnswers((x) => ({ ...x, [qid]: v as Answer })); setDirty(true); if (missing.has(qid)) { const m = new Set(missing); m.delete(qid); setMissing(m); } }} />
      )}
      {canEdit && d.form && (
        <div className={compact ? 'flex justify-end gap-2' : 'sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6'}>
          {dirty && <span className="mr-auto self-center text-xs text-amber-600">● {t('csv.unsaved')}</span>}
          <Button variant="secondary" loading={busy === 'save'} icon={<Save className="h-4 w-4" />} onClick={() => send(false)}>{t('form.saveDraft')}</Button>
          <Button loading={busy === 'submit'} icon={<Send className="h-4 w-4" />} onClick={() => setConfirmSubmit(true)}>{t('form.submit')}</Button>
        </div>
      )}
      <ConfirmDialog open={confirmSubmit} onClose={() => setConfirmSubmit(false)} title={t('form.submitTitle')} message={t('form.submitMsg')} confirmLabel={t('form.submit')}
        onConfirm={() => send(true)} />
    </div>
  );
}
