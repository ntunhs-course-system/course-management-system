# 給組員的資料庫交付說明

這份資料包以 `database (2).zip` 為基礎整理，包含原始資料、Python 建庫檔案、Node.js 功能模組及串接文件。

## 第一次使用

1. 將壓縮檔解壓縮到現有專案根目錄，合併 `database/` 資料夾；不要用它取代整個專案。
2. 確認 Python 3.8 以上、Node.js 22.13.0 以上。
3. 關閉正在使用資料庫的後端程式。
4. 在專案根目錄執行：

   ```bash
   python database/build_db.py
   ```

5. 腳本會重建 `database/courses.db`，並在 `backend/data/app.db` 建立／補齊資料表及同步大樓與教室資料。
6. 依 `README-NODE-INTEGRATION.md` 將 CommonJS 模組串接至 Node.js 後端。

## 本包檔案

### database/

- `build_db.py`：Python 建庫程式。`USE_MEASURED_COORDS` 已設為 `True`；重建會匯入課程、時段並套用管理者異動。
- `init_app_db.py`：Python app.db 初始化程式，這次維持原樣。
- `courses.json`：原始課程匯入資料。
- `course_timeslots.json`：原始上課時段匯入資料。
- `courses.db`：已重新建置的課程 SQLite 資料庫。
- `courses.db.bak`：重建前資料庫備份；僅供回復參考，不是執行必要檔。
- `wishlist.js`：預選清單、衝堂檢查、學分計算。
- `admin-courses.js`：管理者新增、修改、刪除課程。
- `classrooms.js`：大樓與教室位置查詢／同步。
- `course-utils.js`：共用欄位驗證、時間與教室解析、資料庫交易工具。
- `errors.js`：統一錯誤類別。
- `README.md`：資料表、欄位、課程資料與模組說明。

### 根目錄文件

- `README-TEAM.md`：本文件，給全組第一次安裝使用。
- `README-NODE-INTEGRATION.md`：Node.js 連線、模組呼叫與錯誤處理範例。
- `.gitignore-additions.txt`：可複製到專案 `.gitignore` 的規則。

## app.db 為什麼不在壓縮包？

`app.db` 會存放使用者帳號、密碼雜湊、預選清單和管理者異動。每位組員應在自己的專案內執行 `build_db.py` 建立自己的 `backend/data/app.db`，不要共用別人的帳號資料，也不要把它提交到 GitHub。

如果你已經有自己的 `app.db`，請先備份；`build_db.py` 設計上會保留既有使用者與預選資料，不會清空它們。

## Git 注意事項

請把 `.gitignore-additions.txt` 的規則加進專案根目錄 `.gitignore`。尤其不要提交 `backend/data/app.db`、其 WAL/SHM 暫存檔，以及資料庫備份檔。

## 本包範圍

本包已提供預選、衝堂、學分、管理者課程異動及教室位置的 Node.js 函式。完整課程搜尋 API（例如關鍵字、系所、年級、分頁查詢）尚未從 Python 移植成 JavaScript；若現有後端尚未實作，需另外整合。
