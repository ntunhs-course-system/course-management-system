const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-password-test-'));
process.env.APP_DB_PATH = path.join(tmpDir, 'app.db');
process.env.SESSION_SECRET = 'test-secret-'.padEnd(40, 'x');

const { appDb } = require('../db');
const { hashPassword } = require('../middleware/auth');
const { createApp } = require('../app');

let server;
let base;

async function call(method, url, { body, cookie } = {}) {
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

const login = async (username, password) => (await call('POST', '/api/auth/login', { body: { username, password } })).cookie;
const change = (cookie, current_password, new_password) =>
  call('PUT', '/api/auth/password', { cookie, body: { current_password, new_password } });

before(async () => {
  const insert = appDb.prepare(
    'INSERT INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?)'
  );
  insert.run('alice', await hashPassword('alice-old-pass'), 'student', 1);
  insert.run('bob', await hashPassword('bob-old-pass'), 'student', 0);
  insert.run('carol', await hashPassword('carol-old-pass'), 'student', 0);
  insert.run('dave', await hashPassword('dave-old-pass'), 'student', 0);

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  appDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('沒登入不能改密碼', async () => {
  const res = await change(undefined, 'alice-old-pass', 'alice-new-pass');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'NOT_LOGGED_IN');
});

test('改密碼成功：新密碼能登入、舊的不行，must_change_password 變 0', async () => {
  const cookie = await login('alice', 'alice-old-pass');
  const res = await change(cookie, 'alice-old-pass', 'alice-new-pass');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });

  // 原本的 cookie 換成新的 session id 後還是登入狀態
  const me = await call('GET', '/api/auth/me', { cookie: res.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.must_change_password, false);
  assert.equal((await call('GET', '/api/auth/me', { cookie })).status, 401, '舊的 session id 要失效');

  assert.equal((await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'alice-old-pass' } })).status, 401);
  assert.ok(await login('alice', 'alice-new-pass'));
});

test('改密碼後其他裝置被登出，其他帳號不受影響', async () => {
  const phone = await login('bob', 'bob-old-pass');
  const laptop = await login('bob', 'bob-old-pass');
  const other = await login('carol', 'carol-old-pass');

  const res = await change(laptop, 'bob-old-pass', 'bob-new-pass');
  assert.equal(res.status, 200);
  assert.equal((await call('GET', '/api/auth/me', { cookie: res.cookie })).status, 200);
  assert.equal((await call('GET', '/api/auth/me', { cookie: phone })).status, 401);
  assert.equal((await call('GET', '/api/auth/me', { cookie: other })).status, 200);
});

test('只能改自己的：body 帶別人的 id 沒有用', async () => {
  const cookie = await login('carol', 'carol-old-pass');
  const res = await call('PUT', '/api/auth/password', {
    cookie,
    body: { current_password: 'carol-old-pass', new_password: 'carol-new-pass', user_id: 4, username: 'dave' },
  });
  assert.equal(res.status, 200);
  assert.ok(await login('dave', 'dave-old-pass'), 'dave 的密碼不能被改');
  assert.ok(await login('carol', 'carol-new-pass'));
});

test('格式錯誤、太短、跟舊的一樣、太長都回 400', async () => {
  const cookie = await login('dave', 'dave-old-pass');
  const cases = [
    [{}, 'VALIDATION_ERROR'],
    [{ current_password: 'dave-old-pass' }, 'VALIDATION_ERROR'],
    [{ current_password: 'dave-old-pass', new_password: 12345678 }, 'VALIDATION_ERROR'],
    [{ current_password: 'dave-old-pass', new_password: 'short' }, 'WEAK_PASSWORD'],
    [{ current_password: 'dave-old-pass', new_password: 'dave-old-pass' }, 'WEAK_PASSWORD'],
    [{ current_password: 'dave-old-pass', new_password: '密'.repeat(25) }, 'VALIDATION_ERROR'],
  ];
  for (const [body, code] of cases) {
    const res = await call('PUT', '/api/auth/password', { cookie, body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, code, JSON.stringify(body));
  }
  // 中文用「字數」算，不是 bytes：7 個字不夠，9 個字（27 bytes）可以
  const ok = await change(cookie, 'dave-old-pass', '我的新密碼好長');
  assert.equal(ok.body.error.code, 'WEAK_PASSWORD', '7 個字不夠');
  assert.equal((await change(cookie, 'dave-old-pass', '我的新密碼真的好長')).status, 200);
});

test('目前的密碼錯 5 次後被擋，格式錯誤不算次數', async () => {
  const insert = appDb.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  insert.run('eve', await hashPassword('eve-real-pass'), 'student');
  const cookie = await login('eve', 'eve-real-pass');

  for (let i = 0; i < 3; i++) {
    assert.equal((await change(cookie, 'eve-real-pass', 'short')).status, 400);
  }
  for (let i = 0; i < 5; i++) {
    const res = await change(cookie, `guess-${i}-pass`, 'eve-new-pass');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'WRONG_PASSWORD');
  }
  const blocked = await change(cookie, 'eve-real-pass', 'eve-new-pass');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'TOO_MANY_REQUESTS');
  assert.ok(blocked.body.error.retry_after > 0);
  assert.ok(await login('eve', 'eve-real-pass'), '被擋的那次不能改到密碼');
});
