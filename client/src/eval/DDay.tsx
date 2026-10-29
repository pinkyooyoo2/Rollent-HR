import { CalendarClock } from 'lucide-react';
import { useI18n } from '../i18n';
import { cx } from '../components/ui';

const DAY = 86_400_000;
const tzMinutes = (tz: string) => {
  const m = tz.match(/^([+-])(\d{2}):(\d{2})$/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 540;
};

/**
 * D-7 · D-3 · D-1 · D-DAY · 마감. 남은 일·시간 표시, 마감이 가까울수록 강조.
 * now 는 서버 시각 기준 (기기 시계가 틀려도 어긋나지 않도록 호출부에서 서버와의 차이를 보정)
 */
export function DDay({ deadlineAt, deadlineDate, now, tz, compact }:
  { deadlineAt: string; deadlineDate: string; now: number; tz: string; compact?: boolean }) {
  const { t } = useI18n();
  const remain = Date.parse(deadlineAt) - now;
  const today = new Date(now + tzMinutes(tz) * 60_000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(deadlineDate) - Date.parse(today)) / DAY);
  const closed = remain < 0;
  const label = closed ? t('evalSite.ddayClosed') : days <= 0 ? 'D-DAY' : `D-${days}`;
  const tone = closed ? 'bg-slate-200 text-slate-600'
    : days <= 1 ? 'bg-red-600 text-white'
      : days <= 3 ? 'bg-amber-500 text-white'
        : days <= 7 ? 'bg-amber-100 text-amber-800'
          : 'bg-brand-50 text-brand-700';
  const h = Math.floor(remain / 3_600_000);
  const detail = closed ? t('evalSite.closedHint')
    : remain >= DAY ? t('evalSite.remainDays', { d: Math.floor(remain / DAY), h: h % 24 })
      : t('evalSite.remainHours', { h, m: Math.floor((remain % 3_600_000) / 60_000) });
  if (compact) return <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', tone)}>{label}</span>;
  return (
    <div className="flex items-center gap-2" role="timer" aria-live="polite">
      <span className={cx('rounded-lg px-2.5 py-1 text-sm font-bold tracking-wide', tone)}>{label}</span>
      <span className="text-xs leading-tight text-slate-500">
        <span className="flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{t('evalSite.deadlineAt', { date: deadlineDate })}</span>
        <span className={cx(!closed && days <= 1 && 'font-semibold text-red-600')}>{detail}</span>
      </span>
    </div>
  );
}
