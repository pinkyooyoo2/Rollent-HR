/** 직원별 평가 진행 상세 (홈 대시보드 '직원별 평가 진행 현황'의 상세 보기) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { Card, EmptyState, ErrorState, PageHeader, Pagination, ProgressBar, SearchInput, Spinner } from '../components/ui';
import { StageBadge, OverallBadge, STAGES, type OverallState, type StageState } from '../lib/status';
import { ProgressSummary } from '../components/StageProgress';

interface Row {
  employee_id: number; emp_no: string; name: string; department_id: number | null; department_name: string; state: OverallState;
  stages: Record<'self' | 'leader' | 'exec' | 'upward', StageState>; weights: Record<'self' | 'leader' | 'exec' | 'upward', number>;
  completed_stages: number; required_stages: number;
}

export default function ProgressDetailPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [rounds, setRounds] = useState<any[]>([]);
  const [roundId, setRoundId] = useState<number | null>(Number(params.get('roundId')) || null);
  const [data, setData] = useState<{ round: any; employees: Row[]; departments: { id: number | null; name: string }[] } | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [dept, setDept] = useState(params.get('dept') ?? '');
  const [state, setState] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = useCallback(() => {
    setError('');
    api.get(`/dashboard${roundId ? `?roundId=${roundId}` : ''}`)
      .then((d) => { setData(d); if (!roundId && d.round) setRoundId(d.round.id); })
      .catch((e) => setError(errorMessage(t, e)));
  }, [roundId, t]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/rounds').then((r) => setRounds(r.items)).catch(() => undefined); }, []);
  useEffect(() => setPage(1), [q, dept, state, stageFilter]);

  const filtered = useMemo(() => (data?.employees ?? []).filter((e) => {
    const [fs, fst] = stageFilter.split(':');
    return (!q || e.name.toLowerCase().includes(q.toLowerCase()) || (e.department_name ?? '').toLowerCase().includes(q.toLowerCase()) || e.emp_no.includes(q))
      && (!dept || String(e.department_id) === dept)
      && (!state || (state === 'done' ? e.state === 'completed' || e.state === 'finalized' : e.state === state))
      && (!stageFilter || (fst === 'pending' ? !['na', 'submitted'].includes(e.stages[fs as 'self']) : e.stages[fs as 'self'] === fst));
  }), [data, q, dept, state, stageFilter]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Spinner />;
  return (
    <div>
      <PageHeader title={t('dashboard.detailTitle')} crumbs={[{ label: t('dashboard.detailTitle') }]}
        description={t('dashboard.detailDesc')}
        actions={<select className="input !w-auto" value={roundId ?? ''} onChange={(e) => setRoundId(Number(e.target.value))} aria-label={t('common.round')}>
          {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>} />
      <Card bodyClass="p-0" title={t('dashboard.employeeProgress')} actions={<>
        <SearchInput value={q} onChange={setQ} placeholder={t('dashboard.searchPlaceholder')} />
        <select className="input !w-auto" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">{t('common.allDepartments')}</option>
          {data.departments.map((d) => <option key={String(d.id)} value={String(d.id)}>{d.name}</option>)}
        </select>
        <select className="input !w-auto" value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">{t('common.allStates')}</option>
          <option value="not_started">{t('state.not_started')}</option>
          <option value="in_progress">{t('state.in_progress')}</option>
          <option value="done">{t('dashboard.doneFilter')}</option>
        </select>
        <select className="input !w-auto" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label={t('admin.allStageStates')}>
          <option value="">{t('admin.allStageStates')}</option>
          {STAGES.map((s) => ['pending', 'submitted', 'unassigned'].map((st) => <option key={`${s}:${st}`} value={`${s}:${st}`}>{t(`stage.${s}`)} · {t(`admin.stageFilter.${st}`)}</option>))}
        </select>
      </>}>
        {filtered.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">{t('common.employeeName')}</th><th className="th">{t('common.department')}</th><th className="th">{t('dashboard.currentStep')}</th>
                {/* 단계 번호는 직원마다 적용 단계가 달라 '진행 단계' 열에서만 표시 */}
                {STAGES.map((st) => <th key={st} className="th">{t(`stage.${st}`)}</th>)}
                <th className="th">{t('dashboard.finalDone')}</th><th className="th w-44">{t('dashboard.progress')}</th>
              </tr></thead>
              <tbody>
                {filtered.slice((page - 1) * pageSize, page * pageSize).map((e) => {
                  const pct = e.required_stages ? (e.completed_stages / e.required_stages) * 100 : 0;
                  return (
                    <tr key={e.employee_id} className="hover:bg-slate-50">
                      <td className="td"><div className="font-medium">{e.name}</div><div className="text-xs text-slate-400">{e.emp_no}</div></td>
                      <td className="td whitespace-nowrap">{e.department_name}</td>
                      <td className="td"><ProgressSummary e={e} t={t} /></td>
                      {STAGES.map((st) => <td key={st} className="td"><StageBadge state={e.stages[st]} t={t} />
                        {e.stages[st] !== 'na' && e.weights[st] > 0 && <div className="mt-0.5 text-[10px] text-slate-400">{e.weights[st]}%</div>}</td>)}
                      <td className="td"><OverallBadge state={e.state} t={t} /></td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={pct} color={pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-400' : 'bg-slate-300'} />
                          <span className="w-12 text-right text-xs text-slate-500">{e.completed_stages}/{e.required_stages}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-3"><Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} /></div>
      </Card>
    </div>
  );
}
