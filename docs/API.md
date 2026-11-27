# 後端 API 說明（給前端）

## 基本規則

- 所有 API 都在 `/api` 底下，資料格式是 JSON。
- 登入用 cookie（`sid`），瀏覽器會自動帶。用 `fetch` 時要加 `credentials: 'include'`：

  ```js
  fetch('/api/auth/me', { credentials: 'include' })
  ```

- 除了 `health`、`login`、`logout`，**其他 API 都要先登入**，沒登入會回 401。
- 登入狀態 2 小時後過期。

## 錯誤格式

所有錯誤都長這樣：

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "帳號或密碼錯誤" } }
```

**請用 `code` 判斷要做什麼，`message` 只拿來顯示給使用者看。** `message` 的文字之後可能會改，`code` 不會改。

| HTTP 狀態碼 | code | 意思 | 前端建議 |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | 參數格式錯誤 | 顯示 `message` |
| 400 | `INVALID_JSON` | 送出的 JSON 格式壞掉 | 檢查程式 |
| 400 | `WRONG_PASSWORD` | 變更密碼時，目前的密碼打錯 | 顯示在「目前的密碼」欄位 |
| 400 | `WEAK_PASSWORD` | 新密碼太短，或跟目前的密碼一樣 | 顯示在「新密碼」欄位 |
| 400 | `CANNOT_MODIFY_SELF` | 管理者想停用自己或重設自己的密碼 | 顯示 `message` |
| 401 | `INVALID_CREDENTIALS` | 帳號或密碼錯誤 | 顯示在登入表單 |
| 401 | `NOT_LOGGED_IN` | 沒登入 | 跳到登入頁 |
| 401 | `SESSION_EXPIRED` | 登入已逾時 | 提示「登入已逾時」，再跳到登入頁 |
| 401 | `ACCOUNT_DISABLED` | 帳號被管理者停用 | 提示後跳到登入頁 |
| 403 | `FORBIDDEN` | 沒有權限（例如學生打管理者 API） | 顯示沒有權限 |
| 404 | `NOT_FOUND` | 找不到資料 | 顯示找不到 |
| 404 | `API_NOT_FOUND` | 網址打錯 | 檢查程式 |
| 409 | `USERNAME_TAKEN` | 新增帳號時，帳號已經有人用（不分大小寫） | 顯示在「帳號」欄位 |
| 413 | `PAYLOAD_TOO_LARGE` | 送出的資料太大 | 檢查程式 |
| 429 | `ACCOUNT_LOCKED` | 同一個帳號登入失敗太多次 | 用 `retry_after` 顯示倒數 |
| 429 | `TOO_MANY_REQUESTS` | 同一個 IP 登入失敗太多次，或變更密碼時目前的密碼錯太多次 | 用 `retry_after` 顯示倒數 |
| 500 | `INTERNAL_ERROR` | 伺服器錯誤 | 顯示「系統錯誤，請稍後再試」 |

429 會多一個 `retry_after` 欄位，代表還要等幾秒：

```json
{ "error": { "code": "ACCOUNT_LOCKED", "message": "嘗試次數過多，請稍後再試", "retry_after": 842 } }
```

---

## 登入

### `POST /api/auth/login` 登入

```json
{ "username": "student", "password": "your-password" }
```

- 帳號最多 50 字，密碼最多 72 bytes（中文一個字算 3 bytes），超過回 400。
- 帳號不存在、密碼錯誤、帳號被停用，都回 `INVALID_CREDENTIALS`。
- 同一個帳號 15 分鐘內失敗 5 次，會被鎖 15 分鐘（`ACCOUNT_LOCKED`）。

成功：

```json
{
  "ok": true,
  "user": { "id": 2, "username": "student", "role": "student", "must_change_password": false }
}
```

- `role`：`"student"` 或 `"admin"`
- `must_change_password` 為 `true` 時，請導到變更密碼頁（`PUT /api/auth/password`）

### `POST /api/auth/logout` 登出

不用帶 body。回傳 `{ "ok": true }`。

### `GET /api/auth/me` 目前登入的使用者

```json
{ "id": 2, "username": "student", "role": "student", "must_change_password": false }
```

可以在頁面載入時呼叫，判斷使用者有沒有登入：回 200 是已登入，回 401 是沒登入。

### `PUT /api/auth/password` 變更自己的密碼

```json
{ "current_password": "old-password", "new_password": "new-password" }
```

- 只能改目前登入的人自己的密碼，body 裡帶別人的 id 或帳號都沒有用。
- 新密碼至少 8 個字（中文一個字算 1 個字）、最多 72 bytes，而且不能跟目前的密碼一樣，不符合回 `WEAK_PASSWORD`。
- 目前的密碼打錯回 `WRONG_PASSWORD`（是 400，不是 401，不用跳登入頁）。
- 目前的密碼 15 分鐘內錯 5 次會被擋 15 分鐘（`TOO_MANY_REQUESTS`，有 `retry_after`）。格式錯誤不算次數。

成功回傳 `{ "ok": true }`，並且：

- 這個瀏覽器保持登入（後端會換一個新的 cookie，瀏覽器會自動更新，前端不用處理）。
- **同一個帳號在其他裝置、其他瀏覽器的登入會被登出。**
- `must_change_password` 會變成 `false`，可以把使用者導回首頁。

---

## 課程

### `GET /api/courses/semesters` 學期清單

新的學期排在前面，可以拿來做學期下拉選單，第一個當預設值。

```json
["115-1"]
```

### `GET /api/courses/departments?semester=115-1` 系所清單

`semester` 一定要帶。

```json
["生死與健康心理諮商系", "資訊管理系", "..."]
```

### `GET /api/courses` 查詢課程

| 參數 | 必填 | 說明 |
|---|---|---|
| `semester` | ✓ | 學期，例如 `115-1` |
| `keyword` | | 搜尋課名、老師、課號 |
| `department` | | 系所，用 `/departments` 回傳的值 |
| `course_type` | | `必修` 或 `選修` |
| `grade` | | 年級 1～7 |
| `division` | | 學制，例如 `日間部` |
| `weekday` | | 星期幾上課，1～7（1 是星期一） |
| `page` | | 第幾頁，預設 1 |
| `page_size` | | 一頁幾筆，預設 10，最多 50 |

範例：`/api/courses?semester=115-1&keyword=統計&weekday=2&page=1&page_size=10`

中文參數要用 `encodeURIComponent` 或 `URLSearchParams` 轉碼。

```json
{
  "total": 37,
  "page": 1,
  "page_size": 10,
  "items": [
    {
      "id": "10674857",
      "course_no": "1151331401078012A0",
      "name": "人文與社會科學統計",
      "department": "生死與健康心理諮商系",
      "class_name": "生四二A",
      "teachers": "陳伯瑋",
      "credits": 2,
      "course_type": "必修",
      "time_text": "二 3-4",
      "classroom": "F602",
      "enrolled": 60
    }
  ]
}
```

總頁數可以用 `Math.ceil(total / page_size)` 算。

### `GET /api/courses/:id` 單一課程

除了查詢結果裡的欄位，還多了課程大綱、修課限制和上課時段：

```json
{
  "id": "10674857",
  "course_no": "1151331401078012A0",
  "name": "人文與社會科學統計",
  "semester": "115-1",
  "department": "生死與健康心理諮商系",
  "division": "日間部",
  "grade": 2,
  "class_name": "生四二A",
  "teachers": "陳伯瑋",
  "credits": 2,
  "course_type": "必修",
  "time_text": "二 3-4",
  "classroom": "F602",
  "enrolled": 60,
  "summary": "介紹統計學的各項基本概念……",
  "restriction": "本系四技一般生二年級以上、程式設計課程",
  "timeslots": [
    { "weekday": 2, "start_period": 3, "end_period": 4 }
  ]
}
```

- `timeslots` 是拆好的上課時間，畫課表時用這個，不要自己解析 `time_text`。
- 一門課可能有好幾個時段，也可能完全沒有（例如實習課），沒有時是空陣列。
- 找不到課程回 404 `NOT_FOUND`。

### `GET /api/courses/compare?ids=A,B,C` 課程比較

> ⚠️ 還在 `feature/course-compare` 分支，尚未合併。

- 一次比較 1～5 門課，用逗號隔開。
- 照傳入的順序回傳，重複的 id 只算一次。
- 每門課的欄位跟 `/api/courses/:id` 一樣。
- 找不到的 id 放在 `not_found`，不會讓整個請求失敗。

```json
{
  "items": [ { "id": "10674857", "name": "人文與社會科學統計", "...": "...", "timeslots": [] } ],
  "not_found": ["nope123"]
}
```

---

## 教室地圖

> ⚠️ 還在 `feature/room-map` 分支，尚未合併。

### `GET /api/rooms/buildings` 所有大樓

```json
[
  { "id": 6, "name": "學思樓", "room_prefix": "F", "map_x": 43.5, "map_y": 36.5 }
]
```

`map_x`、`map_y` 是大樓在地圖上的位置（看起來是 0～100 的百分比，詳細請跟資料組確認）。

### `GET /api/rooms?codes=F602、I303` 一次查多間教室

- 最多 10 間，可以用 `、` `,` `，` `;` `；` `/` 分隔。
- 可以直接把課程的 `classroom` 欄位丟進來。

```json
{
  "items": [
    {
      "code": "F602", "room_type": "room", "floor": 6,
      "building_id": 6, "building_name": "學思樓", "map_x": 43.5, "map_y": 36.5,
      "has_location": true
    }
  ]
}
```

`room_type` 是 `room`（一般教室）或 `special`（特殊教室）。

**查不到位置的教室也會回傳**，只是 `has_location` 是 `false`、位置欄位是 `null`。這種教室只要顯示文字就好，不要標在地圖上。

### `GET /api/rooms/:code` 單一教室

欄位跟上面一樣。找不到這間教室回 404 `NOT_FOUND`。

---

## 管理者：帳號管理

**只有 `role` 是 `admin` 的人能用**，沒登入回 401，學生回 403 `FORBIDDEN`。

帳號資料長這樣（不會回傳密碼）：

```json
{
  "id": 3,
  "username": "stu1",
  "role": "student",
  "is_active": true,
  "must_change_password": false,
  "created_at": "2026-11-27 08:30:00"
}
```

`created_at` 是 UTC 時間，顯示前要轉成台灣時間（+8 小時）。

### `GET /api/admin/users` 帳號清單

| 參數 | 說明 |
|---|---|
| `role` | `student` 或 `admin`，不給就全部 |
| `is_active` | `true` 或 `false`，不給就全部 |
| `keyword` | 帳號包含這段文字 |
| `page` | 第幾頁，預設 1 |
| `page_size` | 每頁幾筆，預設 20，最多 100 |

回傳 `{ "total": 3, "page": 1, "page_size": 20, "items": [帳號, ...] }`，依 `id` 排序。

### `POST /api/admin/users` 新增帳號

```json
{ "username": "stu3", "password": "first-password", "role": "student" }
```

- 帳號只能用英文、數字和 `.` `_` `-`，最多 50 字，前後空白會自動去掉。
- 帳號已經存在回 409 `USERNAME_TAKEN`，**不分大小寫**（有 `stu1` 就不能再建 `STU1`）。
- 密碼規則跟變更密碼一樣：至少 8 個字、最多 72 bytes。
- 成功回 **201** 和新的帳號資料。新帳號的 `must_change_password` 是 `true`，第一次登入會被要求改密碼。

### `PATCH /api/admin/users/:id` 停用／啟用帳號

```json
{ "is_active": false }
```

- `is_active` 一定要是 `true` 或 `false`（布林值，不是字串）。
- 停用後，這個人在所有裝置**馬上被登出**，也不能再登入。
- 回傳更新後的帳號資料。

### `POST /api/admin/users/:id/reset-password` 重設密碼

```json
{ "new_password": "temp-password" }
```

- 給忘記密碼的人一個臨時密碼，規則跟變更密碼一樣。
- 重設後，這個人在所有裝置被登出，下次登入 `must_change_password` 是 `true`。
- 成功回傳 `{ "ok": true }`。

**這兩支 API 共同的規則**

- `:id` 不是正整數回 400，找不到這個帳號回 404 `NOT_FOUND`。
- 管理者不能停用自己，也不能用這支重設自己的密碼，會回 400 `CANNOT_MODIFY_SELF`。自己的密碼請用 `PUT /api/auth/password`。

---

## 還沒做的 API

- 管理者：課程新增、修改、刪除

完成後會再更新這份文件。
