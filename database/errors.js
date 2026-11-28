'use strict';

/** 使用者輸入格式錯誤、欄位不合法或參數型別不正確。 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'VALIDATION_ERROR';
  }
}

/** 指定的課程或使用者不存在。 */
class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.code = 'NOT_FOUND';
  }
}

/** 使用者存在，但沒有執行管理者操作的權限。 */
class AuthorizationError extends Error {
  constructor(message = '沒有管理者權限') {
    super(message);
    this.name = 'AuthorizationError';
    this.code = 'FORBIDDEN';
  }
}

module.exports = {
  ValidationError,
  NotFoundError,
  AuthorizationError,
};
