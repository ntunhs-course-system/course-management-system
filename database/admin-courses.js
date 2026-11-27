'use strict';

const {
  EDITABLE_FIELDS,
  assertDatabase,
  assertAdmin,
  assertCourseExists,
  normalizeFieldValue,
  parseClassrooms,
  getCourse,
  replaceTimeslots,
  insertCourse,
  beginCrossDatabaseTransaction,
  commitCrossDatabaseTransaction,
  rollbackCrossDatabaseTransaction,
  ValidationError,
} = require('./course-utils');
const { syncClassrooms } = require('./classrooms');
const { randomUUID } = require('node:crypto');

const FIELD_NAMES = Object.keys(EDITABLE_FIELDS);

function normalizeCourseData(data, requireAllRequired) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ValidationError('課程資料必須是物件');
  }
  const unknown = Object.keys(data).filter((field) => !Object.hasOwn(EDITABLE_FIELDS, field));
  if (unknown.length) {
    throw new ValidationError(`不能設定的欄位：${unknown.join(', ')}`);
  }

  const cleaned = {};
  for (const field of FIELD_NAMES) {
    if (requireAllRequired || Object.hasOwn(data, field)) {
      cleaned[field] = normalizeFieldValue(field, data[field]);
    } else {
      cleaned[field] = null;
    }
  }
  return cleaned;
}

/**
 * 管理者新增課程，並將新增資料寫入 app.db.added_courses，避免重建時遺失。
 * 必須傳入已開啟的 courseDb、appDb，以及已驗證登入者的 adminUserId。
 */
function adminCreateCourse(courseDb, appDb, data, adminUserId) {
  assertDatabase(courseDb, 'courseDb');
  assertDatabase(appDb, 'appDb');
  const admin = assertAdmin(appDb, adminUserId);
  const cleaned = normalizeCourseData(data, true);
  let courseId;

  try {
    beginCrossDatabaseTransaction(courseDb, appDb);
    const pendingId = `pending-${randomUUID()}`;
    const added = appDb.prepare(
      'INSERT INTO added_courses (course_id, data, created_by) VALUES (?, ?, ?)',
    ).run(pendingId, JSON.stringify(cleaned), admin.id);
    const sequence = Number(added.lastInsertRowid);
    courseId = `A${String(sequence).padStart(5, '0')}`;
    appDb.prepare('UPDATE added_courses SET course_id = ? WHERE seq = ?').run(courseId, sequence);

    insertCourse(courseDb, courseId, cleaned);
    syncClassrooms(appDb, parseClassrooms(cleaned.classroom));
    commitCrossDatabaseTransaction(courseDb, appDb);
  } catch (error) {
    rollbackCrossDatabaseTransaction(courseDb, appDb);
    throw error;
  }

  return getCourse(courseDb, courseId);
}

/** 管理者修改課程，並將每個欄位的最新值寫入 app.db.course_overrides。 */
function adminUpdateCourse(courseDb, appDb, courseId, changes, adminUserId) {
  assertDatabase(courseDb, 'courseDb');
  assertDatabase(appDb, 'appDb');
  const admin = assertAdmin(appDb, adminUserId);
  const id = assertCourseExists(courseDb, courseId);

  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new ValidationError('changes 必須是物件');
  }
  const changeFields = Object.keys(changes);
  if (changeFields.length === 0) throw new ValidationError('至少需要提供一個修改欄位');
  const cleaned = {};
  for (const field of changeFields) cleaned[field] = normalizeFieldValue(field, changes[field]);

  try {
    beginCrossDatabaseTransaction(courseDb, appDb);
    const updateOverride = appDb.prepare(
      `INSERT INTO course_overrides (course_id, field_name, new_value, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(course_id, field_name) DO UPDATE SET
         new_value = excluded.new_value,
         updated_by = excluded.updated_by,
         updated_at = datetime('now', 'localtime')`,
    );

    for (const [field, value] of Object.entries(cleaned)) {
      // field 先經 EDITABLE_FIELDS 白名單驗證，才能安全插入欄位名稱。
      courseDb.prepare(`UPDATE courses SET "${field}" = ? WHERE id = ?`).run(value, id);
      if (field === 'time_text') replaceTimeslots(courseDb, id, value);
      updateOverride.run(id, field, value === null ? null : String(value), admin.id);
    }

    if (Object.hasOwn(cleaned, 'classroom')) {
      syncClassrooms(appDb, parseClassrooms(cleaned.classroom));
    }
    commitCrossDatabaseTransaction(courseDb, appDb);
  } catch (error) {
    rollbackCrossDatabaseTransaction(courseDb, appDb);
    throw error;
  }

  return getCourse(courseDb, id);
}

/** 管理者刪除課程、時段及所有使用者的相關預選，並留下重建用刪除紀錄。 */
function adminDeleteCourse(courseDb, appDb, courseId, adminUserId) {
  assertDatabase(courseDb, 'courseDb');
  assertDatabase(appDb, 'appDb');
  const admin = assertAdmin(appDb, adminUserId);
  const id = assertCourseExists(courseDb, courseId);
  let removedFromWishlists = 0;

  try {
    beginCrossDatabaseTransaction(courseDb, appDb);
    courseDb.prepare('DELETE FROM courses WHERE id = ?').run(id);
    removedFromWishlists = appDb.prepare(
      'DELETE FROM wishlist WHERE course_id = ?',
    ).run(id).changes;
    appDb.prepare('DELETE FROM course_overrides WHERE course_id = ?').run(id);
    const removedAddedCourse = appDb.prepare(
      'DELETE FROM added_courses WHERE course_id = ?',
    ).run(id).changes;

    if (removedAddedCourse === 0) {
      appDb.prepare(
        'INSERT OR REPLACE INTO deleted_courses (course_id, deleted_by) VALUES (?, ?)',
      ).run(id, admin.id);
    }
    commitCrossDatabaseTransaction(courseDb, appDb);
  } catch (error) {
    rollbackCrossDatabaseTransaction(courseDb, appDb);
    throw error;
  }

  return { deleted: id, removed_from_wishlists: removedFromWishlists };
}

module.exports = {
  adminCreateCourse,
  adminUpdateCourse,
  adminDeleteCourse,
};
