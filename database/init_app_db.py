"""
init_app_db.py — 建立 / 檢查 app.db（使用者資料與設定）

app.db 放「不能被重建清掉」的資料：
    users             使用者帳號
    wishlist          學生預選清單
    course_overrides  管理者修改過的課程欄位（重建 courses.db 後自動套用回來）
    added_courses     管理者新增的課程（重建 courses.db 後自動加回來）
    deleted_courses   管理者刪除的課程（重建 courses.db 後自動再刪掉）
    buildings         校本部大樓與地圖座標
    classrooms        教室代號 → 大樓對照

只會建立不存在的表、補上缺少的欄位，不會刪除或清空資料，重複執行是安全的。

用法：
    python database/init_app_db.py                     # 建在 backend/data/app.db
    python database/init_app_db.py D:\\project\\app.db   # 建在指定位置
"""

import os
import sqlite3
import sys
from pathlib import Path


# 本檔在 database/，app.db 在專案根目錄的 backend/data/（和後端同一份）
# 想換位置：設定環境變數 APP_DB_PATH
APP_DB_PATH = Path(os.environ.get(
    "APP_DB_PATH",
    Path(__file__).resolve().parent.parent / "backend" / "data" / "app.db",
))


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,                       -- bcrypt 雜湊，不存原本的密碼
    role           TEXT NOT NULL
                   CHECK (role IN ('student', 'admin')),
    is_active      INTEGER NOT NULL DEFAULT 1           -- 0 = 停用
                   CHECK (is_active IN (0, 1)),
    must_change_password INTEGER NOT NULL DEFAULT 0     -- 1 = 下次登入要先改密碼（新帳號、管理者重設密碼後）
                   CHECK (must_change_password IN (0, 1)),
    created_at     TEXT NOT NULL
                   DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS wishlist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    course_id   TEXT NOT NULL,                          -- courses.db 的 courses.id
    added_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (user_id, course_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    -- course_id 在另一個資料庫，SQLite 沒辦法設外鍵，
    -- 管理者刪除課程時，要自己清掉 wishlist 裡同一門課。
);
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist (user_id);

-- build_db.py 重建 courses.db 之後，會把這裡的每一筆重新套回去
CREATE TABLE IF NOT EXISTS course_overrides (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   TEXT NOT NULL,
    field_name  TEXT NOT NULL,                          -- courses 的欄位名，例如 classroom
    new_value   TEXT,                                   -- 一律存文字，套用時再轉型；NULL = 清空
    updated_by  INTEGER,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (course_id, field_name),                     -- 同一門課同一個欄位只留最新一筆
    -- 管理者帳號被刪除時保留修改紀錄，只是不知道是誰改的
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
);

-- 重建 courses.db 之後，build_db.py 會把這裡的課程重新加回去
CREATE TABLE IF NOT EXISTS added_courses (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   TEXT NOT NULL UNIQUE,                   -- 格式 A00001，不會和來源資料的數字 id 重複
    data        TEXT NOT NULL,                          -- 課程欄位內容（JSON 文字）
    created_by  INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

-- 重建 courses.db 之後，build_db.py 會把這裡的課程再刪一次（不然會從 JSON 裡復活）
CREATE TABLE IF NOT EXISTS deleted_courses (
    course_id   TEXT PRIMARY KEY,
    deleted_by  INTEGER,
    deleted_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS buildings (
    id           INTEGER PRIMARY KEY,                   -- 地圖上的編號 1~14
    name         TEXT NOT NULL,
    room_prefix  TEXT UNIQUE,                           -- 教室代號開頭字母（B、S、G、F、I）；沒有就是 NULL
    map_x        REAL NOT NULL                          -- 佔地圖圖片寬度的百分比（0~100）
                 CHECK (map_x BETWEEN 0 AND 100),
    map_y        REAL NOT NULL                          -- 佔地圖圖片高度的百分比（0~100）
                 CHECK (map_y BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS classrooms (
    code         TEXT PRIMARY KEY,                      -- F601、IB01、校外實習…
    building_id  INTEGER,                               -- 找不到大樓（或不是一般教室）就是 NULL
    floor        INTEGER,                               -- 由代號第一個數字推算，推不出來就是 NULL
    room_type    TEXT NOT NULL                          -- room = 一般教室；special = 校外實習、論文研究教室等
                 CHECK (room_type IN ('room', 'special')),
    FOREIGN KEY (building_id) REFERENCES buildings (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_classrooms_building ON classrooms (building_id);
"""


def check_sqlite_version():
    """SQL 會用到 ON CONFLICT ... DO UPDATE，SQLite 版本要 3.24 以上。"""
    if sqlite3.sqlite_version_info < (3, 24, 0):
        raise SystemExit(f"SQLite 版本太舊（{sqlite3.sqlite_version}），需要 3.24 以上，請更新 Python。")


def get_app_connection(db_path=APP_DB_PATH):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # SQLite 預設不檢查外鍵，每次連線都要開
    return conn


def init_app_database(db_path=APP_DB_PATH):
    """建立 app.db 與資料表（已存在的資料表和資料都不會動）。回傳連線。"""
    check_sqlite_version()
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = get_app_connection(db_path)
    conn.executescript(SCHEMA_SQL)
    add_missing_columns(conn)
    conn.commit()
    return conn


# 舊版 app.db 已經有 users 表時，CREATE TABLE IF NOT EXISTS 不會補新欄位，要在這裡補
MIGRATION_COLUMNS = [
    ("users", "must_change_password",
     "INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1))"),
]


def add_missing_columns(conn):
    for table, column, definition in MIGRATION_COLUMNS:
        existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            print(f"  已在 {table} 補上欄位 {column}")


def main():
    db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else APP_DB_PATH
    conn = init_app_database(db_path)
    try:
        print(f"app.db 已就緒：{db_path}")
        for t in ("users", "wishlist", "course_overrides", "added_courses",
                  "deleted_courses", "buildings", "classrooms"):
            n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"  {t:17s} {n} 筆")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
