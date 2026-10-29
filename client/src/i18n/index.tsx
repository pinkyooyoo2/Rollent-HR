import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import ko from './locales/ko';
import en from './locales/en';
import ru from './locales/ru';
import ja from './locales/ja';
import zh from './locales/zh';

export const LANGUAGES = [
  { code: 'ko', label: '한국어', locale: 'ko-KR' },
  { code: 'en', label: 'English', locale: 'en-US' },
  { code: 'ru', label: 'Русский', locale: 'ru-RU' },
  { code: 'ja', label: '日本語', locale: 'ja-JP' },
  { code: 'zh', label: '简体中文', locale: 'zh-CN' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];

const DICTS: Record<Lang, Record<string, string>> = { ko, en, ru, ja, zh };

export type TFn = (key: string, params?: Record<string, string | number>) => string;

interface I18nCtx {
  lang: Lang;
  locale: string;
  setLang: (l: Lang) => void;
  t: TFn;
}

const Ctx = createContext<I18nCtx>(null!);

function initialLang(): Lang {
  try {
    const s = localStorage.getItem('lang');
    if (s && s in DICTS) return s as Lang;
  } catch { /* storage 사용 불가 */ }
  return 'ko';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try { localStorage.setItem('lang', l); } catch { /* ignore */ }
  }, []);
  const t = useCallback<TFn>((key, params) => {
    let s = DICTS[lang][key] ?? ko[key as keyof typeof ko] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t, locale: LANGUAGES.find((x) => x.code === lang)!.locale }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

/** 서버 오류 코드를 현재 언어 메시지로 변환 */
export function errorMessage(t: TFn, e: unknown): string {
  const code = (e as { code?: string })?.code ?? 'SERVER_ERROR';
  const key = `errors.${code}`;
  const msg = t(key);
  return msg === key ? t('errors.SERVER_ERROR') : msg;
}
