const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-rooms-test-'));
process.env.APP_DB_PATH = path.join(tmpDir, 'app.db');
process.env.SESSION_SECRET = 'test-secret-'.padEnd(40, 'x');

const { appDb } = require('../db');
const { hashPassword } = require('../middleware/auth');
const { createApp } = require('../app');

let server;
let base;
let cookie;

async function get(url, withCookie = true) {
  const res = await fetch(base + url, { headers: withCookie ? { Cookie: cookie } : {} });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  // 和 database/init_app_db.py 一樣的資料表（正式環境由 build_db.py 建立）
  appDb.exec(`
    CREATE TABLE buildings (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, room_prefix TEXT UNIQUE,
      map_x REAL NOT NULL, map_y REAL NOT NULL
    );
    CREATE TABLE classrooms (
      code TEXT PRIMARY KEY, building_id INTEGER, floor INTEGER, room_type TEXT NOT NULL,
      FOREIGN KEY (building_id) REFERENCES buildings (id) ON DELETE SET NULL
    );
    INSERT INTO buildings VALUES (5, '教學大樓', 'G', 58.5, 40.5), (6, '學思樓', 'F', 43.5, 36.5),
                                 (14, '樂育樓', 'I', 10.5, 63.0), (2, '行政大樓', NULL, 72.5, 48.0);
    INSERT INTO classrooms VALUES ('F601', 6, 6, 'room'), ('G209', 5, 2, 'room'),
                                  ('IB01', 14, NULL, 'room'), ('C303', NULL, 3, 'room'),
                                  ('校外實習', NULL, NULL, 'special');
  `);
  appDb.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run('reader', await hashPassword('reader-pass-123'), 'student');

  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'reader', password: 'reader-pass-123' }),
  });
  cookie = res.headers.get('set-cookie').split(';')[0];
});

after(() => {
  server.close();
  appDb.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('教室 API 要先登入', async () => {
  for (const url of ['/api/rooms/buildings', '/api/rooms/F601', '/api/rooms?codes=F601']) {
    const res = await get(url, false);
    assert.equal(res.status, 401, url);
    assert.equal(res.body.error.code, 'NOT_LOGGED_IN');
  }
});

test('GET /api/rooms/buildings 依編號排序回傳所有大樓', async () => {
  const res = await get('/api/rooms/buildings');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((b) => b.id), [2, 5, 6, 14]);
  assert.deepEqual(res.body[2], { id: 6, name: '學思樓', room_prefix: 'F', map_x: 43.5, map_y: 36.5 });
});

test('GET /api/rooms/:code 回傳大樓、樓層、座標', async () => {
  const res = await get('/api/rooms/F601');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    code: 'F601', room_type: 'room', floor: 6,
    building_id: 6, building_name: '學思樓', map_x: 43.5, map_y: 36.5, has_location: true,
  });
});

test('沒有大樓的教室 has_location 是 false，查不到的回 404', async () => {
  const c303 = await get('/api/rooms/C303');
  assert.equal(c303.status, 200);
  assert.equal(c303.body.has_location, false);
  assert.equal(c303.body.map_x, null);

  const special = await get(`/api/rooms/${encodeURIComponent('校外實習')}`);
  assert.equal(special.status, 200);
  assert.equal(special.body.room_type, 'special');
  assert.equal(special.body.has_location, false);

  const missing = await get('/api/rooms/Z999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('GET /api/rooms?codes= 可以直接帶課程的 classroom 文字', async () => {
  const res = await get(`/api/rooms?codes=${encodeURIComponent('G209、IB01、G209、Z999')}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((r) => [r.code, r.has_location]),
    [['G209', true], ['IB01', true], ['Z999', false]]);
  assert.equal(res.body.items[2].room_type, null, '查不到的教室 room_type 是 null');
});

test('教室參數錯誤回 400', async () => {
  const tooMany = Array.from({ length: 11 }, (_, i) => `F${600 + i}`).join(',');
  for (const url of ['/api/rooms', '/api/rooms?codes=', '/api/rooms?codes=,,', `/api/rooms?codes=${tooMany}`,
    `/api/rooms?codes=${'A'.repeat(21)}`, '/api/rooms?codes=a&codes=b', `/api/rooms/${'A'.repeat(21)}`]) {
    const res = await get(url);
    assert.equal(res.status, 400, url);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('SQL injection 字串只會被當成教室代號', async () => {
  const res = await get(`/api/rooms/${encodeURIComponent("' OR 1=1--")}`);
  assert.equal(res.status, 404);
});
