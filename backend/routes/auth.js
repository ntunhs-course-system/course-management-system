const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { appDb } = require('../db');
const { loginRequired, isPasswordTooLong, MAX_USERNAME_LENGTH } = require('../middleware/auth');

const router = express.Router();

// 15 分鐘內最多失敗 5 次（登入成功不算）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: '嘗試次數過多，請 15 分鐘後再試' },
});

const findUserByName = appDb.prepare(
  'SELECT id, username, password_hash, role, is_active, must_change_password FROM users WHERE username = ?'
);

// 帳號不存在時也比對一次，避免從回應時間猜出帳號
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

// 格式檢查放在次數限制前面：格式錯的請求不會比對密碼，不用算進嘗試次數
function validateLoginBody(req, res, next) {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: '請輸入帳號和密碼' });
  }
  if (username.length > MAX_USERNAME_LENGTH || isPasswordTooLong(password)) {
    return res.status(400).json({ error: '帳號或密碼太長' });
  }
  next();
}

router.post('/login', validateLoginBody, loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = findUserByName.get(username.trim());
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !ok || !user.is_active) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      res.json({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          must_change_password: Boolean(user.must_change_password),
        },
      });
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    res.json({ ok: true });
  });
});

router.get('/me', loginRequired, (req, res) => {
  const { id, username, role, must_change_password } = req.user;
  res.json({ id, username, role, must_change_password: Boolean(must_change_password) });
});

module.exports = router;
