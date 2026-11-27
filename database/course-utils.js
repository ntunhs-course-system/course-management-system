'use strict';

const {
  ValidationError,
  NotFoundError,
  AuthorizationError,
} = require('./errors');

const MIN_CREDITS = 9;
const MAX_CREDITS = 25;

const EDITABLE_FIELDS = Object.freeze({
  course_no: 'text',
  name: 'text',
  semester: 'text',
  department: 'text',
  division: 'text',
  grade: 'int',
  class_name: 'text',
  teachers: 'text',
  credits: 'int',
  course_type: 'type',
  time_text: 'time',
  classroom: 'room',
  enrolled: 'int',
  summary: 'text',
  restriction: 'text',
});

const NOT_NULL_FIELDS = new Set([
  'name', 'semester', 'department', 'credits', 'course_type',
]);

const DAY_NUM = Object.freeze({
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '七': 7,
});
const DAY_TEXT = Object.freeze({
  1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日',
});

function assertDatabase(db, label) {
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {
    throw new ValidationError(`${label} 必須是已開啟的 node:sqlite DatabaseSync 連線`);
  }
}

function normalizeUserId(value) {
  const userId = typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new ValidationError('userId 必須是正整數');
  }
  return userId;
}

function normalizeCourseId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('courseId 必須是非空字串');
  }
  return value.trim();
}

function normalizeCourseIds(values) {
  if (!Array.isArray(values)) {
    throw new ValidationError('courseIds 必須是陣列');
  }
  return [...new Set(values.map(normalizeCourseId))];
}

function assertUserExists(appDb, userId) {
  assertDatabase(appDb, 'appDb');
  const id = normalizeUserId(userId);
  const row = appDb.prepare(
    'SELECT id, username, role, is_active FROM users WHERE id = ?',
  ).get(id);
  if (!row) throw new NotFoundError(`找不到使用者：${id}`);
  return row;
}

function assertAdmin(appDb, adminUserId) {
  if (adminUserId === undefined || adminUserId === null) {
    throw new AuthorizationError('管理者操作必須提供登入者的 userId');
  }
  const user = assertUserExists(appDb, adminUserId);
  if (user.is_active !== 1 || user.role !== 'admin') {
    throw new AuthorizationError('此帳號沒有管理者權限或已停用');
  }
  return user;
}

function assertCourseExists(courseDb, courseId) {
  assertDatabase(courseDb, 'courseDb');
  const id = normalizeCourseId(courseId);
  const row = courseDb.prepare('SELECT id FROM courses WHERE id = ?').get(id);
  if (!row) throw new NotFoundError(`找不到課程：${id}`);
  return id;
}

function parseClassrooms(text) {
  if (text === null || text === undefined || text === '') return [];
  if (typeof text !== 'string') {
    throw new ValidationError('classroom 必須是字串');
  }
  const rooms = [];
  for (const part of text.split(/[、,，;；/]+/u)) {
    const code = part.trim();
    if (code && !rooms.includes(code)) rooms.push(code);
  }
  return rooms;
}

function parseTimeText(text) {
  if (text === null || text === undefined || String(text).trim() === '') return [];
  if (typeof text !== 'string') {
    throw new ValidationError('time_text 必須是字串');
  }

  const slots = [];
  for (const part of text.split('、')) {
    const match = part.trim().match(/^([一二三四五六日七])\s+([\d,\-\s]+)$/u);
    if (!match) {
      throw new ValidationError(
        `看不懂的上課時間：${JSON.stringify(part)}（正確例子：二 3-4、四 1,6-7）`,
      );
    }
    const weekday = DAY_NUM[match[1]];
    for (const segment of match[2].replace(/\s+/g, '').split(',')) {
      if (!segment) continue;
      const periodMatch = segment.match(/^(\d+)(?:-(\d+))?$/);
      if (!periodMatch) throw new ValidationError(`節次格式錯誤：${segment}`);
      const start = Number(periodMatch[1]);
      const end = periodMatch[2] === undefined ? start : Number(periodMatch[2]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        throw new ValidationError(`節次不合理：${segment}`);
      }
      slots.push([weekday, start, end]);
    }
  }
  return slots;
}

function formatTimeText(slots) {
  const byDay = new Map();
  for (const slot of slots) {
    const [weekday, start, end] = slot;
    if (!DAY_TEXT[weekday] || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 1 || end < start) {
      throw new ValidationError('上課時段資料格式不正確');
    }
    if (!byDay.has(weekday)) byDay.set(weekday, []);
    byDay.get(weekday).push(start === end ? String(start) : `${start}-${end}`);
  }
  return [...byDay.entries()]
    .map(([weekday, values]) => `${DAY_TEXT[weekday]} ${values.join(',')}`)
    .join('、');
}

function normalizeFieldValue(field, value) {
  const kind = EDITABLE_FIELDS[field];
  if (!kind) throw new ValidationError(`不能修改的欄位：${field}`);

  if (typeof value === 'string') value = value.trim();
  if (value === undefined || value === null || value === '') {
    if (NOT_NULL_FIELDS.has(field)) throw new ValidationError(`${field} 不能是空的`);
    return null;
  }

  if (kind === 'int') {
    let number;
    if (typeof value === 'number') {
      number = value;
    } else if (typeof value === 'string' && /^\d+$/.test(value)) {
      number = Number(value);
    } else {
      throw new ValidationError(`${field} 必須是非負整數`);
    }
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new ValidationError(`${field} 必須是非負整數`);
    }
    return number;
  }

  if (kind === 'type') {
    if (value !== '必修' && value !== '選修') {
      throw new ValidationError('course_type 只能是「必修」或「選修」');
    }
    return value;
  }

  if (kind === 'room') {
    return parseClassrooms(value).join('、') || null;
  }

  if (kind === 'time') {
    return formatTimeText(parseTimeText(value)) || null;
  }

  if (typeof value !== 'string') {
    throw new ValidationError(`${field} 必須是文字`);
  }
  return value;
}

function getCourse(courseDb, courseId) {
  assertDatabase(courseDb, 'courseDb');
  const id = normalizeCourseId(courseId);
  const row = courseDb.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  if (!row) return null;
  const course = { ...row };
  course.timeslots = courseDb.prepare(
    `SELECT weekday, start_period, end_period
       FROM course_timeslots
      WHERE course_id = ?
      ORDER BY weekday, start_period`,
  ).all(id).map((slot) => ({ ...slot }));
  return course;
}

function replaceTimeslots(courseDb, courseId, timeText) {
  courseDb.prepare('DELETE FROM course_timeslots WHERE course_id = ?').run(courseId);
  const slots = parseTimeText(timeText);
  if (slots.length === 0) return;
  const insert = courseDb.prepare(
    `INSERT INTO course_timeslots (course_id, weekday, start_period, end_period)
     VALUES (?, ?, ?, ?)`,
  );
  for (const [weekday, start, end] of slots) insert.run(courseId, weekday, start, end);
}

function insertCourse(courseDb, courseId, values) {
  const fields = Object.keys(EDITABLE_FIELDS);
  const columns = ['id', ...fields];
  const placeholders = columns.map(() => '?').join(', ');
  const params = [courseId, ...fields.map((field) => values[field] ?? null)];
  courseDb.prepare(
    `INSERT INTO courses (${columns.join(', ')}) VALUES (${placeholders})`,
  ).run(...params);
  replaceTimeslots(courseDb, courseId, values.time_text);
}

function syncClassrooms(appDb, codes) {
  const buildings = appDb.prepare(
    'SELECT id, room_prefix FROM buildings WHERE room_prefix IS NOT NULL',
  ).all();
  const prefixToBuilding = new Map(buildings.map((row) => [row.room_prefix, row.id]));
  const upsert = appDb.prepare(
    `INSERT INTO classrooms (code, building_id, floor, room_type)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       building_id = excluded.building_id,
       floor = excluded.floor,
       room_type = excluded.room_type`,
  );

  for (const code of codes) {
    const match = code.match(/^([A-Za-z]{1,2})(\d+)$/);
    if (!match) {
      upsert.run(code, null, null, 'special');
      continue;
    }
    let prefix = match[1].toUpperCase();
    if (prefix === 'IB') prefix = 'I';
    const digits = match[2];
    const floor = digits.length >= 3 ? Number(digits[0]) : null;
    const buildingId = prefixToBuilding.get(prefix) ?? null;
    upsert.run(code, buildingId, floor, 'room');
  }
}

function beginCrossDatabaseTransaction(courseDb, appDb) {
  assertDatabase(courseDb, 'courseDb');
  assertDatabase(appDb, 'appDb');
  // caller passes already-open connections; enable FK checks on those connections.
  courseDb.exec('PRAGMA foreign_keys = ON');
  appDb.exec('PRAGMA foreign_keys = ON');
  appDb.exec('BEGIN IMMEDIATE');
  try {
    courseDb.exec('BEGIN IMMEDIATE');
  } catch (error) {
    try { appDb.exec('ROLLBACK'); } catch { /* keep original error */ }
    throw error;
  }
}

function commitCrossDatabaseTransaction(courseDb, appDb) {
  // app.db first, following the original Python implementation.
  appDb.exec('COMMIT');
  courseDb.exec('COMMIT');
}

function rollbackCrossDatabaseTransaction(courseDb, appDb) {
  for (const db of [courseDb, appDb]) {
    try { db.exec('ROLLBACK'); } catch { /* transaction may already be committed */ }
  }
}

module.exports = {
  MIN_CREDITS,
  MAX_CREDITS,
  EDITABLE_FIELDS,
  assertDatabase,
  normalizeUserId,
  normalizeCourseId,
  normalizeCourseIds,
  assertUserExists,
  assertAdmin,
  assertCourseExists,
  parseClassrooms,
  parseTimeText,
  formatTimeText,
  normalizeFieldValue,
  getCourse,
  replaceTimeslots,
  insertCourse,
  syncClassrooms,
  beginCrossDatabaseTransaction,
  commitCrossDatabaseTransaction,
  rollbackCrossDatabaseTransaction,
  ValidationError,
  NotFoundError,
  AuthorizationError,
};
