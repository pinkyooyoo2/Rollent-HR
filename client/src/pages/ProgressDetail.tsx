/** 직원별 평가 진행 상세 (홈 대시보드 '직원별 평가 진행 현황'의 상세 보기: 직원 1명 또는 전체) */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SearchInput, Spinner } from '../components/ui';
import { StageBadge, STAGES, posLabel, type OverallState, type StageState } from '../lib/status';
import { ProgressSummary } from '../components/StageProgress';

interface Row {
  employee_id: number; emp_no: string; name: string; department_id: number | null; department_name: string; position: string | null; state: OverallState;
  stages: Record<'self' | 'leader' | 'exec' | 'upward', StageState>; weights: Record<'self' | 'leader' | 'exec' | 'upward', number>;
  completed_stages: number; required_stages: number;
}

export default function ProgressDetailPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const empId = Number(params.get('emp')) || null;
  const [rounds, setRounds] = useState<any[]>([]);
  const [roundId, setRoundId] = useState<number | null>(Number(params.get('roundId')) || null);
  const [data, setData] = useState<{ round: any; employees: Row[]; departments: { id: number | null; name: string }[] } | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [dept, setDept] = useState(params.get('dept') ?? '');
  const [state, setState] = useState('');
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
  useEffect(() => setPage(1), [q, dept, state]);

  const filtered = useMemo(() => (data?.employees ?? []).filter((e) => (empId ? e.employee_id === empId
    : (!q || e.name.toLowerCase().includes(q.toLowerCase()) || (e.department_name ?? '').toLowerCase().includes(q.toLowerCase()) || e.emp_no.includes(q))
      && (!dept || String(e.department_id) === dept)
      && (!state || (state === 'done' ? e.state === 'completed' || e.state === 'finalized' : e.state === state)))), [data, empId, q, dept, state]);

  const back = () => (window.history.length > 1 ? nav(-1) : nav('/'));

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Spinner />;
  const one = empId ? filtered[0] : undefined;
  return (
    <div>
      <PageHeader title={one ? t('dashboard.detailOne', { name: one.name }) : t('dashboard.detailTitle')} crumbs={[{ label: t('dashboard.detailTitle') }]}
        description={t('dashboard.detailDesc')}
        actions={<>
          <Button variant="secondary" icon={<ArrowLeft className="h-4 w-4" />} onClick={back}>{t('dashboard.back')}</Button>
          <select className="input !w-auto" value={roundId ?? ''} onChange={(e) => setRoundId(Number(e.target.value))} aria-label={t('common.round')}>
            {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </>} />
      <Card bodyClass="p-0" title={t('dashboard.employeeProgress')} actions={!empId && <>
        <SearchInput value={q} onChange={setQ} placeholder={t('dashboard.searchNameDept')} />
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
      </>}>
        {filtered.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">{t('common.department')}</th><th className="th">{t('common.position')}</th><th className="th">{t('common.employeeName')}</th>
                <th className="th">{t('dashboard.currentStep')}</th>
                {STAGES.map((st) => <th key={st} className="th">{t(`stage.${st}`)}</th>)}
              </tr></thead>
              <tbody>
                {filtered.slice((page - 1) * pageSize, page * pageSize).map((e) => (
                  <tr key={e.employee_id} className="hover:bg-slate-50">
                    <td className="td whitespace-nowrap">{e.department_name ?? '–'}</td>
                    <td className="td whitespace-nowrap">{posLabel(t, e.position)}</td>
                    <td className="td font-medium">{e.name}</td>
                    <td className="td"><ProgressSummary e={e} t={t} /></td>
                    {/* 해당 없는 단계(가중치 0%, 예: 팀원→팀장평가 대상이 아닌 직원·임원의 팀장/임원평가)는 '-' */}
                    {STAGES.map((st) => (
                      <td key={st} className="td">
                        {e.stages[st] === 'na' ? <span className="px-2 text-slate-400" title={t('dashboard.notApplicable')}>-</span> : <StageBadge state={e.stages[st]} t={t} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!empId && <div className="px-4 pb-3"><Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} /></div>}
      </Card>
    </div>
  );
}
