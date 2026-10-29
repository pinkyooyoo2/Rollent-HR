import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, PlayCircle, StopCircle, RotateCcw, Wand2, UserPlus, UserMinus, Eye, Undo2, CheckSquare, Settings2, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, ProgressBar, SearchInput, Spinner, Tabs, cx } from '../components/ui';
import AssignmentView from '../components/AssignmentView';
import EvaluationForm from '../components/EvaluationForm';
import { StageBadge, STAGES, fmtDate, JOB_GROUPS, type Stage, posLabel } from '../lib/status';

type Tab = 'progress' | 'preview' | 'logs';

export default function AdminEvalPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('progress');
  return (
    <div>
      <PageHeader title={t('nav.adminEval')} description={t('admin.description')} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'progress', label: t('admin.tab.progress') }, { id: 'preview', label: t('admin.tab.preview') },
        ...(can('logs.view') ? [{ id: 'logs' as Tab, label: t('admin.tab.logs') }] : []),
      ]} />
      {tab === 'progress' && <RoundManager />}
      {tab === 'preview' && <FormPreviewTab />}
      {tab === 'logs' && <LogsTab />}
    </div>
  );
}

const stageColor = { pending: 'slate', open: 'green', closed: 'red' } as const;

function RoundManager() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [rounds, setRounds] = useState<any[] | null>(null);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [prog, setProg] = useState<{ round: any; items: any[] } | null>(null);
  const [error, setError] = useState('');
  const [editRound, setEditRound] = useState<any | null>(null);
  const [delRound, setDelRound] = useState(false);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const [stageFilter, setStageFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [assignEdit, setAssignEdit] = useState<{ target: any; stage: Stage } | null>(null);
  const [upwardTarget, setUpwardTarget] = useState<any | null>(null);
  const [viewAssign, setViewAssign] = useState<number | null>(null);
  const [reopen, setReopen] = useState<number | null>(null);
  const [forceClose, setForceClose] = useState<number | null>(null);
  const [addTargets, setAddTargets] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<any | null>(null);
  const [autoAssign, setAutoAssign] = useState(false);
  const manage = can('rounds.manage');

  const loadRounds = useCallback((select?: number) => {
    api.get('/rounds').then((r) => {
      setRounds(r.items);
      setRoundId((cur) => select ?? (cur && r.items.some((x: any) => x.id === cur) ? cur : r.items.find((x: any) => x.status === 'open')?.id ?? r.items[0]?.id ?? null));
    }).catch((e) => setError(errorMessage(t, e)));
  }, [t]);
  const loadProg = useCallback(() => {
    if (!roundId) { setProg(null); return; }
    api.get(`/rounds/${roundId}/progress`).then(setProg).catch((e) => setError(errorMessage(t, e)));
  }, [roundId, t]);
  useEffect(() => { loadRounds(); }, [loadRounds]);
  useEffect(() => { loadProg(); }, [loadProg]);
  useEffect(() => setPage(1), [q, dept, onlyPending, stageFilter, roundId]);

  const reload = () => { loadRounds(); loadProg(); };
  const call = async (fn: () => Promise<unknown>, msg = t('common.saved')) => {
    try { await fn(); toast('success', msg); reload(); } catch (e) { toast('error', errorMessage(t, e)); throw e; }
  };

  const items = prog?.items ?? [];
  const depts = useMemo(() => [...new Map(items.map((i) => [i.department_id, i.department_name])).entries()], [items]);
  const filtered = items.filter((i) =>
    (!q || i.name.includes(q) || i.emp_no.includes(q) || (i.department_name ?? '').includes(q))
    && (!dept || String(i.department_id) === dept)
    && (!onlyPending || STAGES.some((s) => !['na', 'submitted'].includes(i.stages[s].state)))
    && (!stageFilter || (() => { const [s, st] = stageFilter.split(':'); return i.stages[s].state === st || (st === 'pending' && !['na', 'submitted'].includes(i.stages[s].state)); })()));
  const stageStats = STAGES.map((s) => {
    const req = items.filter((i) => i.stages[s].state !== 'na');
    return { stage: s, total: req.length, done: req.filter((i) => i.stages[s].state === 'submitted').length, unassigned: req.filter((i) => i.stages[s].state === 'unassigned').length };
  });

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!rounds) return <Spinner />;
  const r = prog?.round;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input !w-auto" value={roundId ?? ''} onChange={(e) => setRoundId(Number(e.target.value))} aria-label={t('common.round')}>
          {rounds.map((x) => <option key={x.id} value={x.id}>{x.name} ({t(`roundStatus.${x.status}`)})</option>)}
        </select>
        {manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditRound({})}>{t('admin.newRound')}</Button>}
      </div>
      {rounds.length === 0 ? <Card><EmptyState title={t('dashboard.noRound')} /></Card> : !r ? <Spinner /> : <>
        <Card title={<span className="flex items-center gap-2">{r.name}<Badge color={r.status === 'open' ? 'green' : r.status === 'closed' ? 'red' : 'slate'}>{t(`roundStatus.${r.status}`)}</Badge></span>}
          actions={manage && <>
            <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditRound(r)}>{t('common.edit')}</Button>
            {r.status !== 'open' && <Button size="sm" variant="teal" icon={r.status === 'closed' ? <RotateCcw className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
              onClick={() => call(() => api.post(`/rounds/${r.id}/status`, { status: 'open' }))}>{r.status === 'closed' ? t('admin.reopenRound') : t('admin.startRound')}</Button>}
            {r.status === 'open' && <Button size="sm" variant="danger" icon={<StopCircle className="h-3.5 w-3.5" />} onClick={() => call(() => api.post(`/rounds/${r.id}/status`, { status: 'closed' }))}>{t('admin.closeRound')}</Button>}
            <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />} onClick={() => setDelRound(true)}>{t('common.delete')}</Button>
          </>}>
          <div className="grid gap-4 lg:grid-cols-4">
            <div className="space-y-1 text-sm">
              <div><span className="text-slate-500">{t('admin.evalPeriod')}:</span> {r.start_date} ~ {r.end_date}</div>
              <div><span className="text-slate-500">{t('admin.targetPeriod')}:</span> {r.period_start ?? '–'} ~ {r.period_end ?? '–'}</div>
              <div><span className="text-slate-500">{t('admin.targets')}:</span> {items.length}</div>
              <label className="flex items-center gap-2 pt-1 text-xs">
                <input type="checkbox" disabled={!manage} checked={!!r.enforce_sequence} onChange={(e) => call(() => api.post(`/rounds/${r.id}/policy`, { enforce_sequence: e.target.checked }))} />
                {t('admin.enforceSequence')}
              </label>
            </div>
            {stageStats.map((s) => (
              <div key={s.stage} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{t(`stage.${s.stage}`)}</span>
                  <Badge color={stageColor[r[`${s.stage}_status`] as keyof typeof stageColor]}>{t(`stageStatus.${r[`${s.stage}_status`]}`)}</Badge>
                </div>
                <div className="mt-2 flex items-baseline justify-between text-xs text-slate-500">
                  <span>{t('admin.submittedOf', { done: s.done, total: s.total })}</span>
                  <span className="font-semibold text-navy-900">{s.total ? Math.round((s.done / s.total) * 100) : 0}%</span>
                </div>
                <ProgressBar value={s.total ? (s.done / s.total) * 100 : 0} className="mt-1" color="bg-teal-500" />
                {s.unassigned > 0 && <div className="mt-1 text-[11px] text-red-600">{t('admin.unassignedN', { n: s.unassigned })}</div>}
                {manage && (
                  <div className="mt-2 flex gap-1">
                    {(['pending', 'open', 'closed'] as const).map((st) => (
                      <button key={st} disabled={r[`${s.stage}_status`] === st} onClick={() => call(() => api.post(`/rounds/${r.id}/stage`, { stage: s.stage, status: st }))}
                        className={cx('flex-1 rounded border px-1 py-1 text-[11px]', r[`${s.stage}_status`] === st ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 hover:bg-slate-50')}>
                        {t(`stageAction.${st}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card title={t('admin.targetList')} bodyClass="p-0" actions={manage && <>
          <Button size="sm" variant="secondary" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setAddTargets(true)}>{t('admin.addTargets')}</Button>
          <Button size="sm" variant="secondary" icon={<Wand2 className="h-3.5 w-3.5" />} onClick={() => setAutoAssign(true)}>{t('admin.autoAssign')}</Button>
        </>}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <SearchInput value={q} onChange={setQ} placeholder={t('dashboard.searchPlaceholder')} />
            <select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">{t('common.allDepartments')}</option>{depts.map(([id, name]) => <option key={String(id)} value={String(id)}>{name}</option>)}
            </select>
            <select className="input !w-auto" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
              <option value="">{t('admin.allStageStates')}</option>
              {STAGES.map((s) => ['pending', 'submitted', 'unassigned'].map((st) => <option key={`${s}:${st}`} value={`${s}:${st}`}>{t(`stage.${s}`)} · {t(`admin.stageFilter.${st}`)}</option>))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} />{t('admin.onlyPending')}</label>
          </div>
          {filtered.length === 0 ? <EmptyState /> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>
                  <th className="th">{t('common.employeeName')}</th><th className="th">{t('common.department')}</th><th className="th">{t('admin.jobGroup')}</th>
                  {STAGES.map((s) => <th key={s} className="th min-w-[190px]">{t(`stage.${s}`)}</th>)}
                  {manage && <th className="th" />}
                </tr></thead>
                <tbody>
                  {filtered.slice((page - 1) * pageSize, page * pageSize).map((i) => (
                    <tr key={i.employee_id} className="align-top hover:bg-slate-50">
                      <td className="td"><div className="font-medium">{i.name}</div><div className="text-xs text-slate-400">{i.emp_no}</div></td>
                      <td className="td whitespace-nowrap">{i.department_name ?? '–'}</td>
                      <td className="td text-xs">{t(`jobGroupFull.${i.job_group}`)}<div className="text-slate-400">{i.weights.self}/{i.weights.leader}/{i.weights.exec}/{i.weights.upward}</div></td>
                      {STAGES.map((s) => {
                        const st = i.stages[s];
                        if (s === 'upward') {
                          // 팀원→팀장평가: 평가자 여러 명 → 제출 수 + 평가자 관리
                          return (
                            <td key={s} className="td">
                              <StageBadge state={st.state} t={t} />
                              {st.state !== 'na' && (
                                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                                  <span>{t('admin.upwardCount', { done: st.submitted_count ?? 0, total: st.total_count ?? 0 })}</span>
                                  <button className="text-brand-600 hover:underline" onClick={() => setUpwardTarget(i)}>{t('admin.upwardManage')}</button>
                                </div>
                              )}
                            </td>
                          );
                        }
                        return (
                          <td key={s} className="td">
                            <StageBadge state={st.state} t={t} />
                            {st.state !== 'na' && (
                              <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                                <span>{st.evaluator_name ?? t('admin.noEvaluator')}</span>
                                {manage && st.state !== 'submitted' && <button className="text-brand-600 hover:underline" onClick={() => setAssignEdit({ target: i, stage: s })}>{t('admin.change')}</button>}
                              </div>
                            )}
                            {st.assignment_id && st.state !== 'na' && st.evaluator_id && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                <button className="inline-flex items-center gap-0.5 text-xs text-slate-600 hover:text-brand-600" onClick={() => setViewAssign(st.assignment_id)}><Eye className="h-3 w-3" />{t('admin.open')}</button>
                                {manage && st.state === 'submitted' && <button className="inline-flex items-center gap-0.5 text-xs text-amber-600 hover:underline" onClick={() => setReopen(st.assignment_id)}><Undo2 className="h-3 w-3" />{t('admin.reopen')}</button>}
                                {manage && st.state === 'in_progress' && <button className="inline-flex items-center gap-0.5 text-xs text-teal-600 hover:underline" onClick={() => setForceClose(st.assignment_id)}><CheckSquare className="h-3 w-3" />{t('admin.forceClose')}</button>}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      {manage && <td className="td"><button className="text-slate-400 hover:text-red-600" title={t('admin.removeTarget')} aria-label={t('admin.removeTarget')} onClick={() => setRemoveTarget(i)}><UserMinus className="h-4 w-4" /></button></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-4 pb-3"><Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} /></div>
        </Card>
      </>}

      {editRound && <RoundModal round={editRound} rounds={rounds} onClose={() => setEditRound(null)} onSaved={(id) => { setEditRound(null); loadRounds(id); }} />}
      {assignEdit && <EvaluatorModal roundId={roundId!} target={assignEdit.target} stage={assignEdit.stage} onClose={() => setAssignEdit(null)} onSaved={() => { setAssignEdit(null); loadProg(); }} />}
      {upwardTarget && roundId && <UpwardModal roundId={roundId} target={upwardTarget} manage={manage} onView={setViewAssign} onReopen={setReopen}
        onClose={() => { setUpwardTarget(null); loadProg(); }} />}
      {viewAssign && <Modal open size="xl" onClose={() => { setViewAssign(null); loadProg(); }} title={t('admin.assignmentDetail')}><AssignmentView id={viewAssign} compact onDone={loadProg} /></Modal>}
      {addTargets && roundId && <AddTargetsModal roundId={roundId} existing={items.map((i) => i.employee_id)} onClose={() => setAddTargets(false)} onSaved={() => { setAddTargets(false); loadProg(); }} />}
      <ConfirmDialog open={delRound} danger onClose={() => setDelRound(false)} title={t('admin.deleteRoundTitle')} message={t('admin.deleteRoundMsg', { name: r?.name ?? '' })} confirmLabel={t('common.delete')}
        onConfirm={() => call(async () => { await api.del(`/rounds/${r.id}`); setRoundId(null); }, t('common.deleted'))} />
      <ConfirmDialog open={!!reopen} onClose={() => setReopen(null)} title={t('admin.reopenTitle')} message={t('admin.reopenMsg')} requireReason confirmLabel={t('admin.reopen')}
        onConfirm={(reason) => call(() => api.post(`/assignments/${reopen}/reopen`, { reason }))} />
      <ConfirmDialog open={!!forceClose} onClose={() => setForceClose(null)} title={t('admin.forceCloseTitle')} message={t('admin.forceCloseMsg')} confirmLabel={t('admin.forceClose')}
        onConfirm={() => call(() => api.post(`/assignments/${forceClose}/close`))} />
      <ConfirmDialog open={!!removeTarget} danger onClose={() => setRemoveTarget(null)} title={t('admin.removeTarget')} message={t('admin.removeTargetMsg', { name: removeTarget?.name ?? '' })}
        onConfirm={() => call(() => api.del(`/rounds/${roundId}/targets/${removeTarget.employee_id}`))} />
      <AutoAssignDialog open={autoAssign} onClose={() => setAutoAssign(false)} onRun={(overwrite) => call(async () => {
        const res = await api.post(`/rounds/${roundId}/auto-assign`, { overwrite });
        toast('info', t('admin.autoAssignResult', { c: res.created, u: res.updated }));
      })} />
    </div>
  );
}

function AutoAssignDialog({ open, onClose, onRun }: { open: boolean; onClose: () => void; onRun: (overwrite: boolean) => Promise<void> }) {
  const { t } = useI18n();
  const [overwrite, setOverwrite] = useState(false);
  return (
    <ConfirmDialog open={open} onClose={onClose} title={t('admin.autoAssign')} confirmLabel={t('admin.run')} onConfirm={() => onRun(overwrite)}
      message={<div className="space-y-3"><p>{t('admin.autoAssignDesc')}</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />{t('admin.overwriteAssign')}</label></div>} />
  );
}

function RoundModal({ round, rounds, onClose, onSaved }: { round: any; rounds: any[]; onClose: () => void; onSaved: (id: number) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const y = new Date().getFullYear();
  const [f, setF] = useState({
    name: round.name ?? `${y}년 정기 인사평가`, year: round.year ?? y, period_start: round.period_start ?? `${y}-01-01`, period_end: round.period_end ?? `${y}-12-31`,
    start_date: round.start_date ?? '', end_date: round.end_date ?? '', enforce_sequence: round.id ? !!round.enforce_sequence : true,
    upward_enabled: round.id ? !!round.upward_enabled : true,
    self_end_date: round.self_end_date ?? '', leader_end_date: round.leader_end_date ?? '', exec_end_date: round.exec_end_date ?? '', upward_end_date: round.upward_end_date ?? '',
  });
  const [autoTargets, setAutoTargets] = useState(true);
  const [copyFrom, setCopyFrom] = useState<number | ''>('');
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = t('validation.required');
    if (!f.start_date) e.start_date = t('validation.required');
    if (!f.end_date) e.end_date = t('validation.required');
    if (f.start_date && f.end_date && f.start_date > f.end_date) e.end_date = t('validation.endBeforeStart');
    for (const s of STAGES) {
      const v = f[`${s}_end_date` as const];
      if (v && f.start_date && v < f.start_date) e[`${s}_end_date`] = t('validation.endBeforeStart');
    }
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = {
        ...f, year: Number(f.year), period_start: f.period_start || null, period_end: f.period_end || null,
        ...Object.fromEntries(STAGES.map((s) => [`${s}_end_date`, f[`${s}_end_date` as const] || null])),
      };
      const r = round.id ? await api.put(`/rounds/${round.id}`, body) : await api.post('/rounds', { ...body, autoTargets, copyWeightsFrom: copyFrom || undefined });
      toast('success', t('common.saved'));
      onSaved(r.id);
    } catch (err) { toast('error', errorMessage(t, err)); } finally { setBusy(false); }
  };
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  return (
    <Modal open onClose={onClose} title={round.id ? t('admin.editRound') : t('admin.newRound')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={save}>{t('common.save')}</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label={t('admin.roundName')} required error={errs.name}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field></div>
        <Field label={t('admin.year')} required><input type="number" className="input" value={f.year} onChange={(e) => set('year', e.target.value)} /></Field>
        <div />
        <Field label={t('admin.startDate')} required error={errs.start_date}><input type="date" className="input" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
        <Field label={t('admin.endDate')} required error={errs.end_date}><input type="date" className="input" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field>
        <Field label={t('admin.periodStart')}><input type="date" className="input" value={f.period_start} onChange={(e) => set('period_start', e.target.value)} /></Field>
        <Field label={t('admin.periodEnd')}><input type="date" className="input" value={f.period_end} onChange={(e) => set('period_end', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.enforce_sequence} onChange={(e) => set('enforce_sequence', e.target.checked)} />{t('admin.enforceSequence')}</label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.upward_enabled} onChange={(e) => set('upward_enabled', e.target.checked)} />{t('admin.upwardEnabled')}</label>
        <div className="rounded-lg border border-slate-200 p-3 sm:col-span-2">
          <div className="mb-2 text-xs font-semibold text-slate-600">{t('admin.stageDeadlines')}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {STAGES.map((s) => (
              <Field key={s} label={t(`stage.${s}`)} error={errs[`${s}_end_date`]}>
                <input type="date" className="input" value={f[`${s}_end_date` as const]} placeholder={f.end_date} onChange={(e) => set(`${s}_end_date`, e.target.value)} />
              </Field>
            ))}
          </div>
        </div>
        {!round.id && <>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={autoTargets} onChange={(e) => setAutoTargets(e.target.checked)} />{t('admin.autoTargets')}</label>
          <div className="sm:col-span-2"><Field label={t('admin.copyWeights')}>
            <select className="input" value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value) || '')}>
              <option value="">{t('admin.templateWeights')}</option>{rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field></div>
        </>}
      </div>
    </Modal>
  );
}

/** 팀원→팀장평가 평가자 관리: 대상 팀장 1명에 대한 팀원 평가자 목록 (추가/제외/열람/재오픈) */
function UpwardModal({ roundId, target, manage, onView, onReopen, onClose }:
  { roundId: number; target: any; manage: boolean; onView: (id: number) => void; onReopen: (id: number) => void; onClose: () => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<any[] | null>(null);
  const [emps, setEmps] = useState<any[]>([]);
  const [add, setAdd] = useState<number | ''>('');
  const load = useCallback(() => {
    api.get(`/rounds/${roundId}/upward/${target.employee_id}`).then((r) => setItems(r.items)).catch((e) => toast('error', errorMessage(t, e)));
  }, [roundId, target.employee_id, t, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (manage) api.get('/employees?all=1').then((r) => setEmps(r.items)).catch(() => undefined); }, [manage]);
  const call = async (fn: () => Promise<unknown>) => {
    try { await fn(); toast('success', t('common.saved')); load(); } catch (e) { toast('error', errorMessage(t, e)); }
  };
  const taken = new Set((items ?? []).map((i) => i.evaluator_employee_id));
  const cand = emps.filter((e) => e.id !== target.employee_id && !taken.has(e.id) && !e.is_executive && e.status !== 'resigned');
  return (
    <Modal open onClose={onClose} size="lg" title={t('admin.upwardTitle', { name: target.name })}>
      <p className="mb-3 text-xs text-slate-500">{t('admin.upwardDesc')}</p>
      {!items ? <Spinner /> : items.length === 0 ? <EmptyState title={t('admin.noEvaluator')} /> : (
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr><th className="th">{t('admin.evaluator')}</th><th className="th">{t('common.status')}</th><th className="th">{t('admin.submittedAt')}</th><th className="th" /></tr></thead>
          <tbody>{items.map((a) => (
            <tr key={a.id}>
              <td className="td"><div className="font-medium">{a.evaluator_name}</div><div className="text-xs text-slate-400">{a.evaluator_department ?? '–'} · {posLabel(t, a.evaluator_position)}</div></td>
              <td className="td"><StageBadge state={a.status} t={t} /></td>
              <td className="td text-xs text-slate-500">{fmtDate(a.submitted_at ?? a.last_saved_at, locale, true)}</td>
              <td className="td"><div className="flex justify-end gap-2 text-xs">
                {a.status !== 'not_started' && <button className="inline-flex items-center gap-0.5 text-slate-600 hover:text-brand-600" onClick={() => onView(a.id)}><Eye className="h-3 w-3" />{t('admin.open')}</button>}
                {manage && a.status === 'submitted' && <button className="inline-flex items-center gap-0.5 text-amber-600 hover:underline" onClick={() => onReopen(a.id)}><Undo2 className="h-3 w-3" />{t('admin.reopen')}</button>}
                {manage && a.status !== 'submitted' && <button className="inline-flex items-center gap-0.5 text-red-600 hover:underline" onClick={() => call(() => api.del(`/rounds/${roundId}/assignments/${a.id}`))}><UserMinus className="h-3 w-3" />{t('admin.removeEvaluator')}</button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {manage && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          <div className="min-w-[240px] flex-1"><Field label={t('admin.addEvaluator')}>
            <select className="input" value={add} onChange={(e) => setAdd(Number(e.target.value) || '')}>
              <option value="">–</option>
              {cand.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.emp_no}) · {e.department_name ?? '-'} · {posLabel(t, e.position)}</option>)}
            </select>
          </Field></div>
          <Button disabled={!add} icon={<UserPlus className="h-4 w-4" />} onClick={() => call(async () => {
            await api.post(`/rounds/${roundId}/assignments`, { targetEmployeeId: target.employee_id, stage: 'upward', evaluatorEmployeeId: add });
            setAdd('');
          })}>{t('admin.addEvaluator')}</Button>
        </div>
      )}
    </Modal>
  );
}

function EvaluatorModal({ roundId, target, stage, onClose, onSaved }: { roundId: number; target: any; stage: Stage; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [emps, setEmps] = useState<any[]>([]);
  const [sel, setSel] = useState<number | ''>(target.stages[stage].evaluator_id ?? '');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/employees?all=1').then((r) => setEmps(r.items)).catch(() => undefined); }, []);
  const cand = emps.filter((e) => (stage === 'self' ? e.id === target.employee_id : e.id !== target.employee_id))
    .filter((e) => !q || e.name.includes(q) || e.emp_no.includes(q))
    .sort((a, b) => Number(b.is_executive || b.is_leader) - Number(a.is_executive || a.is_leader));
  return (
    <Modal open onClose={onClose} size="sm" title={t('admin.setEvaluator', { stage: t(`stage.${stage}`), name: target.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button loading={busy} onClick={async () => {
        setBusy(true);
        try { await api.post(`/rounds/${roundId}/assignments`, { targetEmployeeId: target.employee_id, stage, evaluatorEmployeeId: sel || null }); toast('success', t('common.saved')); onSaved(); }
        catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(false); }
      }}>{t('common.save')}</Button>
    </>}>
      {target.stages[stage].state === 'in_progress' && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-700">{t('admin.changeEvaluatorWarn')}</p>}
      <div className="relative mb-2"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('org.searchEmp')} /></div>
      <select className="input" size={10} value={sel} onChange={(e) => setSel(Number(e.target.value) || '')}>
        <option value="">{t('admin.noEvaluator')}</option>
        {cand.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.emp_no}) · {e.department_name ?? '-'} · {posLabel(t, e.position)}</option>)}
      </select>
    </Modal>
  );
}

function AddTargetsModal({ roundId, existing, onClose, onSaved }: { roundId: number; existing: number[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [emps, setEmps] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/employees?all=1').then((r) => setEmps(r.items.filter((e: any) => e.status !== 'resigned' && !existing.includes(e.id)))).catch(() => undefined); }, [existing]);
  return (
    <Modal open onClose={onClose} title={t('admin.addTargets')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button loading={busy} disabled={!sel.size} onClick={async () => {
        setBusy(true);
        try { const r = await api.post(`/rounds/${roundId}/targets`, { employeeIds: [...sel] }); toast('success', t('admin.targetsAdded', { n: r.added })); onSaved(); }
        catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(false); }
      }}>{t('admin.addN', { n: sel.size })}</Button>
    </>}>
      {!emps ? <Spinner /> : emps.length === 0 ? <EmptyState title={t('admin.allIncluded')} /> : (
        <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {emps.map((e) => (
            <li key={e.id}><label className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={sel.has(e.id)} onChange={(x) => { const s = new Set(sel); if (x.target.checked) s.add(e.id); else s.delete(e.id); setSel(s); }} />
              <span className="font-medium">{e.name}</span><span className="text-xs text-slate-400">{e.emp_no} · {e.department_name ?? '-'}</span>
            </label></li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function FormPreviewTab() {
  const { t } = useI18n();
  const [stage, setStage] = useState<'self' | 'leader' | 'exec'>('self');
  const [group, setGroup] = useState<string>(JOB_GROUPS[0]);
  const [form, setForm] = useState<any | null | undefined>(undefined);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  useEffect(() => {
    setForm(undefined); setAnswers({});
    api.get(`/forms?stage=${stage}&jobGroup=${group}`).then(async (r) => {
      const pub = r.items.find((f: any) => f.status === 'published');
      setForm(pub ? await api.get(`/forms/${pub.id}`) : null);
    }).catch(() => setForm(null));
  }, [stage, group]);
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <Settings2 className="h-4 w-4 text-slate-500" />
        <select className="input !w-auto" value={stage} onChange={(e) => setStage(e.target.value as 'self')}>{STAGES.map((s) => <option key={s} value={s}>{t(`stage.${s}`)}</option>)}</select>
        <select className="input !w-auto" value={group} onChange={(e) => setGroup(e.target.value)}>{JOB_GROUPS.map((g) => <option key={g} value={g}>{t(`jobGroupFull.${g}`)}</option>)}</select>
        <span className="text-xs text-slate-500">{t('admin.previewNote')}</span>
      </div>
      {form === undefined ? <Spinner /> : form === null ? <Card><EmptyState title={t('errors.NO_PUBLISHED_FORM')} /></Card> : <>
        <div className="text-sm text-slate-600"><b>{form.name}</b> v{form.version} · {t('forms.totalPoints', { n: form.total_points })}</div>
        <EvaluationForm sections={form.sections} answers={answers} onChange={(id, a) => setAnswers({ ...answers, [id]: a })} />
      </>}
    </div>
  );
}

function LogsTab() {
  const { t, locale } = useI18n();
  const [kind, setKind] = useState<'activity' | 'access'>('activity');
  const [data, setData] = useState<any | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  useEffect(() => {
    setData(null);
    const h = setTimeout(() => api.get(`/logs/${kind}?page=${page}&pageSize=30&q=${encodeURIComponent(q)}`).then(setData).catch(() => setData({ items: [], total: 0 })), 200);
    return () => clearTimeout(h);
  }, [kind, page, q]);
  useEffect(() => setPage(1), [kind, q]);
  return (
    <Card bodyClass="p-0" title={<div className="inline-flex rounded-lg border border-slate-200 p-0.5">
      {(['activity', 'access'] as const).map((k) => <button key={k} onClick={() => setKind(k)} className={cx('rounded-md px-3 py-1 text-xs', kind === k ? 'bg-brand-600 text-white' : 'text-slate-600')}>{t(`admin.logs.${k}`)}</button>)}
    </div>} actions={kind === 'activity' && <SearchInput value={q} onChange={setQ} placeholder={t('admin.logs.search')} />}>
      {!data ? <Spinner /> : data.items.length === 0 ? <EmptyState /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr><th className="th">{t('common.date')}</th><th className="th">{t('admin.logs.user')}</th>
              {kind === 'activity' ? <><th className="th">{t('admin.logs.action')}</th><th className="th">{t('admin.logs.target')}</th><th className="th">{t('admin.logs.details')}</th></>
                : <><th className="th">{t('admin.logs.request')}</th><th className="th">{t('admin.logs.status')}</th><th className="th">{t('admin.logs.duration')}</th></>}
              <th className="th">IP</th></tr></thead>
            <tbody>
              {data.items.map((l: any) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="td whitespace-nowrap">{fmtDate(l.created_at, locale, true)}</td>
                  <td className="td">{l.user_name ?? '–'}</td>
                  {kind === 'activity' ? <>
                    <td className="td"><code className="rounded bg-slate-100 px-1.5 py-0.5">{l.action}</code><div className="text-slate-500">{t(`action.${l.action}`) !== `action.${l.action}` ? t(`action.${l.action}`) : ''}</div></td>
                    <td className="td">{l.entity_type ? `${l.entity_type}#${l.entity_id ?? ''}` : '–'}</td>
                    <td className="td max-w-md truncate font-mono text-[11px] text-slate-500" title={l.details ?? ''}>{l.details ?? ''}</td>
                  </> : <>
                    <td className="td font-mono">{l.method} {l.path}</td>
                    <td className="td"><Badge color={l.status < 400 ? 'green' : l.status < 500 ? 'amber' : 'red'}>{l.status}</Badge></td>
                    <td className="td">{l.duration_ms}ms</td>
                  </>}
                  <td className="td">{l.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <div className="px-4 pb-3"><Pagination page={page} pageSize={30} total={data.total} onChange={setPage} /></div>}
    </Card>
  );
}
