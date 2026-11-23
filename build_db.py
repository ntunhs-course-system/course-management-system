"""
build_db.py — 北護多課程整合與預選課模擬系統：資料庫建立與查詢

用法：
    1. 把本檔與 courses.json、course_timeslots.json 放在同一個資料夾
    2. 在 VS Code 直接執行（或：python build_db.py）
    3. 會產生 courses.db，並印出匯入結果與幾個查詢範例

後端串接：
    from build_db import get_connection, search_courses, get_course, \
        find_conflicts, calc_credits
"""

import json
import sqlite3
from pathlib import Path


# =====================================================================
# 1. 設定區（路徑、規則常數）
# =====================================================================

# 以本檔所在資料夾為基準，不管從哪裡執行都找得到檔案
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "courses.db"
COURSES_JSON = BASE_DIR / "courses.json"
TIMESLOTS_JSON = BASE_DIR / "course_timeslots.json"

# 需求書規定：四技學生每學期須修 9 至 25 學分
MIN_CREDITS = 9
MAX_CREDITS = 25


# =====================================================================
# 2. 資料表結構（SCHEMA）
#    欄位用英文命名（方便後端程式使用），中文意思寫在註解
# =====================================================================

SCHEMA_SQL = """
-- ---------- 課程主表：一門課一筆 ----------
CREATE TABLE courses (
    id           TEXT PRIMARY KEY,          -- 系統序號（唯一識別碼，請用它當主鍵）
    course_no    TEXT,                      -- 課號（注意：約 1/3 資料在來源檔已損毀，不保證唯一）
    name         TEXT NOT NULL,             -- 課程名稱
    semester     TEXT NOT NULL,             -- 學期，例如 115-1
    department   TEXT NOT NULL,             -- 開課系所
    division     TEXT,                      -- 部別（日間部 / 進修部(夜間部)）
    grade        INTEGER,                   -- 年級（少數課程為空）
    class_name   TEXT,                      -- 開課班級
    teachers     TEXT,                      -- 授課教師（多位用「、」分隔）
    credits      INTEGER NOT NULL           -- 學分
                 CHECK (credits >= 0),
    course_type  TEXT NOT NULL              -- 必選修
                 CHECK (course_type IN ('必修', '選修')),
    time_text    TEXT,                      -- 上課時間（顯示用文字，例如「二 3-4」）
    classroom    TEXT,                      -- 教室
    enrolled     INTEGER,                   -- 修課人數
    summary      TEXT,                      -- 課程摘要
    restriction  TEXT                       -- 修課限制
);

-- ---------- 上課時段表：一門課可有多個時段（衝堂檢查用） ----------
CREATE TABLE course_timeslots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id     TEXT NOT NULL,            -- 對應 courses.id
    weekday       INTEGER NOT NULL          -- 星期（1=一 … 7=日）
                  CHECK (weekday BETWEEN 1 AND 7),
    start_period  INTEGER NOT NULL,         -- 起始節次
    end_period    INTEGER NOT NULL,         -- 結束節次
    CHECK (start_period <= end_period),
    -- 課程被刪除時，它的時段一併刪除
    FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE
);

-- ---------- 索引：加速常用查詢條件 ----------
CREATE INDEX idx_courses_sem_dept  ON courses (semester, department);
CREATE INDEX idx_courses_type      ON courses (course_type);
CREATE INDEX idx_courses_grade     ON courses (grade);
CREATE INDEX idx_timeslots_course  ON course_timeslots (course_id);
CREATE INDEX idx_timeslots_day     ON course_timeslots (weekday, start_period, end_period);
"""


# =====================================================================
# 3. 連線與建立資料庫
# =====================================================================

def get_connection(db_path=DB_PATH):
    """取得資料庫連線（後端每次處理請求時，各自呼叫一次即可）。"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row          # 查詢結果可用欄位名稱取值
    conn.execute("PRAGMA foreign_keys = ON")  # SQLite 預設不檢查外鍵，每次連線都要開
    return conn


def create_database():
    """刪除舊資料庫並重新建立（每次執行都是全新匯入）。"""
    if DB_PATH.exists():
        DB_PATH.unlink()
    conn = get_connection()
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    return conn


# =====================================================================
# 4. 匯入 JSON
# =====================================================================

def load_json(path):
    """讀取 JSON 檔（UTF-8）。"""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def import_courses(conn):
    """匯入 courses.json → courses 表。左邊是 JSON 的中文欄位名。"""
    data = load_json(COURSES_JSON)
    rows = [
        (
            c["系統序號"], c["課號"], c["課程名稱"], c["學期"], c["開課系所"],
            c["部別"], c["年級"], c["開課班級"], c["授課教師"], c["學分"],
            c["必選修"], c["上課時間"], c["教室"], c["修課人數"],
            c["課程摘要"], c["修課限制"],
        )
        for c in data
    ]
    with conn:  # 成功自動 commit，失敗自動 rollback
        conn.executemany(
            """INSERT INTO courses
               (id, course_no, name, semester, department, division, grade,
                class_name, teachers, credits, course_type, time_text,
                classroom, enrolled, summary, restriction)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )
    return len(rows)


def import_timeslots(conn):
    """匯入 course_timeslots.json → course_timeslots 表。"""
    data = load_json(TIMESLOTS_JSON)
    rows = [(t["系統序號"], t["星期"], t["起始節次"], t["結束節次"]) for t in data]
    with conn:
        conn.executemany(
            """INSERT INTO course_timeslots
               (course_id, weekday, start_period, end_period)
               VALUES (?,?,?,?)""",
            rows,
        )
    return len(rows)


def verify_import(conn, n_courses, n_slots):
    """匯入後檢查：筆數是否一致、外鍵是否都對得上。"""
    db_courses = conn.execute("SELECT COUNT(*) FROM courses").fetchone()[0]
    db_slots = conn.execute("SELECT COUNT(*) FROM course_timeslots").fetchone()[0]
    broken_fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    assert db_courses == n_courses, "課程筆數不一致"
    assert db_slots == n_slots, "時段筆數不一致"
    assert not broken_fk, "有時段對不到課程"
    print(f"匯入完成：課程 {db_courses} 筆、上課時段 {db_slots} 筆，外鍵檢查通過")


# =====================================================================
# 5. 查詢函式（給後端 API 使用，都回傳 dict / list，可直接轉 JSON）
# =====================================================================

def list_departments(conn, semester=None):
    """取得開課系所清單（給前端下拉選單用）。"""
    sql = "SELECT DISTINCT department FROM courses"
    params = []
    if semester:
        sql += " WHERE semester = ?"
        params.append(semester)
    sql += " ORDER BY department"
    return [r["department"] for r in conn.execute(sql, params)]


def search_courses(conn, semester=None, department=None, course_type=None,
                   grade=None, division=None, weekday=None, keyword=None,
                   page=1, page_size=10):
    """
    課程查詢（對應需求書：依學期、系所、年級、必選修、部別、星期、關鍵字，分頁顯示）。
    條件都是選填，沒給就不篩選。
    """
    where, params = [], []

    # 一般條件：有給才加進 WHERE（一律用 ? 帶參數，避免 SQL injection）
    if semester:
        where.append("c.semester = ?");    params.append(semester)
    if department:
        where.append("c.department = ?");  params.append(department)
    if course_type:
        where.append("c.course_type = ?"); params.append(course_type)
    if grade:
        where.append("c.grade = ?");       params.append(grade)
    if division:
        where.append("c.division = ?");    params.append(division)

    # 星期：到時段表裡找有沒有那一天的課
    if weekday:
        where.append("EXISTS (SELECT 1 FROM course_timeslots t "
                     "WHERE t.course_id = c.id AND t.weekday = ?)")
        params.append(weekday)

    # 關鍵字：比對課名、教師、課號
    if keyword:
        where.append("(c.name LIKE ? OR c.teachers LIKE ? OR c.course_no LIKE ?)")
        params += [f"%{keyword}%"] * 3

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    # 先算總筆數（前端要顯示「共 N 筆」與頁數）
    total = conn.execute(
        f"SELECT COUNT(*) FROM courses c {where_sql}", params
    ).fetchone()[0]

    # 再取這一頁的資料（列表頁不需要摘要、限制這些長文字）
    offset = (page - 1) * page_size
    rows = conn.execute(
        f"""SELECT c.id, c.course_no, c.name, c.department, c.class_name,
                   c.teachers, c.credits, c.course_type, c.time_text,
                   c.classroom, c.enrolled
            FROM courses c {where_sql}
            ORDER BY c.department, c.class_name, c.name
            LIMIT ? OFFSET ?""",
        params + [page_size, offset],
    ).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows],
    }


def get_course(conn, course_id):
    """取得單一課程完整資料（含摘要、修課限制、所有上課時段）。找不到回傳 None。"""
    row = conn.execute("SELECT * FROM courses WHERE id = ?", (course_id,)).fetchone()
    if row is None:
        return None
    course = dict(row)
    course["timeslots"] = [
        dict(t) for t in conn.execute(
            """SELECT weekday, start_period, end_period
               FROM course_timeslots WHERE course_id = ?
               ORDER BY weekday, start_period""",
            (course_id,),
        )
    ]
    return course


def find_conflicts(conn, course_ids):
    """
    衝堂檢查：傳入預選課程的 id 清單，回傳所有「時間重疊」的課程配對。
    兩個時段重疊的條件：同一天，且 A 開始 <= B 結束、B 開始 <= A 結束。
    """
    if len(course_ids) < 2:
        return []
    marks = ",".join("?" * len(course_ids))
    rows = conn.execute(
        f"""SELECT a.course_id AS course_a,
                   b.course_id AS course_b,
                   a.weekday,
                   MAX(a.start_period, b.start_period) AS from_period,
                   MIN(a.end_period,   b.end_period)   AS to_period
            FROM course_timeslots a
            JOIN course_timeslots b
              ON a.weekday = b.weekday
             AND a.course_id < b.course_id            -- 每一對只算一次
             AND a.start_period <= b.end_period
             AND b.start_period <= a.end_period
            WHERE a.course_id IN ({marks}) AND b.course_id IN ({marks})""",
        list(course_ids) * 2,
    ).fetchall()
    return [dict(r) for r in rows]


def calc_credits(conn, course_ids):
    """學分計算：回傳必修、選修、總學分，以及是否落在 9~25 學分內。"""
    result = {"required": 0, "elective": 0, "total": 0, "in_range": False}
    if course_ids:
        marks = ",".join("?" * len(course_ids))
        rows = conn.execute(
            f"""SELECT course_type, SUM(credits) AS s FROM courses
                WHERE id IN ({marks}) GROUP BY course_type""",
            list(course_ids),
        )
        for r in rows:
            key = "required" if r["course_type"] == "必修" else "elective"
            result[key] = r["s"]
    result["total"] = result["required"] + result["elective"]
    result["in_range"] = MIN_CREDITS <= result["total"] <= MAX_CREDITS
    return result


# =====================================================================
# 6. 主程式：建庫 → 匯入 → 檢查 → 示範查詢
# =====================================================================

def main():
    conn = create_database()
    try:
        n_courses = import_courses(conn)
        n_slots = import_timeslots(conn)
        verify_import(conn, n_courses, n_slots)

        # ---- 示範 1：查「週二」的「必修」課，第 1 頁 ----
        page = search_courses(conn, course_type="必修", weekday=2, page_size=5)
        print(f"\n[查詢示範] 週二必修課，共 {page['total']} 筆，第 1 頁：")
        for c in page["items"]:
            print(f"  {c['name']}｜{c['class_name']}｜{c['time_text']}｜{c['classroom']}")

        # ---- 示範 2：單一課程詳細資料 ----
        if page["items"]:
            detail = get_course(conn, page["items"][0]["id"])
            print(f"\n[課程詳細] {detail['name']}，時段：{detail['timeslots']}")

        # ---- 示範 3：衝堂檢查與學分計算（拿剛查到的課當作預選清單）----
        ids = [c["id"] for c in page["items"]]
        print("\n[衝堂檢查]", find_conflicts(conn, ids) or "沒有衝堂")
        print("[學分計算]", calc_credits(conn, ids))
    finally:
        conn.close()


if __name__ == "__main__":
    main()
