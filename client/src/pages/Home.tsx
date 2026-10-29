import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { Users, Building2, CheckCircle2, Clock, Percent, LayoutGrid, GripVertical, Eye, EyeOff, ArrowUp, ArrowDown, X, ChevronRight, ListChecks } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorState, Modal, PageHeader, Pagination, ProgressBar, SearchInput, Spinner, cx } from '../components/ui';
import { type OverallState, type StageState } from '../lib/status';
import { ProgressSummary, StageSteps } from '../components/StageProgress';

interface DashData {
  round: any;
  summary: { totalEmployees: number; totalDepartments: number; targets: number; completed: number; inProgress: number; notStarted: number; completionRate: number };
  employees: { employee_id: number; emp_no: string; name: string; department_id: number | null; department_name: string; state: OverallState;
    stages: Record<'self' | 'leader' | 'exec' | 'upward', StageState>; weights: Record<'self' | 'leader' | 'exec' | 'upward', number>;
    completed_stages: number; required_stages: number }[];
  departments: { id: number | null; name: string; total: number; completed: number; rate: number }[];
}

type WidgetId = 'summary' | 'departments' | 'progress';
const DEFAULT_LAYOUT: { id: WidgetId; visible: boolean }[] = [
  { id: 'summary', visible: true }, { id: 'departments', visible: true }, { id: 'progress', visible: true },
];

function Stat({ icon, label, value, sub, accent }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; accent: string }) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', accent)}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-navy-900">{value}</div>
        {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

export default function HomePage() {
  const { t } = useI18n();
  const toast = useToast();
  const nav = useNavigate();
  const [rounds, setRounds] = useState<any[]>([]);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [data, setData] = useState<DashData | null>(null);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState(DEFAULT_LAYOUT);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(() => {
    setError('');
    api.get<DashData>(`/dashboard${roundId ? `?roundId=${roundId}` : ''}`)
      .then((d) => { setData(d); if (!roundId && d.round) setRoundId(d.round.id); })
      .catch((e) => setError(errorMessage(t, e)));
  }, [roundId, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/rounds').then((r) => setRounds(r.items)).catch(() => undefined);
    api.get('/dashboard/layout').then((r) => {
      if (r.layout?.widgets?.length) {
        const saved = r.layout.widgets.filter((w: any) => DEFAULT_LAYOUT.some((d) => d.id === w.id));
        const missing = DEFAULT_LAYOUT.filter((d) => !saved.some((w: any) => w.id === d.id));
        setLayout([...saved, ...missing]);
      }
    }).catch(() => undefined);
  }, []);
  useEffect(() => setPage(1), [q, dept, state]);

  const filtered = useMemo(() => (data?.employees ?? []).filter((e) =>
    (!q || e.name.toLowerCase().includes(q.toLowerCase()) || (e.department_name ?? '').toLowerCase().includes(q.toLowerCase()) || e.emp_no.includes(q))
    && (!dept || String(e.department_id) === dept)
    && (!state || (state === 'done' ? e.state === 'completed' || e.state === 'finalized' : e.state === state))), [data, q, dept, state]);

  const saveLayout = async (l: typeof layout) => {
    try {
      await api.put('/dashboard/layout', { widgets: l });
      setLayout(l);
      toast('success', t('dashboard.layoutSaved'));
      setLayoutOpen(false);
    } catch (e) { toast('error', errorMessage(t, e)); }
  };

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Spinner />;

  const s = data.summary;
  /** 상세 페이지로 이동 (현재 차수·부서·검색 조건 유지) */
  const openDetail = (query?: string) => {
    const p = new URLSearchParams();
    if (roundId) p.set('roundId', String(roundId));
    if (dept) p.set('dept', dept);
    if (query ?? q) p.set('q', query ?? q);
    nav(`/progress?${p}`);
  };
  const widgets: Record<WidgetId, ReactNode> = {
    summary: (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat icon={<Users className="h-5 w-5 text-brand-600" />} accent="bg-brand-50" label={t('dashboard.totalEmployees')} value={s.totalEmployees} sub={t('dashboard.targetsN', { n: s.targets })} />
        <Stat icon={<Building2 className="h-5 w-5 text-navy-900" />} accent="bg-slate-100" label={t('dashboard.totalDepartments')} value={s.totalDepartments} />
        <Stat icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} accent="bg-emerald-50" label={t('dashboard.completed')} value={s.completed} />
        <Stat icon={<Clock className="h-5 w-5 text-amber-600" />} accent="bg-amber-50" label={t('dashboard.inProgress')} value={s.inProgress} sub={t('dashboard.notStartedN', { n: s.notStarted })} />
        <div className="card p-5">
          <div className="flex items-center gap-2 text-xs text-slate-500"><Percent className="h-4 w-4 text-teal-600" />{t('dashboard.completionRate')}</div>
          <div className="mt-1 text-2xl font-bold text-navy-900">{s.completionRate}%</div>
          <ProgressBar value={s.completionRate} color="bg-teal-500" className="mt-2" />
        </div>
      </div>
    ),
    departments: (
      <Card title={t('dashboard.deptProgress')} actions={dept && <Button size="sm" variant="ghost" icon={<X className="h-3.5 w-3.5" />} onClick={() => setDept('')}>{t('dashboard.clearDept')}</Button>}>
        {data.departments.length === 0 ? <EmptyState /> : (
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="h-72 lg:col-span-3" aria-label={t('dashboard.deptProgress')}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.departments} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="#eef0f4" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} interval={0} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip cursor={{ fill: 'rgba(2,82,156,0.06)' }} content={({ active, payload }) => active && payload?.[0] ? (
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow">
                      <div className="font-semibold text-slate-800">{payload[0].payload.name}</div>
                      <div className="text-slate-600">{t('dashboard.rateTooltip', { rate: payload[0].payload.rate, done: payload[0].payload.completed, total: payload[0].payload.total })}</div>
                    </div>) : null} />
                  <Bar dataKey="rate" radius={[4, 4, 0, 0]} className="cursor-pointer" onClick={(d: any) => setDept(String(d.id))}>
                    {data.departments.map((d) => <Cell key={String(d.id)} fill={!dept || String(d.id) === dept ? '#02529c' : '#a9cce9'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-1 text-center text-[11px] text-slate-400">{t('dashboard.chartHint')}</p>
            </div>
            <div className="overflow-x-auto lg:col-span-2">
              <table className="w-full">
                <thead><tr><th className="th">{t('common.department')}</th><th className="th text-right">{t('dashboard.total')}</th><th className="th text-right">{t('dashboard.done')}</th><th className="th text-right">{t('dashboard.rate')}</th></tr></thead>
                <tbody>
                  {data.departments.map((d) => (
                    <tr key={String(d.id)} onClick={() => setDept(String(d.id))} className={cx('cursor-pointer hover:bg-slate-50', String(d.id) === dept && 'bg-brand-50')}>
                      <td className="td font-medium">{d.name}</td><td className="td text-right">{d.total}</td><td className="td text-right">{d.completed}</td>
                      <td className="td text-right font-semibold text-brand-700">{d.rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    ),
    progress: (
      <Card title={t('dashboard.employeeProgress')} bodyClass="p-0" actions={<>
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
        <Button variant="secondary" icon={<ListChecks className="h-4 w-4" />} onClick={() => openDetail()}>{t('dashboard.viewDetail')}</Button>
      </>}>
        {filtered.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto">
            {/* 간단 보기: 직원별 현재 진행 단계 한 줄 + 단계 표시. 단계별 상세는 상세 페이지에서 */}
            <table className="w-full">
              <thead><tr>
                <th className="th">{t('common.employeeName')}</th><th className="th">{t('common.department')}</th>
                <th className="th">{t('dashboard.currentStep')}</th><th className="th">{t('dashboard.steps')}</th><th className="th w-10" />
              </tr></thead>
              <tbody>
                {filtered.slice((page - 1) * pageSize, page * pageSize).map((e) => (
                  <tr key={e.employee_id} className="cursor-pointer hover:bg-slate-50" onClick={() => openDetail(e.emp_no)}>
                    <td className="td"><div className="font-medium">{e.name}</div><div className="text-xs text-slate-400">{e.emp_no}</div></td>
                    <td className="td whitespace-nowrap">{e.department_name}</td>
                    <td className="td"><ProgressSummary e={e} t={t} /></td>
                    <td className="td"><StageSteps e={e} t={t} /></td>
                    <td className="td text-right"><ChevronRight className="h-4 w-4 text-slate-300" aria-label={t('dashboard.viewDetail')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-3"><Pagination page={page} pageSize={pageSize} total={filtered.length} onChange={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} /></div>
      </Card>
    ),
  };

  return (
    <div>
      <PageHeader title={t('nav.home')} crumbs={[]} description={data.round ? `${data.round.name} · ${data.round.start_date} ~ ${data.round.end_date}` : t('dashboard.noRound')}
        actions={<>
          <select className="input !w-auto" value={roundId ?? ''} onChange={(e) => setRoundId(Number(e.target.value))} aria-label={t('common.round')}>
            {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <Button variant="secondary" icon={<LayoutGrid className="h-4 w-4" />} onClick={() => setLayoutOpen(true)}>{t('dashboard.manageWidgets')}</Button>
        </>} />
      <div className="space-y-5">
        {layout.filter((w) => w.visible).map((w) => <div key={w.id}>{widgets[w.id]}</div>)}
        {layout.every((w) => !w.visible) && <EmptyState title={t('dashboard.allHidden')} action={<Button size="sm" onClick={() => setLayoutOpen(true)}>{t('dashboard.manageWidgets')}</Button>} />}
      </div>
      <WidgetManager open={layoutOpen} onClose={() => setLayoutOpen(false)} layout={layout} onSave={saveLayout} />
    </div>
  );
}

function WidgetManager({ open, onClose, layout, onSave }: { open: boolean; onClose: () => void; layout: typeof DEFAULT_LAYOUT; onSave: (l: typeof DEFAULT_LAYOUT) => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState(layout);
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => { if (open) setItems(layout); }, [open, layout]);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setItems(next);
  };
  return (
    <Modal open={open} onClose={onClose} title={t('dashboard.manageWidgets')} size="sm" footer={<>
      <Button variant="ghost" onClick={() => setItems(DEFAULT_LAYOUT)}>{t('common.resetDefault')}</Button>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button onClick={() => onSave(items)}>{t('common.save')}</Button>
    </>}>
      <p className="mb-3 text-xs text-slate-500">{t('dashboard.widgetHint')}</p>
      <ul className="space-y-2">
        {items.map((w, i) => (
          <li key={w.id} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}
            className={cx('flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2', drag === i && 'opacity-50')}>
            <GripVertical className="h-4 w-4 cursor-grab text-slate-400" />
            <span className={cx('flex-1 text-sm', !w.visible && 'text-slate-400 line-through')}>{t(`dashboard.widget.${w.id}`)}</span>
            <button className="rounded p-1 hover:bg-slate-100" onClick={() => move(i, i - 1)} aria-label="up"><ArrowUp className="h-4 w-4" /></button>
            <button className="rounded p-1 hover:bg-slate-100" onClick={() => move(i, i + 1)} aria-label="down"><ArrowDown className="h-4 w-4" /></button>
            <button className="rounded p-1 hover:bg-slate-100" onClick={() => setItems(items.map((x, j) => j === i ? { ...x, visible: !x.visible } : x))}
              aria-label={w.visible ? t('common.hide') : t('common.show')} title={w.visible ? t('common.hide') : t('common.show')}>
              {w.visible ? <Eye className="h-4 w-4 text-brand-600" /> : <EyeOff className="h-4 w-4 text-slate-400" />}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
