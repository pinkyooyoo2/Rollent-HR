import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { PageHeader } from '../components/ui';
import AssignmentView from '../components/AssignmentView';

export default function EvaluatePage() {
  const { id } = useParams();
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <div>
      <PageHeader title={t('my.evaluateTitle')} crumbs={[{ label: t('nav.my'), to: '/my' }, { label: t('my.evaluateTitle') }]} />
      <AssignmentView id={Number(id)} onDone={() => setTimeout(() => nav('/my'), 600)} />
    </div>
  );
}
