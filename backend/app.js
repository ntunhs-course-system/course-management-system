const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { loginRequired, adminOnly } = require('./middleware/auth');
const { sendError } = require('./utils/errors');
const { appDb } = require('./db');
const { SqliteSessionStore } = require('./session-store');

function createApp() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET 未設定或太短（至少 32 字）');
  }

  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.use(session({
    name: 'sid',
    secret: process.env.SESSION_SECRET,
    store: new SqliteSessionStore(appDb),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 2 * 60 * 60 * 1000,
    },
  }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', require('./routes/auth'));
  // 依 API 指南，查課程要先登入
  app.use('/api/courses', loginRequired, require('./routes/courses'));
  app.use('/api/admin/users', loginRequired, adminOnly, require('./routes/admin-users'));

  app.use('/api', (req, res) => sendError(res, 404, 'API_NOT_FOUND'));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return sendError(res, 400, 'INVALID_JSON');
    if (err.type === 'entity.too.large') return sendError(res, 413, 'PAYLOAD_TOO_LARGE');
    // 其他使用者端錯誤（4xx）照原本狀態碼回，不當成伺服器錯誤
    const status = err.status || err.statusCode;
    if (status >= 400 && status < 500) return sendError(res, status, 'VALIDATION_ERROR');
    console.error(err);
    sendError(res, 500, 'INTERNAL_ERROR');
  });

  return app;
}

module.exports = { createApp };
