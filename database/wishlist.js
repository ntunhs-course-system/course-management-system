'use strict';

const {
  MIN_CREDITS,
  MAX_CREDITS,
  assertDatabase,
  normalizeUserId,
  normalizeCourseId,
  normalizeCourseIds,
  assertUserExists,
  assertCourseExists,
  getCourse,
  ValidationError,
} = require('./course-utils');

/**
 * 將課程加入指定使用者的預選清單。
 * 回傳 true = 新加入；false = 原本已在清單。
 * courseDb / appDb 必須由後端先開啟，這個函式不會自行開資料庫。
 */
function addToWishlist(courseDb, appDb, userId, courseId) {
  assertDatabase(courseDb, 'courseDb');
  assertDatabase(appDb, 'appDb');
  const user = assertUserExists(appDb, userId);
  const id = assertCourseExists(courseDb, courseId);
  const result = appDb.prepare(
    'INSERT OR IGNORE INTO wishlist (user_id, course_id) VALUES (?, ?)',
  ).run(user.id, id);
  return result.changes === 1;
}

/** 回傳 true = 有移除；false = 原本不在清單。允許清除已經不存在的舊課程 ID。 */
function removeFromWishlist(appDb, userId, courseId) {
  assertDatabase(appDb, 'appDb');
  const user = assertUserExists(appDb, userId);
  const id = normalizeCourseId(courseId);
  const result = appDb.prepare(
    'DELETE FROM wishlist WHERE user_id = ? AND course_id = ?',
  ).run(user.id, id);
  return result.changes === 1;
}

/** 清空指定使用者的預選清單，回傳刪除筆數。 */
function clearWishlist(appDb, userId) {
  assertDatabase(appDb, 'appDb');
  const user = assertUserExists(appDb, userId);
  const result = appDb.prepare('DELETE FROM wishlist WHERE user_id = ?').run(user.id);
  return result.changes;
}

/** 找出指定課程 ID 清單中所有時間重疊的課程配對。 */
function findConflicts(courseDb, courseIds) {
  assertDatabase(courseDb, 'courseDb');
  const ids = normalizeCourseIds(courseIds);
  for (const id of ids) assertCourseExists(courseDb, id);
  if (ids.length < 2) return [];

  const placeholders = ids.map(() => '?').join(', ');
  const rows = courseDb.prepare(
    `SELECT a.course_id AS course_a,
            b.course_id AS course_b,
            a.weekday,
            MAX(a.start_period, b.start_period) AS from_period,
            MIN(a.end_period, b.end_period) AS to_period
       FROM course_timeslots a
       JOIN course_timeslots b
         ON a.weekday = b.weekday
        AND a.course_id < b.course_id
        AND a.start_period <= b.end_period
        AND b.start_period <= a.end_period
      WHERE a.course_id IN (${placeholders})
        AND b.course_id IN (${placeholders})
      ORDER BY a.weekday, from_period, course_a, course_b`,
  ).all(...ids, ...ids);

  return rows.map((row) => ({ ...row }));
}

/** 計算必修、選修、總學分，以及總學分是否落在 9 至 25 學分。 */
function calcCredits(courseDb, courseIds) {
  assertDatabase(courseDb, 'courseDb');
  const ids = normalizeCourseIds(courseIds);
  for (const id of ids) assertCourseExists(courseDb, id);
  const result = { required: 0, elective: 0, total: 0, in_range: false };
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = courseDb.prepare(
      `SELECT course_type, COALESCE(SUM(credits), 0) AS total_credits
         FROM courses
        WHERE id IN (${placeholders})
        GROUP BY course_type`,
    ).all(...ids);
    for (const row of rows) {
      if (row.course_type === '必修') result.required = Number(row.total_credits || 0);
      else if (row.course_type === '選修') result.elective = Number(row.total_credits || 0);
    }
  }
  result.total = result.required + result.elective;
  result.in_range = result.total >= MIN_CREDITS && result.total <= MAX_CREDITS;
  return result;
}

/**
 * 取得使用者預選清單，並附上完整課程、衝堂標記與學分統計。
 * 若舊清單留有已不存在的課程 ID，會略過該課程，不會讓整份清單報錯。
 */
function getWishlistSummary(courseDb, appDb, userId) {
  assertDatabase(courseDb, 'courseDb');
  assertDatabase(appDb, 'appDb');
  const user = assertUserExists(appDb, userId);
  const savedRows = appDb.prepare(
    'SELECT course_id FROM wishlist WHERE user_id = ? ORDER BY id',
  ).all(user.id);

  const items = [];
  for (const row of savedRows) {
    const course = getCourse(courseDb, row.course_id);
    if (course) items.push(course);
  }

  const ids = items.map((course) => course.id);
  const conflicts = findConflicts(courseDb, ids);
  const conflictIds = new Set();
  for (const conflict of conflicts) {
    conflictIds.add(conflict.course_a);
    conflictIds.add(conflict.course_b);
  }
  for (const course of items) {
    course.has_conflict = conflictIds.has(course.id);
  }

  return {
    items,
    conflicts,
    credits: calcCredits(courseDb, ids),
  };
}

module.exports = {
  addToWishlist,
  removeFromWishlist,
  clearWishlist,
  findConflicts,
  calcCredits,
  getWishlistSummary,
};
