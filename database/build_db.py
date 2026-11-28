"""
build_db.py — 北護多課程整合與預選課模擬系統：資料庫建立與查詢

用法（在 VS Code 直接執行，或：python build_db.py）：
    1. 把本檔、init_app_db.py、courses.json、course_timeslots.json 放在同一個資料夾
    2. 執行後會做這幾件事：
         a. 用兩份 JSON 重建 courses.db（課程、上課時段）
         b. 檢查 backend/data/app.db；沒有就建立，有就保留（帳號、預選清單都不會被清掉）
         c. 把管理者在網站上做過的事重新套用回新的 courses.db：
              新增的課程（added_courses）、刪除的課程（deleted_courses）、
              改過的課程欄位（course_overrides）
         d. 更新 app.db 的大樓（buildings）與教室對照（classrooms）

重要：
    - 重建前會把舊的 courses.db 複製成 courses.db.bak（只留最近一份）。
    - 新資料庫先建在 courses.new.db，全部成功才會換掉 courses.db；中途失敗，舊的不會壞。
    - 管理者在網站上新增 / 修改 / 刪除課程時，後端請呼叫
      admin_create_course() / admin_update_course() / admin_delete_course()，
      它們會同時改 courses.db 並記錄到 app.db，重建後才不會消失。
      （後端如果自己直接改 courses.db，重建後那些修改會不見。）
    - 重建前請先關閉後端（Windows 上開著的資料庫檔案無法被取代）。

後端串接：
    from build_db import (get_connection, search_courses, get_course, find_conflicts,
                          calc_credits, list_departments, list_buildings,
                          get_classroom_info, admin_create_course, admin_update_course,
                          admin_delete_course, add_to_wishlist, remove_from_wishlist,
                          clear_wishlist, get_wishlist_summary)
    from init_app_db import get_app_connection
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import uuid
from pathlib import Path

from init_app_db import APP_DB_PATH, init_app_database


# =====================================================================
# 1. 設定區（路徑、規則常數）
# =====================================================================

# 以本檔所在資料夾為基準，不管從哪裡執行都找得到檔案
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "courses.db"
BACKUP_PATH = BASE_DIR / "courses.db.bak"
TEMP_PATH = BASE_DIR / "courses.new.db"
COURSES_JSON = BASE_DIR / "courses.json"
TIMESLOTS_JSON = BASE_DIR / "course_timeslots.json"

# 需求書規定：四技學生每學期須修 9 至 25 學分
MIN_CREDITS = 9
MAX_CREDITS = 25


# =====================================================================
# 2. 校本部大樓與教室規則（地圖用）
# =====================================================================

# 大樓編號 → (大樓名稱, 教室代號開頭字母, map_x, map_y)
# map_x、map_y = 在地圖圖片上的位置，佔圖片寬、高的百分比（0~100）
# 教室代號開頭字母是 None 的大樓，代表課程資料裡目前沒有以它開頭的教室
BUILDING_MAP = {
    1:  ("親仁樓",       "B",  76.5, 33.5),
    2:  ("行政大樓",     None, 72.5, 48.0),
    3:  ("科技大樓",     "S",  66.5, 58.0),
    4:  ("圖書館",       None, 56.5, 51.5),
    5:  ("教學大樓",     "G",  58.5, 40.5),
    6:  ("學思樓",       "F",  43.5, 36.5),
    7:  ("體育館",       None, 26.5, 40.0),
    8:  ("明倫館",       None, 25.5, 45.5),
    9:  ("宿舍-蕙質樓",  None, 23.5, 52.5),
    10: ("學生餐廳",     None, 20.5, 56.0),
    11: ("宿舍-蘭心樓",  None, 21.5, 61.5),
    12: ("宿舍-爾雅樓",  None, 17.0, 44.0),
    13: ("水療中心",     None, 11.0, 50.5),
    14: ("樂育樓",       "I",  10.5, 63.0),
}

# 【座標校正選項】上面是你指定的座標。我把地圖圖片（3515×2665）上 14 個編號圓圈
# 的中心量了一次，下面是實測值。你指定的座標有約一半（尤其左半邊 7~14 號）
# 會落在大樓外面，最大差 9.3 個百分點。
# 如果你前端用的就是那張地圖圖片，把下面改成 True 就會改用實測值。
USE_MEASURED_COORDS = True
MEASURED_COORDS = {
    1: (71.1, 34.6),  2: (68.2, 45.9),  3: (63.9, 60.0),  4: (56.5, 51.9),
    5: (57.2, 42.0),  6: (40.9, 35.5),  7: (29.7, 39.7),  8: (29.0, 45.7),
    9: (28.2, 53.5), 10: (27.0, 56.1), 11: (27.5, 62.5), 12: (21.3, 43.5),
    13: (19.8, 50.2), 14: (19.8, 62.7),
}

# 教室代號開頭字母的別名：IB01、IB02 算在樂育樓（I）
PREFIX_ALIAS = {"IB": "I"}

# 教室開頭字母 → 大樓編號（由上面的 BUILDING_MAP 自動產生）
PREFIX_TO_BUILDING = {v[1]: no for no, v in BUILDING_MAP.items() if v[1]}

# 多間教室的分隔符號（來源資料用「、」）
ROOM_SPLIT_RE = re.compile(r"[、,，;；/]+")
# 一般教室代號：1~2 個英文字母 + 數字，例如 F601、B111、IB01
ROOM_CODE_RE = re.compile(r"^([A-Za-z]{1,2})(\d+)$")


def parse_classrooms(text):
    """
    把課程的「教室」文字拆成教室清單，重複的只留一個，順序不變。
        'F414、I303'            -> ['F414', 'I303']
        '校外實習、校外實習'     -> ['校外實習']
        ''                      -> []
    """
    if not text:
        return []
    rooms = []
    for part in ROOM_SPLIT_RE.split(str(text)):
        part = part.strip()
        if part and part not in rooms:
            rooms.append(part)
    return rooms


def resolve_classroom(code):
    """
    判斷單一教室代號，回傳 dict：
        code          教室代號（原樣保留）
        room_type     'room' 一般教室 / 'special' 校外實習、論文研究教室、體育教室、其他…
        building_id   大樓編號；找不到對應大樓（例如 C 開頭）就是 None
        floor         樓層；由代號第一個數字推算（F601 -> 6），推不出來就是 None
    """
    m = ROOM_CODE_RE.match(code)
    if not m:                                   # 不是「字母+數字」→ 非一般教室，原字串保留
        return {"code": code, "room_type": "special", "building_id": None, "floor": None}
    letters, digits = m.group(1).upper(), m.group(2)
    prefix = PREFIX_ALIAS.get(letters, letters)           # IB -> I
    floor = int(digits[0]) if len(digits) >= 3 else None  # IB01 這種 2 位數推不出樓層
    return {
        "code": code,
        "room_type": "room",
        "building_id": PREFIX_TO_BUILDING.get(prefix),    # C 開頭 -> None（保留代號，沒有大樓）
        "floor": floor,
    }


# =====================================================================
# 3. 上課時間：文字 <-> 時段
#    文字格式（顯示用）：'二 3-4、四 1,6-7'；時段格式：(星期, 起始節次, 結束節次)
# =====================================================================

DAY_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "七": 7}
DAY_TEXT = {1: "一", 2: "二", 3: "三", 4: "四", 5: "五", 6: "六", 7: "日"}


def parse_time_text(text):
    """'二 3-4、四 1,6-7' -> [(2,3,4), (4,1,1), (4,6,7)]。空字串回傳 []；格式不對丟 ValueError。"""
    slots = []
    if text is None or not str(text).strip():
        return slots
    for part in str(text).split("、"):
        m = re.fullmatch(r"\s*([一二三四五六日七])\s+([\d,\-\s]+?)\s*", part)
        if not m:
            raise ValueError(f"看不懂的上課時間：{part!r}（正確例子：二 3-4、四 1,6-7）")
        day = DAY_NUM[m.group(1)]
        for seg in m.group(2).replace(" ", "").split(","):
            if not seg:
                continue
            a, _, b = seg.partition("-")
            start, end = int(a), int(b or a)
            if start < 1 or start > end:
                raise ValueError(f"節次不合理：{seg!r}")
            slots.append((day, start, end))
    return slots


def format_time_text(slots):
    """[(2,3,4), (4,1,1), (4,6,7)] -> '二 3-4、四 1,6-7'。同一天的時段併在一起。"""
    by_day = {}
    for day, a, b in slots:
        by_day.setdefault(day, []).append(str(a) if a == b else f"{a}-{b}")
    return "、".join(f"{DAY_TEXT[d]} {','.join(v)}" for d, v in by_day.items())


# =====================================================================
# 4. courses.db 資料表結構（課程、上課時段）
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
    classroom    TEXT,                      -- 教室（多間用「、」分隔，例如「F414、I303」）
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
# 5. 連線與建立資料庫
# =====================================================================

def get_connection(db_path=DB_PATH):
    """取得 courses.db 連線（後端每次處理請求時，各自呼叫一次即可）。"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row            # 查詢結果可用欄位名稱取值
    conn.execute("PRAGMA foreign_keys = ON")  # SQLite 預設不檢查外鍵，每次連線都要開
    return conn


def create_courses_db(path):
    """在指定位置建立全新、空的 courses 資料庫（有舊檔就先刪掉）。"""
    path = Path(path)
    if path.exists():
        path.unlink()
    conn = get_connection(path)
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    return conn


# =====================================================================
# 6. 匯入 JSON
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
            c["必選修"], c["上課時間"],
            "、".join(parse_classrooms(c["教室"])),   # 順便清掉重複的教室（校外實習、校外實習…）
            c["修課人數"], c["課程摘要"], c["修課限制"],
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


# =====================================================================
# 7. app.db 的大樓與教室對照
# =====================================================================

def seed_buildings(app_conn):
    """把 BUILDING_MAP 寫進 app.db 的 buildings（已存在就更新）。每次重建都以程式裡的設定為準。"""
    with app_conn:
        for no, (name, prefix, x, y) in BUILDING_MAP.items():
            if USE_MEASURED_COORDS:
                x, y = MEASURED_COORDS[no]
            app_conn.execute(
                """INSERT INTO buildings (id, name, room_prefix, map_x, map_y)
                   VALUES (?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET
                       name = excluded.name, room_prefix = excluded.room_prefix,
                       map_x = excluded.map_x, map_y = excluded.map_y""",
                (no, name, prefix, x, y),
            )
    return len(BUILDING_MAP)


def sync_classrooms(app_conn, codes, commit=True):
    """
    把教室代號寫進 app.db 的 classrooms（已存在就依規則重新計算）。回傳處理的教室數。
    commit=False：不要自己提交，由呼叫端決定什麼時候一起提交（管理者修改課程時使用）。
    """
    for code in codes:
        r = resolve_classroom(code)
        app_conn.execute(
            """INSERT INTO classrooms (code, building_id, floor, room_type)
               VALUES (?,?,?,?)
               ON CONFLICT(code) DO UPDATE SET
                   building_id = excluded.building_id, floor = excluded.floor,
                   room_type = excluded.room_type""",
            (r["code"], r["building_id"], r["floor"], r["room_type"]),
        )
    if commit:
        app_conn.commit()
    return len(codes)


def all_classroom_codes(courses_conn):
    """從 courses 表收集所有不重複的教室代號（多間教室會先拆開）。"""
    codes = []
    for (text,) in courses_conn.execute("SELECT DISTINCT classroom FROM courses"):
        for code in parse_classrooms(text):
            if code not in codes:
                codes.append(code)
    return codes


# =====================================================================
# 8. 管理者修改課程：欄位驗證、套用 overrides、後端用的修改函式
# =====================================================================

# 可以被管理者修改的欄位（左：courses 欄位名；右：資料型態）。id 不能改。
EDITABLE_FIELDS = {
    "course_no": "text", "name": "text", "semester": "text", "department": "text",
    "division": "text", "grade": "int", "class_name": "text", "teachers": "text",
    "credits": "int", "course_type": "type", "time_text": "time", "classroom": "room",
    "enrolled": "int", "summary": "text", "restriction": "text",
}
# 這幾個欄位不能是空的（對應 courses 表的 NOT NULL）
NOT_NULL_FIELDS = {"name", "semester", "department", "credits", "course_type"}


def normalize_field_value(field, value):
    """檢查並整理要寫入的值；不合法就丟 ValueError。回傳可以直接寫進資料庫的值。"""
    kind = EDITABLE_FIELDS.get(field)
    if kind is None:
        raise ValueError(f"不能修改的欄位：{field}")
    if isinstance(value, str):
        value = value.strip()
    if value is None or value == "":
        if field in NOT_NULL_FIELDS:
            raise ValueError(f"{field} 不能是空的")
        return None

    if kind == "int":
        if isinstance(value, float) and not value.is_integer():
            raise ValueError(f"{field} 必須是整數：{value!r}")
        try:
            n = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{field} 必須是整數：{value!r}")
        if n < 0:
            raise ValueError(f"{field} 不能是負數：{n}")
        return n
    if kind == "type":
        if value not in ("必修", "選修"):
            raise ValueError(f"course_type 只能是 必修 或 選修：{value!r}")
        return value
    if kind == "room":
        return "、".join(parse_classrooms(value)) or None
    if kind == "time":
        return format_time_text(parse_time_text(value)) or None   # 格式不對會丟 ValueError
    return str(value)


def replace_timeslots(courses_conn, course_id, time_text):
    """依上課時間文字，重新產生這門課的上課時段（不 commit，由呼叫端決定）。"""
    courses_conn.execute("DELETE FROM course_timeslots WHERE course_id = ?", (course_id,))
    courses_conn.executemany(
        """INSERT INTO course_timeslots (course_id, weekday, start_period, end_period)
           VALUES (?,?,?,?)""",
        [(course_id, d, a, b) for d, a, b in parse_time_text(time_text)],
    )


def _apply_change(courses_conn, course_id, field, value):
    """把單一欄位的修改寫進 courses（不 commit）。field 已經過 EDITABLE_FIELDS 檢查，可安全放進 SQL。"""
    courses_conn.execute(f'UPDATE courses SET "{field}" = ? WHERE id = ?', (value, course_id))
    if field == "time_text":                      # 改了上課時間，時段表也要跟著變，衝堂檢查才會正確
        replace_timeslots(courses_conn, course_id, value)


def apply_overrides(courses_conn, app_conn):
    """
    把 app.db 的 course_overrides 套用到 courses.db。
    回傳 (套用成功筆數, 問題清單)；有問題的紀錄會跳過並列出，不會讓程式中斷，也不會被刪除。
    """
    applied, problems = 0, []
    rows = app_conn.execute(
        "SELECT course_id, field_name, new_value FROM course_overrides ORDER BY id").fetchall()
    for r in rows:
        cid, field = r["course_id"], r["field_name"]
        if courses_conn.execute("SELECT 1 FROM courses WHERE id = ?", (cid,)).fetchone() is None:
            problems.append(f"課程 {cid} 已不存在，略過它的修改（{field}）")
            continue
        try:
            value = normalize_field_value(field, r["new_value"])
            _apply_change(courses_conn, cid, field, value)
        except (ValueError, sqlite3.IntegrityError) as e:
            problems.append(f"課程 {cid} 的 {field} 修改無法套用：{e}")
            continue
        applied += 1
    courses_conn.commit()
    return applied, problems


def admin_update_course(courses_conn, app_conn, course_id, changes, admin_user_id=None):
    """
    【給後端使用】管理者修改課程：同時改 courses.db，並記錄到 course_overrides。
    只要透過這個函式修改，重建 courses.db 之後修改就會自動套用回來。

        changes        要改的欄位，例如 {"classroom": "F601", "teachers": "王小明"}
        admin_user_id  哪位管理者改的（users.id），可以不給

    欄位不合法會丟 ValueError、找不到課程會丟 LookupError，而且兩個資料庫都不會被改動。
    成功時回傳修改後的課程資料（同 get_course）。
    """
    if courses_conn.execute("SELECT 1 FROM courses WHERE id = ?", (course_id,)).fetchone() is None:
        raise LookupError(f"找不到課程：{course_id}")
    cleaned = {f: normalize_field_value(f, v) for f, v in changes.items()}   # 先全部檢查過

    try:
        for field, value in cleaned.items():
            _apply_change(courses_conn, course_id, field, value)
            app_conn.execute(
                """INSERT INTO course_overrides (course_id, field_name, new_value, updated_by)
                   VALUES (?,?,?,?)
                   ON CONFLICT(course_id, field_name) DO UPDATE SET
                       new_value = excluded.new_value,
                       updated_by = excluded.updated_by,
                       updated_at = datetime('now', 'localtime')""",
                (course_id, field, None if value is None else str(value), admin_user_id),
            )
        if "classroom" in cleaned:                # 新的教室代號也要進對照表，地圖才找得到
            sync_classrooms(app_conn, parse_classrooms(cleaned["classroom"]), commit=False)
        # 提交順序：先 app.db，再 courses.db。app.db 常被很多人同時寫入、比較可能因為被鎖住而失敗，
        # 這時 courses.db 還沒提交，會一起還原（兩邊都不變）。兩個是不同的檔案，沒辦法保證百分之百同時成功；
        # 極少見的情況是 courses.db 最後才失敗：錯誤會丟出來，app.db 的紀錄會留著，下次重建時套用。
        app_conn.commit()
        courses_conn.commit()
    except Exception:
        courses_conn.rollback()
        app_conn.rollback()
        raise
    return get_course(courses_conn, course_id)


def _insert_course(conn, course_id, values):
    """把一門課寫進 courses 與 course_timeslots（不 commit）。欄位名稱來自白名單，可安全放進 SQL。"""
    cols = list(EDITABLE_FIELDS)
    conn.execute(
        f"INSERT INTO courses (id, {', '.join(cols)}) VALUES ({','.join('?' * (len(cols) + 1))})",
        [course_id] + [values.get(c) for c in cols],
    )
    replace_timeslots(conn, course_id, values.get("time_text"))


def insert_added_courses(courses_conn, app_conn):
    """把 app.db 的 added_courses（管理者新增的課）加進新的 courses.db。回傳 (加入門數, 問題清單)。"""
    added, problems = 0, []
    for r in app_conn.execute("SELECT course_id, data FROM added_courses ORDER BY seq").fetchall():
        try:
            _insert_course(courses_conn, r["course_id"], json.loads(r["data"]))
        except (ValueError, sqlite3.IntegrityError) as e:
            problems.append(f"管理者新增的課程 {r['course_id']} 無法加回：{e}")
            continue
        added += 1
    courses_conn.commit()
    return added, problems


def apply_deletions(courses_conn, app_conn):
    """把 app.db 的 deleted_courses（管理者刪除的課）從新的 courses.db 再刪掉一次。回傳刪除門數。"""
    n = 0
    for (cid,) in app_conn.execute("SELECT course_id FROM deleted_courses").fetchall():
        n += courses_conn.execute("DELETE FROM courses WHERE id = ?", (cid,)).rowcount
    courses_conn.commit()
    return n


def admin_create_course(courses_conn, app_conn, data, admin_user_id=None):
    """
    【給後端使用】管理者新增課程：寫進 courses.db，並記錄到 added_courses，重建後會自動加回來。

        data  課程欄位，例如 {"name": "新課", "semester": "115-1", "department": "資訊管理系",
              "credits": 2, "course_type": "選修", "time_text": "二 3-4", "classroom": "F601"}
              name、semester、department、credits、course_type 一定要有，其他可以省略。

    新課程的 id 會自動產生（格式 A00001）。欄位不合法丟 ValueError，兩個資料庫都不會被改動。
    成功時回傳新課程資料（同 get_course）。
    """
    unknown = set(data) - set(EDITABLE_FIELDS)
    if unknown:
        raise ValueError(f"不能設定的欄位：{sorted(unknown)}")
    cleaned = {f: normalize_field_value(f, data.get(f)) for f in EDITABLE_FIELDS}   # 缺必填欄位會丟 ValueError

    try:
        cur = app_conn.execute(
            "INSERT INTO added_courses (course_id, data, created_by) VALUES (?,?,?)",
            ("pending-" + uuid.uuid4().hex, json.dumps(cleaned, ensure_ascii=False), admin_user_id),
        )
        course_id = "A%05d" % cur.lastrowid
        app_conn.execute("UPDATE added_courses SET course_id = ? WHERE seq = ?", (course_id, cur.lastrowid))
        _insert_course(courses_conn, course_id, cleaned)
        sync_classrooms(app_conn, parse_classrooms(cleaned["classroom"]), commit=False)
        # 提交順序：先 app.db，再 courses.db。app.db 常被很多人同時寫入、比較可能因為被鎖住而失敗，
        # 這時 courses.db 還沒提交，會一起還原（兩邊都不變）。兩個是不同的檔案，沒辦法保證百分之百同時成功；
        # 極少見的情況是 courses.db 最後才失敗：錯誤會丟出來，app.db 的紀錄會留著，下次重建時套用。
        app_conn.commit()
        courses_conn.commit()
    except Exception:
        courses_conn.rollback()
        app_conn.rollback()
        raise
    return get_course(courses_conn, course_id)


def admin_delete_course(courses_conn, app_conn, course_id, admin_user_id=None):
    """
    【給後端使用】管理者刪除課程：
        - 從 courses.db 刪掉（上課時段一併刪除）
        - 從所有學生的預選清單（wishlist）移除（需求書：課程刪除後，預選清單裡的同一門課跟著移除）
        - 記錄到 deleted_courses，重建後不會從 JSON 裡復活（如果是管理者自己新增的課，直接移除新增紀錄）
    找不到課程丟 LookupError。成功回傳 {"deleted": 課程id, "removed_from_wishlists": 被移除的預選筆數}。
    """
    if courses_conn.execute("SELECT 1 FROM courses WHERE id = ?", (course_id,)).fetchone() is None:
        raise LookupError(f"找不到課程：{course_id}")
    try:
        courses_conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
        removed = app_conn.execute("DELETE FROM wishlist WHERE course_id = ?", (course_id,)).rowcount
        app_conn.execute("DELETE FROM course_overrides WHERE course_id = ?", (course_id,))
        was_added = app_conn.execute("DELETE FROM added_courses WHERE course_id = ?", (course_id,)).rowcount
        if not was_added:                         # 來源資料裡的課：記下來，重建時才不會復活
            app_conn.execute(
                "INSERT OR REPLACE INTO deleted_courses (course_id, deleted_by) VALUES (?,?)",
                (course_id, admin_user_id),
            )
        # 提交順序：先 app.db，再 courses.db。app.db 常被很多人同時寫入、比較可能因為被鎖住而失敗，
        # 這時 courses.db 還沒提交，會一起還原（兩邊都不變）。兩個是不同的檔案，沒辦法保證百分之百同時成功；
        # 極少見的情況是 courses.db 最後才失敗：錯誤會丟出來，app.db 的紀錄會留著，下次重建時套用。
        app_conn.commit()
        courses_conn.commit()
    except Exception:
        courses_conn.rollback()
        app_conn.rollback()
        raise
    return {"deleted": course_id, "removed_from_wishlists": removed}


# =====================================================================
# 9. 重建流程與檢查
# =====================================================================

def check_time_consistency(conn):
    """檢查每門課的「上課時間文字」與「上課時段表」是否一致，回傳不一致的課程 id。"""
    slots = {}
    for r in conn.execute("SELECT course_id, weekday, start_period, end_period FROM course_timeslots"):
        slots.setdefault(r["course_id"], []).append((r["weekday"], r["start_period"], r["end_period"]))
    bad = []
    for r in conn.execute("SELECT id, time_text FROM courses"):
        try:
            expected = sorted(parse_time_text(r["time_text"]))
        except ValueError:
            bad.append(r["id"])
            continue
        if expected != sorted(slots.get(r["id"], [])):
            bad.append(r["id"])
    return bad


def verify_import(conn, n_courses, n_slots):
    """匯入後檢查：筆數是否一致、外鍵是否都對得上。"""
    db_courses = conn.execute("SELECT COUNT(*) FROM courses").fetchone()[0]
    db_slots = conn.execute("SELECT COUNT(*) FROM course_timeslots").fetchone()[0]
    broken_fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    assert db_courses == n_courses, "課程筆數不一致"
    assert db_slots == n_slots, "時段筆數不一致"
    assert not broken_fk, "有時段對不到課程"


def rebuild_all():
    """
    完整重建流程。回傳結果摘要 dict。
    順序：建新資料庫 → 匯入 JSON → 套用管理者修改 → 更新大樓與教室 → 全部成功才換掉舊檔。
    """
    # 1. app.db：補齊資料表（不會動既有資料）
    app_conn = init_app_database(APP_DB_PATH)
    try:
        # 2. 在暫存檔建立全新的 courses 資料庫，舊的 courses.db 先不碰
        conn = create_courses_db(TEMP_PATH)
        try:
            n_courses = import_courses(conn)
            n_slots = import_timeslots(conn)
            verify_import(conn, n_courses, n_slots)

            # 3. 把管理者做過的事套用回來：先加回新增的課、再刪掉刪除的課、最後套用改過的欄位
            n_added, add_problems = insert_added_courses(conn, app_conn)
            n_deleted = apply_deletions(conn, app_conn)
            applied, problems = apply_overrides(conn, app_conn)
            problems = add_problems + problems

            # 4. 更新大樓與教室對照（用套用修改後的教室資料）
            n_buildings = seed_buildings(app_conn)
            n_rooms = sync_classrooms(app_conn, all_classroom_codes(conn))

            # 5. 最後檢查
            bad_time = check_time_consistency(conn)
            orphan_wishlist = [r[0] for r in app_conn.execute("SELECT DISTINCT course_id FROM wishlist")
                               if conn.execute("SELECT 1 FROM courses WHERE id = ?", (r[0],)).fetchone() is None]
            summary = {
                "courses": n_courses, "timeslots": n_slots,
                "added": n_added, "deleted": n_deleted,
                "overrides_applied": applied, "override_problems": problems,
                "buildings": n_buildings, "classrooms": n_rooms,
                "time_mismatch": bad_time, "orphan_wishlist": orphan_wishlist,
            }
        finally:
            conn.close()

        # 6. 全部成功：備份舊檔，再用新檔取代（取代是一次完成，不會留下半套資料庫）
        if DB_PATH.exists():
            shutil.copy2(DB_PATH, BACKUP_PATH)
            summary["backup"] = BACKUP_PATH.name
        try:
            os.replace(TEMP_PATH, DB_PATH)
        except PermissionError:
            raise SystemExit("無法取代 courses.db：檔案可能被後端或其他程式開著，請先關閉後再執行一次。"
                             "（舊資料庫沒有被動到）")
        return summary
    finally:
        app_conn.close()
        if TEMP_PATH.exists():          # 失敗時清掉暫存檔
            TEMP_PATH.unlink()


# =====================================================================
# 10. 查詢函式（給後端 API 使用，都回傳 dict / list，可直接轉 JSON）
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


# ---------- 預選清單（wishlist）：每位使用者各自一份，一律用 user_id 區分 ----------

def add_to_wishlist(courses_conn, app_conn, user_id, course_id):
    """
    把課程加入某位使用者的預選清單。回傳 True = 新加入，False = 本來就在清單裡。
    課程不存在、或使用者不存在，丟 LookupError。
    """
    if courses_conn.execute("SELECT 1 FROM courses WHERE id = ?", (course_id,)).fetchone() is None:
        raise LookupError(f"找不到課程：{course_id}")
    try:
        cur = app_conn.execute(
            "INSERT OR IGNORE INTO wishlist (user_id, course_id) VALUES (?,?)", (user_id, course_id))
    except sqlite3.IntegrityError:
        app_conn.rollback()
        raise LookupError(f"找不到使用者：{user_id}")
    app_conn.commit()
    return cur.rowcount == 1


def remove_from_wishlist(app_conn, user_id, course_id):
    """把課程從某位使用者的預選清單移除。回傳 True = 有移除，False = 本來就不在清單裡。"""
    cur = app_conn.execute(
        "DELETE FROM wishlist WHERE user_id = ? AND course_id = ?", (user_id, course_id))
    app_conn.commit()
    return cur.rowcount == 1


def clear_wishlist(app_conn, user_id):
    """清空某位使用者的預選清單。回傳清掉幾筆。"""
    cur = app_conn.execute("DELETE FROM wishlist WHERE user_id = ?", (user_id,))
    app_conn.commit()
    return cur.rowcount


def get_wishlist_summary(courses_conn, app_conn, user_id):
    """
    取得某位使用者的預選清單，一次附上衝堂與學分（預選清單每次變動後，前端呼叫這個重新整理畫面）：
        items      每門課的完整資料，多一個 has_conflict（是否和清單內其他課衝堂）
        conflicts  衝堂配對與重疊節次
        credits    必修、選修、總學分，以及是否落在 9~25 學分
    """
    items = []
    for (cid,) in app_conn.execute(
            "SELECT course_id FROM wishlist WHERE user_id = ? ORDER BY id", (user_id,)).fetchall():
        course = get_course(courses_conn, cid)
        if course:                                # 課程已不存在（被移除）的就略過
            items.append(course)
    ids = [c["id"] for c in items]
    conflicts = find_conflicts(courses_conn, ids)
    in_conflict = {x for pair in conflicts for x in (pair["course_a"], pair["course_b"])}
    for c in items:
        c["has_conflict"] = c["id"] in in_conflict
    return {"items": items, "conflicts": conflicts, "credits": calc_credits(courses_conn, ids)}


def list_buildings(app_conn):
    """取得所有大樓與地圖座標（前端畫地圖標記用）。"""
    return [dict(r) for r in app_conn.execute(
        "SELECT id, name, room_prefix, map_x, map_y FROM buildings ORDER BY id")]


def get_classroom_info(app_conn, classroom_text):
    """
    教室位置查詢（地圖用）。傳入課程的 classroom 文字（可含多間教室），
    回傳每間教室的大樓與地圖座標。has_location=False 代表沒有地圖位置
    （校外實習、論文研究教室、C 開頭等），前端請改成只顯示文字。
    """
    result = []
    for code in parse_classrooms(classroom_text):
        row = app_conn.execute(
            """SELECT c.code, c.room_type, c.floor,
                      b.id AS building_id, b.name AS building_name, b.map_x, b.map_y
               FROM classrooms c LEFT JOIN buildings b ON b.id = c.building_id
               WHERE c.code = ?""",
            (code,),
        ).fetchone()
        info = dict(row) if row else {
            "code": code, "room_type": None, "floor": None,
            "building_id": None, "building_name": None, "map_x": None, "map_y": None,
        }
        info["has_location"] = info["building_id"] is not None
        result.append(info)
    return result


# =====================================================================
# 11. 主程式：重建 → 檢查 → 示範查詢
# =====================================================================

def main():
    # Windows 的主控台遇到少數罕見字會出錯，改成印不出來的字用 ? 代替（資料庫本身不受影響）
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    s = rebuild_all()
    print(f"重建完成：課程 {s['courses']} 筆、上課時段 {s['timeslots']} 筆")
    print(f"管理者做過的事：新增 {s['added']} 門、刪除 {s['deleted']} 門、改欄位 {s['overrides_applied']} 筆，已套用回來")
    print(f"app.db：大樓 {s['buildings']} 棟、教室對照 {s['classrooms']} 間")
    print(f"courses.db 位置：{DB_PATH}")
    print(f"app.db 位置：{APP_DB_PATH.resolve()}")
    if "backup" in s:
        print(f"舊資料庫已備份為 {s['backup']}")
    for p in s["override_problems"]:
        print("【注意】", p)
    if s["time_mismatch"]:
        print(f"【注意】{len(s['time_mismatch'])} 門課的上課時間文字與時段表不一致：{s['time_mismatch'][:5]}")
    if s["orphan_wishlist"]:
        print(f"【注意】預選清單裡有 {len(s['orphan_wishlist'])} 門課已經不在課程資料裡：{s['orphan_wishlist'][:5]}")

    from init_app_db import get_app_connection
    conn, app_conn = get_connection(), get_app_connection()
    try:
        # ---- 示範 1：查「週二」的「必修」課，第 1 頁 ----
        page = search_courses(conn, course_type="必修", weekday=2, page_size=5)
        print(f"\n[查詢示範] 週二必修課，共 {page['total']} 筆，第 1 頁：")
        for c in page["items"]:
            print(f"  {c['name']}｜{c['class_name']}｜{c['time_text']}｜{c['classroom']}")

        # ---- 示範 2：教室位置（地圖用）----
        if page["items"]:
            room_text = page["items"][0]["classroom"]
            print(f"\n[教室位置] {room_text} ->", get_classroom_info(app_conn, room_text))

        # ---- 示範 3：衝堂檢查與學分計算（拿剛查到的課當作預選清單）----
        ids = [c["id"] for c in page["items"]]
        print("\n[衝堂檢查]", find_conflicts(conn, ids) or "沒有衝堂")
        print("[學分計算]", calc_credits(conn, ids))
    finally:
        conn.close()
        app_conn.close()


if __name__ == "__main__":
    main()
