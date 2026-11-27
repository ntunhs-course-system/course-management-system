const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// courses.db 會被 build_db.py 重建，帳號另外存在 app.db
// 沒設定 COURSE_DB_PATH 時，優先用資料組新版的 database/courses.db，
// 還沒有 database/ 的電腦退回根目錄的舊版 courses.db
function defaultCourseDbPath() {
  const candidates = ['../database/courses.db', '../courses.db'].map((p) => path.resolve(__dirname, p));
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}
const courseDbPath = process.env.COURSE_DB_PATH
  ? path.resolve(__dirname, process.env.COURSE_DB_PATH)
  : defaultCourseDbPath();
const appDbPath = path.resolve(__dirname, process.env.APP_DB_PATH || 'data/app.db');

if (!fs.existsSync(courseDbPath)) {
  throw new Error(`找不到課程資料庫：${courseDbPath}`);
}

const courseDb = new DatabaseSync(courseDbPath);
courseDb.exec('PRAGMA foreign_keys = ON');

fs.mkdirSync(path.dirname(appDbPath), { recursive: true });
const appDb = new DatabaseSync(appDbPath);
appDb.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    username              TEXT NOT NULL UNIQUE,
    password_hash         TEXT NOT NULL,
    role                  TEXT NOT NULL CHECK (role IN ('student', 'admin')),
    is_active             INTEGER NOT NULL DEFAULT 1,
    must_change_password  INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = { courseDb, appDb };
