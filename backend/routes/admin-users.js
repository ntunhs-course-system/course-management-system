const express = require('express');
const { appDb } = require('../db');
const {
  hashPassword, isPasswordTooLong, MAX_USERNAME_LENGTH, MIN_PASSWORD_LENGTH,
} = require('../middleware/auth');
const { sendError } = require('../utils/errors');

// 掛在 /api/admin/users 底下，app.js 已經先檢查 loginRequired + adminOnly：
//   GET   /api/admin/users                     帳號清單
//   POST  /api/admin/users                     新增帳號
//   PATCH /api/admin/users/:id                 停用 / 啟用
//   POST  /api/admin/users/:id/reset-password  重設密碼
const router = express.Router();

const ROLES = ['student', 'admin'];
const MAX_PAGE_SIZE = 100;
// 帳號只收英數字和 . _ -，避免看起來一樣但其實不同的帳號（全形、空白…）
const USERNAME_RE = /^[A-Za-z0-9._-]+$/;

// 回傳給前端的欄位，絕對不含 password_hash
const USER_COLUMNS = 'id, username, role, is_active, must_change_password, created_at';

function toUser(row) {
  return {
    ...row,
    is_active: Boolean(row.is_active),
    must_change_password: Boolean(row.must_change_password),
  };
}

// 沒給回傳 undefined，格式錯回傳 null
function toInt(value, { min, max }) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n < min || n > max ? null : n;
}

function checkPassword(password) {
  if (typeof password !== 'string' || !password) return ['VALIDATION_ERROR', '請輸入密碼'];
  if (isPasswordTooLong(password)) return ['VALIDATION_ERROR', '密碼太長（最多 72 bytes，中文一個字算 3 bytes）'];
  if ([...password].length < MIN_PASSWORD_LENGTH) return ['WEAK_PASSWORD', `密碼至少要 ${MIN_PASSWORD_LENGTH} 個字`];
  return null;
}

const findUser = appDb.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`);
const usernameExists = appDb.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE');
const insertUser = appDb.prepare(
  'INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, 1)'
);
const setActive = appDb.prepare('UPDATE users SET is_active = ? WHERE id = ?');
const resetPassword = appDb.prepare(
  'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?'
);
// 停用或重設密碼後，把這個人所有裝置都登出
const deleteUserSessions = appDb.prepare(
  "DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?"
);

// :id 必須是正整數，同時處理「不能改自己」和 404
function loadTarget(req, res, next) {
  const id = toInt(req.params.id, { min: 1, max: Number.MAX_SAFE_INTEGER });
  if (!id) return sendError(res, 400, 'VALIDATION_ERROR', '使用者 id 格式錯誤');
  const target = findUser.get(id);
  if (!target) return sendError(res, 404, 'NOT_FOUND', '找不到這個帳號');
  // 管理者不能停用自己（會把自己鎖在外面），自己的密碼請用 PUT /api/auth/password 改
  if (target.id === req.user.id) return sendError(res, 400, 'CANNOT_MODIFY_SELF');
  req.target = target;
  next();
}

router.get('/', (req, res) => {
  const q = req.query;
  let page = toInt(q.page, { min: 1, max: 100000 });
  let pageSize = toInt(q.page_size, { min: 1, max: MAX_PAGE_SIZE });
  if (page === null || pageSize === null) {
    return sendError(res, 400, 'VALIDATION_ERROR', '查詢參數格式錯誤');
  }
  if (page === undefined) page = 1;
  if (pageSize === undefined) pageSize = 20;

  const where = [];
  const params = [];
  if (q.role !== undefined) {
    if (!ROLES.includes(q.role)) return sendError(res, 400, 'VALIDATION_ERROR', 'role 只能是 student 或 admin');
    where.push('role = ?');
    params.push(q.role);
  }
  if (q.is_active !== undefined) {
    if (q.is_active !== 'true' && q.is_active !== 'false') {
      return sendError(res, 400, 'VALIDATION_ERROR', 'is_active 只能是 true 或 false');
    }
    where.push('is_active = ?');
    params.push(q.is_active === 'true' ? 1 : 0);
  }
  if (q.keyword !== undefined) {
    if (typeof q.keyword !== 'string') return sendError(res, 400, 'VALIDATION_ERROR', '查詢參數格式錯誤');
    const keyword = q.keyword.trim();
    if (keyword) {
      where.push("username LIKE ? ESCAPE '\\'");
      params.push(`%${keyword.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { total } = appDb.prepare(`SELECT COUNT(*) AS total FROM users ${whereSql}`).get(...params);
  const items = appDb.prepare(
    `SELECT ${USER_COLUMNS} FROM users ${whereSql} ORDER BY id LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize).map(toUser);

  res.json({ total, page, page_size: pageSize, items });
});

router.post('/', async (req, res, next) => {
  try {
    const { username, password, role } = req.body || {};
    if (typeof username !== 'string' || !username.trim()) {
      return sendError(res, 400, 'VALIDATION_ERROR', '請輸入帳號');
    }
    const name = username.trim();
    if (name.length > MAX_USERNAME_LENGTH || !USERNAME_RE.test(name)) {
      return sendError(res, 400, 'VALIDATION_ERROR', `帳號只能用英文、數字和 . _ -，最多 ${MAX_USERNAME_LENGTH} 字`);
    }
    if (!ROLES.includes(role)) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'role 只能是 student 或 admin');
    }
    const bad = checkPassword(password);
    if (bad) return sendError(res, 400, ...bad);

    const hash = await hashPassword(password);
    // 查重和新增中間沒有 await，不會被別的請求插隊
    // Alice 和 alice 算同一個帳號，不然登入時很容易搞混
    if (usernameExists.get(name)) return sendError(res, 409, 'USERNAME_TAKEN');
    const { lastInsertRowid } = insertUser.run(name, hash, role);
    res.status(201).json(toUser(findUser.get(Number(lastInsertRowid))));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', loadTarget, (req, res) => {
  const { is_active: isActive } = req.body || {};
  if (typeof isActive !== 'boolean') {
    return sendError(res, 400, 'VALIDATION_ERROR', '請提供 is_active（true 或 false）');
  }
  setActive.run(isActive ? 1 : 0, req.target.id);
  if (!isActive) deleteUserSessions.run(req.target.id);
  res.json(toUser(findUser.get(req.target.id)));
});

router.post('/:id/reset-password', loadTarget, async (req, res, next) => {
  try {
    const { new_password: newPassword } = req.body || {};
    const bad = checkPassword(newPassword);
    if (bad) return sendError(res, 400, ...bad);

    resetPassword.run(await hashPassword(newPassword), req.target.id);
    deleteUserSessions.run(req.target.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
