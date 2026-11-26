const express = require('express');
const bcrypt = require('bcryptjs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { appDb } = require('../db');
const { loginRequired, isPasswordTooLong, MAX_USERNAME_LENGTH } = require('../middleware/auth');

const { sendError } = require('../utils/errors');

// 掛在 /api/auth 底下：
//   POST /api/auth/login
//   POST /api/auth/logout
//   GET  /api/auth/me
const router = express.Router();

// 被擋時回傳 retry_after（秒），前端可以顯示倒數
function lockedHandler(code) {
  return (req, res) => {
    const resetTime = req.rateLimit && req.rateLimit.resetTime;
    const retryAfter = resetTime ? Math.max(1, Math.ceil((resetTime - Date.now()) / 1000)) : 15 * 60;
    sendError(res, 429, code, undefined, { retry_after: retryAfter });
  };
}

// 校園網路很多人共用同一個對外 IP，所以用「IP + 帳號」計次：
// 同一個帳號 15 分鐘內最多失敗 5 次，不會因為別人打錯就讓大家都登不進去（登入成功不算）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${req.body.username.trim()}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: lockedHandler('ACCOUNT_LOCKED'),
});

// 同一個 IP 換很多帳號亂試，另外用比較寬的上限擋
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: lockedHandler('TOO_MANY_REQUESTS'),
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
    return sendError(res, 400, 'VALIDATION_ERROR', '請輸入帳號和密碼');
  }
  if (username.length > MAX_USERNAME_LENGTH || isPasswordTooLong(password)) {
    return sendError(res, 400, 'VALIDATION_ERROR', '帳號或密碼太長');
  }
  next();
}

router.post('/login', validateLoginBody, loginIpLimiter, loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const user = findUserByName.get(username.trim());
    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

    // 帳號不存在、密碼錯、帳號停用都回同一個 code，別人猜不出哪些帳號存在
    if (!user || !ok || !user.is_active) {
      return sendError(res, 401, 'INVALID_CREDENTIALS');
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      // 只存 userId，角色每次由 loginRequired 從資料庫重新讀
      req.session.userId = user.id;
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
