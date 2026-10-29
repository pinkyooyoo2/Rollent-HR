import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './index.css';
import { I18nProvider } from './i18n';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/Toast';
import { Spinner } from './components/ui';
import Layout from './components/Layout';
import LoginPage from './pages/Login';
import HomePage from './pages/Home';
import OrganizationPage from './pages/Organization';
import FormsPage from './pages/Forms';
import AdminEvalPage from './pages/AdminEval';
import ResultsPage from './pages/Results';
import KpiPage from './pages/Kpi';
import MyEvaluationsPage from './pages/MyEvaluations';
import EvaluatePage from './pages/Evaluate';
import EvalApp from './eval/EvalApp';
import ProgressDetailPage from './pages/ProgressDetail';

/**
 * 화면 접근 분기 (서버에서도 동일하게 권한 검증)
 *  - 관리자(dashboard.view) → 관리자 페이지, 그 외(팀원·팀장·임원) → 평가 전용 사이트 /e
 */
function Guard({ perm, children }: { perm?: string; children: React.ReactNode }) {
  const { user, loading, can } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (perm && !can(perm)) return <Navigate to={can('dashboard.view') ? '/' : '/e'} replace />;
  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/e" element={<Guard perm="evaluate"><EvalApp /></Guard>} />
      <Route element={<Guard perm="dashboard.view"><Layout /></Guard>}>
        <Route index element={<Guard perm="dashboard.view"><HomePage /></Guard>} />
        <Route path="progress" element={<Guard perm="dashboard.view"><ProgressDetailPage /></Guard>} />
        <Route path="organization" element={<Guard perm="org.view"><OrganizationPage /></Guard>} />
        <Route path="forms" element={<Guard perm="forms.view"><FormsPage /></Guard>} />
        <Route path="kpi" element={<Guard perm="rounds.view"><KpiPage /></Guard>} />
        <Route path="admin-eval" element={<Guard perm="rounds.view"><AdminEvalPage /></Guard>} />
        <Route path="results" element={<Guard perm="results.view"><ResultsPage /></Guard>} />
        <Route path="my" element={<MyEvaluationsPage />} />
        <Route path="evaluate/:id" element={<EvaluatePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>,
);
