// 建立測試帳號，帳密從 .env 讀
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });

const { appDb } = require('../db');
const { hashPassword, isPasswordTooLong, MIN_PASSWORD_LENGTH } = require('../middleware/auth');

const accounts = [
  { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD, role: 'admin' },
  { username: process.env.STUDENT_USERNAME || 'student', password: process.env.STUDENT_PASSWORD, role: 'student' },
];

// 已經存在的帳號不動，不然重跑會把改過的密碼蓋掉、把停用的帳號重新啟用
const insertIfMissing = appDb.prepare(`
  INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)
  ON CONFLICT (username) DO NOTHING
`);
const exists = appDb.prepare('SELECT 1 FROM users WHERE username = ?');

async function main() {
  for (const a of accounts) {
    if (exists.get(a.username)) {
      console.log(`已存在，略過：${a.username}`);
      continue;
    }
    if (!a.password || [...a.password].length < MIN_PASSWORD_LENGTH || isPasswordTooLong(a.password)) {
      console.error(`略過 ${a.username}：密碼要 8 個字以上、72 bytes 以內`);
      process.exitCode = 1;
      continue;
    }
    insertIfMissing.run(a.username, await hashPassword(a.password), a.role);
    console.log(`已建立帳號：${a.username}（${a.role}）`);
  }
}

main();
