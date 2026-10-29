import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PenSquare, Eye, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';
import { StageBadge, fmtDate } from '../lib/status';

export default function MyEvaluationsPage() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const load = () => api.get('/my/assignments').then((r) => setItems(r.items)).catch((e) => setError(errorMessage(t, e)));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = useMemo(() => {
    const m = new Map<number, { round: any; list: any[] }>();
    for (const a of items ?? []) {
      if (!m.has(a.round_id)) m.set(a.round_id, { round: a, list: [] });
      m.get(a.round_id)!.list.push(a);
    }
    return [...m.values()];
  }, [items]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  return (
    <div>
      <PageHeader title={t('nav.my')} description={t('my.description')} />
      {!items ? <Spinner /> : grouped.length === 0 ? <Card><EmptyState title={t('my.none')} /></Card> : (
        <div className="space-y-5">
          {grouped.map(({ round, list }) => {
            const done = list.filter((a) => a.status === 'submitted').length;
            return (
              <Card key={round.round_id} title={<span>{round.round_name} <Badge color={round.round_status === 'open' ? 'green' : 'slate'}>{t(`roundStatus.${round.round_status}`)}</Badge></span>}
                actions={<span className="text-xs text-slate-500">{t('my.doneOf', { done, total: list.length })} · {t('my.deadline')}: {fmtDate(round.end_date, locale)}</span>} bodyClass="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr><th className="th">{t('my.stage')}</th><th className="th">{t('my.target')}</th><th className="th">{t('common.department')}</th><th className="th">{t('common.status')}</th><th className="th">{t('my.updated')}</th><th className="th text-right">{t('common.actions')}</th></tr></thead>
                    <tbody>
                      {list.map((a) => {
                        const editable = a.status !== 'submitted' && a.stage_open && a.sequence_ok;
                        return (
                          <tr key={a.id} className="hover:bg-slate-50">
                            <td className="td"><Badge color="blue">{t(`stage.${a.stage}`)}</Badge></td>
                            <td className="td font-medium">{a.target_name} <span className="text-xs text-slate-400">{a.target_emp_no}</span></td>
                            <td className="td">{a.target_department ?? '–'}</td>
                            <td className="td"><StageBadge state={a.status} t={t} />
                              {a.status !== 'submitted' && !a.stage_open && <div className="mt-1 text-[11px] text-slate-400">{t('my.block.STAGE_NOT_OPEN')}</div>}
                              {a.status !== 'submitted' && a.stage_open && !a.sequence_ok && <div className="mt-1 text-[11px] text-slate-400">{t('my.block.PREVIOUS_STAGE_PENDING')}</div>}
                            </td>
                            <td className="td text-xs text-slate-500">{fmtDate(a.submitted_at ?? a.updated_at, locale, true)}</td>
                            <td className="td text-right">
                              <Link to={`/evaluate/${a.id}`} className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium ${editable ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                                {editable ? <><PenSquare className="h-3.5 w-3.5" />{a.status === 'in_progress' ? t('my.continue') : t('my.start')}</>
                                  : a.status === 'submitted' ? <><Eye className="h-3.5 w-3.5" />{t('common.view')}</> : <><Lock className="h-3.5 w-3.5" />{t('common.view')}</>}
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
