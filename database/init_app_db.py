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

規則：
    - 只會「建立不存在的表」，不會刪除、不會清空任何資料，重複執行是安全的。
    - build_db.py 重建 courses.db 時會呼叫這裡的 init_app_database()，
      但只會補齊資料表、更新大樓與教室對照，不會動 users / wishlist / course_overrides。

用法：
    python init_app_db.py                        # 建在 backend/data/app.db
    python init_app_db.py D:\\project\\app.db      # 建在指定位置

後端串接：
    from init_app_db import get_app_connection
"""

import os
import sqlite3
import sys
from pathlib import Path


# =====================================================================
# 1. 設定區
# =====================================================================

# app.db 的位置：本檔所在資料夾 / backend / data / app.db
# 想換位置：設定環境變數 APP_DB_PATH，或直接改下面這一行
APP_DB_PATH = Path(os.environ.get(
    "APP_DB_PATH",
    Path(__file__).resolve().parent / "backend" / "data" / "app.db",
))


# =====================================================================
# 2. 資料表結構（SCHEMA）
# =====================================================================

SCHEMA_SQL = """
-- ---------- 使用者帳號 ----------
CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,   -- 每個人的編號，自動加 1，不用自己填
    username       TEXT NOT NULL UNIQUE,                -- 登入帳號：s1234567、admin01，必填、不能重複
    password_hash  TEXT NOT NULL,                       -- 加密後的密碼，必填，不是存原本的密碼
    role           TEXT NOT NULL                        -- 身分：只能是 student 或 admin
                   CHECK (role IN ('student', 'admin')),
    is_active      INTEGER NOT NULL DEFAULT 1           -- 1 = 可以用，0 = 停用，預設是 1
                   CHECK (is_active IN (0, 1)),
    must_change_password INTEGER NOT NULL DEFAULT 0     -- 1 = 下次登入要先改密碼（管理者重設密碼後設為 1），預設是 0
                   CHECK (must_change_password IN (0, 1)),
    created_at     TEXT NOT NULL                        -- 建立時間，自動填
                   DEFAULT (datetime('now', 'localtime'))
);

-- ---------- 學生預選清單（一位學生對一門課一筆）----------
CREATE TABLE IF NOT EXISTS wishlist (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,                       -- 哪位使用者（綁 users.id）
    course_id   TEXT NOT NULL,                          -- 哪門課（對應 courses.db 的 courses.id）
    added_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (user_id, course_id),                        -- 同一門課不能重複加入
    -- 使用者被刪除時，他的預選清單一併刪除
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    -- 注意：course_id 在另一個資料庫，SQLite 沒辦法設外鍵，
    --       管理者刪除課程時，後端要自己清掉 wishlist 裡同一門課。
);
CREATE INDEX IF NOT EXISTS idx_wishlist_user ON wishlist (user_id);

-- ---------- 管理者修改過的課程欄位 ----------
-- build_db.py 重建 courses.db 之後，會把這裡的每一筆重新套回去
CREATE TABLE IF NOT EXISTS course_overrides (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   TEXT NOT NULL,                          -- 哪門課（courses.db 的 courses.id）
    field_name  TEXT NOT NULL,                          -- 改了哪個欄位（courses 的欄位名，例如 classroom）
    new_value   TEXT,                                   -- 改成什麼（一律存文字，套用時再轉型；NULL = 清空）
    updated_by  INTEGER,                                -- 哪位管理者改的
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (course_id, field_name),                     -- 同一門課同一個欄位只留最新一筆
    -- 管理者帳號被刪除時，保留修改紀錄，只是不知道是誰改的
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
);

-- ---------- 管理者新增的課程 ----------
-- 重建 courses.db 之後，build_db.py 會把這裡的課程重新加回去
CREATE TABLE IF NOT EXISTS added_courses (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id   TEXT NOT NULL UNIQUE,                   -- 新課程的 id，格式 A00001（不會和來源資料的數字 id 重複）
    data        TEXT NOT NULL,                          -- 課程欄位內容（JSON 文字）
    created_by  INTEGER,                                -- 哪位管理者新增的
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

-- ---------- 管理者刪除的課程 ----------
-- 重建 courses.db 之後，build_db.py 會把這裡的課程再刪掉一次（不然刪掉的課會從 JSON 裡復活）
CREATE TABLE IF NOT EXISTS deleted_courses (
    course_id   TEXT PRIMARY KEY,                       -- 被刪除的課程 id
    deleted_by  INTEGER,                                -- 哪位管理者刪的
    deleted_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
);

-- ---------- 校本部大樓（地圖用）----------
CREATE TABLE IF NOT EXISTS buildings (
    id           INTEGER PRIMARY KEY,                   -- 地圖上的編號 1~14
    name         TEXT NOT NULL,                         -- 大樓名稱
    room_prefix  TEXT UNIQUE,                           -- 教室代號開頭字母（B、S、G、F、I）；沒有就是 NULL
    map_x        REAL NOT NULL                          -- 地圖位置：佔圖片「寬度」的百分比（0~100）
                 CHECK (map_x BETWEEN 0 AND 100),
    map_y        REAL NOT NULL                          -- 地圖位置：佔圖片「高度」的百分比（0~100）
                 CHECK (map_y BETWEEN 0 AND 100)
);

-- ---------- 教室對照（教室代號 → 大樓）----------
CREATE TABLE IF NOT EXISTS classrooms (
    code         TEXT PRIMARY KEY,                      -- 教室代號：F601、IB01、校外實習…
    building_id  INTEGER,                               -- 在哪棟大樓；找不到（或不是一般教室）就是 NULL
    floor        INTEGER,                               -- 樓層（由代號第一個數字推算，推不出來就是 NULL）
    room_type    TEXT NOT NULL                          -- room = 一般教室；special = 校外實習、論文研究教室等
                 CHECK (room_type IN ('room', 'special')),
    FOREIGN KEY (building_id) REFERENCES buildings (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_classrooms_building ON classrooms (building_id);
"""


# =====================================================================
# 3. 連線與建立資料庫
# =====================================================================

def check_sqlite_version():
    """本專案的 SQL 會用到 ON CONFLICT ... DO UPDATE，SQLite 版本要 3.24 以上。"""
    if sqlite3.sqlite_version_info < (3, 24, 0):
        raise SystemExit(f"SQLite 版本太舊（{sqlite3.sqlite_version}），需要 3.24 以上，請更新 Python。")


def get_app_connection(db_path=APP_DB_PATH):
    """取得 app.db 連線（後端每次處理請求時，各自呼叫一次即可）。"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row            # 查詢結果可用欄位名稱取值
    conn.execute("PRAGMA foreign_keys = ON")  # SQLite 預設不檢查外鍵，每次連線都要開
    return conn


def init_app_database(db_path=APP_DB_PATH):
    """建立 app.db 與資料表（已存在的資料表和資料都不會動）。回傳連線。"""
    check_sqlite_version()
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)   # 資料夾不存在就先建立
    conn = get_app_connection(db_path)
    conn.executescript(SCHEMA_SQL)
    add_missing_columns(conn)
    conn.commit()
    return conn


# 舊版 app.db 已經有 users 表時，CREATE TABLE IF NOT EXISTS 不會補新欄位，要在這裡補
# （只會新增欄位，不會改動既有資料）
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


# =====================================================================
# 4. 主程式
# =====================================================================

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
