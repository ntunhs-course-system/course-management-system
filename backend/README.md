# 後端（Express）

## 需求

- Node.js 22.13 以上（用到內建的 `node:sqlite`，不用另外裝資料庫）
- 課程資料庫 `courses.db`，由資料組用 `build_db.py` 產生

## 第一次設定

```bash
cd backend
npm install
cp .env.example .env      # 填 SESSION_SECRET 和測試帳號密碼
npm run seed:users        # 建立測試帳號，已存在的帳號不會被改
npm run dev               # http://localhost:3000
```

## 測試

```bash
npm test
```

測試會用暫存的帳號資料庫，不會動到 `data/app.db`。

## 目前的限制

- **登入狀態存在記憶體**：伺服器重開後所有人都要重新登入，也不能同時跑多台伺服器。demo 階段先這樣，之後可以改存到 SQLite。
- **登入次數限制也存在記憶體**：同一個帳號 15 分鐘內失敗 5 次會被擋，同一個 IP 15 分鐘內失敗 100 次會被擋。伺服器重開後次數會歸零。
- 帳號存在 `data/app.db`，不會上傳 GitHub。課程資料在 `courses.db`，`build_db.py` 重建時會整個覆蓋，所以兩個分開放。
