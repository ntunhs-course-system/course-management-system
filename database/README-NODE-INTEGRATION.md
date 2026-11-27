# Node.js 後端串接說明

本文件對應 `database/` 內的 JavaScript 模組，以及現有 `courses.db` / `backend/data/app.db` 結構。

## 1. 環境需求

- Node.js 22.13.0 以上。
- CommonJS（`require` / `module.exports`）。
- 使用 Node.js 內建 `node:sqlite` 的 `DatabaseSync`。
- 不需要安裝 `sqlite3`、`better-sqlite3` 或額外 SQLite 套件。

## 2. 資料庫路徑

假設後端入口是 `backend/server.js`：

```text
project-root/
├── backend/
│   ├── server.js
│   └── data/
│       └── app.db
└── database/
    ├── courses.db
    ├── wishlist.js
    ├── admin-courses.js
    ├── classrooms.js
    ├── course-utils.js
    └── errors.js
```

## 3. 開啟資料庫並傳入函式

資料庫函式不會自行開啟連線。由後端負責建立連線、啟用外鍵檢查，並於請求完成後關閉：

```js
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const projectRoot = path.resolve(__dirname, '..');
const COURSE_DB_PATH = path.join(projectRoot, 'database', 'courses.db');
const APP_DB_PATH = path.join(projectRoot, 'backend', 'data', 'app.db');

function openDatabases() {
  const courseDb = new DatabaseSync(COURSE_DB_PATH);
  const appDb = new DatabaseSync(APP_DB_PATH);
  courseDb.exec('PRAGMA foreign_keys = ON');
  appDb.exec('PRAGMA foreign_keys = ON');
  return { courseDb, appDb };
}
```

如果後端檔案不在 `backend/server.js`，請依實際位置調整 `projectRoot`。不要在每個資料庫函式內再建立 `DatabaseSync`。

## 4. 預選清單、衝堂與學分

```js
const wishlist = require('../database/wishlist');

const { courseDb, appDb } = openDatabases();
try {
  const added = wishlist.addToWishlist(
    courseDb,
    appDb,
    req.user.id,
    req.params.courseId,
  );

  const summary = wishlist.getWishlistSummary(courseDb, appDb, req.user.id);
  res.json({ added, ...summary });
} catch (error) {
  next(error);
} finally {
  courseDb.close();
  appDb.close();
}
```

可用函式：

| 函式 | 參數 | 回傳 |
| --- | --- | --- |
| `addToWishlist(courseDb, appDb, userId, courseId)` | 已開啟兩份 DB、使用者 ID、課程 ID | `true` 新增成功；`false` 原本已存在 |
| `removeFromWishlist(appDb, userId, courseId)` | app DB、使用者 ID、課程 ID | 是否有移除 |
| `clearWishlist(appDb, userId)` | app DB、使用者 ID | 清除筆數 |
| `findConflicts(courseDb, courseIds)` | course DB、課程 ID 陣列 | 衝堂課程配對與重疊節次 |
| `calcCredits(courseDb, courseIds)` | course DB、課程 ID 陣列 | `{ required, elective, total, in_range }` |
| `getWishlistSummary(courseDb, appDb, userId)` | 兩份 DB、使用者 ID | 預選課程、衝堂、學分摘要 |

`getWishlistSummary` 會略過已不存在的舊課程 ID，避免一筆舊資料使整份清單無法顯示。

## 5. 管理者新增、修改、刪除課程

```js
const adminCourses = require('../database/admin-courses');

const { courseDb, appDb } = openDatabases();
try {
  const created = adminCourses.adminCreateCourse(courseDb, appDb, {
    name: '新課程',
    semester: '115-1',
    department: '資訊管理系',
    credits: 2,
    course_type: '選修',
    time_text: '二 3-4',
    classroom: 'F601',
  }, req.user.id);

  const updated = adminCourses.adminUpdateCourse(
    courseDb,
    appDb,
    created.id,
    { classroom: 'G209', teachers: '王小明' },
    req.user.id,
  );

  const deleted = adminCourses.adminDeleteCourse(
    courseDb,
    appDb,
    created.id,
    req.user.id,
  );
} catch (error) {
  next(error);
} finally {
  courseDb.close();
  appDb.close();
}
```

`adminUserId` 必須是已啟用且 `role = 'admin'` 的 `users.id`。模組內會再次驗證管理者身分；後端 API 仍必須套用登入驗證與管理者 middleware。

管理異動會記錄在 `app.db`：新增寫入 `added_courses`、修改寫入 `course_overrides`、刪除寫入 `deleted_courses`，以便日後重建 `courses.db` 時重套異動。

## 6. 大樓與教室位置

```js
const classrooms = require('../database/classrooms');

const { appDb } = openDatabases();
try {
  const buildings = classrooms.listBuildings(appDb);
  const roomInfo = classrooms.getClassroomInfo(appDb, 'F405、G209');
  res.json({ buildings, roomInfo });
} finally {
  appDb.close();
}
```

`has_location: false` 代表沒有對應大樓座標，前端應只顯示教室文字，不應放地圖標記。

## 7. 錯誤處理

模組使用以下錯誤類別：

| 錯誤 | 情況 | 建議 HTTP 狀態 |
| --- | --- | ---: |
| `ValidationError` | 輸入格式、必填欄位或欄位值不合法 | 400 |
| `NotFoundError` | 課程或使用者不存在 | 404 |
| `AuthorizationError` | 未提供管理者 ID、帳號停用或不是管理者 | 403 |

可在後端集中處理：

```js
const { ValidationError, NotFoundError, AuthorizationError } =
  require('../database/errors');

app.use((error, req, res, next) => {
  if (error instanceof ValidationError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof NotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  if (error instanceof AuthorizationError) {
    return res.status(403).json({ error: error.message });
  }
  return next(error);
});
```

## 8. 注意事項

1. `build_db.py` 和 `init_app_db.py` 維持 Python；它們負責建庫與資料匯入，不需要改成 JavaScript。
2. Node.js 模組只接收後端傳入、已開啟的資料庫連線，不會自行開啟或關閉資料庫。
3. 管理者異動應透過 `admin-courses.js`，不要由後端直接改 `courses.db`，否則下次執行 `build_db.py` 時修改可能消失。
4. `app.db` 與 `courses.db` 是兩個不同檔案，無法保證跨檔案交易百分之百原子化。模組依原 Python 設計先提交 `app.db` 再提交 `courses.db`；發生極少見的第二階段提交失敗時，請依日誌及重建流程處理。
5. 本次 JavaScript 模組涵蓋預選、衝堂、學分、管理者課程異動及教室位置；完整課程搜尋 API（例如 `search_courses`、`list_departments`）仍需依現有 Node.js 後端實作或另行移植，並未在本包宣稱已完成。
