import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Copy, Trash2, GripVertical, Eye, Save, Send, FilePlus2, Download, ChevronUp, ChevronDown, Scale, History, AlertTriangle, Lock,
} from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useI18n, errorMessage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Modal, PageHeader, Spinner, Tabs, cx } from '../components/ui';
import EvaluationForm, { type Question, type Section } from '../components/EvaluationForm';
import CsvManager from '../components/CsvManager';
import { fmtDate, JOB_GROUPS } from '../lib/status';

type Tab = 'self' | 'leader' | 'exec' | 'upward' | 'weights' | 'csv';
const QTYPES = ['short_text', 'long_text', 'single_choice', 'checkbox', 'dropdown', 'score_scale', 'linear_scale', 'descriptive'] as const;
const CHOICE = ['single_choice', 'checkbox', 'dropdown', 'score_scale', 'descriptive'];
const TEXT = ['short_text', 'long_text'];
const GRADES = [{ label: 'A', score: 5 }, { label: 'B', score: 4 }, { label: 'C', score: 3 }, { label: 'D', score: 2 }, { label: 'E', score: 1 }];

export default function FormsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('self');
  return (
    <div>
      <PageHeader title={t('nav.forms')} description={t('forms.description')} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'self', label: t('stage.self') }, { id: 'leader', label: t('stage.leader') }, { id: 'exec', label: t('stage.exec') },
        { id: 'upward', label: t('stage.upward') }, { id: 'weights', label: t('forms.tab.weights') },
        ...(can('forms.manage') ? [{ id: 'csv' as Tab, label: t('forms.tab.csv') }] : []),
      ]} />
      {(['self', 'leader', 'exec', 'upward'] as const).includes(tab as any) && <StageForms key={tab} stage={tab as 'self'} />}
      {tab === 'weights' && <WeightsPanel />}
      {tab === 'csv' && <CsvManager kinds={['questions']} description={t('forms.csvDesc')} />}
    </div>
  );
}

/* ───────────── 단계별 양식 / 버전 ───────────── */

function StageForms({ stage }: { stage: 'self' | 'leader' | 'exec' | 'upward' }) {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const groups = stage === 'upward' ? ['common'] : [...JOB_GROUPS];
  const [group, setGroup] = useState<string>(groups[0]);
  const [list, setList] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [del, setDel] = useState<any | null>(null);

  const load = useCallback(() => {
    api.get(`/forms?stage=${stage}&jobGroup=${group}`).then((r) => {
      setList(r.items);
      setSelected((cur) => (r.items.some((f: any) => f.id === cur) ? cur
        : (r.items.find((f: any) => f.status === 'draft') ?? r.items.find((f: any) => f.status === 'published') ?? r.items[0])?.id ?? null));
    }).catch((e) => toast('error', errorMessage(t, e)));
  }, [stage, group, t, toast]);
  useEffect(() => { setList(null); load(); }, [load]);

  const newVersion = async (fromId: number) => {
    try { const f = await api.post(`/forms/${fromId}/clone`); toast('success', t('forms.versionCreated', { v: f.version })); setSelected(f.id); load(); }
    catch (e: any) {
      if (e.code === 'DRAFT_EXISTS') { setSelected(e.details.draftId); toast('info', t('errors.DRAFT_EXISTS')); }
      else toast('error', errorMessage(t, e));
    }
  };
  const createEmpty = async () => {
    try { const f = await api.post('/forms', { stage, job_group: group, name: `${t(`stage.${stage}`)} · ${t(`jobGroupFull.${group}`)}` }); setSelected(f.id); load(); }
    catch (e) { toast('error', errorMessage(t, e)); }
  };

  return (
    <div className="space-y-4">
      {stage === 'upward' && <div className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('forms.upwardNote')}</div>}
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <button key={g} onClick={() => setGroup(g)} className={cx('rounded-full border px-3 py-1.5 text-sm', group === g ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}>
              {t(`jobGroupFull.${g}`)}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-4">
        <Card title={<span className="flex items-center gap-2"><History className="h-4 w-4" />{t('forms.versions')}</span>} bodyClass="p-2" className="xl:col-span-1">
          {!list ? <Spinner /> : list.length === 0 ? <EmptyState action={can('forms.manage') && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={createEmpty}>{t('forms.createForm')}</Button>} /> : (
            <ul className="space-y-1">
              {list.map((f) => (
                <li key={f.id}>
                  <button onClick={() => setSelected(f.id)} className={cx('w-full rounded-lg px-3 py-2 text-left text-sm', selected === f.id ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50')}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">v{f.version}</span>
                      <Badge color={f.status === 'published' ? 'green' : f.status === 'draft' ? 'blue' : 'slate'}>{t(`formStatus.${f.status}`)}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{t('forms.qCount', { n: f.question_count, p: Math.round(f.total_points * 100) / 100 })}</div>
                    <div className="text-[11px] text-slate-400">{fmtDate(f.updated_at, locale, true)}{f.usage_count ? ` · ${t('forms.usedN', { n: f.usage_count })}` : ''}</div>
                  </button>
                  {selected === f.id && (
                    <div className="flex flex-wrap gap-1 px-2 pb-2 pt-1">
                      <Button size="sm" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => setPreview(f.id)}>{t('forms.preview')}</Button>
                      <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadFile(`/forms/${f.id}/export.csv`, 'questions.csv').catch((e) => toast('error', errorMessage(t, e)))}>CSV</Button>
                      {can('forms.manage') && f.status !== 'draft' && <Button size="sm" variant="ghost" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => newVersion(f.id)}>{t('forms.newVersion')}</Button>}
                      {can('forms.manage') && f.status === 'draft' && !f.usage_count && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5 text-red-500" />} onClick={() => setDel(f)}>{t('common.delete')}</Button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="xl:col-span-3">
          {selected ? <FormEditor key={selected} formId={selected} onChanged={load} onNewVersion={newVersion} /> : <Card><EmptyState /></Card>}
        </div>
      </div>
      {preview && <PreviewModal formId={preview} onClose={() => setPreview(null)} />}
      <ConfirmDialog open={!!del} danger onClose={() => setDel(null)} title={t('forms.deleteDraftTitle')} message={t('forms.deleteDraftMsg', { v: del?.version ?? '' })}
        confirmLabel={t('common.delete')} onConfirm={async () => {
          try { await api.del(`/forms/${del.id}`); toast('success', t('common.deleted')); setSelected(null); load(); } catch (e) { toast('error', errorMessage(t, e)); throw e; }
        }} />
    </div>
  );
}

function PreviewModal({ formId, onClose, form: given }: { formId?: number; onClose: () => void; form?: any }) {
  const { t } = useI18n();
  const [form, setForm] = useState<any | null>(given ?? null);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  useEffect(() => { if (!given && formId) api.get(`/forms/${formId}`).then(setForm).catch(() => undefined); }, [formId, given]);
  return (
    <Modal open onClose={onClose} size="xl" title={<span>{t('forms.preview')} {form && <span className="text-sm font-normal text-slate-500">· {form.name} v{form.version}</span>}</span>}>
      {!form ? <Spinner /> : <>
        <p className="mb-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">{t('forms.previewNote')}</p>
        <EvaluationForm sections={form.sections} answers={answers} onChange={(id, a) => setAnswers({ ...answers, [id]: a })} />
      </>}
    </Modal>
  );
}

/* ───────────── 편집기 ───────────── */

let keySeq = 1;
interface EQ extends Omit<Question, 'id' | 'options'> { key: number; options: { key: number; label: string; score: number }[] }
interface ES { key: number; title: string; description: string; questions: EQ[] }

const toEditable = (sections: Section[]): ES[] => sections.map((s) => ({
  key: keySeq++, title: s.title, description: s.description ?? '',
  questions: s.questions.map((q) => ({ ...q, key: keySeq++, options: q.options.map((o) => ({ key: keySeq++, label: o.label, score: o.score })) })),
}));

function FormEditor({ formId, onChanged, onNewVersion }: { formId: number; onChanged: () => void; onNewVersion: (id: number) => void }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState<any | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sections, setSections] = useState<ES[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [publish, setPublish] = useState(false);
  const [drag, setDrag] = useState<{ s: number; q: number } | null>(null);
  const [openQ, setOpenQ] = useState<number | null>(null);

  const load = useCallback(() => {
    api.get(`/forms/${formId}`).then((f) => { setForm(f); setName(f.name); setDescription(f.description ?? ''); setSections(toEditable(f.sections)); setDirty(false); })
      .catch((e) => toast('error', errorMessage(t, e)));
  }, [formId, t, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const editable = form?.status === 'draft' && can('forms.manage');
  const total = useMemo(() => sections.flatMap((s) => s.questions).filter((q) => q.scored).reduce((a, q) => a + Number(q.points || 0), 0), [sections]);
  const mutate = (fn: (s: ES[]) => ES[]) => { setSections((cur) => fn(structuredClone(cur))); setDirty(true); };
  const updQ = (si: number, qi: number, patch: Partial<EQ>) => mutate((s) => { Object.assign(s[si].questions[qi], patch); return s; });

  const changeType = (si: number, qi: number, type: string) => mutate((s) => {
    const q = s[si].questions[qi];
    q.type = type;
    if (TEXT.includes(type)) { q.scored = false; q.points = 0; q.options = []; }
    if ((type === 'score_scale' || type === 'descriptive') && q.options.length === 0) q.options = GRADES.map((g) => ({ ...g, key: keySeq++ }));
    if (['single_choice', 'checkbox', 'dropdown'].includes(type) && q.options.length === 0) q.options = [{ key: keySeq++, label: `${t('forms.option')} 1`, score: 0 }];
    if (type === 'linear_scale') { q.options = []; q.settings = { min: 1, max: 5, ...(q.settings ?? {}) }; }
    return s;
  });

  const newQuestion = (): EQ => ({ key: keySeq++, type: 'score_scale', text: t('forms.newQuestion'), description: '', required: true, points: 1, scored: true, settings: null, is_sample: false, is_suggestion: false, options: GRADES.map((g) => ({ ...g, key: keySeq++ })) });
  const suggestionIdx = sections.findIndex((s) => s.questions.some((q) => q.is_suggestion));
  const addSection = () => mutate((s) => {
    const sec: ES = { key: keySeq++, title: t('forms.newSection'), description: '', questions: [newQuestion()] };
    const at = suggestionIdx >= 0 ? suggestionIdx : s.length;
    s.splice(at, 0, sec);
    return s;
  });
  const moveSection = (i: number, d: number) => mutate((s) => { if (i + d < 0 || i + d >= s.length) return s; const [x] = s.splice(i, 1); s.splice(i + d, 0, x); return s; });
  const dropQ = (si: number, qi: number | null) => {
    if (!drag) return;
    mutate((s) => {
      const [q] = s[drag.s].questions.splice(drag.q, 1);
      const target = s[si].questions;
      let idx = qi === null ? target.length : qi;
      if (drag.s === si && drag.q < idx) idx--;
      target.splice(idx, 0, q);
      return s;
    });
    setDrag(null);
  };
  const distribute = (si: number) => {
    const sec = sections[si];
    const cur = sec.questions.filter((q) => q.scored).reduce((a, q) => a + Number(q.points), 0);
    const v = window.prompt(t('forms.distributePrompt'), String(Math.round(cur * 100) / 100));
    if (v === null) return;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) { toast('error', t('validation.number')); return; }
    const scored = sec.questions.filter((q) => q.scored).length;
    if (!scored) return;
    mutate((s) => { s[si].questions.forEach((q) => { if (q.scored) q.points = Math.round((n / scored) * 10000) / 10000; }); return s; });
  };

  const save = async () => {
    for (const s of sections) {
      if (!s.title.trim()) { toast('error', t('forms.err.sectionTitle')); return false; }
      for (const q of s.questions) {
        if (!q.text.trim()) { toast('error', t('forms.err.questionText')); return false; }
        if (CHOICE.includes(q.type) && q.options.length === 0) { toast('error', t('forms.err.options', { q: q.text })); return false; }
        if (q.options.some((o) => !o.label.trim())) { toast('error', t('forms.err.optionLabel', { q: q.text })); return false; }
      }
    }
    setSaving(true);
    try {
      const ordered = [...sections].sort((a, b) => Number(a.questions.some((q) => q.is_suggestion)) - Number(b.questions.some((q) => q.is_suggestion)));
      const f = await api.put(`/forms/${formId}`, {
        name, description,
        sections: ordered.map((s) => ({
          title: s.title, description: s.description || null,
          questions: s.questions.map((q) => ({
            type: q.type, text: q.text, description: q.description || null, required: q.required, points: Number(q.points) || 0, scored: q.scored,
            settings: q.settings ?? null, is_sample: !!q.is_sample, is_suggestion: !!q.is_suggestion, options: q.options.map((o) => ({ label: o.label, score: Number(o.score) || 0 })),
          })),
        })),
      });
      setForm(f); setSections(toEditable(f.sections)); setDirty(false);
      toast('success', t('common.saved'));
      onChanged();
      return true;
    } catch (e) { toast('error', errorMessage(t, e)); return false; } finally { setSaving(false); }
  };

  if (!form) return <Card><Spinner /></Card>;

  return (
    <div className="space-y-4">
      <div className="card sticky top-0 z-10 flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          {editable ? <input className="input font-semibold" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label={t('forms.formName')} />
            : <div className="font-semibold text-navy-900">{form.name}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge color={form.status === 'published' ? 'green' : form.status === 'draft' ? 'blue' : 'slate'}>v{form.version} · {t(`formStatus.${form.status}`)}</Badge>
            <span className={cx('font-semibold', Math.abs(total - 100) < 0.01 ? 'text-emerald-600' : 'text-amber-600')}>{t('forms.totalPoints', { n: Math.round(total * 100) / 100 })}</span>
            {Math.abs(total - 100) >= 0.01 && <span className="text-amber-600">{t('forms.normalizeNote')}</span>}
            {form.source && <span>· {t('forms.source')}: {form.source}</span>}
            {dirty && <span className="text-amber-600">● {t('csv.unsaved')}</span>}
          </div>
        </div>
        <Button variant="secondary" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>{t('forms.preview')}</Button>
        {editable && <Button variant="secondary" loading={saving} icon={<Save className="h-4 w-4" />} onClick={save} disabled={!dirty}>{t('common.save')}</Button>}
        {editable && <Button icon={<Send className="h-4 w-4" />} onClick={async () => { if (!dirty || (await save())) setPublish(true); }}>{t('forms.publish')}</Button>}
        {!editable && can('forms.manage') && <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => onNewVersion(form.id)}>{t('forms.editAsNewVersion')}</Button>}
      </div>
      {!editable && <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-3 text-sm text-slate-600"><Lock className="h-4 w-4" />{t('forms.lockedNote')}</div>}
      {editable && (
        <div className="card p-4">
          <Field label={t('common.description')}><textarea className="input" rows={2} value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} /></Field>
        </div>
      )}

      {sections.map((s, si) => {
        const secPts = s.questions.filter((q) => q.scored).reduce((a, q) => a + Number(q.points || 0), 0);
        const isSuggestion = s.questions.some((q) => q.is_suggestion);
        return (
          <section key={s.key} className="card" onDragOver={(e) => editable && e.preventDefault()} onDrop={() => editable && dropQ(si, null)}>
            <header className="flex flex-wrap items-start gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <div className="min-w-[220px] flex-1 space-y-1.5">
                {editable ? <>
                  <input className="input font-semibold" value={s.title} onChange={(e) => mutate((x) => { x[si].title = e.target.value; return x; })} aria-label={t('forms.sectionTitle')} />
                  <input className="input text-xs" value={s.description} placeholder={t('forms.sectionDesc')} onChange={(e) => mutate((x) => { x[si].description = e.target.value; return x; })} />
                </> : <><div className="font-semibold">{s.title}</div>{s.description && <div className="text-xs text-slate-500">{s.description}</div>}</>}
              </div>
              <Badge color="blue">{t('form.sectionPoints', { n: Math.round(secPts * 100) / 100 })}</Badge>
              {editable && !isSuggestion && <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<Scale className="h-3.5 w-3.5" />} onClick={() => distribute(si)}>{t('forms.distribute')}</Button>
                <button className="rounded p-1 hover:bg-slate-200" onClick={() => moveSection(si, -1)} aria-label="up"><ChevronUp className="h-4 w-4" /></button>
                <button className="rounded p-1 hover:bg-slate-200" onClick={() => moveSection(si, 1)} aria-label="down"><ChevronDown className="h-4 w-4" /></button>
                <button className="rounded p-1 text-red-500 hover:bg-red-50" onClick={() => { if (window.confirm(t('forms.deleteSectionConfirm'))) mutate((x) => { x.splice(si, 1); return x; }); }} aria-label={t('common.delete')}><Trash2 className="h-4 w-4" /></button>
              </div>}
            </header>
            <ul>
              {s.questions.map((q, qi) => (
                <li key={q.key} draggable={editable} onDragStart={() => setDrag({ s: si, q: qi })} onDragOver={(e) => { if (editable) { e.preventDefault(); e.stopPropagation(); } }}
                  onDrop={(e) => { e.stopPropagation(); if (editable) dropQ(si, qi); }}
                  className={cx('border-b border-slate-100 last:border-0', drag?.s === si && drag?.q === qi && 'opacity-40')}>
                  <div className="flex items-start gap-2 px-4 py-3">
                    {editable && <GripVertical className="mt-1 h-4 w-4 shrink-0 cursor-grab text-slate-300" aria-label={t('forms.dragHint')} />}
                    <button className="flex-1 text-left" onClick={() => setOpenQ(openQ === q.key ? null : q.key)}>
                      <div className="text-sm font-medium">{q.text}{q.required && <span className="text-red-500"> *</span>}</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge>{t(`qtype.${q.type}`)}</Badge>
                        {q.scored ? <Badge color="teal">{t('form.points', { n: Math.round(Number(q.points) * 100) / 100 })}</Badge> : <Badge>{t('form.notScored')}</Badge>}
                        {q.is_sample && <Badge color="violet">{t('form.sample')}</Badge>}
                        {q.is_suggestion && <Badge color="amber">{t('forms.suggestionItem')}</Badge>}
                      </div>
                    </button>
                    {editable && <div className="flex gap-1">
                      <button className="rounded p-1 hover:bg-slate-100" title={t('forms.duplicate')} aria-label={t('forms.duplicate')}
                        onClick={() => mutate((x) => { const c = structuredClone(x[si].questions[qi]); c.key = keySeq++; c.is_suggestion = false; c.options.forEach((o) => { o.key = keySeq++; }); x[si].questions.splice(qi + 1, 0, c); return x; })}>
                        <Copy className="h-4 w-4 text-slate-500" /></button>
                      <button className="rounded p-1 hover:bg-red-50" title={t('common.delete')} aria-label={t('common.delete')}
                        onClick={() => mutate((x) => { x[si].questions.splice(qi, 1); return x; })}><Trash2 className="h-4 w-4 text-red-500" /></button>
                    </div>}
                  </div>
                  {openQ === q.key && <QuestionEditor q={q} editable={!!editable} onChange={(p) => updQ(si, qi, p)} onType={(ty) => changeType(si, qi, ty)} />}
                </li>
              ))}
            </ul>
            {editable && !isSuggestion && (
              <div className="p-3"><Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => { const nq = newQuestion(); mutate((x) => { x[si].questions.push(nq); return x; }); setOpenQ(nq.key); }}>{t('forms.addQuestion')}</Button></div>
            )}
          </section>
        );
      })}
      {editable && <Button variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={addSection}>{t('forms.addSection')}</Button>}

      {preview && <PreviewModal onClose={() => setPreview(false)} form={{ ...form, name, sections: sections.map((s, i) => ({ id: -i - 1, title: s.title, description: s.description, questions: s.questions.map((q) => ({ ...q, id: q.key, options: q.options.map((o) => ({ ...o, id: o.key })) })) })) }} />}
      <ConfirmDialog open={publish} onClose={() => setPublish(false)} title={t('forms.publishTitle')} message={t('forms.publishMsg')} confirmLabel={t('forms.publish')}
        onConfirm={async () => {
          try { await api.post(`/forms/${formId}/publish`); toast('success', t('forms.published')); load(); onChanged(); } catch (e) { toast('error', errorMessage(t, e)); throw e; }
        }} />
    </div>
  );
}

function QuestionEditor({ q, editable, onChange, onType }: { q: EQ; editable: boolean; onChange: (p: Partial<EQ>) => void; onType: (t: string) => void }) {
  const { t } = useI18n();
  const isText = TEXT.includes(q.type);
  const setOpt = (i: number, p: Partial<EQ['options'][number]>) => onChange({ options: q.options.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  const moveOpt = (i: number, d: number) => {
    if (i + d < 0 || i + d >= q.options.length) return;
    const o = [...q.options]; const [x] = o.splice(i, 1); o.splice(i + d, 0, x); onChange({ options: o });
  };
  return (
    <div className="mx-4 mb-4 space-y-3 rounded-lg border border-brand-100 bg-brand-50/40 p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2"><Field label={t('forms.questionText')} required><input className="input" disabled={!editable} value={q.text} onChange={(e) => onChange({ text: e.target.value })} /></Field></div>
        <Field label={t('forms.questionType')}>
          <select className="input" disabled={!editable} value={q.type} onChange={(e) => onType(e.target.value)}>
            {QTYPES.map((ty) => <option key={ty} value={ty}>{t(`qtype.${ty}`)}</option>)}
          </select>
        </Field>
        <div className="md:col-span-3"><Field label={t('common.description')}><input className="input" disabled={!editable} value={q.description ?? ''} onChange={(e) => onChange({ description: e.target.value })} /></Field></div>
      </div>
      <div className="flex flex-wrap items-center gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" disabled={!editable} checked={q.required} onChange={(e) => onChange({ required: e.target.checked })} />{t('forms.required')}</label>
        <label className={cx('flex items-center gap-2', isText && 'text-slate-400')}><input type="checkbox" disabled={!editable || isText} checked={q.scored} onChange={(e) => onChange({ scored: e.target.checked, points: e.target.checked ? q.points || 1 : 0 })} />{t('forms.scored')}</label>
        {q.scored && <label className="flex items-center gap-2">{t('forms.points')}<input type="number" step="0.01" min={0} className="input !w-24" disabled={!editable} value={q.points} onChange={(e) => onChange({ points: Number(e.target.value) })} /></label>}
        <label className="flex items-center gap-2"><input type="checkbox" disabled={!editable} checked={!!q.is_sample} onChange={(e) => onChange({ is_sample: e.target.checked })} />{t('forms.markSample')}</label>
        {isText && q.scored === false && <span className="text-xs text-slate-400">{t('forms.textNotScored')}</span>}
      </div>
      {CHOICE.includes(q.type) && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">{t('forms.options')} {q.scored && <span className="text-slate-400">· {t('forms.optionScoreHint')}</span>}</div>
          <ul className="space-y-1.5">
            {q.options.map((o, i) => (
              <li key={o.key} className="flex items-center gap-2">
                <span className="w-5 text-right text-xs text-slate-400">{i + 1}</span>
                <input className="input" disabled={!editable} value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} aria-label={t('forms.optionLabel')} />
                <input type="number" step="0.5" className="input !w-24" disabled={!editable} value={o.score} onChange={(e) => setOpt(i, { score: Number(e.target.value) })} aria-label={t('forms.optionScore')} />
                {editable && <>
                  <button className="rounded p-1 hover:bg-white" onClick={() => moveOpt(i, -1)} aria-label="up"><ChevronUp className="h-4 w-4" /></button>
                  <button className="rounded p-1 hover:bg-white" onClick={() => moveOpt(i, 1)} aria-label="down"><ChevronDown className="h-4 w-4" /></button>
                  <button className="rounded p-1 text-red-500 hover:bg-white" onClick={() => onChange({ options: q.options.filter((_, j) => j !== i) })} aria-label={t('common.delete')}><Trash2 className="h-4 w-4" /></button>
                </>}
              </li>
            ))}
          </ul>
          {editable && <div className="mt-2 flex gap-2">
            <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange({ options: [...q.options, { key: keySeq++, label: `${t('forms.option')} ${q.options.length + 1}`, score: 0 }] })}>{t('forms.addOption')}</Button>
            <Button size="sm" variant="ghost" onClick={() => onChange({ options: GRADES.map((g) => ({ ...g, key: keySeq++ })) })}>{t('forms.useGrades')}</Button>
          </div>}
        </div>
      )}
      {q.type === 'linear_scale' && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t('forms.scaleMin')}><select className="input" disabled={!editable} value={q.settings?.min ?? 1} onChange={(e) => onChange({ settings: { ...q.settings, min: Number(e.target.value) } })}>{[0, 1].map((n) => <option key={n}>{n}</option>)}</select></Field>
          <Field label={t('forms.scaleMax')}><select className="input" disabled={!editable} value={q.settings?.max ?? 5} onChange={(e) => onChange({ settings: { ...q.settings, max: Number(e.target.value) } })}>{[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n}>{n}</option>)}</select></Field>
          <Field label={t('forms.minLabel')}><input className="input" disabled={!editable} value={q.settings?.minLabel ?? ''} onChange={(e) => onChange({ settings: { ...q.settings, minLabel: e.target.value } })} /></Field>
          <Field label={t('forms.maxLabel')}><input className="input" disabled={!editable} value={q.settings?.maxLabel ?? ''} onChange={(e) => onChange({ settings: { ...q.settings, maxLabel: e.target.value } })} /></Field>
        </div>
      )}
    </div>
  );
}

/* ───────────── 가중치 ───────────── */

interface W { self: number; leader: number; exec: number; upward: number }
const toW = (x: any): W => ({ self: x.self, leader: x.leader, exec: x.exec, upward: x.upward ?? 0 });

/** leaderGroup: 팀장 직군만 팀원→팀장평가 반영 비율을 설정할 수 있음 */
function WeightRow({ label, w, onChange, disabled, leaderGroup }: { label: string; w: W; onChange: (w: W) => void; disabled?: boolean; leaderGroup?: boolean }) {
  const { t } = useI18n();
  const sum = Math.round((w.self + w.leader + w.exec + w.upward) * 1000) / 1000;
  const keys = leaderGroup ? (['self', 'leader', 'exec', 'upward'] as const) : (['self', 'leader', 'exec'] as const);
  return (
    <div className={cx('rounded-lg border p-4', sum === 100 ? 'border-slate-200' : 'border-red-300 bg-red-50/40', disabled && 'opacity-50')}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className={cx('text-sm font-bold', sum === 100 ? 'text-emerald-600' : 'text-red-600')}>{t('forms.sum', { n: sum })}</span>
      </div>
      <div className={cx('grid gap-4', leaderGroup ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}>
        {keys.map((k) => (
          <div key={k}>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-600"><span>{t(`stage.${k}`)}</span>
              <span className="flex items-center gap-1"><input type="number" min={0} max={100} step={1} disabled={disabled} className="input !w-20 !py-1 text-right" value={w[k]}
                onChange={(e) => onChange({ ...w, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} aria-label={t(`stage.${k}`)} />%</span>
            </div>
            <input type="range" min={0} max={100} step={1} disabled={disabled} className="w-full accent-brand-600" value={w[k]} onChange={(e) => onChange({ ...w, [k]: Number(e.target.value) })} aria-label={t(`stage.${k}`)} />
          </div>
        ))}
      </div>
      {sum !== 100 && <p className="mt-2 text-xs text-red-600">{t('forms.sumError')}</p>}
      {leaderGroup && <p className="mt-2 text-xs text-slate-500">{t('forms.upwardWeightHint')}</p>}
    </div>
  );
}

function WeightsPanel() {
  const { t, locale } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const [rounds, setRounds] = useState<any[]>([]);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [def, setDef] = useState<W>({ self: 20, leader: 40, exec: 40, upward: 0 });
  const [ov, setOv] = useState<Record<string, W | null>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = can('weights.manage');

  useEffect(() => { api.get('/rounds').then((r) => { setRounds(r.items); setRoundId(r.items.find((x: any) => x.status === 'open')?.id ?? r.items[0]?.id ?? null); }).catch(() => undefined); }, []);
  const load = useCallback(() => {
    if (!roundId) return;
    api.get(`/rounds/${roundId}/weights`).then((r) => {
      const w = r.weights;
      setDef(toW(w.default));
      setOv(Object.fromEntries(JOB_GROUPS.map((g) => [g, w[g].overridden ? toW(w[g]) : null])));
      setHistory(r.history);
    }).catch((e) => toast('error', errorMessage(t, e)));
  }, [roundId, t, toast]);
  useEffect(() => { load(); }, [load]);

  const ok = (w: W) => Math.abs(w.self + w.leader + w.exec + w.upward - 100) < 0.001;
  const valid = ok(def) && Object.values(ov).every((w) => !w || ok(w));
  const save = async () => {
    setBusy(true);
    try { await api.put(`/rounds/${roundId}/weights`, { default: def, overrides: ov, reason }); toast('success', t('forms.weightsSaved')); setReason(''); load(); }
    catch (e) { toast('error', errorMessage(t, e)); } finally { setBusy(false); }
  };
  const ex = Math.round((90 * def.self + 80 * def.leader + 85 * def.exec) / 100 * 100) / 100;

  if (!rounds.length) return <Card><EmptyState title={t('dashboard.noRound')} /></Card>;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2" title={t('forms.weightsTitle')} actions={
        <select className="input !w-auto" value={roundId ?? ''} onChange={(e) => setRoundId(Number(e.target.value))}>{rounds.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}>
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{t('forms.weightsDesc')}</p>
          <WeightRow label={t('forms.defaultWeights')} w={def} onChange={setDef} disabled={!editable} />
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <div className="font-semibold">{t('forms.formula')}</div>
            <div className="mt-1 font-mono">{t('forms.formulaText')}</div>
            <div className="mt-1">{t('forms.example', { s: def.self, l: def.leader, e: def.exec, r: ex })}</div>
          </div>
          <h4 className="pt-2 text-sm font-semibold">{t('forms.groupOverrides')}</h4>
          <p className="text-xs text-slate-500">{t('forms.groupOverridesDesc')}</p>
          {JOB_GROUPS.map((g) => (
            <div key={g}>
              <label className="mb-2 flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={!editable} checked={!!ov[g]} onChange={(e) => setOv({ ...ov, [g]: e.target.checked ? { ...def, upward: 0 } : null })} />
                {t(`jobGroupFull.${g}`)} {!ov[g] && <span className="text-xs text-slate-400">({t('forms.usesDefault')})</span>}
              </label>
              {ov[g] && <WeightRow label={t(`jobGroupFull.${g}`)} w={ov[g]!} onChange={(w) => setOv({ ...ov, [g]: w })} disabled={!editable} leaderGroup={g.endsWith('_leader')} />}
            </div>
          ))}
          <div className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">
            <b>{t('jobGroupFull.executive')}</b> · {t('forms.executiveFixed')}
          </div>
          {editable && (
            <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
              <div className="min-w-[240px] flex-1"><Field label={t('forms.changeReason')}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
              <Button loading={busy} disabled={!valid} icon={<Save className="h-4 w-4" />} onClick={save}>{t('forms.saveWeights')}</Button>
            </div>
          )}
        </div>
      </Card>
      <Card title={t('forms.weightHistory')} bodyClass="p-0">
        {history.length === 0 ? <EmptyState /> : (
          <ul className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto">
            {history.map((h) => (
              <li key={h.id} className="px-4 py-3 text-xs">
                <div className="flex justify-between"><b>{h.job_group === 'default' ? t('forms.defaultWeights') : t(`jobGroupFull.${h.job_group}`)}</b><span className="text-slate-400">{fmtDate(h.changed_at, locale, true)}</span></div>
                <div className="mt-1 font-mono text-slate-600">
                  {h.before ? `${h.before.self}/${h.before.leader}/${h.before.exec}/${h.before.upward ?? 0}` : '–'} → {h.after ? `${h.after.self}/${h.after.leader}/${h.after.exec}/${h.after.upward ?? 0}` : '–'}
                  {h.after && !h.after.overridden && h.job_group !== 'default' && <span className="ml-1 text-slate-400">({t('forms.usesDefault')})</span>}
                </div>
                <div className="text-slate-500">{h.changed_by_name}{h.reason && ` · ${h.reason}`}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
