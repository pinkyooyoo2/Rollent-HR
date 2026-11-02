import { Fragment, useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Download, ArrowRightLeft, Crown, UserCog, ChevronDown, ChevronRight, StickyNote } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, SearchInput, SortHeader, Spinner, Tabs, cx, useSort, sortRows,
} from '../components/ui';
import CsvManager from '../components/CsvManager';
import { fmtDate, fmtScore, OverallBadge, POSITIONS, posLabel } from '../lib/status';

type Tab = 'employees' | 'departments' | 'csv';

export default function OrganizationPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('employees');
  const [version, setVersion] = useState(0);
  return (
    <div>
      <PageHeader title={t('nav.organization')} description={t('org.description')} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'employees', label: t('org.tab.employees') },
        { id: 'departments', label: t('org.tab.departments') },
        ...(can('org.manage') ? [{ id: 'csv' as Tab, label: t('org.tab.csv') }] : []),
      ]} />
      {tab === 'employees' && <EmployeesTab key={version} />}
      {tab === 'departments' && <DepartmentsTab key={version} />}
      {tab === 'csv' && <CsvManager kinds={['employees', 'departments']} description={t('org.csvDesc')} onApplied={() => setVersion((v) => v + 1)} />}
    </div>
  );
}

const statusColor = (s: string) => (s === 'active' ? 'green' : s === 'leave' ? 'amber' : 'slate');

/* ───────────── 부서 ───────────── */

function useEmployeeOptions() {
  const [list, setList] = useState<any[]>([]);
  const reload = useCallback(() => { api.get('/employees?all=1').then((r) => setList(r.items)).catch(() => undefined); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { list, reload };
}

function DepartmentsTab() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const { sort, onSort } = useSort('name');
  const [edit, setEdit] = useState<any | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [del, setDel] = useState<any | null>(null);
  const [blocked, setBlocked] = useState<any | null>(null);
  const emps = useEmployeeOptions();

  const load = useCallback(() => {
    setError('');
    api.get(`/departments?q=${encodeURIComponent(q)}`).then((r) => setItems(r.items)).catch((e) => setError(errorMessage(t, e)));
  }, [q, t]);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  const changed = () => { load(); emps.reload(); setReloadKey((k) => k + 1); };

  const rows = sortRows(items ?? [], sort, (r, c) => (c === 'members' ? r.member_count : c === 'leader' ? r.leader_name : r[c]));
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const askDelete = (d: any) => (d.member_count > 0 ? setBlocked(d) : setDel(d));

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <SearchInput value={q} onChange={setQ} placeholder={t('org.searchDept')} />
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile('/departments/export.csv', 'departments.csv').catch((e) => toast('error', errorMessage(t, e)))}>{t('common.exportCsv')}</Button>
          {can('org.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({})}>{t('org.addDept')}</Button>}
        </div>
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : !items ? <Spinner /> : rows.length === 0 ? <EmptyState /> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <SortHeader label={t('org.deptName')} col="name" sort={sort} onSort={onSort} />
              <SortHeader label={t('org.leader')} col="leader" sort={sort} onSort={onSort} />
              <SortHeader label={t('org.memberCount')} col="members" sort={sort} onSort={onSort} className="text-right" />
              <th className="th text-right">{t('common.actions')}</th>
            </tr></thead>
            <tbody>
              {rows.map((d) => (
                <Fragment key={d.id}>
                  <tr className={cx('hover:bg-slate-50', open.has(d.id) && 'bg-brand-50')}>
                    <td className="td font-medium">
                      {/* 부서명 옆 토글: 누르면 아래로 상세정보가 펼쳐지고 다시 누르면 접힘 */}
                      <button className="inline-flex items-center gap-1.5 hover:text-brand-700" onClick={() => toggle(d.id)} aria-expanded={open.has(d.id)} title={t('org.toggleDetail')}>
                        {open.has(d.id) ? <ChevronDown className="h-4 w-4 text-brand-600" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        {d.name}
                      </button>
                    </td>
                    <td className="td">{d.leader_name ?? <span className="text-slate-400">{t('org.noLeader')}</span>}</td>
                    <td className="td text-right">{d.member_count}</td>
                    <td className="td">
                      {can('org.manage') && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(d)}>{t('common.edit')}</Button>
                          <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />} onClick={() => askDelete(d)}>{t('common.delete')}</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {open.has(d.id) && (
                    <tr>
                      <td colSpan={4} className="border-b border-slate-200 bg-slate-50/60 p-0">
                        <DepartmentDetail key={reloadKey} id={d.id} employees={emps.list} onChanged={changed} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <DepartmentModal dept={edit} employees={emps.list} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); changed(); }} />}
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('org.deleteDeptTitle')} message={t('org.deleteDeptMsg', { name: del?.name ?? '' })} confirmLabel={t('common.delete')}
        onConfirm={async () => {
          try { await api.del(`/departments/${del.id}`); toast('success', t('common.deleted')); changed(); } catch (e) { toast('error', errorMessage(t, e)); throw e; }
        }} />
      <Modal open={!!blocked} onClose={() => setBlocked(null)} size="sm" title={t('org.deleteDeptBlockedTitle')} footer={<>
        <Button variant="secondary" onClick={() => setBlocked(null)}>{t('common.close')}</Button>
        <Button onClick={() => { setOpen((s) => new Set(s).add(blocked.id)); setBlocked(null); }}>{t('org.showMembers')}</Button>
      </>}>
        <p className="text-sm text-slate-600">{t('org.deleteDeptBlocked', { name: blocked?.name ?? '', n: blocked?.member_count ?? 0 })}</p>
      </Modal>
    </div>
  );
}

function DepartmentModal({ dept, employees, onClose, onSaved }: { dept: any; employees: any[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({ name: dept.name ?? '', leader_employee_id: dept.leader_employee_id ?? null, description: dept.description ?? '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = t('validation.required');
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (dept.id) await api.put(`/departments/${dept.id}`, f); else await api.post('/departments', f);
      toast('success', t('common.saved'));
      onSaved();
    } catch (err) { toast('error', errorMessage(t, err)); } finally { setBusy(false); }
  };
  const members = dept.id ? employees.filter((e) => e.department_id === dept.id) : employees;
  return (
    <Modal open onClose={onClose} title={dept.id ? t('org.editDept') : t('org.addDept')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={save}>{t('common.save')}</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('org.deptName')} required error={errs.name}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('org.leader')} hint={dept.id ? undefined : t('org.leaderMoveHint')}>
          <select className="input" value={f.leader_employee_id ?? ''} onChange={(e) => setF({ ...f, leader_employee_id: Number(e.target.value) || null })}>
            <option value="">{t('org.noLeader')}</option>
            {members.map((e) => <option key={e.id} value={e.id}>{e.department_name && !dept.id ? `${e.department_name} · ` : ''}{posLabel(t, e.position)} · {e.name}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2"><Field label={t('common.description')}><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
      </div>
    </Modal>
  );
}

/** 부서 상세 (아코디언 펼침 영역): 팀장 변경, 소속 직원(직급 → 직원명 순), 직원 부서 이동 */
function DepartmentDetail({ id, employees, onChanged }: { id: number; employees: any[]; onChanged: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [d, setD] = useState<any | null>(null);
  const [depts, setDepts] = useState<any[]>([]);
  const [move, setMove] = useState<any | null>(null);
  const load = useCallback(() => { api.get(`/departments/${id}`).then(setD).catch((e) => toast('error', errorMessage(t, e))); }, [id, t, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (can('org.manage')) api.get('/departments').then((r) => setDepts(r.items)).catch(() => undefined); }, [can]);
  const setLeader = async (employeeId: number | null) => {
    try { await api.put(`/departments/${id}/leader`, { employeeId }); toast('success', t('org.leaderChanged')); load(); onChanged(); }
    catch (e) { toast('error', errorMessage(t, e)); }
  };
  if (!d) return <Spinner />;
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-3">
      <div className="space-y-3">
        {d.description && <p className="text-sm text-slate-600">{d.description}</p>}
        <dl className="text-sm"><dt className="text-xs text-slate-500">{t('org.leader')}</dt><dd className="font-medium">{d.leader_name ?? '–'}</dd></dl>
        {can('org.manage') && (
          <Field label={t('org.changeLeader')}>
            <select className="input" value={d.leader_employee_id ?? ''} onChange={(e) => setLeader(Number(e.target.value) || null)}>
              <option value="">{t('org.noLeader')}</option>
              {employees.filter((e) => e.department_id === id).map((e) => <option key={e.id} value={e.id}>{posLabel(t, e.position)} · {e.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className="lg:col-span-2">
        <h4 className="mb-2 text-sm font-semibold text-slate-700">{t('org.membersN', { n: d.members.length })}</h4>
        {d.members.length === 0 ? <p className="text-sm text-slate-400">{t('org.noMembers')}</p> : (
          <table className="w-full rounded-lg bg-white">
            <thead><tr><th className="th">{t('common.position')}</th><th className="th">{t('common.employeeName')}</th><th className="th">{t('org.empStatus')}</th>{can('org.manage') && <th className="th" />}</tr></thead>
            <tbody>
              {d.members.map((m: any) => (
                <tr key={m.id}>
                  <td className="td whitespace-nowrap">{posLabel(t, m.position)}</td>
                  <td className="td font-medium"><span className="inline-flex items-center gap-1.5">{d.leader_employee_id === m.id && <Crown className="h-4 w-4 text-amber-500" aria-label={t('org.leader')} />}{m.name}</span></td>
                  <td className="td"><Badge color={statusColor(m.status)}>{t(`empStatus.${m.status}`)}</Badge></td>
                  {can('org.manage') && <td className="td text-right"><Button size="sm" variant="ghost" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} onClick={() => setMove({ ...m, department_id: id, department_name: d.name })}>{t('org.move')}</Button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {move && <MoveModal emp={move} depts={depts} onClose={() => setMove(null)} onSaved={() => { setMove(null); load(); onChanged(); }} />}
    </div>
  );
}

/* ───────────── 직원 ───────────── */

function EmployeesTab() {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<{ items: any[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [deptId, setDeptId] = useState('');
  const [status, setStatus] = useState('');
  const [jobGroup, setJobGroup] = useState('');
  const [position, setPosition] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // 기본 정렬('')은 서버의 부서 → 직급 → 직원명 순서. 열 머리글을 누르면 그 열 기준으로 정렬
  const { sort, onSort } = useSort('');
  const [orgSort, setOrgSort] = useState(true);
  const [depts, setDepts] = useState<any[]>([]);
  const [editId, setEditId] = useState<number | 'new' | null>(null);

  useEffect(() => { api.get('/departments').then((r) => setDepts(r.items)).catch(() => undefined); }, []);
  const load = useCallback(() => {
    setError('');
    const p = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize) });
    if (!orgSort && sort.col) { p.set('sort', sort.col); p.set('dir', sort.dir); }
    if (deptId) p.set('departmentId', deptId);
    if (status) p.set('status', status);
    if (jobGroup) p.set('jobGroup', jobGroup);
    if (position) p.set('position', position);
    api.get(`/employees?${p}`).then(setData).catch((e) => setError(errorMessage(t, e)));
  }, [q, deptId, status, jobGroup, position, page, pageSize, sort, orgSort, t]);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  useEffect(() => setPage(1), [q, deptId, status, jobGroup, position]);
  const sortBy = (col: string) => { setOrgSort(false); onSort(col); };
  const shownSort = orgSort ? { col: '', dir: 'asc' as const } : sort;

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <SearchInput value={q} onChange={setQ} placeholder={t('org.searchEmpName')} />
        <select className="input !w-auto" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
          <option value="">{t('common.allDepartments')}</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="input !w-auto" value={position} onChange={(e) => setPosition(e.target.value)} aria-label={t('common.position')}>
          <option value="">{t('org.allPositions')}</option>{POSITIONS.map((p) => <option key={p} value={p}>{posLabel(t, p)}</option>)}
        </select>
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('org.allStatus')}</option>{['active', 'leave', 'resigned'].map((s) => <option key={s} value={s}>{t(`empStatus.${s}`)}</option>)}
        </select>
        <select className="input !w-auto" value={jobGroup} onChange={(e) => setJobGroup(e.target.value)}>
          <option value="">{t('org.allJobGroups')}</option><option value="office">{t('jobGroup.office')}</option><option value="production">{t('jobGroup.production')}</option>
        </select>
        {!orgSort && <Button size="sm" variant="ghost" onClick={() => setOrgSort(true)}>{t('org.orgSort')}</Button>}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile('/employees/export.csv', 'employees.csv').catch((e) => toast('error', errorMessage(t, e)))}>{t('common.exportCsv')}</Button>
          {can('org.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditId('new')}>{t('org.addEmp')}</Button>}
        </div>
      </div>
      <p className="border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs text-slate-500">{t('org.clickNameHint')}</p>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Spinner /> : data.items.length === 0 ? <EmptyState /> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <SortHeader label={t('common.department')} col="department" sort={shownSort} onSort={sortBy} />
              <SortHeader label={t('common.position')} col="position" sort={shownSort} onSort={sortBy} />
              <SortHeader label={t('common.employeeName')} col="name" sort={shownSort} onSort={sortBy} />
              <SortHeader label={t('org.empStatus')} col="status" sort={shownSort} onSort={sortBy} />
              {can('org.manage') && <th className="th text-right">{t('common.actions')}</th>}
            </tr></thead>
            <tbody>
              {data.items.map((e, i) => {
                // 부서별 묶음: 기본 정렬일 때 부서가 바뀌는 행 앞에 부서 제목 행
                const group = orgSort && (i === 0 || data.items[i - 1].department_name !== e.department_name);
                return (
                  <Fragment key={e.id}>
                    {group && <tr><td colSpan={can('org.manage') ? 5 : 4} className="border-b border-slate-200 bg-brand-50/70 px-4 py-2 text-sm font-semibold text-brand-700">{e.department_name ?? t('org.noDept')}</td></tr>}
                    <tr className="hover:bg-slate-50">
                      <td className="td whitespace-nowrap">{e.department_name ?? '–'}</td>
                      <td className="td whitespace-nowrap">{posLabel(t, e.position)}</td>
                      <td className="td font-medium"><button className="text-brand-700 hover:underline" onClick={() => setEditId(e.id)}>{e.name}</button></td>
                      <td className="td"><Badge color={statusColor(e.status)}>{t(`empStatus.${e.status}`)}</Badge></td>
                      {/* 직원명 클릭과 같은 수정 화면을 엶 (삭제는 수정 화면 안에서만) */}
                      {can('org.manage') && <td className="td text-right">
                        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditId(e.id)}>{t('common.edit')}</Button>
                      </td>}
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <div className="px-4 pb-3"><Pagination page={page} pageSize={pageSize} total={data.total} onChange={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} /></div>}
      {editId !== null && <EmployeeEditor id={editId === 'new' ? null : editId} depts={depts} onClose={() => setEditId(null)} onChanged={load} />}
    </div>
  );
}

/**
 * 직원 상세·수정 (직원명 클릭 시 바로 열림)
 *  - 항목 순서: 부서 → 직급 → 재직상태 → 직원명 → 사번, 메모(관리자 전용). 이메일·연락처는 표시하지 않음
 *  - 부서를 바꾸고 저장하면 부서 이동
 *  - 직원 삭제는 이 화면 안에서만 (확인 후 소프트 삭제: 평가 이력 보존)
 */
function EmployeeEditor({ id, depts, onClose, onChanged }: { id: number | null; depts: any[]; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('org.manage');
  const [e, setE] = useState<any | null>(id ? null : {});
  const [f, setF] = useState({ department_id: null as number | null, position: '팀원', status: 'active', name: '', emp_no: '', job_group: 'office', hire_date: '', memo: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [acc, setAcc] = useState({ role: 'employee', isActive: true });
  const [accBusy, setAccBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    api.get(`/employees/${id}`).then((x) => {
      setE(x);
      setF({
        department_id: x.department_id ?? null, position: (POSITIONS as readonly string[]).includes(x.position) ? x.position : '팀원', status: x.status ?? 'active',
        name: x.name ?? '', emp_no: x.emp_no ?? '', job_group: x.job_group ?? 'office', hire_date: x.hire_date ?? '', memo: x.memo ?? '',
      });
      setAcc({ role: x.role ?? (x.is_leader ? 'leader' : 'employee'), isActive: x.account_active === undefined || x.account_active === null ? true : !!x.account_active });
    }).catch((err) => toast('error', errorMessage(t, err)));
  }, [id, t, toast]);
  useEffect(() => { load(); }, [load]);

  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  const save = async () => {
    const er: Record<string, string> = {};
    if (!f.emp_no.trim()) er.emp_no = t('validation.required'); else if (!/^[A-Za-z0-9_-]+$/.test(f.emp_no)) er.emp_no = t('validation.codeFormat');
    if (!f.name.trim()) er.name = t('validation.required');
    setErrs(er);
    if (Object.keys(er).length) return;
    setBusy(true);
    try {
      if (id) await api.put(`/employees/${id}`, f); else await api.post('/employees', f);
      toast('success', t('common.saved'));
      onChanged();
      onClose();
    } catch (err) { toast('error', errorMessage(t, err)); } finally { setBusy(false); }
  };
  const saveAccount = async () => {
    setAccBusy(true);
    try { await api.put(`/employees/${id}/account`, acc); toast('success', t('common.saved')); load(); onChanged(); }
    catch (err) { toast('error', errorMessage(t, err)); } finally { setAccBusy(false); }
  };
  const moved = !!id && e && f.department_id !== (e.department_id ?? null);

  return (
    <Modal open onClose={onClose} size="lg" title={!id ? t('org.addEmp') : manage ? t('org.editEmp') : t('org.empDetail')} footer={<>
      {id && manage && <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDel(true)}>{t('org.deleteEmpTitle')}</Button>}
      <Button variant="secondary" onClick={onClose}>{manage ? t('common.cancel') : t('common.close')}</Button>
      {manage && <Button loading={busy} onClick={save}>{t('common.save')}</Button>}
    </>}>
      {!e ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('common.department')} hint={moved ? t('org.deptMoveHint') : undefined}>
              <select className="input" disabled={!manage} value={f.department_id ?? ''} onChange={(x) => set('department_id', Number(x.target.value) || null)}>
                <option value="">–</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label={t('common.position')} required>
              <select className="input" disabled={!manage} value={f.position} onChange={(x) => set('position', x.target.value)}>
                {POSITIONS.map((p) => <option key={p} value={p}>{posLabel(t, p)}</option>)}
              </select>
            </Field>
            <Field label={t('org.empStatus')}>
              <select className="input" disabled={!manage} value={f.status} onChange={(x) => set('status', x.target.value)}>
                {['active', 'leave', 'resigned'].map((s) => <option key={s} value={s}>{t(`empStatus.${s}`)}</option>)}
              </select>
            </Field>
            <Field label={t('common.employeeName')} required error={errs.name}><input className="input" disabled={!manage} value={f.name} onChange={(x) => set('name', x.target.value)} /></Field>
            <Field label={t('common.empNo')} required error={errs.emp_no}><input className="input" disabled={!manage} value={f.emp_no} onChange={(x) => set('emp_no', x.target.value)} /></Field>
            <Field label={t('org.jobGroup')}>
              <select className="input" disabled={!manage} value={f.job_group} onChange={(x) => set('job_group', x.target.value)}>
                <option value="office">{t('jobGroup.office')}</option><option value="production">{t('jobGroup.production')}</option>
              </select>
            </Field>
            <Field label={t('org.hireDate')}><input type="date" className="input" disabled={!manage} value={f.hire_date} onChange={(x) => set('hire_date', x.target.value)} /></Field>
          </div>
          {manage && (
            <div>
              <label className="label flex items-center gap-1.5" htmlFor="emp-memo"><StickyNote className="h-4 w-4 text-brand-600" />{t('org.memo')}<Badge color="amber">{t('org.memoAdminOnly')}</Badge></label>
              <textarea id="emp-memo" className="input" rows={3} maxLength={2000} placeholder={t('org.memoPlaceholder')} value={f.memo} onChange={(x) => set('memo', x.target.value)} />
            </div>
          )}
          <p className="text-xs text-slate-400">{t('org.jobGroupHint')}</p>
          {id && <>
            <div>
              <h4 className="mb-2 text-sm font-semibold">{t('org.evalHistory')}</h4>
              {e.history?.length ? (
                <table className="w-full"><thead><tr><th className="th">{t('common.round')}</th><th className="th">{t('common.status')}</th>{can('results.view') && <th className="th text-right">{t('results.finalScore')}</th>}</tr></thead>
                  <tbody>{e.history.map((h: any) => (
                    <tr key={h.round_id}><td className="td">{h.round_name}</td><td className="td"><OverallBadge state={h.state} t={t} /></td>{can('results.view') && <td className="td text-right font-semibold">{fmtScore(h.final_score)}</td>}</tr>
                  ))}</tbody></table>
              ) : <p className="text-sm text-slate-400">{t('common.noData')}</p>}
            </div>
            {can('users.manage') && (
              <div className="rounded-lg border border-slate-200 p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><UserCog className="h-4 w-4" />{t('org.account')}{!e.user_id && <Badge color="amber">{t('org.noAccount')}</Badge>}
                  <span className="ml-auto text-xs font-normal text-slate-400">{t('org.lastLogin')}: {fmtDate(e.last_login_at, locale, true)}</span></h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t('org.role')}>
                    <select className="input" value={acc.role} onChange={(x) => setAcc({ ...acc, role: x.target.value })}>
                      {['employee', 'leader', 'executive', 'admin'].map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                    </select>
                  </Field>
                  <div className="text-xs text-slate-500 sm:pt-6">{t('org.loginInfo', { name: e.name, empNo: e.emp_no })}</div>
                  <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={acc.isActive} onChange={(x) => setAcc({ ...acc, isActive: x.target.checked })} />{t('org.accountActive')}</label>
                </div>
                <div className="mt-3 flex justify-end"><Button size="sm" loading={accBusy} onClick={saveAccount}>{e.user_id ? t('org.updateAccount') : t('org.createAccount')}</Button></div>
              </div>
            )}
          </>}
        </div>
      )}
      <ConfirmDialog open={confirmDel} danger onClose={() => setConfirmDel(false)} title={t('org.deleteEmpTitle')}
        message={e?.history?.length ? t('org.deleteEmpMsgHistory', { name: e?.name ?? '', n: e.history.length }) : t('org.deleteEmpMsg', { name: e?.name ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          try { await api.del(`/employees/${id}`); toast('success', t('common.deleted')); onChanged(); onClose(); } catch (err) { toast('error', errorMessage(t, err)); throw err; }
        }} />
    </Modal>
  );
}

function MoveModal({ emp, depts, onClose, onSaved }: { emp: any; depts: any[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [to, setTo] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} size="sm" title={t('org.moveTitle', { name: emp.name })} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button loading={busy} disabled={!to} onClick={async () => {
        setBusy(true);
        try { await api.post(`/employees/${emp.id}/move`, { departmentId: to }); toast('success', t('org.moved')); onSaved(); }
        catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(false); }
      }}>{t('org.move')}</Button>
    </>}>
      <p className="mb-3 text-sm text-slate-600">{t('org.currentDept')}: <b>{emp.department_name ?? '–'}</b></p>
      <select className="input" value={to} onChange={(e) => setTo(Number(e.target.value) || '')}>
        <option value="">{t('org.selectDept')}</option>
        {depts.filter((d) => d.id !== emp.department_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      {emp.is_leader ? <p className="mt-2 text-xs text-amber-600">{t('org.moveLeaderWarn')}</p> : null}
    </Modal>
  );
}
