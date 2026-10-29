import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { FileText, FileDown, Eye, Building2, User, Crown, Globe2, Loader2 } from 'lucide-react';
import { api, downloadFile, saveBlob } from '../lib/api';
import { useI18n, errorMessage, type TFn } from '../i18n';
import { useToast } from '../components/Toast';
import { Button, Card, EmptyState, Modal, SearchInput, cx } from '../components/ui';
import { STAGES, fmtDate, fmtScore, posLabel, fmtKpi } from '../lib/status';

type RType = 'all' | 'department' | 'employee' | 'leader';
const TYPES: { id: RType; icon: typeof Globe2 }[] = [
  { id: 'all', icon: Globe2 }, { id: 'department', icon: Building2 }, { id: 'employee', icon: User }, { id: 'leader', icon: Crown },
];
const MAX_DEPT_ROWS = 24;

/** 렌더된 .report-page 들을 A4 PDF(1건 = 1페이지)로 변환 */
async function pagesToPdf(container: HTMLElement | null): Promise<Blob> {
  const pages = container?.querySelectorAll<HTMLElement>('.report-page') ?? [];
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  for (let i = 0; i < pages.length; i++) {
    const png = await toPng(pages[i], { pixelRatio: 2, backgroundColor: '#ffffff', skipFonts: true, cacheBust: true });
    if (i > 0) pdf.addPage();
    pdf.addImage(png, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  }
  return pdf.output('blob');
}

/**
 * 직원 1명의 평가 결과 리포트를 PDF / CSV로 바로 내려받기.
 * 반환된 node(오프스크린 렌더 영역)를 화면 어딘가에 함께 렌더해야 PDF 캡처가 가능함.
 */
export function useEmployeeReport(roundId: number, year?: number) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [data, setData] = useState<any | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const pdf = async (emp: { employee_id: number; emp_no: string; name: string }) => {
    setBusy(`${emp.employee_id}:pdf`);
    try {
      const r = await api.get(`/reports/data?roundId=${roundId}&type=employee&ids=${emp.employee_id}`);
      if (!r.reports.length) { toast('error', t('common.noData')); return; }
      setData(r.reports[0]);
      await new Promise((ok) => setTimeout(ok, 200)); // 렌더 대기
      saveBlob(await pagesToPdf(ref.current), `${t('report.fileName')}_${emp.emp_no}_${emp.name}_${year ?? ''}.pdf`.replace(/\s+/g, '_'));
      await api.post('/reports/log', { type: 'employee', format: 'pdf', roundId, targetDesc: `${emp.name} (${emp.emp_no})` });
      toast('success', t('report.downloaded'));
    } catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(''); setData(null); }
  };

  const csv = async (emp: { employee_id: number; emp_no: string; name: string }) => {
    setBusy(`${emp.employee_id}:csv`);
    try {
      await downloadFile(`/reports/csv?roundId=${roundId}&type=employee&ids=${emp.employee_id}`, `${t('report.fileName')}_${emp.emp_no}.csv`);
      toast('success', t('report.downloaded'));
    } catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(''); }
  };

  const node = (
    <div ref={ref} style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden>
      {data && <ReportPage type="employee" data={data} t={t} locale={locale} />}
    </div>
  );
  return { pdf, csv, busy, node };
}

export default function ReportsPanel({ roundId, rounds }: { roundId: number; rounds: any[] }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const [type, setType] = useState<RType>('all');
  const [depts, setDepts] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [q, setQ] = useState('');
  const [reports, setReports] = useState<any[] | null>(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<'' | 'pdf' | 'csv' | 'preview'>('');
  const [logs, setLogs] = useState<any[]>([]);
  const renderRef = useRef<HTMLDivElement>(null);
  const round = rounds.find((r) => r.id === roundId);

  useEffect(() => {
    api.get(`/results/${roundId}`).then((r) => setResults(r.items)).catch(() => undefined);
    api.get('/departments').then((r) => setDepts(r.items)).catch(() => undefined);
  }, [roundId]);
  const loadLogs = () => api.get('/reports/logs').then((r) => setLogs(r.items)).catch(() => undefined);
  useEffect(() => { loadLogs(); }, []);
  useEffect(() => { setSel(new Set()); setReports(null); }, [type, roundId]);

  const candidates = useMemo(() => {
    if (type === 'department') return depts.map((d) => ({ id: d.id, label: d.name, sub: d.code }));
    const list = type === 'leader' ? results.filter((r) => depts.some((d) => d.leader_employee_id === r.employee_id)) : results;
    return list.map((r) => ({ id: r.employee_id, label: r.name, sub: `${r.emp_no} · ${r.department_name ?? '-'}` }));
  }, [type, depts, results]);
  const visible = candidates.filter((c) => !q || c.label.includes(q) || c.sub.includes(q));
  const ids = type === 'all' ? '' : [...sel].join(',');
  const ready = type === 'all' || sel.size > 0;

  const fetchReports = async () => {
    const r = await api.get(`/reports/data?roundId=${roundId}&type=${type}&ids=${ids}`);
    setReports(r.reports);
    return r.reports as any[];
  };
  const targetDesc = () => (type === 'all' ? 'all' : candidates.filter((c) => sel.has(c.id)).map((c) => c.label).join(', ').slice(0, 1900));

  const doPreview = async () => {
    setBusy('preview');
    try { await fetchReports(); setPreview(true); } catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(''); }
  };

  const doPdf = async () => {
    setBusy('pdf');
    try {
      const reps = await fetchReports();
      if (!reps.length) { toast('error', t('common.noData')); return; }
      await new Promise((r) => setTimeout(r, 150)); // 렌더 대기
      const name = `${t(`report.type.${type}`)}_${round?.year ?? ''}${reps.length > 1 ? `_${reps.length}` : ''}.pdf`.replace(/\s+/g, '_');
      saveBlob(await pagesToPdf(renderRef.current), name);
      await api.post('/reports/log', { type, format: 'pdf', roundId, targetDesc: targetDesc() });
      toast('success', t('report.downloaded'));
      loadLogs();
    } catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(''); }
  };

  const doCsv = async () => {
    setBusy('csv');
    try { await downloadFile(`/reports/csv?roundId=${roundId}&type=${type}&ids=${ids}`, 'report.csv'); toast('success', t('report.downloaded')); loadLogs(); }
    catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(''); }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="space-y-4 xl:col-span-2">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TYPES.map((x) => (
            <button key={x.id} onClick={() => setType(x.id)} className={cx('card flex flex-col items-start gap-2 p-4 text-left transition', type === x.id ? 'ring-2 ring-brand-600' : 'hover:border-brand-200')}>
              <x.icon className={cx('h-6 w-6', type === x.id ? 'text-brand-600' : 'text-slate-400')} />
              <div className="text-sm font-semibold">{t(`report.type.${x.id}`)}</div>
              <div className="text-xs text-slate-500">{t(`report.typeDesc.${x.id}`)}</div>
            </button>
          ))}
        </div>
        {type !== 'all' && (
          <Card title={t('report.selectTargets', { n: sel.size })} actions={<>
            <SearchInput value={q} onChange={setQ} placeholder={t('common.search')} />
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set(visible.map((v) => v.id)))}>{t('common.selectAll')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>{t('common.clear')}</Button>
          </>} bodyClass="p-0">
            {visible.length === 0 ? <EmptyState /> : (
              <ul className="grid max-h-80 grid-cols-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((c) => (
                  <li key={c.id}><label className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(c.id); else s.delete(c.id); setSel(s); }} />
                    <span className="font-medium">{c.label}</span><span className="truncate text-xs text-slate-400">{c.sub}</span>
                  </label></li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <div className="card flex flex-wrap items-center gap-2 p-4">
          <span className="mr-auto text-xs text-slate-500">{t('report.a4Note')}</span>
          <Button variant="secondary" disabled={!ready} loading={busy === 'preview'} icon={<Eye className="h-4 w-4" />} onClick={doPreview}>{t('report.preview')}</Button>
          <Button variant="secondary" disabled={!ready} loading={busy === 'csv'} icon={<FileDown className="h-4 w-4" />} onClick={doCsv}>{t('report.csv')}</Button>
          <Button disabled={!ready} loading={busy === 'pdf'} icon={<FileText className="h-4 w-4" />} onClick={doPdf}>{t('report.pdf')}</Button>
        </div>
      </div>
      <Card title={t('report.logs')} bodyClass="p-0">
        {logs.length === 0 ? <EmptyState /> : (
          <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
            {logs.map((l) => (
              <li key={l.id} className="px-4 py-2.5 text-xs">
                <div className="flex justify-between"><b>{t(`report.type.${l.report_type}`)} · {l.format.toUpperCase()}</b><span className="text-slate-400">{fmtDate(l.created_at, locale, true)}</span></div>
                <div className="truncate text-slate-500">{l.user_name} · {l.round_name}{l.target_desc && l.target_desc !== 'all' ? ` · ${l.target_desc}` : ''}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* PDF 캡처용 오프스크린 렌더 영역 */}
      <div ref={renderRef} style={{ position: 'fixed', left: -10000, top: 0 }} aria-hidden>
        {busy === 'pdf' && reports?.map((r, i) => <ReportPage key={i} type={type} data={r} t={t} locale={locale} />)}
      </div>
      {preview && reports && (
        <Modal open size="full" onClose={() => setPreview(false)} title={t('report.previewTitle', { n: reports.length })}
          footer={<Button loading={busy === 'pdf'} icon={busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} onClick={doPdf}>{t('report.pdf')}</Button>}>
          {reports.length === 0 ? <EmptyState /> : (
            <div className="flex flex-col items-center gap-6 bg-slate-100 py-6">
              {reports.map((r, i) => (
                <div key={i} style={{ width: 794 * 0.75, height: 1123 * 0.75 }} className="shadow-lg">
                  <div style={{ transform: 'scale(0.75)', transformOrigin: 'top left' }}><ReportPage type={type} data={r} t={t} locale={locale} /></div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ───────────── A4 리포트 템플릿 (1건 = 1페이지) ───────────── */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const C = { navy: '#1e1f4e', blue: '#02529c', teal: '#24b5c8', line: '#e2e8f0', muted: '#64748b', soft: '#f1f5f9' };

function Header({ title, data, t, locale }: { title: string; data: any; t: TFn; locale: string }) {
  const r = data.round;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `3px solid ${C.navy}`, paddingBottom: 12, marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 700, color: C.navy }}>{title}</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
          {r?.name} · {t('report.evalPeriod')} {r?.start_date} ~ {r?.end_date}{r?.period_start ? ` · ${t('report.targetPeriod')} ${r.period_start} ~ ${r.period_end}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <img src="/logo-wide.jpg" alt="ROLLENT" style={{ height: 40 }} />
        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{t('report.generated')}: {new Date().toLocaleString(locale)}</div>
      </div>
    </div>
  );
}

function H({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: C.navy, margin: '14px 0 6px', borderLeft: `4px solid ${C.teal}`, paddingLeft: 8 }}>{children}</div>;
}

const th: React.CSSProperties = { background: C.soft, fontWeight: 600, fontSize: 11, padding: '5px 6px', borderBottom: `1px solid ${C.line}`, textAlign: 'left', color: '#334155' };
const td: React.CSSProperties = { fontSize: 11, padding: '4px 6px', borderBottom: `1px solid ${C.line}` };

function Tile({ label, value, dark }: { label: string; value: ReactNode; dark?: boolean }) {
  return (
    <div style={{ flex: 1, border: `1px solid ${dark ? C.navy : C.line}`, background: dark ? C.navy : '#fff', color: dark ? '#fff' : '#222', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, opacity: 0.75 }}>{label}</div>
      <div style={{ fontSize: dark ? 22 : 17, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Footer({ t }: { t: TFn }) {
  return <div style={{ position: 'absolute', bottom: 22, left: 44, right: 44, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.muted, borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
    <span>{t('report.confidential')}</span><span>대양롤랜트(주) · ROLLENT</span>
  </div>;
}

function Bands({ bands }: { bands: { label: string; count: number }[] }) {
  const max = Math.max(1, ...bands.map((b) => b.count));
  return (
    <div>
      {bands.map((b) => (
        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 3 }}>
          <span style={{ width: 44, color: C.muted }}>{b.label}</span>
          <div style={{ flex: 1, background: C.soft, height: 12, borderRadius: 3 }}><div style={{ width: `${(b.count / max) * 100}%`, background: C.blue, height: 12, borderRadius: 3 }} /></div>
          <span style={{ width: 24, textAlign: 'right' }}>{b.count}</span>
        </div>
      ))}
    </div>
  );
}

export function ReportPage({ type, data, t, locale }: { type: RType; data: any; t: TFn; locale: string }) {
  if (type === 'all') return <OverallPage data={data} t={t} locale={locale} />;
  if (type === 'department') return <DepartmentPage data={data} t={t} locale={locale} />;
  return <EmployeePage data={data} t={t} locale={locale} leader={type === 'leader'} />;
}

function EmployeePage({ data, t, locale, leader }: { data: any; t: TFn; locale: string; leader?: boolean }) {
  const r = data.result;
  const e = data.employee;
  const lastAdj = data.adjustments.find((a: any) => a.status === 'active');
  const maxOpinions = leader ? 3 : 4;
  return (
    <div className="report-page">
      <Header title={t(leader ? 'report.type.leader' : 'report.type.employee')} data={data} t={t} locale={locale} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 6 }}>
        <tbody><tr>
          {[[t('common.employeeName'), e.name], [t('common.empNo'), e.emp_no], [t('common.department'), e.department_name ?? '-'], [t('common.position'), posLabel(t, e.position)]].map(([k, v]) => (
            <td key={k} style={{ ...td, border: `1px solid ${C.line}` }}><span style={{ color: C.muted, fontSize: 10 }}>{k}</span><br /><b style={{ fontSize: 13 }}>{v}</b></td>
          ))}
        </tr></tbody>
      </table>
      <H>{t('report.scoreSummary')}</H>
      <div style={{ display: 'flex', gap: 8 }}>
        {STAGES.filter((s) => r.stages[s].state !== 'na').map((s) => <Tile key={s} label={`${t(`stage.${s}`)} (${r.weights[s]}%)`} value={r.stages[s].state === 'na' ? 'N/A' : fmtScore(r.stages[s].score)} />)}
        <Tile label={t('results.weighted')} value={fmtScore(r.weighted_score)} />
        {r.kpi_ratio && <Tile label={`${t('results.kpiScore')} (${r.kpi_ratio.kpi}%)`} value={fmtKpi(r.kpi_score)} />}
        <Tile label={t('report.beforeAdjust')} value={fmtScore(lastAdj ? lastAdj.before_score : r.computed_score)} />
        <Tile dark label={t('results.confirmedScore')} value={fmtScore(r.final_score)} />
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
        {t('report.formulaLine', { s: r.weights.self, l: r.weights.leader, e: r.weights.exec })}
        {r.weights.upward > 0 && ` · ${t('stage.upward')} ${r.weights.upward}%`}
        {r.kpi_ratio && ` · ${t('results.kpiRatio', { p: r.kpi_ratio.personal, k: r.kpi_ratio.kpi })}`}
        {lastAdj && ` · ${lastAdj.reason ? t('report.adjustedLine', { from: fmtScore(lastAdj.before_score), to: fmtScore(lastAdj.after_score), reason: clip(lastAdj.reason, 40) }) : t('report.adjustedLineNoReason', { from: fmtScore(lastAdj.before_score), to: fmtScore(lastAdj.after_score) })}`}
        {r.final_score === null && ` · ${t('results.incompleteNote')}`}
      </div>
      <H>{t('report.sectionResults')}</H>
      {data.sections.length === 0 ? <div style={{ fontSize: 11, color: C.muted }}>{t('results.noSectionData')}</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>{t('results.item')}</th><th style={{ ...th, textAlign: 'right' }}>{t('results.maxPoints')}</th>
            {STAGES.map((s) => <th key={s} style={{ ...th, textAlign: 'right' }}>{t(`stage.${s}`)}</th>)}</tr></thead>
          <tbody>{data.sections.slice(0, 16).map((s: any) => (
            <tr key={s.title}><td style={td}>{s.title}</td><td style={{ ...td, textAlign: 'right', color: C.muted }}>{s.max}</td>
              {STAGES.map((st) => <td key={st} style={{ ...td, textAlign: 'right' }}>{s.earned[st] ?? '–'}</td>)}</tr>
          ))}</tbody>
        </table>
      )}
      {leader && data.team && <>
        <H>{t('report.teamSummary')}{data.team.departments.length ? ` · ${data.team.departments.join(', ')}` : ''}</H>
        <div style={{ display: 'flex', gap: 8 }}>
          <Tile label={t('report.teamMembers')} value={data.team.total} />
          <Tile label={t('report.completedN')} value={`${data.team.completed} (${data.team.rate}%)`} />
          <Tile label={t('report.avgScore')} value={fmtScore(data.team.avg)} />
          <Tile label={t('report.maxMin')} value={`${fmtScore(data.team.max)} / ${fmtScore(data.team.min)}`} />
        </div>
      </>}
      <H>{t('report.opinions')}</H>
      {data.opinions.length === 0 ? <div style={{ fontSize: 11, color: C.muted }}>–</div> : data.opinions.slice(0, maxOpinions).map((o: any, i: number) => (
        <div key={i} style={{ fontSize: 11, marginBottom: 5, lineHeight: 1.45 }}><b style={{ color: C.blue }}>[{t(`stage.${o.stage}`)}]</b> {clip(o.text.replace(/\s+/g, ' '), leader ? 150 : 200)}</div>
      ))}
      {data.suggestions.length > 0 && <>
        <H>{t('results.suggestions')}</H>
        {data.suggestions.slice(0, 2).map((s: any, i: number) => <div key={i} style={{ fontSize: 11, marginBottom: 4 }}>• {clip(s.text.replace(/\s+/g, ' '), 160)}</div>)}
      </>}
      <div style={{ marginTop: 12, fontSize: 11, display: 'flex', gap: 20 }}>
        <span><span style={{ color: C.muted }}>{t('report.finalizedDate')}:</span> <b>{r.finalized_at ? fmtDate(r.finalized_at, locale) : t('report.notFinalized')}</b></span>
        <span><span style={{ color: C.muted }}>{t('results.state')}:</span> <b>{t(`state.${r.state}`)}</b></span>
      </div>
      <Footer t={t} />
    </div>
  );
}

function DepartmentPage({ data, t, locale }: { data: any; t: TFn; locale: string }) {
  const s = data.stats;
  const many = data.members.length > MAX_DEPT_ROWS;
  return (
    <div className="report-page">
      <Header title={t('report.type.department')} data={data} t={t} locale={locale} />
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{data.department?.name} <span style={{ fontSize: 12, color: C.muted, fontWeight: 400 }}>{data.department?.code} · {t('org.leader')}: {data.department?.leader_name ?? '-'}</span></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Tile label={t('report.totalMembers')} value={s.total} />
        <Tile label={t('report.completedN')} value={s.completed} />
        <Tile label={t('dashboard.completionRate')} value={`${s.rate}%`} />
        <Tile dark label={t('report.avgScore')} value={fmtScore(s.avg)} />
      </div>
      <H>{t('report.deptSummary')}</H>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, fontSize: 11, lineHeight: 1.7 }}>
          {t('report.deptSummaryText', { total: s.total, done: s.completed, rate: s.rate, avg: fmtScore(s.avg), max: fmtScore(s.max), min: fmtScore(s.min) })}
          <div style={{ marginTop: 4, color: C.muted }}>{STAGES.map((st) => `${t(`stage.${st}`)} ${fmtScore(s.stageAvg[st])}`).join(' · ')}</div>
        </div>
        <div style={{ width: 260 }}><Bands bands={s.bands} /></div>
      </div>
      <H>{t('report.memberScores')}{many ? ` (${t('report.topN', { n: MAX_DEPT_ROWS })})` : ''}</H>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>{t('common.empNo')}</th><th style={th}>{t('common.employeeName')}</th><th style={th}>{t('common.position')}</th>
          {STAGES.map((st) => <th key={st} style={{ ...th, textAlign: 'right' }}>{t(`stage.${st}`)}</th>)}
          <th style={{ ...th, textAlign: 'right' }}>{t('results.confirmedScore')}</th><th style={th}>{t('results.state')}</th></tr></thead>
        <tbody>{data.members.slice(0, MAX_DEPT_ROWS).map((m: any) => (
          <tr key={m.employee_id}><td style={td}>{m.emp_no}</td><td style={td}>{m.name}</td><td style={td}>{posLabel(t, m.position)}</td>
            {STAGES.map((st) => <td key={st} style={{ ...td, textAlign: 'right' }}>{fmtScore(m[st])}</td>)}
            <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtScore(m.final)}</td><td style={td}>{t(`state.${m.state}`)}</td></tr>
        ))}</tbody>
      </table>
      {many && <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>{t('report.csvForFull', { n: data.members.length })}</div>}
      <Footer t={t} />
    </div>
  );
}

function OverallPage({ data, t, locale }: { data: any; t: TFn; locale: string }) {
  const s = data.stats;
  return (
    <div className="report-page">
      <Header title={t('report.type.all')} data={data} t={t} locale={locale} />
      <div style={{ display: 'flex', gap: 8 }}>
        <Tile label={t('report.totalMembers')} value={s.total} />
        <Tile label={t('report.completedN')} value={s.completed} />
        <Tile label={t('state.finalized')} value={s.finalized} />
        <Tile label={t('dashboard.completionRate')} value={`${s.rate}%`} />
        <Tile dark label={t('report.avgScore')} value={fmtScore(s.avg)} />
      </div>
      <H>{t('report.overallSummary')}</H>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, fontSize: 11, lineHeight: 1.7 }}>
          {t('report.overallSummaryText', { total: s.total, done: s.completed, rate: s.rate, avg: fmtScore(s.avg), max: fmtScore(s.max), min: fmtScore(s.min), pending: data.pending })}
          <div style={{ marginTop: 4, color: C.muted }}>{STAGES.map((st) => `${t(`stage.${st}`)} ${fmtScore(s.stageAvg[st])}`).join(' · ')}</div>
        </div>
        <div style={{ width: 260 }}><Bands bands={s.bands} /></div>
      </div>
      <H>{t('report.byDepartment')}</H>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>{t('common.department')}</th><th style={{ ...th, textAlign: 'right' }}>{t('report.totalMembers')}</th><th style={{ ...th, textAlign: 'right' }}>{t('report.completedN')}</th>
          <th style={{ ...th, textAlign: 'right' }}>{t('dashboard.completionRate')}</th><th style={{ ...th, textAlign: 'right' }}>{t('report.avgScore')}</th><th style={{ ...th, textAlign: 'right' }}>{t('report.maxMin')}</th></tr></thead>
        <tbody>{data.departments.slice(0, 20).map((d: any) => (
          <tr key={String(d.id)}><td style={td}>{d.name}</td><td style={{ ...td, textAlign: 'right' }}>{d.total}</td><td style={{ ...td, textAlign: 'right' }}>{d.completed}</td>
            <td style={{ ...td, textAlign: 'right' }}>{d.rate}%</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtScore(d.avg)}</td>
            <td style={{ ...td, textAlign: 'right' }}>{fmtScore(d.max)} / {fmtScore(d.min)}</td></tr>
        ))}</tbody>
      </table>
      <H>{t('report.top5')}</H>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>{data.top.map((x: any, i: number) => (
          <tr key={x.emp_no}><td style={{ ...td, width: 30, fontWeight: 700, color: C.blue }}>{i + 1}</td><td style={td}>{x.name}</td><td style={td}>{x.emp_no}</td><td style={td}>{x.department_name}</td><td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtScore(x.final)}</td></tr>
        ))}</tbody>
      </table>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>{t('report.fullListCsv')}</div>
      <Footer t={t} />
    </div>
  );
}
