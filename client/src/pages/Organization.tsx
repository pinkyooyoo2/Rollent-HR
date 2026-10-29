import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Download, ArrowRightLeft, RotateCcw, Crown, UserCog, X, Eye } from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import {
  Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, SearchInput, SortHeader, Spinner, Tabs, cx, useSort, sortRows,
} from '../components/ui';
import CsvManager from '../components/CsvManager';
import { fmtDate, fmtScore, OverallBadge, POSITIONS, posLabel } from '../lib/status';

type Tab = 'departments' | 'employees' | 'csv';

export default function OrganizationPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('departments');
  const [version, setVersion] = useState(0);
  return (
    <div>
      <PageHeader title={t('nav.organization')} description={t('org.description')} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'departments', label: t('org.tab.departments') },
        { id: 'employees', label: t('org.tab.employees') },
        ...(can('org.manage') ? [{ id: 'csv' as Tab, label: t('org.tab.csv') }] : []),
      ]} />
      {tab === 'departments' && <DepartmentsTab key={version} />}
      {tab === 'employees' && <EmployeesTab key={version} />}
      {tab === 'csv' && <CsvManager kinds={['employees', 'departments']} description={t('org.csvDesc')} onApplied={() => setVersion((v) => v + 1)} />}
    </div>
  );
}

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
  const [detailId, setDetailId] = useState<number | null>(null);
  const emps = useEmployeeOptions();

  const load = useCallback(() => {
    setError('');
    api.get(`/departments?q=${encodeURIComponent(q)}`).then((r) => setItems(r.items)).catch((e) => setError(errorMessage(t, e)));
  }, [q, t]);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);

  const rows = sortRows(items ?? [], sort, (r, c) => (c === 'members' ? r.member_count : c === 'leader' ? r.leader_name : r[c]));

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <div className={cx('card', detailId ? 'xl:col-span-3' : 'xl:col-span-5')}>
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
                  <tr key={d.id} className={cx('cursor-pointer hover:bg-slate-50', detailId === d.id && 'bg-brand-50')} onClick={() => setDetailId(d.id)}>
                    <td className="td font-medium">{d.name}</td>
                    <td className="td">{d.leader_name ?? <span className="text-slate-400">{t('org.noLeader')}</span>}</td>
                    <td className="td text-right">{d.member_count}</td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setDetailId(d.id)}>{t('common.detail')}</Button>
                        {can('org.manage') && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(d)}>{t('common.edit')}</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {detailId && <DepartmentDetail id={detailId} onClose={() => setDetailId(null)} employees={emps.list} onChanged={() => { load(); emps.reload(); }} />}
      {edit && <DepartmentModal dept={edit} employees={emps.list} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); emps.reload(); }} />}
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
            {members.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.emp_no}){e.department_name && !dept.id ? ` · ${e.department_name}` : ''}</option>)}
          </select>
        </Field>
        <div className="sm:col-span-2"><Field label={t('common.description')}><textarea className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
      </div>
    </Modal>
  );
}

function DepartmentDetail({ id, onClose, employees, onChanged }: { id: number; onClose: () => void; employees: any[]; onChanged: () => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [d, setD] = useState<any | null>(null);
  const load = useCallback(() => { api.get(`/departments/${id}`).then(setD).catch((e) => toast('error', errorMessage(t, e))); }, [id, t, toast]);
  useEffect(() => { load(); }, [load]);
  const setLeader = async (employeeId: number | null) => {
    try { await api.put(`/departments/${id}/leader`, { employeeId }); toast('success', t('org.leaderChanged')); load(); onChanged(); }
    catch (e) { toast('error', errorMessage(t, e)); }
  };
  return (
    <aside className="card xl:col-span-2">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold">{t('org.deptDetail')}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label={t('common.close')}><X className="h-4 w-4" /></button>
      </div>
      {!d ? <Spinner /> : (
        <div className="space-y-4 p-4">
          <div>
            <div className="text-lg font-bold text-navy-900">{d.name}</div>
            {d.description && <p className="text-sm text-slate-500">{d.description}</p>}
          </div>
          <dl className="text-sm">
            <div><dt className="text-xs text-slate-500">{t('org.leader')}</dt><dd className="font-medium">{d.leader_name ?? '–'}</dd></div>
          </dl>
          {can('org.manage') && (
            <Field label={t('org.changeLeader')}>
              <select className="input" value={d.leader_employee_id ?? ''} onChange={(e) => setLeader(Number(e.target.value) || null)}>
                <option value="">{t('org.noLeader')}</option>
                {employees.filter((e) => e.department_id === id).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.emp_no})</option>)}
              </select>
            </Field>
          )}
          <div>
            <h4 className="mb-2 text-xs font-semibold text-slate-600">{t('org.membersN', { n: d.members.length })}</h4>
            {d.members.length === 0 ? <EmptyState /> : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {d.members.map((m: any) => (
                  <li key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      {d.leader_employee_id === m.id && <Crown className="h-4 w-4 text-amber-500" aria-label={t('org.leader')} />}
                      <span className="font-medium">{m.name}</span><span className="text-xs text-slate-400">{m.emp_no}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-slate-500">{posLabel(t, m.position)}<Badge color={m.status === 'active' ? 'green' : m.status === 'leave' ? 'amber' : 'slate'}>{t(`empStatus.${m.status}`)}</Badge></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </aside>
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
  const [deleted, setDeleted] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { sort, onSort } = useSort('emp_no');
  const [depts, setDepts] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [move, setMove] = useState<any | null>(null);
  const [del, setDel] = useState<any | null>(null);

  useEffect(() => { api.get('/departments').then((r) => setDepts(r.items)).catch(() => undefined); }, []);
  const load = useCallback(() => {
    setError('');
    const p = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize), sort: sort.col, dir: sort.dir });
    if (deptId) p.set('departmentId', deptId);
    if (status) p.set('status', status);
    if (jobGroup) p.set('jobGroup', jobGroup);
    if (position) p.set('position', position);
    if (deleted) { p.set('includeDeleted', '1'); p.set('onlyDeleted', '1'); }
    api.get(`/employees?${p}`).then(setData).catch((e) => setError(errorMessage(t, e)));
  }, [q, deptId, status, jobGroup, position, deleted, page, pageSize, sort, t]);
  useEffect(() => { const h = setTimeout(load, 200); return () => clearTimeout(h); }, [load]);
  useEffect(() => setPage(1), [q, deptId, status, jobGroup, position, deleted]);

  const restore = async (e: any) => {
    try { await api.post(`/employees/${e.id}/restore`); toast('success', t('org.restored')); load(); } catch (err) { toast('error', errorMessage(t, err)); }
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
        <SearchInput value={q} onChange={setQ} placeholder={t('org.searchEmp')} />
        <select className="input !w-auto" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
          <option value="">{t('common.allDepartments')}</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('org.allStatus')}</option>{['active', 'leave', 'resigned'].map((s) => <option key={s} value={s}>{t(`empStatus.${s}`)}</option>)}
        </select>
        <select className="input !w-auto" value={position} onChange={(e) => setPosition(e.target.value)} aria-label={t('common.position')}>
          <option value="">{t('org.allPositions')}</option>{POSITIONS.map((p) => <option key={p} value={p}>{posLabel(t, p)}</option>)}
        </select>
        <select className="input !w-auto" value={jobGroup} onChange={(e) => setJobGroup(e.target.value)}>
          <option value="">{t('org.allJobGroups')}</option><option value="office">{t('jobGroup.office')}</option><option value="production">{t('jobGroup.production')}</option>
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={deleted} onChange={(e) => setDeleted(e.target.checked)} />{t('org.showDeleted')}</label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => downloadFile('/employees/export.csv', 'employees.csv').catch((e) => toast('error', errorMessage(t, e)))}>{t('common.exportCsv')}</Button>
          {can('org.manage') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({})}>{t('org.addEmp')}</Button>}
        </div>
      </div>
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Spinner /> : data.items.length === 0 ? <EmptyState /> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <SortHeader label={t('common.empNo')} col="emp_no" sort={sort} onSort={onSort} />
              <SortHeader label={t('common.employeeName')} col="name" sort={sort} onSort={onSort} />
              <SortHeader label={t('common.department')} col="department" sort={sort} onSort={onSort} />
              <SortHeader label={t('common.position')} col="position" sort={sort} onSort={onSort} />
              <SortHeader label={t('org.empStatus')} col="status" sort={sort} onSort={onSort} />
              <th className="th text-right">{t('common.actions')}</th>
            </tr></thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id} className={cx('hover:bg-slate-50', e.deleted_at && 'text-slate-400')}>
                  <td className="td font-mono text-xs">{e.emp_no}</td>
                  <td className="td font-medium"><button className="hover:text-brand-600 hover:underline" onClick={() => setDetail(e.id)}>{e.name}</button></td>
                  <td className="td whitespace-nowrap">{e.department_name ?? '–'}</td>
                  <td className="td">{posLabel(t, e.position)}</td>
                  <td className="td">{e.deleted_at ? <Badge color="red">{t('org.deleted')}</Badge> : <Badge color={e.status === 'active' ? 'green' : e.status === 'leave' ? 'amber' : 'slate'}>{t(`empStatus.${e.status}`)}</Badge>}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setDetail(e.id)}>{t('common.detail')}</Button>
                      {can('org.manage') && !e.deleted_at && <>
                        <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEdit(e)}>{t('common.edit')}</Button>
                        <Button size="sm" variant="ghost" icon={<ArrowRightLeft className="h-3.5 w-3.5" />} onClick={() => setMove(e)}>{t('org.move')}</Button>
                        <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />} onClick={() => setDel(e)}>{t('common.delete')}</Button>
                      </>}
                      {can('org.manage') && e.deleted_at && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => restore(e)}>{t('org.restore')}</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <div className="px-4 pb-3"><Pagination page={page} pageSize={pageSize} total={data.total} onChange={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} /></div>}
      {edit && <EmployeeModal emp={edit} depts={depts} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {detail && <EmployeeDetail id={detail} onClose={() => setDetail(null)} onChanged={load} />}
      {move && <MoveModal emp={move} depts={depts} onClose={() => setMove(null)} onSaved={() => { setMove(null); load(); }} />}
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('org.deleteEmpTitle')} message={t('org.deleteEmpMsg', { name: del?.name ?? '' })} confirmLabel={t('common.delete')}
        onConfirm={async () => {
          try { await api.del(`/employees/${del.id}`); toast('success', t('common.deleted')); load(); } catch (e) { toast('error', errorMessage(t, e)); throw e; }
        }} />
    </div>
  );
}

function EmployeeModal({ emp, depts, onClose, onSaved }: { emp: any; depts: any[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState({
    emp_no: emp.emp_no ?? '', name: emp.name ?? '', department_id: emp.department_id ?? null, position: (POSITIONS as readonly string[]).includes(emp.position) ? emp.position : '팀원',
    job_group: emp.job_group ?? 'office', status: emp.status ?? 'active',
    hire_date: emp.hire_date ?? '', email: emp.email ?? '', phone: emp.phone ?? '',
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.emp_no.trim()) e.emp_no = t('validation.required'); else if (!/^[A-Za-z0-9_-]+$/.test(f.emp_no)) e.emp_no = t('validation.codeFormat');
    if (!f.name.trim()) e.name = t('validation.required');
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = t('validation.email');
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (emp.id) await api.put(`/employees/${emp.id}`, f); else await api.post('/employees', f);
      toast('success', t('common.saved'));
      onSaved();
    } catch (err) { toast('error', errorMessage(t, err)); } finally { setBusy(false); }
  };
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v });
  return (
    <Modal open onClose={onClose} size="lg" title={emp.id ? t('org.editEmp') : t('org.addEmp')} footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button loading={busy} onClick={save}>{t('common.save')}</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('common.empNo')} required error={errs.emp_no}><input className="input" value={f.emp_no} onChange={(e) => set('emp_no', e.target.value)} /></Field>
        <Field label={t('common.employeeName')} required error={errs.name}><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label={t('common.department')}>
          <select className="input" value={f.department_id ?? ''} onChange={(e) => set('department_id', Number(e.target.value) || null)}>
            <option value="">–</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label={t('common.position')} required>
          <select className="input" value={f.position} onChange={(e) => set('position', e.target.value)}>
            {POSITIONS.map((p) => <option key={p} value={p}>{posLabel(t, p)}</option>)}
          </select>
        </Field>
        <Field label={t('org.jobGroup')}>
          <select className="input" value={f.job_group} onChange={(e) => set('job_group', e.target.value)}>
            <option value="office">{t('jobGroup.office')}</option><option value="production">{t('jobGroup.production')}</option>
          </select>
        </Field>
        <Field label={t('org.empStatus')}>
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
            {['active', 'leave', 'resigned'].map((s) => <option key={s} value={s}>{t(`empStatus.${s}`)}</option>)}
          </select>
        </Field>
        <Field label={t('org.hireDate')}><input type="date" className="input" value={f.hire_date} onChange={(e) => set('hire_date', e.target.value)} /></Field>
        <Field label={t('common.email')} error={errs.email}><input type="email" className="input" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label={t('org.phone')}><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      </div>
      <p className="mt-3 text-xs text-slate-400">{t('org.jobGroupHint')}</p>
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

function EmployeeDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [e, setE] = useState<any | null>(null);
  const [acc, setAcc] = useState({ role: 'employee', isActive: true });
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get(`/employees/${id}`).then((x) => { setE(x); setAcc({ role: x.role ?? (x.is_leader ? 'leader' : 'employee'), isActive: x.account_active === undefined || x.account_active === null ? true : !!x.account_active }); })
      .catch((err) => toast('error', errorMessage(t, err)));
  }, [id, t, toast]);
  useEffect(() => { load(); }, [load]);
  const saveAccount = async () => {
    setBusy(true);
    try { await api.put(`/employees/${id}/account`, acc); toast('success', t('common.saved')); load(); onChanged(); }
    catch (err) { toast('error', errorMessage(t, err)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={t('org.empDetail')}>
      {!e ? <Spinner /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xl font-bold text-navy-900">{e.name}</div>
            <code className="rounded bg-slate-100 px-2 py-0.5 text-xs">{e.emp_no}</code>
            {e.is_executive ? <Badge color="navy">{t('org.executive')}</Badge> : null}
            <Badge color={e.status === 'active' ? 'green' : 'slate'}>{t(`empStatus.${e.status}`)}</Badge>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[
              [t('common.department'), e.department_name], [t('common.position'), posLabel(t, e.position)],
              [t('org.jobGroup'), t(`jobGroup.${e.job_group}`)], [t('org.hireDate'), e.hire_date], [t('common.email'), e.email], [t('org.phone'), e.phone],
              [t('org.lastLogin'), fmtDate(e.last_login_at, locale, true)],
            ].map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="font-medium">{v || '–'}</dd></div>)}
          </dl>
          <div>
            <h4 className="mb-2 text-sm font-semibold">{t('org.evalHistory')}</h4>
            {e.history.length === 0 ? <p className="text-sm text-slate-400">{t('common.noData')}</p> : (
              <table className="w-full"><thead><tr><th className="th">{t('common.round')}</th><th className="th">{t('common.status')}</th>{can('results.view') && <th className="th text-right">{t('results.finalScore')}</th>}</tr></thead>
                <tbody>{e.history.map((h: any) => (
                  <tr key={h.round_id}><td className="td">{h.round_name}</td><td className="td"><OverallBadge state={h.state} t={t} /></td>{can('results.view') && <td className="td text-right font-semibold">{fmtScore(h.final_score)}</td>}</tr>
                ))}</tbody></table>
            )}
          </div>
          {can('users.manage') && (
            <div className="rounded-lg border border-slate-200 p-4">
              <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><UserCog className="h-4 w-4" />{t('org.account')}{!e.user_id && <Badge color="amber">{t('org.noAccount')}</Badge>}</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t('org.role')}>
                  <select className="input" value={acc.role} onChange={(x) => setAcc({ ...acc, role: x.target.value })}>
                    {['employee', 'leader', 'executive', 'admin'].map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                  </select>
                </Field>
                <div className="text-xs text-slate-500 sm:pt-6">{t('org.loginInfo', { name: e.name, empNo: e.emp_no })}</div>
                <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={acc.isActive} onChange={(x) => setAcc({ ...acc, isActive: x.target.checked })} />{t('org.accountActive')}</label>
              </div>
              <div className="mt-3 flex justify-end"><Button size="sm" loading={busy} onClick={saveAccount}>{e.user_id ? t('org.updateAccount') : t('org.createAccount')}</Button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
