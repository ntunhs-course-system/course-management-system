// 建立測試帳號，帳密從 .env 讀
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });

const { appDb } = require('../db');
const { hashPassword } = require('../middleware/auth');

const accounts = [
  { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD, role: 'admin' },
  { username: process.env.STUDENT_USERNAME || 'student', password: process.env.STUDENT_PASSWORD, role: 'student' },
];

const upsert = appDb.prepare(`
  INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)
  ON CONFLICT (username) DO UPDATE SET
    password_hash = excluded.password_hash,
    role = excluded.role,
    is_active = 1
`);

async function main() {
  for (const a of accounts) {
    if (!a.password || a.password.length < 8) {
      console.error(`略過 ${a.username}：密碼至少 8 個字`);
      process.exitCode = 1;
      continue;
    }
    upsert.run(a.username, await hashPassword(a.password), a.role);
    console.log(`已建立帳號：${a.username}（${a.role}）`);
  }
}

main();
