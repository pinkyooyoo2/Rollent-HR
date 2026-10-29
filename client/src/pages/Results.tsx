import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Lock, Unlock, PencilLine, Undo2, ShieldAlert, Eye, CheckCircle2, MessageSquareText, FileText, FileDown } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, SearchInput, SortHeader, Spinner, Tabs, cx, sortRows, useSort,
} from '../components/ui';
import CsvManager from '../components/CsvManager';
import ReportsPanel, { useEmployeeReport } from './Reports';
import { OverallBadge, StageBadge, STAGES, fmtDate, fmtScore, posLabel, fmtKpi } from '../lib/status';

type Tab = 'results' | 'adjustments' | 'reports' | 'import';

export default function ResultsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('results');
  const [rounds, setRounds] = useState<any[]>([]);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api.get('/rounds').then((r) => { setRounds(r.items); setRoundId(r.items.find((x: any) => x.status === 'open')?.id ?? r.items[0]?.id ?? null); }).catch(() => undefined);
  }, []);
  return (
    <div>
      <PageHeader title={t('nav.results')} description={t('results.description')} actions={
        <select className="input !w-auto" value={roundId ?? ''} onChange={(e) => setRoundId(Number(e.target.value))} aria-label={t('common.round')}>
          {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'results', label: t('results.tab.results') }, { id: 'adjustments', label: t('results.tab.adjustments') },
        ...(can('reports.generate') ? [{ id: 'reports' as Tab, label: t('results.tab.reports') }] : []),
        ...(can('results.import') || can('results.import.approve') ? [{ id: 'import' as Tab, label: t('results.tab.import') }] : []),
      ]} />
      {!roundId ? <Card><EmptyState title={t('dashboard.noRound')} /></Card> : <>
        {tab === 'results' && <ResultsTable key={`${roundId}-${version}`} roundId={roundId} />}
        {tab === 'adjustments' && <AdjustmentsTab roundId={roundId} />}
        {tab === 'reports' && <ReportsPanel roundId={roundId} rounds={rounds} />}
        {tab === 'import' && <CsvManager kinds={['results']} defaultOptions={{ roundId }} description={t('results.importDesc')} onApplied={() => setVersion((v) => v + 1)} />}
      </>}
    </div>
  );
}

function ResultsTable({ roundId }: { roundId: number }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<{ round: any; items: any[] } | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'simple' | 'detail'>('simple');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [state, setState] = useState('');
  const { sort, onSort } = useSort('final_score', 'desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [detail, setDetail] = useState<number | null>(null);
  const [finalize, setFinalize] = useState(false);
  const [adjRow, setAdjRow] = useState<any | null>(null);
  const report = useEmployeeReport(roundId, data?.round?.year);

  const load = useCallback(() => {
    setError('');
    api.get(`/results/${roundId}`).then(setData).catch((e) => setError(errorMessage(t, e)));
  }, [roundId, t]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => setPage(1), [q, dept, state]);

  const depts = useMemo(() => [...new Map((data?.items ?? []).map((i) => [i.department_id, i.department_name])).entries()], [data]);
  const rows = useMemo(() => {
    const f = (data?.items ?? []).filter((i) =>
      (!q || i.name.toLowerCase().includes(q.toLowerCase()) || i.emp_no.toLowerCase().includes(q.toLowerCase()))
      && (!dept || String(i.department_id) === dept)
      && (!state || (state === 'done' ? ['completed', 'finalized'].includes(i.state) : state === 'undone' ? !['completed', 'finalized'].includes(i.state) : i.state === state)));
    return sortRows(f, sort, (r, c) => (STAGES.includes(c as any) ? r.stages[c].score : r[c]), locale);
  }, [data, q, dept, state, sort, locale]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Spinner />;
  const finalizable = rows.filter((r) => sel.has(r.employee_id) && r.state === 'completed');

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {(['simple', 'detail'] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cx('rounded-md px-3 py-1.5 text-sm', mode === m ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50')}>{t(`results.mode.${m}`)}</button>
          ))}
        </div>
        <SearchInput value={q} onChange={setQ} placeholder={t('results.searchPlaceholder')} />
        <select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">{t('common.allDepartments')}</option>{depts.map(([id, n]) => <option key={String(id)} value={String(id)}>{n}</option>)}
        </select>
        <select className="input !w-auto" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">{t('common.allStates')}</option>
          <option value="done">{t('results.filter.done')}</option><option value="undone">{t('results.filter.undone')}</option>
          <option value="finalized">{t('state.finalized')}</option>
        </select>
        <div className="ml-auto flex gap-2">
          {can('results.finalize') && <Button variant="teal" disabled={!finalizable.length} icon={<Lock className="h-4 w-4" />} onClick={() => setFinalize(true)}>{t('results.finalizeN', { n: finalizable.length })}</Button>}
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile(`/results/${roundId}/export.csv?mode=${mode}`, 'results.csv').catch((e) => toast('error', errorMessage(t, e)))}>{t('common.exportCsv')}</Button>
        </div>
      </div>
      {!can('results.adjust') && <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500"><ShieldAlert className="h-4 w-4" />{t('results.viewOnlyNote')}</div>}
      {rows.length === 0 ? <EmptyState /> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              {can('results.finalize') && <th className="th w-8"><input type="checkbox" aria-label={t('common.selectAll')} checked={rows.length > 0 && rows.every((r) => sel.has(r.employee_id))}
                onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.employee_id)) : new Set())} /></th>}
              <SortHeader label={t('common.empNo')} col="emp_no" sort={sort} onSort={onSort} />
              <SortHeader label={t('common.employeeName')} col="name" sort={sort} onSort={onSort} />
              <SortHeader label={t('common.department')} col="department_name" sort={sort} onSort={onSort} />
              {mode === 'simple' ? <SortHeader label={t('common.position')} col="position" sort={sort} onSort={onSort} /> : <>
                {STAGES.map((s) => <SortHeader key={s} label={t(`results.stageScore.${s}`)} col={s} sort={sort} onSort={onSort} className="text-right" />)}
                <th className="th">{t('results.weights')}</th>
                <SortHeader label={t('results.weighted')} col="weighted_score" sort={sort} onSort={onSort} className="text-right" />
                <SortHeader label={t('results.kpiScore')} col="kpi_score" sort={sort} onSort={onSort} className="text-right" />
                <SortHeader label={t('results.adjusted')} col="adjusted_score" sort={sort} onSort={onSort} className="text-right" />
              </>}
              <SortHeader label={mode === 'simple' ? t('results.finalScore') : t('results.confirmedScore')} col="final_score" sort={sort} onSort={onSort} className="text-right" />
              <th className="th">{t('results.state')}</th><th className="th" />
            </tr></thead>
            <tbody>
              {rows.slice((page - 1) * pageSize, page * pageSize).map((r) => (
                <tr key={r.employee_id} className="hover:bg-slate-50">
                  {can('results.finalize') && <td className="td"><input type="checkbox" checked={sel.has(r.employee_id)} aria-label={r.name}
                    onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(r.employee_id); else s.delete(r.employee_id); setSel(s); }} /></td>}
                  <td className="td font-mono text-xs">{r.emp_no}</td>
                  <td className="td font-medium">{r.name}</td>
                  <td className="td whitespace-nowrap">{r.department_name ?? '–'}</td>
                  {mode === 'simple' ? <td className="td">{posLabel(t, r.position)}</td> : <>
                    {STAGES.map((s) => <td key={s} className="td text-right">{r.stages[s].state === 'na' ? <span className="text-xs text-slate-300">N/A</span> : r.stages[s].score === null ? <StageBadge state={r.stages[s].state} t={t} /> : fmtScore(r.stages[s].score)}</td>)}
                    <td className="td font-mono text-xs text-slate-500">{r.weights.self}/{r.weights.leader}/{r.weights.exec}/{r.weights.upward}</td>
                    <td className="td text-right">{fmtScore(r.weighted_score)}</td>
                    <td className="td text-right">{r.kpi_score !== null ? <span title={t('results.kpiRatio', { p: r.kpi_ratio.personal, k: r.kpi_ratio.kpi })}>{fmtKpi(r.kpi_score)}</span> : '–'}</td>
                    <td className="td text-right">{r.adjusted_score !== null ? <span className="font-medium text-violet-700">{fmtScore(r.adjusted_score)}</span> : '–'}</td>
                  </>}
                  <td className="td text-right text-base font-bold text-navy-900">
                    <span className="inline-flex items-center gap-1">
                      {r.final_score === null ? <span className="text-xs font-normal text-slate-400">{t('results.incomplete')}</span> : fmtScore(r.final_score)}
                      {can('results.adjust') && !r.finalized && r.computed_score !== null && (
                        <button className="rounded p-1 text-slate-400 hover:bg-violet-50 hover:text-violet-700" title={t('results.adjust')} aria-label={`${t('results.adjust')} · ${r.name}`} onClick={() => setAdjRow(r)}>
                          <PencilLine className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="td"><OverallBadge state={r.state} t={t} /></td>
                  <td className="td">
                    <div className="flex justify-end gap-0.5 whitespace-nowrap">
                      {can('reports.generate') && <>
                        <Button size="sm" variant="ghost" title={t('report.pdf')} loading={report.busy === `${r.employee_id}:pdf`} disabled={!!report.busy} icon={<FileText className="h-3.5 w-3.5" />} onClick={() => report.pdf(r)}>PDF</Button>
                        <Button size="sm" variant="ghost" title={t('report.csv')} loading={report.busy === `${r.employee_id}:csv`} disabled={!!report.busy} icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => report.csv(r)}>CSV</Button>
                      </>}
                      <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setDetail(r.employee_id)}>{t('common.detail')}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="px-4 pb-3"><Pagination page={page} pageSize={pageSize} total={rows.length} onChange={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} /></div>
      {detail && <ResultDetail roundId={roundId} employeeId={detail} report={report} onClose={() => setDetail(null)} onChanged={load} />}
      {adjRow && <AdjustModal roundId={roundId} employee={{ id: adjRow.employee_id, name: adjRow.name }} result={adjRow} onClose={() => setAdjRow(null)} onSaved={() => { setAdjRow(null); load(); }} />}
      {report.node}
      <ConfirmDialog open={finalize} onClose={() => setFinalize(false)} title={t('results.finalizeTitle')} message={t('results.finalizeMsg', { n: finalizable.length })} confirmLabel={t('results.finalize')}
        onConfirm={async () => {
          try { const r = await api.post(`/results/${roundId}/finalize`, { employeeIds: finalizable.map((x) => x.employee_id) }); toast('success', t('results.finalized', { n: r.finalized })); setSel(new Set()); load(); }
          catch (e) { toast('error', errorMessage(t, e)); throw e; }
        }} />
    </div>
  );
}

function ResultDetail({ roundId, employeeId, report, onClose, onChanged }: { roundId: number; employeeId: number; report: ReturnType<typeof useEmployeeReport>; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [d, setD] = useState<any | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const [revert, setRevert] = useState<any | null>(null);
  const [reopen, setReopen] = useState(false);
  const load = useCallback(() => { api.get(`/results/${roundId}/employees/${employeeId}`).then(setD).catch((e) => toast('error', errorMessage(t, e))); }, [roundId, employeeId, t, toast]);
  useEffect(() => { load(); }, [load]);
  const changed = () => { load(); onChanged(); };
  const r = d?.result;
  return (
    <Modal open onClose={onClose} size="xl" title={t('results.detailTitle')}>
      {!d ? <Spinner /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xl font-bold text-navy-900">{d.employee.name}</span>
            <code className="rounded bg-slate-100 px-2 py-0.5 text-xs">{d.employee.emp_no}</code>
            <span className="text-sm text-slate-500">{d.employee.department_name} · {posLabel(t, d.employee.position)}</span>
            <OverallBadge state={r.state} t={t} />
          </div>
          <div className={cx('grid gap-3 sm:grid-cols-3', r.kpi_ratio ? 'lg:grid-cols-7' : 'lg:grid-cols-6')}>
            {STAGES.filter((s) => r.stages[s].state !== 'na' || r.weights[s] > 0).map((s) => (
              <div key={s} className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs text-slate-500">{t(`stage.${s}`)} <span className="text-slate-400">({r.weights[s]}%)</span></div>
                <div className="text-lg font-bold">{r.stages[s].state === 'na' ? 'N/A' : fmtScore(r.stages[s].score)}</div>
                <div className="text-[11px] text-slate-400">{s === 'upward' ? t('admin.upwardCount', { done: r.stages[s].submitted_count ?? 0, total: r.stages[s].total_count ?? 0 }) : r.stages[s].evaluator_name ?? ''}</div>
              </div>
            ))}
            <div className="rounded-lg border border-slate-200 p-3"><div className="text-xs text-slate-500">{t('results.weighted')}</div><div className="text-lg font-bold">{fmtScore(r.weighted_score)}</div></div>
            {r.kpi_ratio && <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3"><div className="text-xs text-teal-700">{t('results.kpiScore')} <span className="text-teal-600/70">({r.kpi_ratio.kpi}%)</span></div><div className="text-lg font-bold text-teal-700">{fmtKpi(r.kpi_score)}</div></div>}
            <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3"><div className="text-xs text-violet-700">{t('results.adjusted')}</div><div className="text-lg font-bold text-violet-700">{fmtScore(r.adjusted_score)}</div></div>
            <div className="rounded-lg bg-navy-900 p-3 text-white"><div className="text-xs text-white/70">{t('results.confirmedScore')}</div><div className="text-2xl font-bold">{fmtScore(r.final_score)}</div>
              {r.finalized_at && <div className="text-[11px] text-white/60">{fmtDate(r.finalized_at, locale)}</div>}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {can('results.adjust') && !r.finalized && r.computed_score !== null && <Button icon={<PencilLine className="h-4 w-4" />} onClick={() => setAdjOpen(true)}>{t('results.adjust')}</Button>}
            {can('results.finalize') && r.state === 'completed' && <Button variant="teal" icon={<Lock className="h-4 w-4" />} onClick={async () => {
              try { await api.post(`/results/${roundId}/finalize`, { employeeIds: [employeeId] }); toast('success', t('results.finalized', { n: 1 })); changed(); } catch (e) { toast('error', errorMessage(t, e)); }
            }}>{t('results.finalize')}</Button>}
            {can('results.finalize') && r.finalized && <Button variant="secondary" icon={<Unlock className="h-4 w-4" />} onClick={() => setReopen(true)}>{t('results.reopenResult')}</Button>}
            {r.finalized && <span className="flex items-center gap-1 text-xs text-slate-500"><Lock className="h-3.5 w-3.5" />{t('results.finalizedNote')}</span>}
            {r.weighted_score === null && <span className="text-xs text-amber-600">{t('results.incompleteNote')}</span>}
            {r.kpi_ratio && r.computed_score !== null && <span className="text-xs text-slate-500">{t('results.kpiFormula', { w: fmtScore(r.weighted_score), p: r.kpi_ratio.personal, kpi: fmtKpi(r.kpi_score), k: r.kpi_ratio.kpi, total: fmtScore(r.computed_score) })}</span>}
            {can('reports.generate') && (() => {
              const emp = { employee_id: employeeId, emp_no: d.employee.emp_no, name: d.employee.name };
              return <div className="ml-auto flex gap-2">
                <Button variant="secondary" loading={report.busy === `${employeeId}:csv`} disabled={!!report.busy} icon={<FileDown className="h-4 w-4" />} onClick={() => report.csv(emp)}>{t('report.csv')}</Button>
                <Button variant="secondary" loading={report.busy === `${employeeId}:pdf`} disabled={!!report.busy} icon={<FileText className="h-4 w-4" />} onClick={() => report.pdf(emp)}>{t('report.pdf')}</Button>
              </div>;
            })()}
          </div>

          <div>
            <h4 className="mb-2 text-sm font-semibold">{t('results.sectionScores')}</h4>
            {d.sections.length === 0 ? <p className="text-sm text-slate-400">{t('results.noSectionData')}</p> : (
              <div className="overflow-x-auto"><table className="w-full">
                <thead><tr><th className="th">{t('results.item')}</th><th className="th text-right">{t('results.maxPoints')}</th>{STAGES.map((s) => <th key={s} className="th text-right">{t(`stage.${s}`)}</th>)}</tr></thead>
                <tbody>{d.sections.map((s: any) => (
                  <tr key={s.title}><td className="td">{s.title}</td><td className="td text-right text-slate-500">{s.max}</td>
                    {STAGES.map((st) => <td key={st} className="td text-right">{s.earned[st] ?? '–'}</td>)}</tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
          {(d.opinions.length > 0 || d.suggestions.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div><h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><MessageSquareText className="h-4 w-4" />{t('results.opinions')}</h4>
                <ul className="space-y-2">{d.opinions.map((o: any, i: number) => (
                  <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm"><div className="mb-1 text-xs text-slate-500">{t(`stage.${o.stage}`)} · {o.label}</div><p className="whitespace-pre-wrap">{o.text}</p></li>
                ))}</ul></div>
              <div><h4 className="mb-2 text-sm font-semibold">{t('results.suggestions')}</h4>
                {d.suggestions.length === 0 ? <p className="text-sm text-slate-400">–</p> : <ul className="space-y-2">{d.suggestions.map((o: any, i: number) => (
                  <li key={i} className="rounded-lg bg-amber-50 p-3 text-sm"><div className="mb-1 text-xs text-amber-700">{t(`stage.${o.stage}`)}</div><p className="whitespace-pre-wrap">{o.text}</p></li>
                ))}</ul>}</div>
            </div>
          )}
          {!can('responses.view_exec') && <p className="text-xs text-slate-400">{t('results.execTextHidden')}</p>}

          <div>
            <h4 className="mb-2 text-sm font-semibold">{t('results.adjustHistory')}</h4>
            {d.adjustments.length === 0 ? <p className="text-sm text-slate-400">{t('common.noData')}</p> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr><th className="th">{t('common.date')}</th><th className="th text-right">{t('results.computed')}</th><th className="th text-right">{t('results.before')}</th><th className="th text-right">{t('results.after')}</th><th className="th">{t('common.reason')}</th><th className="th">{t('results.adjustedBy')}</th><th className="th">{t('common.status')}</th><th className="th" /></tr></thead>
                <tbody>{d.adjustments.map((a: any) => (
                  <tr key={a.id} className={a.status === 'reverted' ? 'text-slate-400' : ''}>
                    <td className="td text-xs">{fmtDate(a.adjusted_at, locale, true)}</td><td className="td text-right">{fmtScore(a.computed_score)}</td>
                    <td className="td text-right">{fmtScore(a.before_score)}</td><td className="td text-right font-semibold">{fmtScore(a.after_score)}</td>
                    <td className="td">{a.reason}{a.revert_reason && <div className="text-xs">↩ {a.revert_reason}</div>}</td><td className="td">{a.adjusted_by_name}</td>
                    <td className="td">{a.status === 'active' ? <Badge color="violet">{t('results.adjActive')}</Badge> : <Badge>{t('results.adjReverted')}</Badge>}</td>
                    <td className="td">{a.status === 'active' && can('results.adjust') && !r.finalized && <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setRevert(a)}>{t('results.revert')}</Button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
          {d.finalizations.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-semibold">{t('results.finalizeHistory')}</h4>
              <ul className="space-y-1 text-xs text-slate-600">{d.finalizations.map((f: any) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />{fmtDate(f.finalized_at, locale, true)} · {f.finalized_by_name} · {fmtScore(f.final_score)}
                  {f.status === 'reopened' && <span className="text-amber-700">→ {t('results.reopenedBy', { name: f.reopened_by_name, date: fmtDate(f.reopened_at, locale, true) })} ({f.reopen_reason})</span>}</li>
              ))}</ul>
            </div>
          )}
        </div>
      )}
      {adjOpen && r && <AdjustModal roundId={roundId} employee={d.employee} result={r} onClose={() => setAdjOpen(false)} onSaved={() => { setAdjOpen(false); changed(); }} />}
      <ConfirmDialog open={!!revert} onClose={() => setRevert(null)} title={t('results.revertTitle')} message={t('results.revertMsg', { from: fmtScore(revert?.after_score), to: fmtScore(revert?.before_score) })}
        requireReason confirmLabel={t('results.revert')} onConfirm={async (reason) => {
          try { await api.post(`/results/adjustments/${revert.id}/revert`, { reason }); toast('success', t('results.reverted')); changed(); } catch (e) { toast('error', errorMessage(t, e)); throw e; }
        }} />
      <ConfirmDialog open={reopen} onClose={() => setReopen(false)} title={t('results.reopenResult')} message={t('results.reopenResultMsg')} requireReason
        onConfirm={async (reason) => {
          try { await api.post(`/results/${roundId}/employees/${employeeId}/reopen`, { reason }); toast('success', t('common.done')); changed(); } catch (e) { toast('error', errorMessage(t, e)); throw e; }
        }} />
    </Modal>
  );
}

function AdjustModal({ roundId, employee, result, onClose, onSaved }: { roundId: number; employee: any; result: any; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const current = result.adjusted_score ?? result.computed_score;
  const [score, setScore] = useState(String(current ?? ''));
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = Number(score);
  const valid = score !== '' && !Number.isNaN(n) && n >= 0 && n <= 100;
  return (
    <Modal open onClose={onClose} size="sm" title={t('results.adjustTitle', { name: employee.name })} footer={!confirm ? <>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!valid} onClick={() => setConfirm(true)}>{t('common.next')}</Button>
    </> : <>
      <Button variant="secondary" onClick={() => setConfirm(false)}>{t('common.back')}</Button>
      <Button loading={busy} onClick={async () => {
        setBusy(true);
        try { await api.post(`/results/${roundId}/employees/${employee.id}/adjust`, { score: n, reason: reason.trim() }); toast('success', t('results.adjusted_ok')); onSaved(); }
        catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(false); }
      }}>{t('results.confirmAdjust')}</Button>
    </>}>
      {!confirm ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{t('results.computed')}</div><div className="font-bold">{fmtScore(result.computed_score)}</div></div>
            <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{t('results.current')}</div><div className="font-bold">{fmtScore(current)}</div></div>
          </div>
          <Field label={t('results.newScore')} required error={score !== '' && (Number.isNaN(n) || n < 0 || n > 100) ? t('validation.scoreRange') : undefined}>
            <input type="number" min={0} max={100} step={0.01} className="input" value={score} onChange={(e) => setScore(e.target.value)} />
          </Field>
          <Field label={t('results.reasonOptional')} hint={t('results.reasonHint')}><textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p>{t('results.confirmAdjustMsg')}</p>
          <div className="flex items-center justify-center gap-4 rounded-lg bg-violet-50 p-4 text-lg font-bold">
            <span className="text-slate-500">{fmtScore(current)}</span><span>→</span><span className="text-violet-700">{fmtScore(n)}</span>
          </div>
          {reason.trim() && <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">{reason}</p>}
        </div>
      )}
    </Modal>
  );
}

function AdjustmentsTab({ roundId }: { roundId: number }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { setItems(null); api.get(`/results/${roundId}/adjustments`).then((r) => setItems(r.items)).catch(() => setItems([])); }, [roundId]);
  return (
    <Card bodyClass="p-0" title={t('results.allAdjustments')}>
      {!items ? <Spinner /> : items.length === 0 ? <EmptyState /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr><th className="th">{t('common.date')}</th><th className="th">{t('common.employeeName')}</th><th className="th text-right">{t('results.computed')}</th><th className="th text-right">{t('results.before')}</th><th className="th text-right">{t('results.after')}</th><th className="th">{t('common.reason')}</th><th className="th">{t('results.adjustedBy')}</th><th className="th">{t('common.status')}</th></tr></thead>
          <tbody>{items.map((a) => (
            <tr key={a.id}><td className="td text-xs">{fmtDate(a.adjusted_at, locale, true)}</td><td className="td">{a.employee_name} <span className="text-xs text-slate-400">{a.emp_no}</span></td>
              <td className="td text-right">{fmtScore(a.computed_score)}</td><td className="td text-right">{fmtScore(a.before_score)}</td><td className="td text-right font-semibold">{fmtScore(a.after_score)}</td>
              <td className="td">{a.reason}</td><td className="td">{a.adjusted_by_name}</td>
              <td className="td">{a.status === 'active' ? <Badge color="violet">{t('results.adjActive')}</Badge> : <Badge>{t('results.adjReverted')} · {a.reverted_by_name}</Badge>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}
