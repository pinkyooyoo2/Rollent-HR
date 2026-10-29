import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config, ROOT_DIR } from './config.ts';
import { run, get } from './db/index.ts';
import { migrate } from './db/migrate.ts';
import { sessionMiddleware, csrfGuard } from './auth.ts';
import { errorHandler, clientIp, ApiError } from './http.ts';
import { authRouter } from './routes/auth.ts';
import { dashboardRouter } from './routes/dashboard.ts';
import { orgRouter } from './routes/org.ts';
import { formsRouter } from './routes/forms.ts';
import { uploadsRouter } from './routes/uploads.ts';
import { roundsRouter, assignmentsRouter, myRouter } from './routes/rounds.ts';
import { resultsRouter, reportsRouter, logsRouter } from './routes/results.ts';
import { kpiRouter } from './routes/kpi.ts';
import { evalRouter } from './routes/eval.ts';

migrate(false);
if (!get('SELECT id FROM roles LIMIT 1')) {
  console.warn('[server] 데이터가 비어 있습니다. `npm run db:seed` 로 초기 데이터를 생성하세요.');
}

export const app = express();
// 프록시 뒤에서 실제 접속 IP 로 로그인 제한·접근 로그를 기록하기 위함
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// API 접근 로그
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    try {
      run('INSERT INTO access_logs (user_id, method, path, status, ip, user_agent, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.user?.id ?? null, req.method, req.originalUrl.slice(0, 300), res.statusCode, clientIp(req),
          String(req.headers['user-agent'] ?? '').slice(0, 200), Date.now() - start]);
    } catch { /* 로그 실패는 무시 */ }
  });
  next();
});

app.use('/api', sessionMiddleware, csrfGuard);
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.get('/api/health', (_req, res) => { res.json({ ok: true }); });
app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api', orgRouter);
app.use('/api/forms', formsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/rounds', roundsRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/my', myRouter);
app.use('/api/results', resultsRouter);
app.use('/api/kpi', kpiRouter);
app.use('/api/eval', evalRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/logs', logsRouter);
app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND')));
app.use(errorHandler);

// 운영 모드: 빌드된 프론트엔드 제공
const dist = path.join(ROOT_DIR, 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// 만료 세션 정리 (1시간 간격)
setInterval(() => run(`DELETE FROM sessions WHERE expires_at < datetime('now')`), 3600_000).unref();

if (!process.env.NO_LISTEN) {
  app.listen(config.port, () => console.log(`[server] http://localhost:${config.port}  (${config.isProduction ? 'production' : 'development'})`));
}
