import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useI18n, errorMessage } from '../i18n';
import { ApiError } from '../lib/api';
import { Button, Field } from '../components/ui';
import { LanguageSelect } from '../components/Layout';

export default function LoginPage() {
  const { user, login } = useAuth();
  const { t } = useI18n();
  const nav = useNavigate();
  const loc = useLocation();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; password?: string; form?: string }>({});

  if (user) return <Navigate to={user.permissions.includes('dashboard.view') ? '/' : '/e'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = t('auth.nameRequired');
    if (!password) errs.password = t('auth.passwordRequired');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const u = await login(name.trim(), password);
      const from = (loc.state as { from?: string } | null)?.from;
      // 관리자 → 관리자 페이지, 그 외(팀원·팀장·임원) → 평가 전용 사이트
      if (!u.permissions.includes('dashboard.view')) nav('/e', { replace: true });
      else nav(from && from !== '/login' && !from.startsWith('/e') ? from : '/', { replace: true });
    } catch (err) {
      let msg = errorMessage(t, err);
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIALS' && err.details?.remaining) msg += ` ${t('auth.remainingAttempts', { n: err.details.remaining })}`;
      setErrors({ form: msg });
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full flex-col bg-gradient-to-br from-navy-900 via-navy-800 to-brand-700 lg:flex-row">
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -right-32 -top-32 h-[520px] w-[520px] rounded-full border-[56px] border-white/5" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-[420px] w-[420px] rounded-full border-[40px] border-teal-500/15" />
        <div className="text-sm tracking-[0.3em] text-white/60">DAEYANG ROLLENT</div>
        <div>
          <h1 className="text-4xl font-bold leading-tight">{t('login.heroTitle')}</h1>
          <p className="mt-4 max-w-md text-white/70">{t('login.heroDesc')}</p>
        </div>
        <div className="text-xs text-white/40">© {new Date().getFullYear()} 대양롤랜트(주)</div>
      </div>
      <div className="flex flex-1 items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
          <div className="mb-2 flex justify-end"><LanguageSelect /></div>
          <img src="/logo-wide.jpg" alt="ROLLENT 대양롤랜트(주)" className="mx-auto mb-6 h-16 object-contain" />
          <h2 className="text-center text-lg font-bold text-navy-900">{t('login.title')}</h2>
          <p className="mb-6 text-center text-sm text-slate-500">{t('login.subtitle')}</p>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label={t('login.idLabel')} required error={errors.name}>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoFocus placeholder={t('login.namePlaceholder')} aria-invalid={!!errors.name} />
            </Field>
            <Field label={t('login.passwordLabel')} required error={errors.password} hint={t('login.passwordHint')}>
              <div className="relative">
                <input type={show ? 'text' : 'password'} className="input pr-10" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password" placeholder={t('login.passwordPlaceholder')} aria-invalid={!!errors.password} />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
                  aria-label={show ? t('login.hidePassword') : t('login.showPassword')} title={show ? t('login.hidePassword') : t('login.showPassword')}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            {errors.form && <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{errors.form}</div>}
            <Button type="submit" loading={busy} className="w-full !py-2.5" icon={<LogIn className="h-4 w-4" />}>{t('login.submit')}</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
