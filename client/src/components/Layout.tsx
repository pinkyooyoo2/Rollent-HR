import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Users, ClipboardList, Target, ShieldCheck, BarChart3, LogOut, PanelLeftClose, PanelLeftOpen, PenSquare, Globe, UserCircle2, Menu } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useI18n, LANGUAGES, type Lang } from '../i18n';
import { cx } from './ui';

export const NAV = [
  { to: '/', key: 'nav.home', icon: Home, perm: 'dashboard.view', end: true },
  { to: '/organization', key: 'nav.organization', icon: Users, perm: 'org.view' },
  { to: '/forms', key: 'nav.forms', icon: ClipboardList, perm: 'forms.view' },
  { to: '/kpi', key: 'nav.kpi', icon: Target, perm: 'rounds.view' },
  { to: '/admin-eval', key: 'nav.adminEval', icon: ShieldCheck, perm: 'rounds.view' },
  { to: '/results', key: 'nav.results', icon: BarChart3, perm: 'results.view' },
  { to: '/my', key: 'nav.my', icon: PenSquare, perm: 'evaluate' },
];

function readCollapsed() {
  try { return localStorage.getItem('sidebar') === 'collapsed'; } catch { return false; }
}

export function LanguageSelect({ className, dark }: { className?: string; dark?: boolean }) {
  const { lang, t } = useI18n();
  const { changeLanguage } = useAuth();
  return (
    <label className={cx('flex items-center gap-1.5 text-sm', className)}>
      <Globe className={cx('h-4 w-4', dark ? 'text-white/70' : 'text-slate-500')} />
      <span className="sr-only">{t('common.language')}</span>
      <select value={lang} onChange={(e) => changeLanguage(e.target.value as Lang)}
        className={cx('rounded-md border px-2 py-1 text-sm outline-none', dark ? 'border-white/30 bg-white/10 text-white' : 'border-slate-300 bg-white text-slate-700')}>
        {LANGUAGES.map((l) => <option key={l.code} value={l.code} className="text-slate-800">{l.label}</option>)}
      </select>
    </label>
  );
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'open'); } catch { /* ignore */ }
  }, [collapsed]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const doLogout = async () => { await logout(); nav('/login'); };
  const items = NAV.filter((n) => can(n.perm));
  // 홈 대시보드의 '진행 상세' 페이지에서도 HOME 메뉴를 활성으로 표시
  const onProgressDetail = useLocation().pathname.startsWith('/progress');

  const sidebar = (
    <aside className={cx('flex h-full flex-col bg-navy-900 text-white transition-all', collapsed ? 'w-[72px]' : 'w-60')}>
      <div className={cx('flex h-16 items-center gap-2 border-b border-white/10 px-4', collapsed && 'justify-center px-0')}>
        <img src="/logo-square.png" alt="ROLLENT" className="h-9 w-9 rounded-full bg-white object-contain p-0.5" />
        {!collapsed && (
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-wider">ROLLENT</div>
            <div className="text-[11px] text-white/60">{t('common.appShort')}</div>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setMobileOpen(false)} title={collapsed ? t(n.key) : undefined}
            className={({ isActive }) => cx('group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition',
              collapsed && 'justify-center px-0',
              isActive || (n.to === '/' && onProgressDetail) ? 'bg-white/10 font-semibold text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r before:bg-teal-500'
                : 'text-white/70 hover:bg-white/5 hover:text-white')}>
            <n.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span>{t(n.key)}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-1 border-t border-white/10 p-3">
        <button onClick={doLogout} title={collapsed ? t('nav.logout') : undefined}
          className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/70 hover:bg-white/5 hover:text-white', collapsed && 'justify-center px-0')}>
          <LogOut className="h-5 w-5" />{!collapsed && t('nav.logout')}
        </button>
        <button onClick={() => setCollapsed(!collapsed)} aria-label={t('nav.toggle')}
          className={cx('hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-white/50 hover:text-white lg:flex', collapsed && 'justify-center px-0')}>
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" />{t('nav.collapse')}</>}
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full">
      <div className="hidden h-full shrink-0 lg:block">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden" onClick={() => setMobileOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>{sidebar}</div>
          <div className="flex-1 bg-black/40" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="menu"><Menu className="h-5 w-5" /></button>
          <div className="hidden text-sm text-slate-500 sm:block">{t('common.appName')}</div>
          <div className="ml-auto flex items-center gap-4">
            <LanguageSelect />
            <div className="relative" ref={profileRef}>
              <button onClick={() => setProfileOpen(!profileOpen)} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100">
                <UserCircle2 className="h-8 w-8 text-brand-600" />
                <div className="text-left leading-tight">
                  <div className="text-sm font-semibold text-navy-900">{t('header.greeting', { name: user!.display_name })}</div>
                  <div className="text-[11px] text-slate-500">{t(`role.${user!.role}`)} · {user!.emp_no}</div>
                </div>
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-12 z-30 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                  <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">{user!.email ?? '-'}</div>
                  <button onClick={doLogout} className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                    <LogOut className="h-4 w-4" />{t('nav.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
