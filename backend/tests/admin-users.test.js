const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-admin-users-test-'));
process.env.APP_DB_PATH = path.join(tmpDir, 'app.db');
process.env.SESSION_SECRET = 'test-secret-'.padEnd(40, 'x');

const { appDb } = require('../db');
const { hashPassword } = require('../middleware/auth');
const { createApp } = require('../app');

let server;
let base;
let admin; // 管理者的 cookie
let adminId;

async function call(method, url, { body, cookie = admin } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: await res.json(), cookie: setCookie && setCookie.split(';')[0] };
}

async function login(username, password) {
  return call('POST', '/api/auth/login', { cookie: null, body: { username, password } });
}

const userId = (username) => appDb.prepare('SELECT id FROM users WHERE username = ?').get(username).id;

before(async () => {
  const insert = appDb.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  insert.run('boss', await hashPassword('boss-pass-123'), 'admin');
  insert.run('stu1', await hashPassword('stu1-pass-123'), 'student');
  insert.run('stu2', await hashPassword('stu2-pass-123'), 'student');

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  admin = (await login('boss', 'boss-pass-123')).cookie;
  adminId = userId('boss');
});

after(() => {
  server.close();
  appDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('沒登入回 401，學生回 403', async () => {
  const student = (await login('stu1', 'stu1-pass-123')).cookie;
  const requests = [
    ['GET', '/api/admin/users'],
    ['POST', '/api/admin/users', { username: 'x', password: 'xxxxxxxx', role: 'student' }],
    ['PATCH', `/api/admin/users/${userId('stu2')}`, { is_active: false }],
    ['POST', `/api/admin/users/${userId('stu2')}/reset-password`, { new_password: 'hacked-pass' }],
  ];
  for (const [method, url, body] of requests) {
    assert.equal((await call(method, url, { body, cookie: null })).status, 401, `${method} ${url}`);
    const res = await call(method, url, { body, cookie: student });
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
  assert.ok((await login('stu2', 'stu2-pass-123')).cookie, '學生的請求不能改到任何東西');
});

test('帳號清單：不含密碼，可以篩選、分頁', async () => {
  const all = await call('GET', '/api/admin/users');
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 3);
  assert.deepEqual(all.body.items.map((u) => u.username), ['boss', 'stu1', 'stu2']);
  for (const u of all.body.items) {
    assert.equal(u.password_hash, undefined);
    assert.equal(typeof u.is_active, 'boolean');
    assert.equal(typeof u.must_change_password, 'boolean');
  }

  const admins = await call('GET', '/api/admin/users?role=admin');
  assert.deepEqual(admins.body.items.map((u) => u.username), ['boss']);

  const kw = await call('GET', '/api/admin/users?keyword=stu');
  assert.equal(kw.body.total, 2);
  assert.equal((await call('GET', '/api/admin/users?keyword=%25')).body.total, 0, '% 不能變萬用字元');

  const page2 = await call('GET', '/api/admin/users?page=2&page_size=2');
  assert.deepEqual(page2.body.items.map((u) => u.username), ['stu2']);

  for (const qs of ['role=teacher', 'is_active=1', 'page=0', 'page_size=101', 'page=abc']) {
    const res = await call('GET', `/api/admin/users?${qs}`);
    assert.equal(res.status, 400, qs);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('新增帳號：201，第一次登入要改密碼', async () => {
  const res = await call('POST', '/api/admin/users', {
    body: { username: ' newbie ', password: 'newbie-pass-1', role: 'student' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.username, 'newbie', '前後空白要去掉');
  assert.equal(res.body.role, 'student');
  assert.equal(res.body.is_active, true);
  assert.equal(res.body.must_change_password, true);
  assert.equal(res.body.password_hash, undefined);

  const first = await login('newbie', 'newbie-pass-1');
  assert.equal(first.status, 200);
  assert.equal(first.body.user.must_change_password, true);
});

test('新增帳號：重複（不分大小寫）回 409', async () => {
  for (const username of ['stu1', 'STU1']) {
    const res = await call('POST', '/api/admin/users', { body: { username, password: 'whatever-123', role: 'student' } });
    assert.equal(res.status, 409, username);
    assert.equal(res.body.error.code, 'USERNAME_TAKEN');
  }
});

test('新增帳號：格式錯誤回 400', async () => {
  const cases = [
    [{}, 'VALIDATION_ERROR'],
    [{ username: 'a b', password: 'good-pass-1', role: 'student' }, 'VALIDATION_ERROR'],
    [{ username: '王小明', password: 'good-pass-1', role: 'student' }, 'VALIDATION_ERROR'],
    [{ username: 'a'.repeat(51), password: 'good-pass-1', role: 'student' }, 'VALIDATION_ERROR'],
    [{ username: 'okname', password: 'good-pass-1', role: 'teacher' }, 'VALIDATION_ERROR'],
    [{ username: 'okname', password: 'short', role: 'student' }, 'WEAK_PASSWORD'],
    [{ username: 'okname', password: 12345678, role: 'student' }, 'VALIDATION_ERROR'],
    [{ username: 'okname', password: '密'.repeat(25), role: 'student' }, 'VALIDATION_ERROR'],
  ];
  for (const [body, code] of cases) {
    const res = await call('POST', '/api/admin/users', { body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, code, JSON.stringify(body));
  }
  assert.equal((await call('GET', '/api/admin/users?keyword=okname')).body.total, 0);
});

test('停用帳號：馬上被登出、不能登入；啟用後可以登入', async () => {
  const insert = appDb.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  insert.run('temp', await hashPassword('temp-pass-123'), 'student');
  const id = userId('temp');
  const session = (await login('temp', 'temp-pass-123')).cookie;

  const off = await call('PATCH', `/api/admin/users/${id}`, { body: { is_active: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.is_active, false);
  assert.equal((await call('GET', '/api/auth/me', { cookie: session })).status, 401);
  assert.equal((await login('temp', 'temp-pass-123')).status, 401);

  const on = await call('PATCH', `/api/admin/users/${id}`, { body: { is_active: true } });
  assert.equal(on.body.is_active, true);
  assert.equal((await login('temp', 'temp-pass-123')).status, 200);
});

test('重設密碼：舊密碼失效、所有裝置登出、要求改密碼', async () => {
  const id = userId('stu2');
  const session = (await login('stu2', 'stu2-pass-123')).cookie;

  const res = await call('POST', `/api/admin/users/${id}/reset-password`, { body: { new_password: 'temp-reset-99' } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });

  assert.equal((await call('GET', '/api/auth/me', { cookie: session })).status, 401);
  assert.equal((await login('stu2', 'stu2-pass-123')).status, 401);
  const after = await login('stu2', 'temp-reset-99');
  assert.equal(after.status, 200);
  assert.equal(after.body.user.must_change_password, true);

  const weak = await call('POST', `/api/admin/users/${id}/reset-password`, { body: { new_password: 'short' } });
  assert.equal(weak.body.error.code, 'WEAK_PASSWORD');
});

test('不能停用自己、不能重設自己的密碼', async () => {
  const off = await call('PATCH', `/api/admin/users/${adminId}`, { body: { is_active: false } });
  assert.equal(off.status, 400);
  assert.equal(off.body.error.code, 'CANNOT_MODIFY_SELF');
  const reset = await call('POST', `/api/admin/users/${adminId}/reset-password`, { body: { new_password: 'boss-new-pass' } });
  assert.equal(reset.body.error.code, 'CANNOT_MODIFY_SELF');
  assert.equal((await call('GET', '/api/auth/me')).status, 200, '管理者還是登入狀態');
});

test('id 錯誤回 400，找不到回 404，is_active 不是布林值回 400', async () => {
  for (const id of ['abc', '0', '-1', '1.5']) {
    const res = await call('PATCH', `/api/admin/users/${id}`, { body: { is_active: false } });
    assert.equal(res.status, 400, id);
  }
  const missing = await call('PATCH', '/api/admin/users/99999', { body: { is_active: false } });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');

  for (const body of [{}, { is_active: 'false' }, { is_active: 0 }]) {
    const res = await call('PATCH', `/api/admin/users/${userId('stu1')}`, { body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});
