# 北護多課程整合與預選課模擬系統：課程資料庫

這個專案把國立臺北護理健康大學「課程查詢系統」匯出的課程資料，整理成 JSON，
並用 Python 內建的 `sqlite3` 建立 SQLite 資料庫，提供查詢函式給後端使用。

- 學期：115-1
- 資料量：課程 1,237 筆、上課時段 1,358 筆
- 對應專案：《北護多課程整合與預選課模擬系統》需求分析書

---

## 檔案說明

| 檔案 | 說明 |
| --- | --- |
| `build_db.py` | 建立資料庫、匯入 JSON、提供查詢函式（主程式） |
| `courses.json` | 課程資料（一門課一筆） |
| `course_timeslots.json` | 上課時段資料（一個時段一筆，衝堂檢查用） |
| `courses.db` | 執行 `build_db.py` 後產生的 SQLite 資料庫 |

---

## 環境需求

- Python 3.8 以上
- 不需要安裝任何套件（`sqlite3`、`json` 都是 Python 內建）

---

## 使用方式

### 1. 建立資料庫

把 `build_db.py`、`courses.json`、`course_timeslots.json` 放在同一個資料夾，執行：

```bash
python build_db.py
```

成功時會看到：

```
匯入完成：課程 1237 筆、上課時段 1358 筆，外鍵檢查通過
```

同一個資料夾會產生 `courses.db`。

> 注意：每次執行都會刪除舊的 `courses.db` 並重新建立。

### 2. 查看資料

`courses.db` 是二進位檔，不能直接用文字編輯器開啟。可以用：

- VS Code 擴充套件 **SQLite Viewer**
- 免費軟體 **DB Browser for SQLite**

### 3. 在 Python 中查詢

```python
from build_db import get_connection, search_courses

conn = get_connection()
result = search_courses(conn, keyword="資訊", page_size=5)

print("共", result["total"], "筆")
for c in result["items"]:
    print(c["name"], c["class_name"], c["time_text"])

conn.close()
```

---

## 資料表結構

欄位使用英文命名，方便後端程式使用。

### `courses`（課程主表）

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | TEXT，主鍵 | 系統序號（唯一識別碼） |
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
| `classroom` | TEXT | 教室 |
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

兩張表是「一對多」關係：`courses.id` ← `course_timeslots.course_id`。

---

## 查詢函式（給後端使用）

所有函式都定義在 `build_db.py`，回傳 `dict` 或 `list`，可以直接轉成 JSON。

| 函式 | 用途 |
| --- | --- |
| `get_connection()` | 取得資料庫連線（已開啟外鍵檢查） |
| `search_courses(conn, ...)` | 課程查詢，可依學期、系所、年級、必選修、部別、星期、關鍵字篩選，支援分頁 |
| `get_course(conn, course_id)` | 取得單一課程完整資料，含摘要、修課限制與所有上課時段 |
| `find_conflicts(conn, course_ids)` | 衝堂檢查：傳入課程 id 清單，回傳時間重疊的課程配對 |
| `calc_credits(conn, course_ids)` | 學分計算：回傳必修、選修、總學分，以及是否落在 9～25 學分 |
| `list_departments(conn, semester)` | 開課系所清單（前端下拉選單用） |

### 使用範例

```python
from build_db import (get_connection, search_courses, get_course,
                      find_conflicts, calc_credits)

conn = get_connection()

# 查詢：日間部、二年級、選修課，第 1 頁（每頁 10 筆）
page = search_courses(conn, division="日間部", grade=2, course_type="選修")
print(page["total"], page["items"][:2])

# 單一課程詳細資料
course = get_course(conn, "10674857")
print(course["name"], course["timeslots"])

# 預選課程：衝堂檢查與學分計算
selected = ["10674857", "10674863"]
print(find_conflicts(conn, selected))   # 有重疊時回傳配對與重疊節次
print(calc_credits(conn, selected))     # {'required': .., 'elective': .., 'total': .., 'in_range': ..}

conn.close()
```

### 串接後端的注意事項

- 每次處理請求時各自呼叫一次 `get_connection()`，用完關閉，不要在多個執行緒間共用同一個連線。
- 查詢條件一律使用 `?` 參數帶入，不要自己用字串拼接 SQL。

---

## 資料注意事項

這份資料來自學校課程查詢系統的匯出檔，原始檔有一些問題，整理後仍會保留：

1. **課號有約三分之一已損毀**：原始檔被 Excel 轉成科學記號（例如 `1.15141140185901E+17`），後面幾碼已遺失、無法還原。因此 `course_no` 不保證唯一，資料庫主鍵請使用 `id`（系統序號）。如果需要正確課號，需要從學校系統重新匯出，並在 Excel 把課號欄設為文字格式。
2. **少數字元是亂碼**：部分教師姓名含 `?`（原始檔就已是亂碼），有 3 筆課程摘要含 `□`（罕用造字無法解碼）。
3. **2 門校外實習課沒有上課時間**：它們在 `course_timeslots` 裡沒有資料。
4. **`restriction`（修課限制）取自原始檔的「備註」欄**：多數是修課限制，少數是一般說明（例如「第二階段開放全校」）。
5. **`summary`（課程摘要）取自原始檔的「課程大綱」欄**：原始的「課程摘要」欄是空的。

---

## 尚未包含的部分

需求分析書中的使用者帳號、預選清單、匯入紀錄等資料表目前**尚未建立**，
本專案目前只涵蓋課程與上課時段兩張表。
