const bcrypt = require('bcryptjs');
const { appDb } = require('../db');

const BCRYPT_ROUNDS = 12;

// bcrypt 只看密碼前 72 bytes，超過的部分會被忽略（中文一個字 3 bytes）
const MAX_USERNAME_LENGTH = 50;
const MAX_PASSWORD_BYTES = 72;

function isPasswordTooLong(password) {
  return Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES;
}

const findActiveUser = appDb.prepare(
  'SELECT id, username, role, must_change_password FROM users WHERE id = ? AND is_active = 1'
);

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function loginRequired(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) return res.status(401).json({ error: '請先登入' });

  // 帳號被停用就直接登出
  const user = findActiveUser.get(userId);
  if (!user) {
    return req.session.destroy(() => res.status(401).json({ error: '請先登入' }));
  }
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '沒有權限' });
  }
  next();
}

module.exports = {
  loginRequired,
  adminOnly,
  hashPassword,
  isPasswordTooLong,
  BCRYPT_ROUNDS,
  MAX_USERNAME_LENGTH,
  MAX_PASSWORD_BYTES,
};
