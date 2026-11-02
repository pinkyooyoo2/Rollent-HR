import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, CheckCircle2, CircleDashed, LayoutGrid, GripVertical, Eye, EyeOff, ArrowUp, ArrowDown, ListChecks } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, ErrorState, Modal, PageHeader, Pagination, SearchInput, Spinner, cx } from '../components/ui';
import { posLabel, type OverallState, type StageState } from '../lib/status';
import { ProgressSummary, StageSteps } from '../components/StageProgress';

interface DashData {
  round: any;
  summary: { totalEmployees: number; totalDepartments: number; targets: number; completed: number; incomplete: number; inProgress: number; notStarted: number; completionRate: number };
  employees: { employee_id: number; emp_no: string; name: string; department_id: number | null; department_name: string; position: string | null; state: OverallState;
    stages: Record<'self' | 'leader' | 'exec' | 'upward', StageState>; weights: Record<'self' | 'leader' | 'exec' | 'upward', number>;
    completed_stages: number; required_stages: number }[];
  departments: { id: number | null; name: string; total: number; completed: number; rate: number }[];
}

type WidgetId = 'summary' | 'progress';
const DEFAULT_LAYOUT: { id: WidgetId; visible: boolean }[] = [
  { id: 'summary', visible: true }, { id: 'progress', visible: true },
];

function Stat({ icon, label, value, sub, accent }: { icon: ReactNode; label: string; value: ReactNode; sub?: string; accent: string }) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className={cx('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', accent)}>{icon}</div>
      <div className="min-w-0">
        <div className="text-sm text-slate-500">{label}</div>
        <div className="text-3xl font-bold text-navy-900">{value}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
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
        // 제거된 위젯(부서별 진행률)은 저장된 레이아웃에 있어도 무시
        const saved = r.layout.widgets.filter((w: any) => DEFAULT_LAYOUT.some((d) => d.id === w.id));
        const missing = DEFAULT_LAYOUT.filter((d) => !saved.some((w: any) => w.id === d.id));
        setLayout([...saved, ...missing]);
      }
    }).catch(() => undefined);
  }, []);
  useEffect(() => setPage(1), [q, dept, state]);

  // 서버가 부서 → 직급 → 직원명 순으로 정렬해서 보냄
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
  /** 전체 상세 현황으로 이동 (현재 차수·부서·검색 조건 유지) */
  const openDetail = () => {
    const p = new URLSearchParams();
    if (roundId) p.set('roundId', String(roundId));
    if (dept) p.set('dept', dept);
    if (q) p.set('q', q);
    nav(`/progress?${p}`);
  };
  const widgets: Record<WidgetId, ReactNode> = {
    // 완료자 = 그 직원에게 해당되는 평가 단계를 모두 마친 직원 (임원은 자기평가만). 해당 없는 단계는 미완료로 세지 않음
    summary: (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat icon={<Users className="h-6 w-6 text-brand-600" />} accent="bg-brand-50" label={t('dashboard.targets')} value={s.targets} sub={t('dashboard.targetsHint')} />
        <Stat icon={<CheckCircle2 className="h-6 w-6 text-emerald-600" />} accent="bg-emerald-50" label={t('dashboard.completedPeople')} value={s.completed} sub={t('dashboard.completedHint')} />
        <Stat icon={<CircleDashed className="h-6 w-6 text-amber-600" />} accent="bg-amber-50" label={t('dashboard.incompletePeople')} value={s.incomplete ?? s.targets - s.completed} sub={t('dashboard.incompleteHint')} />
      </div>
    ),
    progress: (
      <Card title={t('dashboard.employeeProgress')} bodyClass="p-0" actions={<>
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
        <Button variant="secondary" icon={<ListChecks className="h-4 w-4" />} onClick={() => openDetail()}>{t('dashboard.viewAllDetail')}</Button>
      </>}>
        {filtered.length === 0 ? <EmptyState /> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                <th className="th">{t('common.department')}</th><th className="th">{t('common.position')}</th><th className="th">{t('common.employeeName')}</th>
                <th className="th">{t('dashboard.currentStep')}</th><th className="th">{t('dashboard.steps')}</th>
              </tr></thead>
              <tbody>
                {filtered.slice((page - 1) * pageSize, page * pageSize).map((e) => (
                  <tr key={e.employee_id} className="hover:bg-slate-50">
                    <td className="td whitespace-nowrap">{e.department_name ?? '–'}</td>
                    <td className="td whitespace-nowrap">{posLabel(t, e.position)}</td>
                    <td className="td font-medium">{e.name}</td>
                    <td className="td"><ProgressSummary e={e} t={t} /></td>
                    <td className="td"><StageSteps e={e} t={t} /></td>
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
