const session = require('express-session');

// 把登入狀態存在 app.db，伺服器重開後大家不用重新登入
// （express-session 預設的 MemoryStore 重開就清空，官方也說不能用在正式環境）
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid      TEXT PRIMARY KEY,
        sess     TEXT NOT NULL,
        expires  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires);
    `);
    this.getStmt = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
    this.setStmt = db.prepare(`
      INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
      ON CONFLICT (sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires
    `);
    this.touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.cleanupStmt = db.prepare('DELETE FROM sessions WHERE expires <= ?');

    // 定期刪掉過期的，unref 讓它不會擋住程式結束
    this.cleanup();
    this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.timer.unref();
  }

  static expiresOf(sess) {
    const expires = sess && sess.cookie && sess.cookie.expires;
    return expires ? new Date(expires).getTime() : Date.now() + DEFAULT_TTL_MS;
  }

  cleanup() {
    try {
      this.cleanupStmt.run(Date.now());
    } catch {
      // 資料庫已經關閉（例如測試結束）就不清了
    }
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb = () => {}) {
    try {
      this.setStmt.run(sid, JSON.stringify(sess), SqliteSessionStore.expiresOf(sess));
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      this.touchStmt.run(SqliteSessionStore.expiresOf(sess), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb = () => {}) {
    try {
      this.destroyStmt.run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
}

module.exports = { SqliteSessionStore };
