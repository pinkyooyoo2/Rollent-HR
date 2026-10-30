/**
 * 팀원·팀장·임원용 평가 전용 사이트 (/e)
 * 평가 유형 선택 → (대상이 여러 명이면) 대상 선택 → 평가 작성(자동저장) → 최종 제출 → 제출 완료
 * 점수·결과·다른 사람의 응답은 표시하지 않으며, 서버도 해당 정보를 보내지 않는다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LogOut, ChevronLeft, ChevronRight, CheckCircle2, CloudOff, Cloud, Loader2, AlertTriangle, Lock, Hourglass, Send, PartyPopper, UserRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { useI18n, errorMessage, type TFn } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, Spinner, cx } from '../components/ui';
import EvaluationForm, { type Answer, type Section } from '../components/EvaluationForm';
import { LanguageSelect } from '../components/Layout';
import { fmtDate, posLabel } from '../lib/status';
import { DDay } from './DDay';
import { useAutosave, type SaveStatus } from './useAutosave';

type EvalType = 'self' | 'member_to_leader' | 'leader_to_member' | 'exec_to_leader' | 'exec_to_member';
type EvalState = 'not_started' | 'in_progress' | 'submitted' | 'closed' | 'not_open' | 'waiting';
interface Item {
  id: number; round_id: number; round_name: string; eval_type: EvalType;
  target: { name: string; department: string | null; position: string | null } | null;
  state: EvalState; editable: boolean;
  /** 대기 중일 때 기다리는 평가 대상자의 단계 (self: 평가 대상자의 자기평가) */
  waiting_for: 'self' | null;
  deadline_date: string; deadline_at: string; submitted_at: string | null; last_saved_at: string | null;
}
interface Home { me: { name: string; role: string }; server_now: string; tz_offset: string; items: Item[] }

const TYPE_ORDER: EvalType[] = ['self', 'member_to_leader', 'leader_to_member', 'exec_to_leader', 'exec_to_member'];
const isOpenState = (s: EvalState) => s === 'not_started' || s === 'in_progress';

/** 필수 응답 판정 (서버 isAnswered 와 동일 규칙) */
function isAnswered(type: string, a: Answer | undefined) {
  if (!a) return false;
  switch (type) {
    case 'short_text': case 'long_text': return !!a.text?.trim();
    case 'checkbox': return (a.optionIds?.length ?? 0) > 0;
    case 'linear_scale': return typeof a.value === 'number';
    case 'descriptive': return !!a.text?.trim() && typeof a.optionId === 'number';
    default: return typeof a.optionId === 'number';
  }
}

function StateBadge({ state, t }: { state: EvalState; t: TFn }) {
  const tone: Record<EvalState, string> = {
    not_started: 'bg-slate-100 text-slate-600', in_progress: 'bg-amber-100 text-amber-800', submitted: 'bg-emerald-100 text-emerald-700',
    closed: 'bg-slate-200 text-slate-500', not_open: 'bg-slate-100 text-slate-500', waiting: 'bg-sky-100 text-sky-700',
  };
  const Icon = { not_started: null, in_progress: Loader2, submitted: CheckCircle2, closed: Lock, not_open: Hourglass, waiting: Hourglass }[state];
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone[state])}>
      {Icon && <Icon className="h-3 w-3" />}{t(`evalSite.state.${state}`)}
    </span>
  );
}

function SaveIndicator({ status, lastSavedAt, locale, t }: { status: SaveStatus; lastSavedAt: number; locale: string; t: TFn }) {
  const time = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
  const view: Record<SaveStatus, { icon: JSX.Element; text: string; cls: string }> = {
    idle: { icon: <Cloud className="h-4 w-4" />, text: t('evalSite.save.saved'), cls: 'text-slate-500' },
    saved: { icon: <CheckCircle2 className="h-4 w-4" />, text: t('evalSite.save.saved'), cls: 'text-emerald-600' },
    dirty: { icon: <Cloud className="h-4 w-4" />, text: t('evalSite.save.dirty'), cls: 'text-slate-500' },
    saving: { icon: <Loader2 className="h-4 w-4 animate-spin" />, text: t('evalSite.save.saving'), cls: 'text-brand-600' },
    error: { icon: <AlertTriangle className="h-4 w-4" />, text: t('evalSite.save.error'), cls: 'text-red-600' },
    offline: { icon: <CloudOff className="h-4 w-4" />, text: t('evalSite.save.offline'), cls: 'text-red-600' },
    blocked: { icon: <Lock className="h-4 w-4" />, text: t('evalSite.save.blocked'), cls: 'text-red-600' },
  };
  const v = view[status];
  return (
    <div className={cx('flex items-center gap-1.5 text-xs', v.cls)} role="status" aria-live="polite">
      {v.icon}<span className="font-medium">{v.text}</span>
      {time && status !== 'saving' && <span className="text-slate-400">· {t('evalSite.save.lastSaved', { time })}</span>}
    </div>
  );
}

/** 평가 대상 표시: 이름·부서·직급만 */
function TargetLine({ item, t }: { item: Item; t: TFn }) {
  if (!item.target) return <span className="text-sm text-slate-500">{t('evalSite.selfTarget')}</span>;
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <UserRound className="h-4 w-4 text-slate-400" />
      <b className="text-navy-900">{item.target.name}</b>
      <span className="text-slate-500">{[item.target.department, posLabel(t, item.target.position)].filter(Boolean).join(' · ')}</span>
    </span>
  );
}

export default function EvalApp() {
  const { t, locale } = useI18n();
  const { user, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [params, setParams] = useSearchParams();
  const [done, setDone] = useState<{ item: Item; submittedAt: string } | null>(null);

  const load = useCallback(() => {
    setError('');
    return api.get<Home>('/eval/home').then((r) => { setOffset(Date.parse(r.server_now) - Date.now()); setHome(r); return r; })
      .catch((e) => { setError(errorMessage(t, e)); return null; });
  }, [t]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = window.setInterval(() => setNow(Date.now() + offset), 30_000);
    return () => window.clearInterval(id);
  }, [offset]);

  const items = home?.items ?? [];
  const types = TYPE_ORDER.filter((x) => items.some((i) => i.eval_type === x));
  const typeParam = params.get('type') as EvalType | null;
  const type: EvalType | undefined = typeParam && types.includes(typeParam) ? typeParam
    : types.find((x) => items.some((i) => i.eval_type === x && isOpenState(i.state))) ?? types[0];
  const ofType = items.filter((i) => i.eval_type === type);
  const aParam = Number(params.get('a')) || null;
  const selected = ofType.find((i) => i.id === aParam) ?? (ofType.length === 1 ? ofType[0] : null);
  const remaining = useMemo(() => items.filter((i) => isOpenState(i.state)), [items]);

  const go = (next: { type?: EvalType; a?: number | null }) => {
    setDone(null);
    const p = new URLSearchParams();
    const ty = next.type ?? type;
    if (ty) p.set('type', ty);
    if (next.a) p.set('a', String(next.a));
    setParams(p);
    window.scrollTo({ top: 0 });
  };
  const doLogout = async () => { await logout(); nav('/login', { replace: true }); };

  return (
    <div className="min-h-full bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2.5">
          <img src="/logo-square.png" alt="ROLLENT" className="h-8 w-8 rounded" />
          <div className="mr-auto leading-tight">
            <div className="text-sm font-bold text-navy-900">ROLLENT</div>
            <div className="text-[11px] text-slate-500">{t('evalSite.title')}</div>
          </div>
          <LanguageSelect className="hidden sm:flex" />
          <span className="hidden text-sm text-slate-600 sm:inline">{t('evalSite.hello', { name: user?.display_name ?? '' })}</span>
          <Button size="sm" variant="secondary" icon={<LogOut className="h-3.5 w-3.5" />} onClick={doLogout}>{t('nav.logout')}</Button>
        </div>
        <div className="mx-auto flex max-w-4xl justify-end px-4 pb-2 sm:hidden"><LanguageSelect /></div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-5">
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : !home ? <Spinner /> : items.length === 0 ? (
          <Card><EmptyState title={t('evalSite.noAssignments')} description={t('evalSite.noAssignmentsDesc')} /></Card>
        ) : done ? (
          <DonePanel done={done} remaining={remaining} t={t} locale={locale} onGo={(i) => go({ type: i.eval_type, a: i.id })} onLogout={doLogout} />
        ) : (
          <>
            {/* 평가 유형 탭 */}
            <nav className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t('evalSite.typeTabs')}>
              {types.map((x) => {
                const list = items.filter((i) => i.eval_type === x);
                const left = list.filter((i) => isOpenState(i.state)).length;
                // 남은 작성 건이 없을 때: 모두 제출했으면 ✓, 대기·시작 전이 남아 있으면 모래시계
                const allDone = list.every((i) => i.state === 'submitted' || i.state === 'closed');
                return (
                  <button key={x} role="tab" aria-selected={x === type} onClick={() => go({ type: x, a: null })}
                    className={cx('flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition',
                      x === type ? 'border-brand-600 bg-brand-600 text-white shadow' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300')}>
                    {t(`evalSite.tab.${x}`)}
                    {left > 0 ? <span className={cx('rounded-full px-1.5 text-[11px]', x === type ? 'bg-white/25' : 'bg-amber-100 text-amber-800')}>{left}</span>
                      : allDone ? <CheckCircle2 className={cx('h-4 w-4', x === type ? 'text-white' : 'text-emerald-500')} />
                        : <Hourglass className={cx('h-4 w-4', x === type ? 'text-white' : 'text-sky-500')} />}
                  </button>
                );
              })}
            </nav>
            {type && <p className="mb-4 text-sm text-slate-500">{t(`evalSite.typeDesc.${type}`)}</p>}

            {selected ? (
              <EvalSheet key={selected.id} item={selected} now={now} tz={home.tz_offset} userId={user!.id}
                onBack={ofType.length > 1 ? () => go({ a: null }) : undefined}
                onSubmitted={async (submittedAt) => { await load(); setDone({ item: selected, submittedAt }); window.scrollTo({ top: 0 }); }}
                onReload={() => { void load(); }} toast={toast} />
            ) : (
              <TargetList items={ofType} now={now} tz={home.tz_offset} t={t} onPick={(i) => go({ a: i.id })} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** 평가 대상이 여러 명일 때만 표시. 상태(미시작·작성 중·제출 완료·마감)만 보여줌 */
function TargetList({ items, now, tz, t, onPick }: { items: Item[]; now: number; tz: string; t: TFn; onPick: (i: Item) => void }) {
  const done = items.filter((i) => i.state === 'submitted').length;
  return (
    <Card title={<span>{t('evalSite.selectTarget')} <span className="ml-1 text-xs font-normal text-slate-500">{t('evalSite.progress', { done, total: items.length })}</span></span>} bodyClass="p-0">
      <ul className="divide-y divide-slate-100">
        {items.map((i) => (
          <li key={i.id}>
            <button onClick={() => onPick(i)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left hover:bg-brand-50/50">
              <span className="min-w-0 flex-1"><TargetLine item={i} t={t} /></span>
              <DDay compact deadlineAt={i.deadline_at} deadlineDate={i.deadline_date} now={now} tz={tz} />
              <span className="flex flex-col items-end">
                <StateBadge state={i.state} t={t} />
                {i.state === 'waiting' && i.waiting_for && <span className="mt-0.5 text-[10px] text-sky-700">{t(`evalSite.waitShort.${i.waiting_for}`)}</span>}
              </span>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

interface SheetData { server_now: string; tz_offset: string; assignment: Item; form?: { sections: Section[] }; answers?: Record<number, Answer>; save_seq?: number }

function EvalSheet({ item, now, tz, userId, onBack, onSubmitted, onReload, toast }:
  { item: Item; now: number; tz: string; userId: number; onBack?: () => void; onSubmitted: (at: string) => void; onReload: () => void; toast: ReturnType<typeof useToast> }) {
  const { t } = useI18n();
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setData(null);
    api.get<SheetData>(`/eval/assignments/${item.id}`).then(setData).catch((e) => setError(errorMessage(t, e)));
  }, [item.id, version, t]);

  const a = data?.assignment ?? item;
  const header = (
    <Card className="mb-4">
      {onBack && <button onClick={onBack} className="mb-2 flex items-center gap-1 text-xs text-brand-600 hover:underline"><ChevronLeft className="h-3.5 w-3.5" />{t('evalSite.backToList')}</button>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-navy-900">{t(`evalSite.tab.${a.eval_type}`)}</h1>
            <StateBadge state={a.state} t={t} />
          </div>
          <div className="text-xs text-slate-500">{a.round_name}</div>
          <TargetLine item={a} t={t} />
        </div>
        <DDay deadlineAt={a.deadline_at} deadlineDate={a.deadline_date} now={now} tz={tz} />
      </div>
    </Card>
  );

  if (error) return <>{header}<ErrorState message={error} onRetry={() => { setError(''); setVersion((v) => v + 1); }} /></>;
  if (!data) return <>{header}<Spinner /></>;
  if (!data.assignment.editable || !data.form) {
    const s = data.assignment.state;
    // 대기: 평가 대상자의 어떤 앞 단계가 남았는지 안내 (평가자 본인의 자기평가와는 무관)
    const w = data.assignment.waiting_for;
    const waitMsg = w ? t(`evalSite.waitingFor.${w}`) : t('evalSite.waitingHint');
    const msg = s === 'submitted' ? t('evalSite.alreadySubmitted') : s === 'closed' ? t('evalSite.closedHint') : s === 'waiting' ? waitMsg : t('evalSite.notOpenHint');
    return (
      <>{header}
        <Card><div className="flex flex-col items-center gap-2 py-6 text-center">
          {s === 'submitted' ? <CheckCircle2 className="h-10 w-10 text-emerald-500" /> : s === 'closed' ? <Lock className="h-10 w-10 text-slate-400" /> : <Hourglass className="h-10 w-10 text-sky-500" />}
          <p className="text-sm text-slate-700">{msg}</p>
          {s === 'waiting' && <p className="text-xs text-slate-500">{t('evalSite.waitingNote')}</p>}
          {s === 'submitted' && data.assignment.submitted_at && <p className="text-xs text-slate-500">{t('evalSite.submittedAt', { time: fmtDate(data.assignment.submitted_at, navigator.language, true) })}</p>}
        </div></Card>
      </>
    );
  }
  return (
    <>{header}
      <Writer key={`${item.id}-${version}`} data={data} userId={userId} onSubmitted={onSubmitted} toast={toast}
        onBlocked={(code) => { toast('error', t(`errors.${code}`)); setVersion((v) => v + 1); onReload(); }} />
    </>
  );
}

function Writer({ data, userId, onSubmitted, onBlocked, toast }:
  { data: SheetData; userId: number; onSubmitted: (at: string) => void; onBlocked: (code: string) => void; toast: ReturnType<typeof useToast> }) {
  const { t, locale } = useI18n();
  const a = data.assignment;
  const sections = data.form!.sections;
  const saver = useAutosave({
    assignmentId: a.id, userId, initialAnswers: data.answers ?? {}, serverSeq: data.save_seq ?? 0, lastSavedAt: a.last_saved_at, onBlocked,
  });
  const [missing, setMissing] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const questions = sections.flatMap((s) => s.questions);
  const requiredLeft = questions.filter((q) => q.required && !isAnswered(q.type, saver.answers[q.id])).length;

  const startSubmit = async () => {
    const miss = questions.filter((q) => q.required && !isAnswered(q.type, saver.answers[q.id])).map((q) => q.id);
    setMissing(new Set(miss));
    if (miss.length) {
      toast('error', t('evalSite.requiredMissing', { n: miss.length }));
      document.getElementById(`q-${miss[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    await saver.flush(); // 저장되지 않은 최신 답변 먼저 저장
    setConfirm(true);
  };
  const submit = async () => {
    try {
      const r = await api.post<{ submitted_at: string }>(`/eval/assignments/${a.id}/submit`, { answers: saver.answers, seq: saver.nextSeq() });
      saver.clear();
      onSubmitted(r.submitted_at);
    } catch (e) {
      toast('error', errorMessage(t, e));
      throw e;
    }
  };

  return (
    <div className="pb-24">
      <p className="mb-3 rounded-lg bg-brand-50 px-4 py-2.5 text-xs text-brand-700">{t('evalSite.autosaveNote')}</p>
      <EvaluationForm sections={sections} answers={saver.answers} missing={missing}
        onChange={(qid, ans) => { saver.change(qid, ans); if (missing.has(qid)) { const m = new Set(missing); m.delete(qid); setMissing(m); } }} />
      {/* 하단 고정: 자동저장 상태 + 최종 제출 */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <SaveIndicator status={saver.status} lastSavedAt={saver.lastSavedAt} locale={locale} t={t} />
          <span className="ml-auto text-xs text-slate-500">{requiredLeft > 0 ? t('evalSite.requiredLeft', { n: requiredLeft }) : t('evalSite.readyToSubmit')}</span>
          <Button icon={<Send className="h-4 w-4" />} disabled={saver.status === 'blocked'} onClick={() => void startSubmit()}>{t('evalSite.submit')}</Button>
        </div>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title={t('evalSite.submitConfirmTitle')} confirmLabel={t('evalSite.submit')}
        message={t('evalSite.submitConfirmMsg')} onConfirm={submit} />
    </div>
  );
}

/** 제출 완료 화면: 점수·결과 없이 제출 사실과 남은 평가만 */
function DonePanel({ done, remaining, t, locale, onGo, onLogout }:
  { done: { item: Item; submittedAt: string }; remaining: Item[]; t: TFn; locale: string; onGo: (i: Item) => void; onLogout: () => void }) {
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          <h1 className="text-xl font-bold text-navy-900">{t('evalSite.submittedTitle')}</h1>
          <p className="text-sm text-slate-600">{t(`evalSite.tab.${done.item.eval_type}`)}{done.item.target ? ` · ${done.item.target.name}` : ''}</p>
          <p className="text-xs text-slate-500">{t('evalSite.submittedAt', { time: fmtDate(done.submittedAt, locale, true) })}</p>
        </div>
      </Card>
      {remaining.length > 0 ? (
        <Card title={t('evalSite.remaining', { n: remaining.length })} bodyClass="p-0">
          <ul className="divide-y divide-slate-100">
            {remaining.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="w-24 shrink-0 text-sm font-semibold text-slate-700">{t(`evalSite.tab.${i.eval_type}`)}</span>
                <span className="min-w-0 flex-1"><TargetLine item={i} t={t} /></span>
                <StateBadge state={i.state} t={t} />
                <Button size="sm" onClick={() => onGo(i)}>{t('evalSite.goNext')}</Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <PartyPopper className="h-10 w-10 text-brand-600" />
            <h2 className="text-lg font-bold text-navy-900">{t('evalSite.allDone')}</h2>
            <p className="max-w-md text-sm text-slate-500">{t('evalSite.allDoneDesc')}</p>
            <Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={onLogout}>{t('nav.logout')}</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
