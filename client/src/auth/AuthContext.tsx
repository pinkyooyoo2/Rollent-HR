import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearAllDrafts } from '../eval/drafts';
import { api, setUnauthorizedHandler } from '../lib/api';
import { useI18n, type Lang } from '../i18n';

export interface User {
  id: number;
  emp_no: string;
  employee_id: number | null;
  display_name: string;
  email: string | null;
  role: 'executive' | 'admin' | 'leader' | 'employee';
  role_name: string;
  language: Lang;
  permissions: string[];
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (name: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  can: (perm: string) => boolean;
  changeLanguage: (l: Lang) => void;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { lang, setLang } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.get<{ user: User }>('/auth/me')
      .then((r) => { setUser(r.user); setLang(r.user.language); })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [setLang]);

  const login = useCallback(async (name: string, password: string) => {
    const r = await api.post<{ user: User }>('/auth/login', { name, password, language: lang });
    setUser(r.user);
    return r.user;
  }, [lang]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    clearAllDrafts(); // 공유 기기에 작성 중 평가 내용이 남지 않도록
    setUser(null);
  }, []);

  const changeLanguage = useCallback((l: Lang) => {
    setLang(l);
    if (user) {
      setUser({ ...user, language: l });
      api.put('/auth/language', { language: l }).catch(() => undefined);
    }
  }, [setLang, user]);

  const can = useCallback((p: string) => !!user?.permissions.includes(p), [user]);

  return <Ctx.Provider value={{ user, loading, login, logout, can, changeLanguage }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
