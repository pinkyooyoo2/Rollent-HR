import { Children, cloneElement, isValidElement, useEffect, useId, useState, type ReactNode, type ButtonHTMLAttributes, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, X, Inbox, AlertTriangle, ChevronLeft, ChevronRight, ChevronRight as Crumb, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useI18n } from '../i18n';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'teal';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-200',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost: 'text-slate-600 hover:bg-slate-100 disabled:text-slate-300',
  teal: 'bg-teal-500 text-white hover:bg-teal-600 disabled:bg-teal-300',
};

export function Button({ variant = 'primary', size = 'md', loading, icon, children, className, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition disabled:cursor-not-allowed',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm', VARIANTS[variant], className)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin text-brand-600" /> {label ?? t('common.loading')}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title?: string; description?: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Inbox className="h-10 w-10 text-slate-300" />
      <div className="text-sm font-medium text-slate-600">{title ?? t('common.noData')}</div>
      {description && <div className="max-w-md text-xs text-slate-500">{description}</div>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <AlertTriangle className="h-10 w-10 text-amber-500" />
      <div className="text-sm text-slate-600">{message}</div>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>{t('common.retry')}</Button>}
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={bodyClass ?? 'p-5'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, crumbs, actions, description }: { title: string; crumbs?: { label: string; to?: string }[]; actions?: ReactNode; description?: string }) {
  const { t } = useI18n();
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <nav className="mb-1 flex items-center gap-1 text-xs text-slate-500" aria-label="breadcrumb">
          <Link to="/" className="hover:text-brand-600">HOME</Link>
          {(crumbs ?? [{ label: title }]).map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <Crumb className="h-3 w-3" />
              {c.to ? <Link to={c.to} className="hover:text-brand-600">{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
        <h1 className="text-xl font-bold text-navy-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      <span className="sr-only">{t('common.appName')}</span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[1200px]' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx('w-full rounded-xl bg-white shadow-2xl', w)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-navy-900">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="close"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[calc(100vh-200px)] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** 삭제 등 확인 팝업 (사유 입력 옵션) */
export function ConfirmDialog({ open, title, message, confirmLabel, danger, onConfirm, onClose, requireReason, reasonLabel }:
  { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: (reason: string) => Promise<void> | void;
    onClose: () => void; requireReason?: boolean; reasonLabel?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<>
      <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={requireReason && reason.trim().length < 2}
        onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()); onClose(); } catch { /* 호출부에서 토스트 처리 */ } finally { setBusy(false); } }}>
        {confirmLabel ?? t('common.confirm')}
      </Button>
    </>}>
      <div className="text-sm text-slate-600">{message}</div>
      {requireReason && (
        <div className="mt-3">
          <label className="label">{reasonLabel ?? t('common.reason')} *</label>
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
    </Modal>
  );
}

export function Badge({ color = 'slate', children, icon }: { color?: 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'teal' | 'navy' | 'violet'; children: ReactNode; icon?: ReactNode }) {
  const c = {
    slate: 'bg-slate-100 text-slate-700', blue: 'bg-brand-50 text-brand-700', green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700', teal: 'bg-cyan-50 text-teal-600', navy: 'bg-navy-900 text-white',
    violet: 'bg-violet-50 text-violet-700',
  }[color];
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', c)}>{icon}{children}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.id} role="tab" aria-selected={value === tb.id} onClick={() => onChange(tb.id)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition',
            value === tb.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700')}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange, onPageSize }: { page: number; pageSize: number; total: number; onChange: (p: number) => void; onPageSize?: (n: number) => void }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-3 text-xs text-slate-500">
      <span>{t('common.totalCount', { n: total })}</span>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select className="input !w-auto !py-1 text-xs" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{t('common.perPage', { n })}</option>)}
          </select>
        )}
        <button className="rounded p-1 hover:bg-slate-100 disabled:opacity-30" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="prev"><ChevronLeft className="h-4 w-4" /></button>
        <span>{page} / {pages}</span>
        <button className="rounded p-1 hover:bg-slate-100 disabled:opacity-30" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="next"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function SortHeader({ label, col, sort, onSort, className }: { label: string; col: string; sort: { col: string; dir: 'asc' | 'desc' }; onSort: (col: string) => void; className?: string }) {
  const active = sort.col === col;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={cx('th cursor-pointer select-none hover:text-brand-700', className)} onClick={() => onSort(col)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span className="inline-flex items-center gap-1">{label}<Icon className={cx('h-3 w-3', active ? 'text-brand-600' : 'text-slate-300')} /></span>
    </th>
  );
}

export function useSort(initial: string, dir: 'asc' | 'desc' = 'asc') {
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: initial, dir });
  const onSort = (col: string) => setSort((s) => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }));
  return { sort, onSort };
}

export function sortRows<T>(rows: T[], sort: { col: string; dir: 'asc' | 'desc' }, get: (r: T, col: string) => unknown, locale = 'ko') {
  const m = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a, sort.col);
    const y = get(b, sort.col);
    if (x === y) return 0;
    if (x === null || x === undefined || x === '') return 1;
    if (y === null || y === undefined || y === '') return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * m;
    return String(x).localeCompare(String(y), locale) * m;
  });
}

export function ProgressBar({ value, color = 'bg-brand-600', className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

export function Field({ label, required, children, error, hint }: { label: string; required?: boolean; children: ReactNode; error?: string; hint?: string }) {
  // 첫 번째 입력 요소에 id를 부여해 label과 연결 (스크린리더·라벨 클릭 지원)
  const autoId = useId();
  let controlId: string | undefined;
  let linked = false;
  const items = Children.map(children, (c) => {
    if (linked || !isValidElement(c) || !['input', 'select', 'textarea'].includes(c.type as string)) return c;
    linked = true;
    const el = c as ReactElement<{ id?: string }>;
    controlId = el.props.id ?? autoId;
    return cloneElement(el, { id: controlId });
  });
  return (
    <div>
      <label className="label" htmlFor={controlId}>{label}{required && <span className="text-red-500"> *</span>}</label>
      {items}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="search" className="input max-w-xs" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}
