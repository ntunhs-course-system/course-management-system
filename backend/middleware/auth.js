const bcrypt = require('bcryptjs');
const { appDb } = require('../db');
const { sendError } = require('../utils/errors');

const BCRYPT_ROUNDS = 12;

// bcrypt 只看密碼前 72 bytes，超過的部分會被忽略（中文一個字 3 bytes）
const MAX_USERNAME_LENGTH = 50;
const MAX_PASSWORD_BYTES = 72;
const MIN_PASSWORD_LENGTH = 8;

function isPasswordTooLong(password) {
  return Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES;
}

const findActiveUser = appDb.prepare(
  'SELECT id, username, role, must_change_password FROM users WHERE id = ? AND is_active = 1'
);

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// 瀏覽器有帶 sid cookie，但伺服器已經找不到登入狀態 → 視為逾時
function hasSessionCookie(req) {
  return /(?:^|;\s*)sid=/.test(req.headers.cookie || '');
}

function loginRequired(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) {
    return hasSessionCookie(req)
      ? sendError(res, 401, 'SESSION_EXPIRED')
      : sendError(res, 401, 'NOT_LOGGED_IN');
  }

  // 帳號被停用就直接登出
  const user = findActiveUser.get(userId);
  if (!user) {
    return req.session.destroy(() => {
      res.clearCookie('sid');
      sendError(res, 401, 'ACCOUNT_DISABLED');
    });
  }
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return sendError(res, 403, 'FORBIDDEN');
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
  MIN_PASSWORD_LENGTH,
};
