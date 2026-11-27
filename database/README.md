# 北護多課程整合與預選課模擬系統：資料庫

把國立臺北護理健康大學「課程查詢系統」匯出的課程資料整理成 JSON，
用 Python 內建的 `sqlite3` 建立兩個 SQLite 資料庫，並提供查詢函式給後端使用。

- 學期：115-1
- 課程資料：課程 1,237 筆、上課時段 1,358 筆
- 對應專案：《北護多課程整合與預選課模擬系統》需求分析書

---

## 兩個資料庫，各管各的

| 資料庫 | 放什麼 | 執行 `build_db.py` 時 |
| --- | --- | --- |
| `courses.db` | 課程主表 `courses`、上課時段表 `course_timeslots` | **會重建** |
| `backend/data/app.db` | 多位使用者的帳號、各自的預選清單、管理者做過的修改、大樓與教室對照 | **不會清空**（只補齊資料表、更新大樓與教室對照） |

管理者在網站上新增、修改、刪除的課程，都會記在 `app.db`，
重建 `courses.db` 之後，`build_db.py` 會自動把它們套用回來，所以不會消失。

---

## 檔案結構

```
build_db.py            重建 courses.db、套用管理者的修改、更新大樓與教室、各種查詢與管理函式
init_app_db.py         建立 / 檢查 app.db（build_db.py 會自動呼叫，兩個檔案要放在一起）
courses.json           課程資料（一門課一筆）
course_timeslots.json  上課時段資料（一個時段一筆）
courses.db             已建好的課程資料庫
backend/data/app.db    已建好的使用者資料庫（users、wishlist 等是空表）
map_check.png          地圖座標比對圖（見「教室與地圖」）
```

執行後可能會多出：`courses.db.bak`（上一份 courses.db 的備份，只留最近一份，不需要上傳 GitHub）。

---

## 環境需求

- Python 3.8 以上，SQLite 3.24 以上（一般安裝的 Python 都符合，不夠新時程式會提示）
- 不需要安裝任何套件（`sqlite3`、`json` 都是內建）

---

## 使用方式

### 建立 / 重建資料庫

```bash
python build_db.py
```

依序做這幾件事：

1. 檢查 `backend/data/app.db`：沒有就建立，有就保留（舊版 `app.db` 會自動補上新的資料表）
2. 在 `courses.new.db` 建立全新的課程資料庫並匯入兩份 JSON
3. 套用管理者做過的事：加回新增的課、再刪掉刪除的課、套用改過的欄位
4. 更新 `app.db` 的 `buildings`、`classrooms`
5. 全部成功後，才把舊的 `courses.db` 備份成 `courses.db.bak` 並換成新的

**中途失敗時，舊的 `courses.db` 不會被動到。** 執行完會印出 `courses.db` 與 `app.db` 的完整路徑，可以確認放對位置。

注意：

- 重建前請先**關閉後端**，Windows 上被開啟的資料庫檔案無法被取代，程式會提示你。
- `app.db` 想放別的位置：設定環境變數 `APP_DB_PATH`，或直接改 `init_app_db.py` 裡的 `APP_DB_PATH`。
- 只想建立 / 檢查 `app.db`：`python init_app_db.py`。

### 查看資料

`.db` 是二進位檔，可以用 VS Code 擴充套件 **SQLite Viewer** 或 **DB Browser for SQLite** 開啟。

---

## 管理者新增、修改、刪除課程（後端要這樣做）

後端處理管理者的課程操作時，請呼叫下面三個函式，**不要自己直接改 `courses.db`**
（直接改的話，下次重建後那些修改會不見）。

```python
from build_db import (get_connection, admin_create_course,
                      admin_update_course, admin_delete_course)
from init_app_db import get_app_connection

courses_conn, app_conn = get_connection(), get_app_connection()

# 新增：回傳新課程（id 自動產生，格式 A00001）
course = admin_create_course(courses_conn, app_conn, {
    "name": "新課程", "semester": "115-1", "department": "資訊管理系",
    "credits": 2, "course_type": "選修", "time_text": "二 3-4", "classroom": "F601",
}, admin_user_id=1)

# 修改：只傳要改的欄位
course = admin_update_course(courses_conn, app_conn, "10674857",
                             {"classroom": "G209", "teachers": "王小明"}, admin_user_id=1)

# 刪除：同時從所有學生的預選清單移除，回傳移除了幾筆
result = admin_delete_course(courses_conn, app_conn, "10674857", admin_user_id=1)
# {"deleted": "10674857", "removed_from_wishlists": 2}
```

| 函式 | 做了什麼 | 記在 app.db 哪裡 |
| --- | --- | --- |
| `admin_create_course` | 新增課程（`name`、`semester`、`department`、`credits`、`course_type` 必填） | `added_courses` |
| `admin_update_course` | 修改欄位；改 `time_text` 時，上課時段表一起重算 | `course_overrides` |
| `admin_delete_course` | 刪除課程與時段，並從所有預選清單移除；來源資料的課會記下來，重建時不會復活 | `deleted_courses` |

- 欄位不合法會丟 `ValueError`、找不到課程丟 `LookupError`，這兩種情況兩個資料庫都不會被改動。
- 可修改的欄位：`course_no`、`name`、`semester`、`department`、`division`、`grade`、`class_name`、
  `teachers`、`credits`、`course_type`（只能是 `必修` / `選修`）、`time_text`（格式：`二 3-4、四 1,6-7`）、
  `classroom`、`enrolled`、`summary`、`restriction`。
- `courses.db` 和 `app.db` 是兩個不同的檔案，沒辦法保證百分之百同時成功。`app.db` 先提交、`courses.db` 後提交：
  `app.db` 提交失敗（例如被鎖住）時兩邊一起還原；極少見的情況是 `courses.db` 最後才失敗，錯誤會丟出來，
  `app.db` 的紀錄會留著，下次重建時套用。

---

## 預選清單（每位使用者各自一份）

`wishlist` 用 `user_id` 綁定 `users.id`。後端取得登入者的 id（例如 `req.user.id`）後，傳給下面的函式：

```python
from build_db import (get_connection, add_to_wishlist, remove_from_wishlist,
                      clear_wishlist, get_wishlist_summary)
from init_app_db import get_app_connection

courses_conn, app_conn = get_connection(), get_app_connection()
user_id = 5                                              # 登入者的 users.id

add_to_wishlist(courses_conn, app_conn, user_id, "10674857")    # True=新加入，False=本來就在
remove_from_wishlist(app_conn, user_id, "10674857")             # True=有移除
clear_wishlist(app_conn, user_id)                               # 回傳清掉幾筆
summary = get_wishlist_summary(courses_conn, app_conn, user_id)
# summary["items"]      每門課完整資料，另有 has_conflict（是否衝堂）
# summary["conflicts"]  衝堂配對與重疊節次
# summary["credits"]    {"required": .., "elective": .., "total": .., "in_range": ..}（是否落在 9~25 學分）
```

課程或使用者不存在時，`add_to_wishlist` 會丟 `LookupError`。

---

## app.db 資料表

### `users`（多位使用者的帳號，空表）

| 欄位名稱 | 存什麼 | 例子 | 規則 |
| --- | --- | --- | --- |
| `id` | 每個人的編號 | 1、2、3 | 自動加 1，不用自己填 |
| `username` | 登入帳號 | s1234567、admin01 | 必填，不能重複 |
| `password_hash` | 加密後的密碼 | 一長串亂碼 | 必填，不是存原本的密碼 |
| `role` | 身分 | student 或 admin | 只能是這兩種 |
| `is_active` | 帳號能不能用 | 1 = 可以，0 = 停用 | 預設是 1 |
| `must_change_password` | 下次登入要不要先改密碼 | 1 = 要，0 = 不用 | 預設是 0；管理者重設密碼後由後端設為 1，使用者改完密碼後改回 0 |
| `created_at` | 建立時間 | 2026-11-24 10:00:00 | 自動填（使用執行程式那台電腦的時間） |

密碼的加密（hash）要由後端處理，資料庫只負責存。`username` 區分大小寫（`S1234567` 和 `s1234567` 會是兩個帳號）。

### `wishlist`（學生預選清單）

| 欄位 | 說明 |
| --- | --- |
| `id` | 自動編號 |
| `user_id` | 綁定 `users.id`；使用者被刪除時，他的預選清單一併刪除 |
| `course_id` | 對應 `courses.db` 的 `courses.id` |
| `added_at` | 加入時間（自動填） |

同一位使用者不能重複加入同一門課（`user_id` + `course_id` 唯一）。
`course_id` 在另一個資料庫，沒辦法設外鍵，所以刪除課程請用 `admin_delete_course()`，它會一併清掉預選清單。

### `course_overrides`（管理者修改過的課程欄位）

| 欄位 | 說明 |
| --- | --- |
| `course_id` | 哪門課 |
| `field_name` | 改了哪個欄位（`courses` 的欄位名） |
| `new_value` | 改成什麼（文字；NULL = 清空） |
| `updated_by` | 哪位管理者改的（`users.id`；該帳號被刪除時變 NULL，紀錄保留） |
| `updated_at` | 修改時間（自動填） |

同一門課同一個欄位只留最新一筆。重建時如果某筆修改套用不了（例如欄位值不合法、課程已不存在），
只會警告並略過，**不會中斷，也不會刪除那筆紀錄**。

### `added_courses`、`deleted_courses`（管理者新增、刪除的課程）

| 資料表 | 欄位 |
| --- | --- |
| `added_courses` | `seq`（自動編號）、`course_id`（新課程的 id，A00001 這種格式）、`data`（課程欄位，JSON 文字）、`created_by`、`created_at` |
| `deleted_courses` | `course_id`（被刪除的課程 id）、`deleted_by`、`deleted_at` |

### `buildings`（校本部大樓）與 `classrooms`（教室對照）

| 資料表 | 欄位 |
| --- | --- |
| `buildings` | `id`（地圖編號 1~14）、`name`、`room_prefix`（教室代號開頭字母，沒有就 NULL）、`map_x`、`map_y`（佔圖片寬、高的百分比） |
| `classrooms` | `code`（教室代號）、`building_id`（找不到大樓就 NULL）、`floor`（樓層，推不出來就 NULL）、`room_type`（`room` 一般教室 / `special` 非一般教室） |

兩張表的內容由 `build_db.py` 依規則產生，每次重建都會重新計算。

---

## courses.db 資料表

### `courses`（課程主表）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | TEXT，主鍵 | 系統序號（唯一識別碼）；管理者新增的課是 `A00001` 這種格式 |
| `course_no` | TEXT | 課號（見「資料注意事項」） |
| `name` | TEXT | 課程名稱 |
| `semester` | TEXT | 學期，例如 `115-1` |
| `department` | TEXT | 開課系所 |
| `division` | TEXT | 部別（日間部 / 進修部(夜間部)） |
| `grade` | INTEGER | 年級（少數課程為空） |
| `class_name` | TEXT | 開課班級 |
| `teachers` | TEXT | 授課教師（多位以「、」分隔） |
| `credits` | INTEGER | 學分 |
| `course_type` | TEXT | 必選修（`必修` / `選修`） |
| `time_text` | TEXT | 上課時間（顯示用，例如 `二 3-4`） |
| `classroom` | TEXT | 教室（多間以「、」分隔，例如 `F414、I303`） |
| `enrolled` | INTEGER | 修課人數 |
| `summary` | TEXT | 課程摘要 |
| `restriction` | TEXT | 修課限制 |

### `course_timeslots`（上課時段表）

一門課可以有多個時段，例如週一 1-4 節、週二 1-4 節就是兩筆。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | INTEGER，主鍵 | 自動編號 |
| `course_id` | TEXT，外鍵 | 對應 `courses.id`，課程刪除時一併刪除 |
| `weekday` | INTEGER | 星期（1=一 … 7=日） |
| `start_period` | INTEGER | 起始節次 |
| `end_period` | INTEGER | 結束節次 |

---

## 教室與地圖

### 大樓與座標（`BUILDING_MAP`，在 `build_db.py` 裡）

| 編號 | 大樓 | 教室開頭 | map_x | map_y |
| --- | --- | --- | --- | --- |
| 1 | 親仁樓 | B | 76.5 | 33.5 |
| 2 | 行政大樓 | — | 72.5 | 48.0 |
| 3 | 科技大樓 | S | 66.5 | 58.0 |
| 4 | 圖書館 | — | 56.5 | 51.5 |
| 5 | 教學大樓 | G | 58.5 | 40.5 |
| 6 | 學思樓 | F | 43.5 | 36.5 |
| 7 | 體育館 | — | 26.5 | 40.0 |
| 8 | 明倫館 | — | 25.5 | 45.5 |
| 9 | 宿舍-蕙質樓 | — | 23.5 | 52.5 |
| 10 | 學生餐廳 | — | 20.5 | 56.0 |
| 11 | 宿舍-蘭心樓 | — | 21.5 | 61.5 |
| 12 | 宿舍-爾雅樓 | — | 17.0 | 44.0 |
| 13 | 水療中心 | — | 11.0 | 50.5 |
| 14 | 樂育樓 | I（含 IB） | 10.5 | 63.0 |

**座標提醒**：上表是專案指定的座標。拿它們畫在校本部地圖圖片上（見 `map_check.png`，紅點）會發現
約一半落在大樓外面，尤其左半邊的 7～14 號，最大差 9.3 個百分點。
`build_db.py` 裡另外放了從圖片量出 14 個編號圓圈中心的實測值（`MEASURED_COORDS`，圖上藍圈），
如果前端用的就是那張地圖圖片，把 `USE_MEASURED_COORDS` 改成 `True` 再重建即可。

### 教室代號怎麼解析

| 輸入 | 結果 |
| --- | --- |
| `F414、I303` | 拆成 `F414`、`I303` 兩間 |
| `校外實習、校外實習` | 重複的只留一個 → `校外實習` |
| `F601` | 學思樓、6 樓 |
| `IB01`、`IB02` | 歸屬樂育樓（I），樓層推不出來（NULL） |
| `C303`、`C407` 之類 C 開頭 | 保留代號，`building_id` 為 NULL（沒有對應的大樓） |
| `校外實習`、`論文研究教室`、`體育教室`、`其他` | 保留原字串，`room_type = special`，沒有大樓 |

目前 121 個教室裡，115 個找得到大樓位置，6 個找不到（C303、C407 和上面 4 個非一般教室）。
樓層是用代號第一個數字推算的（`F601` → 6 樓，與需求書畫面一致）；其他大樓是依同樣規則推測。
前端畫地圖時，`has_location = False` 的教室請只顯示文字，不要標地圖。

---

## 課程查詢函式（給後端使用）

所有函式都定義在 `build_db.py`，回傳 `dict` 或 `list`，可以直接轉成 JSON。

| 函式 | 用途 |
| --- | --- |
| `get_connection()` | 取得 `courses.db` 連線（已開啟外鍵檢查） |
| `init_app_db.get_app_connection()` | 取得 `app.db` 連線 |
| `search_courses(conn, ...)` | 課程查詢：依學期、系所、年級、必選修、部別、星期、關鍵字篩選，分頁 |
| `get_course(conn, course_id)` | 單一課程完整資料，含摘要、修課限制與所有上課時段 |
| `find_conflicts(conn, course_ids)` | 衝堂檢查：回傳時間重疊的課程配對 |
| `calc_credits(conn, course_ids)` | 必修、選修、總學分，以及是否落在 9～25 學分 |
| `list_departments(conn, semester)` | 開課系所清單（下拉選單用） |
| `list_buildings(app_conn)` | 所有大樓與地圖座標 |
| `get_classroom_info(app_conn, classroom_text)` | 教室位置：每間教室的大樓、樓層、座標、`has_location` |
| `admin_create_course` / `admin_update_course` / `admin_delete_course` | 管理者新增 / 修改 / 刪除課程（見上面） |
| `add_to_wishlist` / `remove_from_wishlist` / `clear_wishlist` / `get_wishlist_summary` | 預選清單（見上面） |
| `parse_classrooms()`、`resolve_classroom()` | 教室文字拆解與判斷 |
| `parse_time_text()`、`format_time_text()` | 上課時間文字與時段互相轉換 |

### 串接後端的注意事項

- 每次處理請求時各自取得一次連線，用完關閉，不要在多個執行緒間共用同一個連線。
- 查詢條件一律使用 `?` 參數帶入，不要自己用字串拼接 SQL。

---

## 資料注意事項

這份資料來自學校課程查詢系統的匯出檔，原始檔有一些問題，整理後仍會保留：

1. **課號有約三分之一已損毀**：原始檔被 Excel 轉成科學記號（例如 `1.15141140185901E+17`），後面幾碼已遺失、無法還原。因此 `course_no` 不保證唯一，請用 `id`（系統序號）當識別碼。
2. **少數字元是亂碼**：部分教師姓名含 `?`（原始檔就已是亂碼），有 3 筆課程摘要含 `□`（罕用造字無法解碼）。
3. **2 門校外實習課沒有上課時間**：它們在 `course_timeslots` 裡沒有資料。
4. **`restriction`（修課限制）取自原始檔的「備註」欄**：多數是修課限制，少數是一般說明。
5. **`summary`（課程摘要）取自原始檔的「課程大綱」欄**：原始的「課程摘要」欄是空的。
6. **教室重複值已在匯入時清掉**：`courses.json` 與 CSV 裡仍有「校外實習、校外實習」這類重複，匯入 `courses.db` 時會整理成 `校外實習`。

---

## 尚未包含的部分

- 登入驗證、`req.user.id` 這類的後端程式（本專案只提供資料表與資料庫函式）；登入狀態（session / token）要存在哪裡，要看後端的做法
- 管理者「還原已刪除的課程」的功能（目前刪除後，要從 `deleted_courses` 移除那筆紀錄才會在下次重建時回來）
- 匯入紀錄資料表
- `users` 目前只有登入需要的 7 個欄位，需求書提到的姓名、電子郵件、系所、最後登入時間等尚未加入
