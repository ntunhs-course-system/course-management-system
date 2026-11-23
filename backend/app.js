const express = require('express');
const session = require('express-session');
const helmet = require('helmet');

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

  app.use('/api', require('./routes/auth'));
  app.use('/api/courses', require('./routes/courses'));

  app.use('/api', (req, res) => res.status(404).json({ error: '找不到這個 API' }));

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON 格式錯誤' });
    }
    console.error(err);
    res.status(500).json({ error: '伺服器錯誤' });
  });

  return app;
}

module.exports = { createApp };
