import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, X, AlertTriangle, Sigma, Download } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner, Tabs, cx } from '../components/ui';
import CsvManager from '../components/CsvManager';
import { fmtKpi } from '../lib/status';

const UNITS = ['%', '건', '점', '원', '시간', '회'];
// 목표·실적도 소수점 둘째 자리에서 반올림 (입력값이 정수면 그대로)
const num = (v: number | null | undefined, unit: string) => (v === null || v === undefined ? '–' : `${Math.round(v * 10) / 10}${unit}`);

export default function KpiPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const editable = can('weights.manage');
  const [rounds, setRounds] = useState<any[]>([]);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [ratio, setRatio] = useState({ personal: '80', kpi: '20' });
  const [savingRatio, setSavingRatio] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);
  const [tab, setTab] = useState<'items' | 'upload'>('items');

  useEffect(() => {
    api.get('/rounds').then((r) => { setRounds(r.items); setRoundId(r.items.find((x: any) => x.status === 'open')?.id ?? r.items[0]?.id ?? null); })
      .catch((e) => setError(errorMessage(t, e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(() => {
    if (!roundId) return;
    setError('');
    api.get(`/kpi/${roundId}`).then((d) => {
      setData(d);
      setRatio({ personal: String(d.settings.personal_ratio), kpi: String(d.settings.kpi_ratio) });
    }).catch((e) => setError(errorMessage(t, e)));
  }, [roundId, t]);
  useEffect(() => { load(); }, [load]);

  const saveSettings = async (enabled: boolean, personal: number, kpi: number) => {
    setSavingRatio(true);
    try {
      await api.put(`/kpi/${roundId}/settings`, { enabled, personal_ratio: personal, kpi_ratio: kpi });
      toast('success', t('kpi.saved'));
      load();
    } catch (e) { toast('error', errorMessage(t, e)); } finally { setSavingRatio(false); }
  };

  const p = Number(ratio.personal);
  const k = Number(ratio.kpi);
  const sum = (Number.isNaN(p) ? 0 : p) + (Number.isNaN(k) ? 0 : k);
  const sumOk = Math.abs(sum - 100) < 0.001;
  const ratioChanged = data && (p !== data.settings.personal_ratio || k !== data.settings.kpi_ratio);
  const s = data?.settings;

  return (
    <div>
      <PageHeader title={t('nav.kpi')} description={t('kpi.description')} actions={
        <select className="input !w-auto" value={roundId ?? ''} onChange={(e) => { setData(null); setRoundId(Number(e.target.value)); }} aria-label={t('common.round')}>
          {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>} />
      {editable && <Tabs<'items' | 'upload'> value={tab} onChange={setTab} tabs={[{ id: 'items', label: t('kpi.tab.items') }, { id: 'upload', label: t('kpi.tab.upload') }]} />}
      {tab === 'upload' && roundId ? (
        <CsvManager key={roundId} kinds={['kpis']} defaultOptions={{ roundId }} description={t('kpi.uploadDesc')} onApplied={load} />
      ) : error ? <ErrorState message={error} onRetry={load} /> : !roundId ? <Card><EmptyState title={t('dashboard.noRound')} /></Card> : !data ? <Spinner /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className={cx('flex items-start gap-3', editable && 'cursor-pointer')}>
              <input type="checkbox" className="mt-1 h-5 w-5 accent-brand-600" checked={s.enabled} disabled={!editable || savingRatio}
                onChange={(e) => saveSettings(e.target.checked, s.personal_ratio, s.kpi_ratio)} />
              <span>
                <span className="block font-semibold text-navy-900">{t('kpi.apply')}</span>
                <span className="block text-sm text-slate-500">{t('kpi.applyHint')}</span>
              </span>
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile(`/kpi/${roundId}/export.csv`, 'kpi.csv').catch((e) => toast('error', errorMessage(t, e)))}>{t('common.exportCsv')}</Button>
              {editable && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ department_id: data.departments[0]?.id })}>{t('kpi.add')}</Button>}
            </div>
          </div>
          {!editable && <p className="text-xs text-slate-500">{t('kpi.viewOnly')}</p>}

          <div className={cx('card flex flex-wrap items-center justify-between gap-4 p-5', !s.enabled && 'opacity-60')}>
            <div>
              <div className="font-semibold text-navy-900">{t('kpi.ratioTitle')}</div>
              <div className="text-sm text-slate-500">{t('kpi.ratioHint')}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{t('kpi.personal')}</span>
              <input type="number" min={0} max={100} className="input !w-20 text-right" value={ratio.personal} disabled={!editable}
                aria-label={t('kpi.personal')}
                onChange={(e) => setRatio({ personal: e.target.value, kpi: e.target.value === '' ? ratio.kpi : String(Math.max(0, 100 - Number(e.target.value))) })} />
              <span>% +</span>
              <span className="font-medium">{t('kpi.dept')}</span>
              <input type="number" min={0} max={100} className="input !w-20 text-right" value={ratio.kpi} disabled={!editable}
                aria-label={t('kpi.dept')} onChange={(e) => setRatio({ ...ratio, kpi: e.target.value })} />
              <span>%</span>
              <span className={cx('rounded-full px-3 py-1 text-xs font-semibold', sumOk ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>{t('kpi.sum', { n: sum })}</span>
              {editable && <Button size="sm" disabled={!sumOk || !ratioChanged} loading={savingRatio} onClick={() => saveSettings(s.enabled, p, k)}>{t('common.save')}</Button>}
            </div>
          </div>

          {data.departments.length === 0 ? <Card><EmptyState /></Card> : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.departments.map((d: any) => (
                <section key={d.id} className="card p-5">
                  <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                    <div>
                      <h2 className="text-lg font-bold text-navy-900">{d.name}</h2>
                      <div className="text-sm text-slate-500">{t('kpi.count', { n: d.kpis.length })}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-500">{t('kpi.score')}</div>
                      <div className="text-3xl font-bold text-brand-600">{fmtKpi(d.score)}</div>
                    </div>
                  </div>
                  {d.kpis.length > 0 && Math.abs(d.weight_sum - 100) > 0.001 && (
                    <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{t('kpi.weightSumWarn', { n: d.weight_sum })}</p>
                  )}
                  {d.kpis.length === 0 ? <EmptyState title={t('kpi.noItems')} /> : d.kpis.map((x: any) => (
                    <div key={x.id} className="border-b border-slate-100 py-4 last:border-0 last:pb-0">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <h3 className="font-semibold text-slate-800">{x.name}</h3>
                        {editable && <div className="flex gap-1">
                          <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(x)}>{t('common.edit')}</Button>
                          <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5 text-red-500" />} onClick={() => setDel(x)}>{t('common.delete')}</Button>
                        </div>}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          [t('kpi.target'), num(x.target, x.unit)],
                          [t('kpi.actual'), num(x.actual, x.unit)],
                          [t('kpi.achievement'), x.achievement === null ? t('kpi.notCalculable') : `${fmtKpi(x.achievement)}%`],
                          [t('kpi.weight'), `${x.weight}%`],
                        ].map(([label, value], i) => (
                          <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                            <div className="text-xs text-slate-500">{label}</div>
                            <div className={cx('font-semibold', i === 2 && (x.achievement === null ? 'text-slate-400' : 'text-teal-600'))}>{value}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-1.5 text-[11px] text-slate-400">{t(`kpi.dir.${x.direction}`)}</div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}

          <div className="card p-5">
            <h2 className="mb-2 flex items-center gap-1.5 font-semibold text-navy-900"><Sigma className="h-4 w-4" />{t('kpi.formulaTitle')}</h2>
            <div className="rounded-lg bg-brand-50 px-4 py-3 font-mono text-sm text-navy-900">
              {s.enabled ? t('kpi.formula', { p: s.personal_ratio, k: s.kpi_ratio }) : t('kpi.formulaOff')}
            </div>
            <p className="mt-2 text-sm text-slate-500">{t('kpi.formulaNote')}</p>
          </div>
        </div>
      )}
      {edit && roundId && <KpiModal roundId={roundId} item={edit} departments={data?.departments ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('kpi.deleteTitle')} message={t('kpi.deleteMsg', { name: del?.name ?? '' })} confirmLabel={t('common.delete')}
        onConfirm={async () => {
          try { await api.del(`/kpi/items/${del.id}`); toast('success', t('kpi.saved')); load(); } catch (e) { toast('error', errorMessage(t, e)); throw e; }
        }} />
    </div>
  );
}

function KpiModal({ roundId, item, departments, onClose, onSaved }: { roundId: number; item: any; departments: any[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const [f, setF] = useState({
    department_id: item.department_id ?? departments[0]?.id ?? '', name: item.name ?? '', unit: item.unit ?? '%',
    direction: item.direction ?? 'higher', target: str(item.target), actual: str(item.actual), weight: str(item.weight ?? 100),
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toNum = (v: string) => (v.trim() === '' ? null : Number(v));
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = t('validation.required');
    if (!f.department_id) e.department_id = t('validation.required');
    for (const key of ['target', 'actual'] as const) {
      const n = toNum(f[key]);
      if (n !== null && (Number.isNaN(n) || n < 0)) e[key] = t('validation.number');
    }
    const w = Number(f.weight);
    if (f.weight.trim() === '' || Number.isNaN(w) || w < 0 || w > 100) e.weight = t('validation.scoreRange');
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body = { department_id: Number(f.department_id), name: f.name.trim(), unit: f.unit.trim(), direction: f.direction, target: toNum(f.target), actual: toNum(f.actual), weight: w };
    try {
      if (item.id) await api.put(`/kpi/items/${item.id}`, body); else await api.post(`/kpi/${roundId}/items`, body);
      toast('success', t('kpi.saved'));
      onSaved();
    } catch (err) { toast('error', errorMessage(t, err)); } finally { setBusy(false); }
  };
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <Modal open onClose={onClose} title={item.id ? t('kpi.editTitle') : t('kpi.addTitle')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={save}>{t('common.save')}</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('common.department')} required error={errs.department_id}>
          <select className="input" value={f.department_id} onChange={(e) => set('department_id', e.target.value)}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label={t('kpi.name')} required error={errs.name}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label={t('kpi.direction')}>
          <select className="input" value={f.direction} onChange={(e) => set('direction', e.target.value)}>
            <option value="higher">{t('kpi.dir.higher')}</option><option value="lower">{t('kpi.dir.lower')}</option>
          </select>
        </Field>
        <Field label={t('kpi.unit')}>
          <input className="input" list="kpi-units" value={f.unit} onChange={(e) => set('unit', e.target.value)} />
          <datalist id="kpi-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </Field>
        <Field label={t('kpi.target')} error={errs.target}><input type="number" min={0} step="any" className="input" value={f.target} onChange={(e) => set('target', e.target.value)} /></Field>
        <Field label={t('kpi.actual')} error={errs.actual}><input type="number" min={0} step="any" className="input" value={f.actual} onChange={(e) => set('actual', e.target.value)} /></Field>
        <Field label={`${t('kpi.weight')} (%)`} required error={errs.weight}><input type="number" min={0} max={100} step="any" className="input" value={f.weight} onChange={(e) => set('weight', e.target.value)} /></Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">{t('kpi.modalHint')}</p>
    </Modal>
  );
}
