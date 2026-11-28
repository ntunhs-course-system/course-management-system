// 統一錯誤格式：{ error: { code, message, ...額外欄位 } }
//
// 前端請用 code 判斷要做什麼，message 只拿來顯示給使用者看。
// message 的文字之後可能會改，code 不會改；要新增 code 請加在下面的清單並通知前端。

const ERROR_CODES = {
  // 400 請求內容有問題
  VALIDATION_ERROR: '請求參數格式錯誤',
  INVALID_JSON: 'JSON 格式錯誤',
  WRONG_PASSWORD: '目前的密碼錯誤',
  WEAK_PASSWORD: '新密碼不符合規定',
  // 401 沒登入
  INVALID_CREDENTIALS: '帳號或密碼錯誤',
  NOT_LOGGED_IN: '請先登入',
  SESSION_EXPIRED: '登入已逾時，請重新登入',
  ACCOUNT_DISABLED: '帳號已被停用',
  // 403 沒權限
  FORBIDDEN: '沒有權限',
  // 404 找不到
  NOT_FOUND: '找不到資料',
  API_NOT_FOUND: '找不到這個 API',
  // 413 太大
  PAYLOAD_TOO_LARGE: '傳送的資料太大',
  // 429 次數太多
  ACCOUNT_LOCKED: '嘗試次數過多，請稍後再試',
  TOO_MANY_REQUESTS: '請求次數過多，請稍後再試',
  // 500 伺服器問題
  INTERNAL_ERROR: '伺服器錯誤',
};

function sendError(res, status, code, message, extra = {}) {
  if (!(code in ERROR_CODES)) throw new Error(`未定義的錯誤代碼：${code}`);
  return res.status(status).json({ error: { code, message: message || ERROR_CODES[code], ...extra } });
}

module.exports = { ERROR_CODES, sendError };
