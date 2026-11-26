const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-test-'));
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
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: await res.json(), cookie: setCookie && setCookie.split(';')[0] };
}

// 課程 API 要登入，用另一個帳號登入，避免被其他測試登出
let readerCookie;
const get = (url) => call('GET', url, { cookie: readerCookie });

before(async () => {
  const insert = appDb.prepare('INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, ?)');
  insert.run('admin1', await hashPassword('admin-pass-123'), 'admin', 1);
  insert.run('stu1', await hashPassword('student-pass-123'), 'student', 1);
  insert.run('gone', await hashPassword('disabled-pass-123'), 'student', 0);
  insert.run('reader', await hashPassword('reader-pass-123'), 'student', 1);

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  readerCookie = (await call('POST', '/api/login', { body: { username: 'reader', password: 'reader-pass-123' } })).cookie;
});

after(() => {
  server.close();
  appDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('登入成功後 /api/me 回傳使用者，登出後失效', async () => {
  const login = await call('POST', '/api/login', { body: { username: 'stu1', password: 'student-pass-123' } });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'student');
  assert.ok(login.cookie, '應該發 session cookie');
  assert.equal(login.body.user.password_hash, undefined, '不能回傳密碼');

  const me = await call('GET', '/api/me', { cookie: login.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.username, 'stu1');

  await call('POST', '/api/logout', { cookie: login.cookie });
  const after = await call('GET', '/api/me', { cookie: login.cookie });
  assert.equal(after.status, 401);
});

test('密碼錯、帳號不存在、帳號停用都回一樣的錯誤', async () => {
  const wrong = await call('POST', '/api/login', { body: { username: 'stu1', password: 'nope-nope' } });
  const missing = await call('POST', '/api/login', { body: { username: 'nobody', password: 'nope-nope' } });
  const disabled = await call('POST', '/api/login', { body: { username: 'gone', password: 'disabled-pass-123' } });
  for (const r of [wrong, missing, disabled]) {
    assert.equal(r.status, 401);
    assert.equal(r.body.error, '帳號或密碼錯誤');
  }
});

test('帳號超過 50 字、密碼超過 72 bytes 回 400', async () => {
  const longName = await call('POST', '/api/login', { body: { username: 'a'.repeat(51), password: 'student-pass-123' } });
  assert.equal(longName.status, 400);
  const longPw = await call('POST', '/api/login', { body: { username: 'stu1', password: 'x'.repeat(73) } });
  assert.equal(longPw.status, 400);
  // 25 個中文字 = 75 bytes，字數沒超過但 bytes 超過
  const zhPw = await call('POST', '/api/login', { body: { username: 'stu1', password: '密'.repeat(25) } });
  assert.equal(zhPw.status, 400);
  const ok = await call('POST', '/api/login', { body: { username: 'stu1', password: 'student-pass-123' } });
  assert.equal(ok.status, 200);
});

test('沒登入不能用 /api/me', async () => {
  const r = await call('GET', '/api/me');
  assert.equal(r.status, 401);
});

test('沒登入不能用課程 API', async () => {
  for (const url of ['/api/courses', '/api/courses/departments', '/api/courses/abc']) {
    assert.equal((await call('GET', url)).status, 401, url);
  }
});

test('課程查詢：關鍵字、篩選、分頁', async () => {
  const all = await get('/api/courses?semester=115-1&page_size=5');
  assert.equal(all.status, 200);
  assert.ok(all.body.total > 1000);
  assert.equal(all.body.items.length, 5);

  const req = await get(`/api/courses?semester=115-1&course_type=${encodeURIComponent('必修')}&weekday=2&page_size=50`);
  assert.equal(req.status, 200);
  assert.ok(req.body.items.every((c) => c.course_type === '必修'));

  const kw = await get(`/api/courses?semester=115-1&keyword=${encodeURIComponent('資訊')}`);
  assert.ok(kw.body.total > 0);
});

test('課程查詢：參數格式錯誤回 400，關鍵字 % 不會變萬用字元', async () => {
  assert.equal((await get('/api/courses?semester=115-1&weekday=9')).status, 400);
  assert.equal((await get('/api/courses?semester=115-1&page_size=999')).status, 400);
  assert.equal((await get('/api/courses?semester=115-1&course_type=abc')).status, 400);
  const pct = await get('/api/courses?semester=115-1&keyword=%25');
  assert.equal(pct.status, 200);
  assert.equal(pct.body.total, 0);
  const inj = await get(`/api/courses?semester=115-1&keyword=${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(inj.body.total, 0);
});

test('單一課程與系所清單', async () => {
  const list = await get('/api/courses?semester=115-1&page_size=1');
  const id = list.body.items[0].id;
  const one = await get(`/api/courses/${encodeURIComponent(id)}`);
  assert.equal(one.status, 200);
  assert.ok(Array.isArray(one.body.timeslots));

  assert.equal((await get('/api/courses/does-not-exist')).status, 404);

  const depts = await get('/api/courses/departments?semester=115-1');
  assert.ok(depts.body.length > 0);
});

test('一定要指定學期，學期清單可以查', async () => {
  assert.equal((await get('/api/courses')).status, 400);
  assert.equal((await get('/api/courses?semester=')).status, 400);
  assert.equal((await get('/api/courses/departments')).status, 400);

  const sems = await get('/api/courses/semesters');
  assert.equal(sems.status, 200);
  assert.ok(sems.body.includes('115-1'));

  const none = await get('/api/courses?semester=999-9');
  assert.equal(none.status, 200);
  assert.equal(none.body.total, 0);
});

test('登入成功不算進嘗試次數', async () => {
  for (let i = 0; i < 7; i++) {
    const r = await call('POST', '/api/login', { body: { username: 'stu1', password: 'student-pass-123' } });
    assert.equal(r.status, 200, `第 ${i + 1} 次正確登入應該成功`);
  }
});

test('傳送的資料太大回 413，不是 500', async () => {
  const r = await call('POST', '/api/login', { body: { username: 'a', password: 'x'.repeat(200000) } });
  assert.equal(r.status, 413);
});

test('課程查詢：翻頁不會重複或漏掉課程', async () => {
  const first = await get('/api/courses?semester=115-1&page_size=50');
  const total = first.body.total;
  const seen = new Set();
  for (let p = 1; (p - 1) * 50 < total; p++) {
    const r = await get(`/api/courses?semester=115-1&page_size=50&page=${p}`);
    for (const c of r.body.items) {
      assert.ok(!seen.has(c.id), `課程 ${c.id} 在不同頁重複出現`);
      seen.add(c.id);
    }
  }
  assert.equal(seen.size, total);
});

// 會把 admin1 鎖 15 分鐘，所以放最後
test('同一個帳號失敗超過 5 次會被擋，其他帳號不受影響', async () => {
  let last;
  for (let i = 0; i < 6; i++) {
    last = await call('POST', '/api/login', { body: { username: 'admin1', password: 'wrong-pass' } });
  }
  assert.equal(last.status, 429);

  const locked = await call('POST', '/api/login', { body: { username: 'admin1', password: 'admin-pass-123' } });
  assert.equal(locked.status, 429, '被鎖住時密碼正確也不能登入');

  const other = await call('POST', '/api/login', { body: { username: 'stu1', password: 'student-pass-123' } });
  assert.equal(other.status, 200, '同一個 IP 的其他帳號還是可以登入');
});
