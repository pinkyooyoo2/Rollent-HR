import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { UploadCloud, FileSpreadsheet, Download, Eye, Check, Trash2, Undo2, Plus, AlertCircle, AlertTriangle, ShieldCheck, Ban, PlayCircle } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useToast } from './Toast';
import { Badge, Button, ConfirmDialog, EmptyState, Modal, Pagination, Spinner, cx } from './ui';
import { fmtDate } from '../lib/status';

export type CsvKind = 'employees' | 'departments' | 'questions' | 'results' | 'kpis';

interface FieldDef { key: string; required?: boolean; aliases: string[] }
interface Upload {
  id: number; kind: CsvKind; file_name: string; status: string; row_count: number; options: any; result: any; created_at: string;
  uploaded_by_name?: string; reviewed_by_name?: string; review_note?: string; uploaded_by?: number;
}
interface UploadDetail extends Upload {
  headers: string[]; mapping: Record<string, string>; rows: Record<string, string>[];
  validation: { index: number; errors: { field: string; code: string }[]; warnings: { field: string; code: string }[]; action: string }[];
  summary: { total: number; errorRows: number; create: number; update: number; skip: number; import: number; duplicate?: number };
}

const norm = (s: string) => s.toLowerCase().replace(/[\s_()-]/g, '');

/** 엑셀 CSV(CP949/EUC-KR)와 UTF-8 모두 지원 */
async function decodeFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('euc-kr').decode(buf); }
}

function autoMap(headers: string[], fields: FieldDef[]) {
  const m: Record<string, string> = {};
  for (const f of fields) {
    const h = headers.find((x) => f.aliases.some((a) => norm(a) === norm(x)) || norm(x) === norm(f.key));
    if (h) m[f.key] = h;
  }
  return m;
}

const STATUS_COLOR: Record<string, 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'violet'> = {
  staged: 'blue', pending_approval: 'violet', applied: 'green', rejected: 'red', cancelled: 'slate', reverted: 'amber',
};

/** 파일별 결과 건수: 성공(신규·수정·가져오기) / 중복(기존 데이터·다른 파일과 중복되어 추가하지 않음) / 오류 */
function counts(sm: UploadDetail['summary'] | undefined) {
  if (!sm) return { ok: 0, dup: 0, err: 0 };
  return { ok: sm.create + sm.update + sm.import, dup: sm.duplicate ?? 0, err: sm.errorRows };
}

function CountBadges({ sm, t }: { sm: UploadDetail['summary'] | undefined; t: (k: string, p?: Record<string, string | number>) => string }) {
  const c = counts(sm);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge color="green">{t('csv.cntSuccess', { n: c.ok })}</Badge>
      <Badge color="violet">{t('csv.cntDuplicate', { n: c.dup })}</Badge>
      <Badge color={c.err ? 'red' : 'slate'}>{t('csv.cntError', { n: c.err })}</Badge>
    </span>
  );
}

export default function CsvManager({ kinds, defaultOptions, onApplied, description }:
  { kinds: CsvKind[]; defaultOptions?: Record<string, unknown>; onApplied?: () => void; description?: string }) {
  const { t, locale } = useI18n();
  const { can, user } = useAuth();
  const toast = useToast();
  const [kind, setKind] = useState<CsvKind>(kinds[0]);
  const [fields, setFields] = useState<Record<CsvKind, FieldDef[]> | null>(null);
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  /** 이번에 선택한 파일들 (선택 즉시 서버에서 검증된 결과) */
  const [session, setSession] = useState<UploadDetail[]>([]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [showHistory, setShowHistory] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ type: 'cancel' | 'revert' | 'reject'; u: Upload } | null>(null);
  const [overwrite, setOverwrite] = useState<UploadDetail | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get(`/uploads?kind=${kinds.join(',')}`).then((r) => setUploads(r.items)).catch((e) => toast('error', errorMessage(t, e)));
  }, [kinds, t, toast]);
  useEffect(() => { api.get('/uploads/fields').then(setFields).catch(() => undefined); load(); }, [load]);
  /** 세션 파일을 서버의 최신 검증 결과로 갱신 (다른 파일을 적용·취소하면 파일 간 중복 결과가 바뀜) */
  const refreshSession = useCallback(async (list: UploadDetail[]) => {
    const next = await Promise.all(list.map((u) => api.get<UploadDetail>(`/uploads/${u.id}`).catch(() => u)));
    setSession(next);
  }, []);

  const handleFiles = async (files: FileList | File[]) => {
    if (!fields) return;
    const list = [...files].filter((f) => /\.(csv|txt)$/i.test(f.name));
    if (list.length === 0) { toast('error', t('csv.onlyCsv')); return; }
    setBusy(true);
    const added: UploadDetail[] = [];
    for (const file of list) {
      try {
        const text = await decodeFile(file);
        const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
        const headers = (parsed.meta.fields ?? []).filter(Boolean);
        if (!headers.length || !parsed.data.length) { toast('error', t('csv.emptyFile', { name: file.name })); continue; }
        const rows = parsed.data.map((r) => Object.fromEntries(headers.map((h) => [h, String(r[h] ?? '')])));
        // 직원 CSV는 기본적으로 '신규만 추가'(이미 있는 사번은 중복으로 분류). 덮어쓰기는 편집 화면에서 별도 선택 + 확인
        const mode = kind === 'employees' ? 'add_only' : kind === 'departments' || kind === 'kpis' ? 'overwrite' : undefined;
        const opts = { ...(mode ? { mode } : {}), ...(kind === 'questions' ? { questionMode: 'append' } : {}), ...defaultOptions };
        added.push(await api.post<UploadDetail>('/uploads', { kind, fileName: file.name, headers, rows, mapping: autoMap(headers, fields[kind]), options: opts }));
      } catch (e) { toast('error', `${file.name}: ${errorMessage(t, e)}`); }
    }
    setBusy(false);
    if (added.length) setSession((s) => [...s, ...added]);
    load();
  };

  const act = async (u: { id: number; file_name: string; kind: CsvKind }, action: 'apply' | 'approve', silent = false) => {
    try {
      const r = await api.post<UploadDetail>(`/uploads/${u.id}/${action}`, {});
      if (!silent) {
        const c = counts(r.summary);
        toast('success', r.status === 'pending_approval' ? t('csv.sentForApproval') : t('csv.uploadResult', { name: u.file_name, ok: c.ok, dup: c.dup, err: c.err }));
      }
      onApplied?.();
      return true;
    } catch (e: any) {
      toast('error', `${u.file_name}: ${errorMessage(t, e)}${e.details?.errorRows ? ` (${t('csv.errorRowsN', { n: e.details.errorRows })})` : ''}`);
      return false;
    } finally {
      load();
      refreshSession(sessionRef.current);
    }
  };

  /** 업로드: 기존 데이터를 덮어쓰는 행이 있으면 먼저 확인 */
  const upload = (u: UploadDetail) => {
    if (u.summary.update > 0 && u.kind !== 'results') { setOverwrite(u); return; }
    act(u, 'apply');
  };

  const pendingApproval = (uploads ?? []).filter((u) => u.kind === kind && u.status === 'pending_approval');
  const history = (uploads ?? []).filter((u) => u.kind === kind && !session.some((x) => x.id === u.id));
  const sessionFiles = session.filter((u) => u.kind === kind);
  const stagedInSession = sessionFiles.filter((u) => u.status === 'staged');

  const uploadAll = async () => {
    let n = 0;
    for (const u of stagedInSession) {
      if (u.summary.update > 0 && u.kind !== 'results') continue; // 덮어쓰기 파일은 개별 확인 후 업로드
      if (await act(u, 'apply', true)) n++;
    }
    toast(n ? 'success' : 'info', t('csv.appliedAll', { n, total: stagedInSession.length }));
  };

  return (
    <div className="space-y-4">
      {kinds.length > 1 && (
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {kinds.map((k) => (
            <button key={k} onClick={() => setKind(k)} className={cx('rounded-md px-3 py-1.5 text-sm', kind === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
              {t(`csv.kind.${k}`)}
            </button>
          ))}
        </div>
      )}
      {description && <p className="text-sm text-slate-500">{description}</p>}
      {kind === 'employees' && <p className="text-sm text-slate-500">{t('csv.dupRule')}</p>}
      {kind === 'results' && <div className="flex items-start gap-2 rounded-lg bg-violet-50 p-3 text-sm text-violet-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{t('csv.resultsApprovalNote')}</div>}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={cx('flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition',
          dragOver ? 'border-brand-600 bg-brand-50' : 'border-slate-300 bg-white')}>
        <UploadCloud className="h-10 w-10 text-brand-600" />
        <div className="text-sm font-medium text-slate-700">{t('csv.dropHere')}</div>
        <div className="text-xs text-slate-500">{t('csv.dropHintValidate')}</div>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button loading={busy} icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => inputRef.current?.click()}>{t('csv.selectFiles')}</Button>
          <Button variant="secondary" icon={<Download className="h-4 w-4" />}
            onClick={() => downloadFile(`/uploads/template/${kind}`, `${kind}_template.csv`).catch((e) => toast('error', errorMessage(t, e)))}>{t('csv.template')}</Button>
        </div>
        <input ref={inputRef} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {/* 선택한 파일별 검증 결과 → 데이터 확인·수정 → 파일별 업로드 */}
      {sessionFiles.length > 0 && (
        <div className="space-y-2">
          {stagedInSession.length > 1 && (
            <div className="flex justify-end"><Button size="sm" variant="teal" icon={<PlayCircle className="h-4 w-4" />} onClick={uploadAll}>{t('csv.uploadAllN', { n: stagedInSession.length })}</Button></div>
          )}
          {sessionFiles.map((u) => (
            <div key={u.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
              <FileSpreadsheet className="h-5 w-5 shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800">{u.file_name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {u.status === 'staged' ? t('csv.checked', { n: u.summary.total }) : <Badge color={STATUS_COLOR[u.status]}>{t(`csv.status.${u.status}`)}</Badge>}
                  <CountBadges sm={u.summary} t={t} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setEditing(u.id)}>{u.status === 'staged' ? t('csv.previewEdit') : t('common.view')}</Button>
                {u.status === 'staged' && <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => upload(u)}>{u.kind === 'results' ? t('csv.requestApproval') : t('csv.upload')}</Button>}
                {u.status === 'staged' && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />} onClick={() => setConfirm({ type: 'cancel', u })}>{t('common.cancel')}</Button>}
                {u.status !== 'staged' && <Button size="sm" variant="ghost" onClick={() => setSession((s) => s.filter((x) => x.id !== u.id))}>{t('common.close')}</Button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 결과 CSV 승인 대기 (승인권자용) */}
      {pendingApproval.length > 0 && (
        <UploadTable title={t('csv.status.pending_approval')} items={pendingApproval} />
      )}

      <div>
        <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? t('csv.hideHistory') : t('csv.showHistoryBtn')}
        </button>
        {showHistory && <div className="mt-2">{!uploads ? <Spinner /> : history.length === 0 ? <EmptyState title={t('csv.noFiles')} /> : <UploadTable title={t('csv.history')} items={history} />}</div>}
      </div>

      {editing !== null && fields && (
        <UploadEditor id={editing} fields={fields} onClose={() => { setEditing(null); load(); refreshSession(session); }}
          onApply={(u) => { setEditing(null); upload(u); }} />
      )}
      <ConfirmDialog open={!!overwrite} danger onClose={() => setOverwrite(null)} title={t('csv.overwriteTitle')}
        message={t('csv.overwriteMsg', { name: overwrite?.file_name ?? '', n: overwrite?.summary.update ?? 0 })} confirmLabel={t('csv.overwriteConfirm')}
        onConfirm={async () => { if (overwrite) await act(overwrite, 'apply'); }} />
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} danger={confirm?.type !== 'revert'}
        title={confirm ? t(`csv.confirm.${confirm.type}.title`) : ''} message={confirm ? t(`csv.confirm.${confirm.type}.message`, { name: confirm.u.file_name }) : ''}
        requireReason={confirm?.type === 'reject'}
        onConfirm={async (reason) => {
          if (!confirm) return;
          try {
            if (confirm.type === 'cancel') { await api.del(`/uploads/${confirm.u.id}`); setSession((s) => s.filter((x) => x.id !== confirm.u.id)); }
            if (confirm.type === 'revert') { await api.post(`/uploads/${confirm.u.id}/revert`); onApplied?.(); }
            if (confirm.type === 'reject') await api.post(`/uploads/${confirm.u.id}/reject`, { note: reason });
            toast('success', t('common.done'));
            load();
            refreshSession(sessionRef.current);
          } catch (e) { toast('error', errorMessage(t, e)); throw e; }
        }} />
    </div>
  );

  function UploadTable({ title, items }: { title: string; items: Upload[] }) {
    return (
      <div className="card">
        <div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-semibold">{title}</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="th">{t('csv.fileName')}</th><th className="th">{t('common.status')}</th><th className="th text-right">{t('csv.rows')}</th>
              <th className="th">{t('csv.result')}</th><th className="th">{t('csv.uploadedBy')}</th><th className="th">{t('common.date')}</th><th className="th text-right">{t('common.actions')}</th>
            </tr></thead>
            <tbody>
              {items.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="td font-medium">{u.file_name}</td>
                  <td className="td"><Badge color={STATUS_COLOR[u.status]}>{t(`csv.status.${u.status}`)}</Badge>
                    {u.review_note && <div className="mt-0.5 text-xs text-slate-400">{u.review_note}</div>}</td>
                  <td className="td text-right">{u.row_count}</td>
                  <td className="td">{u.result ? <CountBadges sm={u.result} t={t} /> : '–'}</td>
                  <td className="td text-xs">{u.uploaded_by_name}</td>
                  <td className="td text-xs text-slate-500">{fmtDate(u.created_at, locale, true)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setEditing(u.id)}>{u.status === 'staged' ? t('csv.previewEdit') : t('common.view')}</Button>
                      {u.status === 'staged' && <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => act(u, 'apply')}>{u.kind === 'results' ? t('csv.requestApproval') : t('csv.upload')}</Button>}
                      {u.status === 'pending_approval' && can('results.import.approve') && u.uploaded_by !== user?.id &&
                        <Button size="sm" variant="teal" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => act(u, 'approve')}>{t('csv.approve')}</Button>}
                      {u.status === 'pending_approval' && can('results.import.approve') && u.uploaded_by !== user?.id &&
                        <Button size="sm" variant="ghost" icon={<Ban className="h-3.5 w-3.5" />} onClick={() => setConfirm({ type: 'reject', u })}>{t('csv.reject')}</Button>}
                      {['staged', 'pending_approval'].includes(u.status) && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />} onClick={() => setConfirm({ type: 'cancel', u })}>{t('common.cancel')}</Button>}
                      {u.status === 'applied' && (u.kind !== 'results' || can('results.import.approve')) &&
                        <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => setConfirm({ type: 'revert', u })}>{t('csv.revert')}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
}

const PAGE = 50;

function UploadEditor({ id, fields, onClose, onApply }: { id: number; fields: Record<CsvKind, FieldDef[]>; onClose: () => void; onApply: (u: UploadDetail) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [d, setD] = useState<UploadDetail | null>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<any>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [rowFilter, setRowFilter] = useState<'all' | 'errors' | 'duplicates'>('all');
  const [forms, setForms] = useState<any[]>([]);
  const [rounds, setRounds] = useState<any[]>([]);

  const apply = (x: UploadDetail) => { setD(x); setRows(x.rows); setMapping(x.mapping); setOptions(x.options ?? {}); setDirty(false); };
  useEffect(() => { api.get(`/uploads/${id}`).then(apply).catch((e) => toast('error', errorMessage(t, e))); }, [id, t, toast]);
  useEffect(() => {
    if (d?.kind === 'questions') api.get('/forms').then((r) => setForms(r.items.filter((f: any) => f.status === 'draft'))).catch(() => undefined);
    if (d?.kind === 'results' || d?.kind === 'kpis') api.get('/rounds').then((r) => setRounds(r.items)).catch(() => undefined);
  }, [d?.kind]);

  const editable = d?.status === 'staged';
  const save = async () => {
    setSaving(true);
    try { apply(await api.put(`/uploads/${id}`, { rows, mapping, options })); toast('success', t('csv.revalidated')); }
    catch (e) { toast('error', errorMessage(t, e)); } finally { setSaving(false); }
  };

  const vmap = useMemo(() => new Map((d?.validation ?? []).map((v) => [v.index, v])), [d]);
  const isDup = (i: number) => !!vmap.get(i)?.warnings.some((w) => w.code === 'EXISTS_SKIP' || w.code === 'DUPLICATE_OTHER_FILE');
  const indexed = rows.map((r, i) => ({ r, i })).filter(({ i }) => rowFilter === 'all' || (rowFilter === 'errors' ? (vmap.get(i)?.errors.length ?? 0) > 0 : isDup(i)));
  if (!d) return <Modal open onClose={onClose} title="…" size="full"><Spinner /></Modal>;
  const kindFields = fields[d.kind];
  const mappedHeaders = new Set(Object.values(mapping));
  const fieldLabel = (f: string) => t(`csv.field.${d.kind}.${f}`);
  const setCell = (i: number, h: string, v: string) => { setRows(rows.map((r, j) => (j === i ? { ...r, [h]: v } : r))); setDirty(true); };

  return (
    <Modal open onClose={onClose} size="full" title={<span className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-brand-600" />{d.file_name}</span>} footer={<>
      <div className="mr-auto flex flex-wrap items-center gap-2 text-xs">
        <Badge color="blue">{t('csv.sumTotal', { n: d.summary.total })}</Badge>
        {d.summary.create > 0 && <Badge color="green">{t('csv.sumCreate', { n: d.summary.create })}</Badge>}
        {d.summary.update > 0 && <Badge color="amber">{t('csv.sumUpdate', { n: d.summary.update })}</Badge>}
        {(d.summary.duplicate ?? 0) > 0 && <Badge color="violet">{t('csv.cntDuplicate', { n: d.summary.duplicate ?? 0 })}</Badge>}
        {d.summary.skip - (d.summary.duplicate ?? 0) > 0 && <Badge>{t('csv.sumSkip', { n: d.summary.skip - (d.summary.duplicate ?? 0) })}</Badge>}
        {d.summary.import > 0 && <Badge color="violet">{t('csv.sumImport', { n: d.summary.import })}</Badge>}
        {d.summary.errorRows > 0 && <Badge color="red">{t('csv.sumErrors', { n: d.summary.errorRows })}</Badge>}
        {dirty && <span className="text-amber-600">{t('csv.unsaved')}</span>}
      </div>
      <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
      {editable && <Button variant="secondary" loading={saving} onClick={save}>{t('csv.saveValidate')}</Button>}
      {editable && <Button disabled={dirty || (d.summary.errorRows > 0 && !options.skipInvalid)} onClick={() => onApply(d)}>{d.kind === 'results' ? t('csv.requestApproval') : t('csv.upload')}</Button>}
    </>}>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-3 lg:col-span-2">
          <h4 className="mb-2 text-xs font-semibold text-slate-600">{t('csv.mapping')}</h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {kindFields.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-xs">
                <span className="w-28 shrink-0 text-slate-600">{fieldLabel(f.key)}{f.required && <span className="text-red-500">*</span>}</span>
                <select disabled={!editable} className={cx('input !py-1 text-xs', f.required && !mapping[f.key] && 'border-red-400')} value={mapping[f.key] ?? ''}
                  onChange={(e) => { setMapping({ ...mapping, [f.key]: e.target.value }); setDirty(true); }}>
                  <option value="">{t('csv.notMapped')}</option>
                  {d.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-2 rounded-lg border border-slate-200 p-3 text-xs">
          <h4 className="font-semibold text-slate-600">{t('csv.options')}</h4>
          {(d.kind === 'employees' || d.kind === 'departments' || d.kind === 'kpis') && (
            <div className="space-y-1">
              {(['overwrite', 'add_only'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2"><input type="radio" disabled={!editable} checked={(options.mode ?? 'overwrite') === m}
                  onChange={() => { setOptions({ ...options, mode: m }); setDirty(true); }} />{t(`csv.mode.${m}`)}</label>
              ))}
              {d.kind === 'employees' && <label className="flex items-center gap-2"><input type="checkbox" disabled={!editable} checked={!!options.createDepartments}
                onChange={(e) => { setOptions({ ...options, createDepartments: e.target.checked }); setDirty(true); }} />{t('csv.createDepartments')}</label>}
            </div>
          )}
          {d.kind === 'questions' && (
            <div className="space-y-2">
              <select disabled={!editable} className="input !py-1 text-xs" value={options.formId ?? ''} onChange={(e) => { setOptions({ ...options, formId: Number(e.target.value) || undefined }); setDirty(true); }}>
                <option value="">{t('csv.selectDraftForm')}</option>
                {forms.map((f) => <option key={f.id} value={f.id}>{f.name} v{f.version}</option>)}
              </select>
              {(['append', 'replace'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2"><input type="radio" disabled={!editable} checked={(options.questionMode ?? 'append') === m}
                  onChange={() => { setOptions({ ...options, questionMode: m }); setDirty(true); }} />{t(`csv.qmode.${m}`)}</label>
              ))}
            </div>
          )}
          {(d.kind === 'results' || d.kind === 'kpis') && (
            <select disabled={!editable} className="input !py-1 text-xs" value={options.roundId ?? ''} onChange={(e) => { setOptions({ ...options, roundId: Number(e.target.value) || undefined }); setDirty(true); }}>
              <option value="">{t('csv.selectRound')}</option>
              {rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!editable} checked={!!options.skipInvalid}
            onChange={(e) => { setOptions({ ...options, skipInvalid: e.target.checked }); setDirty(true); }} />{t('csv.skipInvalid')}</label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <select className="input !w-auto !py-1 text-xs" value={rowFilter} onChange={(e) => { setRowFilter(e.target.value as typeof rowFilter); setPage(1); }} aria-label={t('csv.rowFilter')}>
          <option value="all">{t('csv.rowsAll')}</option><option value="errors">{t('csv.onlyErrors')}</option><option value="duplicates">{t('csv.onlyDuplicates')}</option>
        </select>
        {editable && <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />}
          onClick={() => { setRows([...rows, Object.fromEntries(d.headers.map((h) => [h, '']))]); setDirty(true); setPage(Math.ceil((rows.length + 1) / PAGE)); }}>{t('csv.addRow')}</Button>}
      </div>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead><tr>
            <th className="th w-10">#</th>
            {d.headers.map((h) => <th key={h} className={cx('th', !mappedHeaders.has(h) && 'text-slate-300')}>{h}</th>)}
            <th className="th">{t('csv.validation')}</th>{editable && <th className="th w-8" />}
          </tr></thead>
          <tbody>
            {indexed.slice((page - 1) * PAGE, page * PAGE).map(({ r, i }) => {
              const v = vmap.get(i);
              const errFields = new Set(v?.errors.map((e) => e.field));
              return (
                <tr key={i} className={cx(v?.errors.length ? 'bg-red-50/60' : v?.warnings.length ? 'bg-amber-50/40' : '')}>
                  <td className="td text-slate-400">{i + 1}</td>
                  {d.headers.map((h) => {
                    const field = Object.entries(mapping).find(([, hh]) => hh === h)?.[0];
                    return (
                      <td key={h} className="border-b border-slate-100 p-1">
                        <input disabled={!editable} value={r[h] ?? ''} onChange={(e) => setCell(i, h, e.target.value)}
                          className={cx('w-full min-w-[90px] rounded border px-1.5 py-1 outline-none focus:border-brand-600', field && errFields.has(field) ? 'border-red-400 bg-white' : 'border-transparent bg-transparent')} />
                      </td>
                    );
                  })}
                  <td className="td min-w-[220px]">
                    {v?.errors.map((e, k) => <div key={k} className="flex items-center gap-1 text-red-600"><AlertCircle className="h-3 w-3" />{fieldLabel(e.field)}: {t(`csv.err.${e.code}`)}</div>)}
                    {v?.warnings.map((e, k) => <div key={k} className="flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />{t(`csv.err.${e.code}`)}</div>)}
                    {!v?.errors.length && !v?.warnings.length && <span className="text-emerald-600">✓ {t(`csv.action.${v?.action ?? 'create'}`)}</span>}
                  </td>
                  {editable && <td className="td"><button className="text-slate-400 hover:text-red-600" aria-label={t('common.delete')}
                    onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 className="h-3.5 w-3.5" /></button></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE} total={indexed.length} onChange={setPage} />
    </Modal>
  );
}
