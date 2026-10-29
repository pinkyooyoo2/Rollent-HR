import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Answer } from '../components/EvaluationForm';
import { readDraft, removeDraft, writeDraft } from './drafts';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'blocked';

const DEBOUNCE_MS = 2000;
const RETRY_MS = [3000, 6000, 12000, 30000];

/** 서버 'YYYY-MM-DD HH:MM:SS'(UTC) → epoch ms */
const parseServerTime = (s?: string | null) => (s ? Date.parse(`${s.replace(' ', 'T')}Z`) : 0);

/**
 * 평가 응답 자동저장
 *  - 마지막 입력 후 2초간 추가 입력이 없으면 서버에 저장 (요청은 한 번에 하나만, 대기 중 변경은 이어서 저장)
 *  - 요청마다 단조 증가 seq 를 보내 서버가 오래된 요청을 무시 → 최신 응답이 이전 응답으로 덮어써지지 않음
 *  - 네트워크 오류 시 sessionStorage 에 임시 보관 + 지수 백오프 재시도, 온라인 복귀 시 즉시 재전송
 *  - 마감·제출 등으로 저장이 거부되면(409) 재시도하지 않고 onBlocked 로 알림
 */
export function useAutosave(opts: {
  assignmentId: number;
  userId: number;
  initialAnswers: Record<number, Answer>;
  serverSeq: number;
  lastSavedAt: string | null;
  onBlocked: (code: string) => void;
}) {
  const { assignmentId, userId, serverSeq, onBlocked } = opts;
  const [answers, setAnswers] = useState<Record<number, Answer>>(opts.initialAnswers);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number>(parseServerTime(opts.lastSavedAt));

  const answersRef = useRef(answers);
  const seqRef = useRef(serverSeq);
  const dirtyRef = useRef(false);
  const inflightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const retryRef = useRef(0);
  const blockedRef = useRef(false);
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;

  const nextSeq = () => {
    seqRef.current = Math.max(Date.now(), seqRef.current + 1);
    return seqRef.current;
  };

  const schedule = useCallback((ms: number) => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void saveNow(); }, ms);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** 현재 응답을 서버에 저장 (진행 중인 요청이 있으면 끝난 뒤 이어서 저장) */
  const saveNow = useCallback(async (): Promise<void> => {
    window.clearTimeout(timerRef.current);
    if (blockedRef.current) return;
    if (inflightRef.current) { await inflightRef.current; if (dirtyRef.current) return saveNow(); return; }
    if (!dirtyRef.current) return;
    const snapshot = answersRef.current;
    const seq = nextSeq();
    dirtyRef.current = false;
    setStatus('saving');
    const p = (async () => {
      try {
        const r = await api.put<{ saved_at: string; stale: boolean }>(`/eval/assignments/${assignmentId}/draft`, { answers: snapshot, seq });
        retryRef.current = 0;
        setLastSavedAt(r.stale ? Date.now() : parseServerTime(r.saved_at) || Date.now());
        if (!dirtyRef.current) { removeDraft(userId, assignmentId); setStatus('saved'); } else setStatus('dirty');
      } catch (e) {
        dirtyRef.current = true;
        if (e instanceof ApiError && e.status === 409) {
          blockedRef.current = true;
          setStatus('blocked');
          onBlockedRef.current(e.code);
          return;
        }
        // 서버 검증 오류(4xx)도 응답은 보관하고 재시도하지 않음, 네트워크·서버 오류는 재시도
        writeDraft(userId, assignmentId, answersRef.current);
        const offline = !(e instanceof ApiError) || !navigator.onLine;
        setStatus(offline ? 'offline' : 'error');
        if (!(e instanceof ApiError) || e.status >= 500 || e.status === 0) {
          const wait = RETRY_MS[Math.min(retryRef.current, RETRY_MS.length - 1)];
          retryRef.current++;
          schedule(wait);
        }
      }
    })();
    inflightRef.current = p;
    await p;
    inflightRef.current = null;
    if (dirtyRef.current && !blockedRef.current && retryRef.current === 0) schedule(300);
  }, [assignmentId, userId, schedule]);

  /** 답변 변경 → 메모리·임시 저장소 반영 후 2초 뒤 서버 저장 */
  const change = useCallback((qid: number, a: Answer | undefined) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (a === undefined) delete next[qid]; else next[qid] = a;
      answersRef.current = next;
      return next;
    });
    dirtyRef.current = true;
    setStatus('dirty');
    writeDraft(userId, assignmentId, answersRef.current);
    schedule(DEBOUNCE_MS);
  }, [assignmentId, userId, schedule]);

  /** 제출 전 등: 남은 변경을 즉시 저장하고 완료까지 대기. 저장 성공 여부 반환 */
  const flush = useCallback(async () => {
    if (dirtyRef.current || inflightRef.current) await saveNow();
    return !dirtyRef.current && !blockedRef.current;
  }, [saveNow]);

  // 이전에 저장하지 못한 임시 응답이 서버 저장본보다 최신이면 복원 후 재동기화
  useEffect(() => {
    const backup = readDraft(userId, assignmentId);
    if (backup && backup.ts > parseServerTime(opts.lastSavedAt)) {
      const restored = backup.answers as Record<number, Answer>;
      answersRef.current = restored;
      setAnswers(restored);
      dirtyRef.current = true;
      setStatus('dirty');
      schedule(500);
    } else if (backup) removeDraft(userId, assignmentId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 온라인 복귀 시 즉시 재전송, 탭 숨김 시 바로 저장, 저장 전 이탈 경고, 화면 이동 시 저장
  useEffect(() => {
    const online = () => { if (dirtyRef.current) { retryRef.current = 0; void saveNow(); } };
    const hidden = () => { if (document.visibilityState === 'hidden' && dirtyRef.current) void saveNow(); };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || inflightRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('beforeunload', beforeUnload);
      window.clearTimeout(timerRef.current);
      if (dirtyRef.current && !blockedRef.current) void saveNow();
    };
  }, [saveNow]);

  return {
    answers, status, lastSavedAt, change, flush,
    /** 제출 시 서버에 보낼 seq (자동저장보다 최신) */
    nextSeq,
    /** 제출 완료 후 임시 저장본 정리 */
    clear: () => { dirtyRef.current = false; blockedRef.current = true; removeDraft(userId, assignmentId); },
  };
}
