const express = require('express');
const { courseDb } = require('../db');
const { sendError } = require('../utils/errors');

const router = express.Router();

const MAX_PAGE_SIZE = 50;
const COURSE_TYPES = ['必修', '選修'];

// 沒給回傳 undefined，格式錯回傳 null
function toInt(value, { min, max }) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  if (n < min || n > max) return null;
  return n;
}

function str(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

router.get('/', (req, res) => {
  const q = req.query;
  const grade = toInt(q.grade, { min: 1, max: 7 });
  const weekday = toInt(q.weekday, { min: 1, max: 7 });
  let page = toInt(q.page, { min: 1, max: 100000 });
  let pageSize = toInt(q.page_size, { min: 1, max: MAX_PAGE_SIZE });
  const courseType = str(q.course_type);
  const semester = str(q.semester);

  // 一定要指定學期，不然不同學期的課會混在一起
  if (!semester) {
    return sendError(res, 400, 'VALIDATION_ERROR', '請指定學期 semester，例如 ?semester=115-1');
  }
  if (grade === null || weekday === null || page === null || pageSize === null) {
    return sendError(res, 400, 'VALIDATION_ERROR', '查詢參數格式錯誤');
  }
  if (page === undefined) page = 1;
  if (pageSize === undefined) pageSize = 10;
  if (courseType && !COURSE_TYPES.includes(courseType)) {
    return sendError(res, 400, 'VALIDATION_ERROR', 'course_type 只能是「必修」或「選修」');
  }

  const where = [];
  const params = [];
  const add = (sql, ...values) => { where.push(sql); params.push(...values); };

  add('c.semester = ?', semester);
  if (str(q.department)) add('c.department = ?', str(q.department));
  if (courseType) add('c.course_type = ?', courseType);
  if (grade) add('c.grade = ?', grade);
  if (str(q.division)) add('c.division = ?', str(q.division));
  if (weekday) {
    add('EXISTS (SELECT 1 FROM course_timeslots t WHERE t.course_id = c.id AND t.weekday = ?)', weekday);
  }
  const keyword = str(q.keyword);
  if (keyword) {
    // % 和 _ 要跳脫
    const like = `%${keyword.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    add("(c.name LIKE ? ESCAPE '\\' OR c.teachers LIKE ? ESCAPE '\\' OR c.course_no LIKE ? ESCAPE '\\')",
      like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { total } = courseDb.prepare(`SELECT COUNT(*) AS total FROM courses c ${whereSql}`).get(...params);
  const items = courseDb.prepare(
    `SELECT c.id, c.course_no, c.name, c.department, c.class_name, c.teachers,
            c.credits, c.course_type, c.time_text, c.classroom, c.enrolled
       FROM courses c ${whereSql}
      ORDER BY c.department, c.class_name, c.name, c.id
      LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);

  res.json({ total, page, page_size: pageSize, items });
});

// 給前端做學期下拉選單，新的學期在前面
const listSemesters = courseDb.prepare('SELECT DISTINCT semester FROM courses ORDER BY semester DESC');

router.get('/semesters', (req, res) => {
  res.json(listSemesters.all().map((r) => r.semester));
});

const listDepartmentsBySemester = courseDb.prepare(
  'SELECT DISTINCT department FROM courses WHERE semester = ? ORDER BY department'
);

router.get('/departments', (req, res) => {
  const semester = str(req.query.semester);
  if (!semester) {
    return sendError(res, 400, 'VALIDATION_ERROR', '請指定學期 semester，例如 ?semester=115-1');
  }
  res.json(listDepartmentsBySemester.all(semester).map((r) => r.department));
});

const getCourse = courseDb.prepare('SELECT * FROM courses WHERE id = ?');
const getTimeslots = courseDb.prepare(
  `SELECT weekday, start_period, end_period FROM course_timeslots
    WHERE course_id = ? ORDER BY weekday, start_period`
);

// 課程比較：GET /api/courses/compare?ids=A,B,C（1～5 門，依傳入順序回傳）
// 找不到的課號放在 not_found，不會整個失敗（例如課程被管理者刪掉了）
const MAX_COMPARE = 5;
const COURSE_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

router.get('/compare', (req, res) => {
  if (typeof req.query.ids !== 'string' || req.query.ids.trim() === '') {
    return sendError(res, 400, 'VALIDATION_ERROR', '請提供 ids，例如 ?ids=A,B,C');
  }
  const ids = [...new Set(req.query.ids.split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_COMPARE) {
    return sendError(res, 400, 'VALIDATION_ERROR', `一次可以比較 1～${MAX_COMPARE} 門課`);
  }
  if (!ids.every((id) => COURSE_ID_RE.test(id))) {
    return sendError(res, 400, 'VALIDATION_ERROR', '課程 id 格式錯誤');
  }

  const items = [];
  const notFound = [];
  for (const id of ids) {
    const course = getCourse.get(id);
    if (course) items.push({ ...course, timeslots: getTimeslots.all(id) });
    else notFound.push(id);
  }
  res.json({ items, not_found: notFound });
});

router.get('/:id', (req, res) => {
  const course = getCourse.get(req.params.id);
  if (!course) return sendError(res, 404, 'NOT_FOUND', '找不到這門課');
  res.json({ ...course, timeslots: getTimeslots.all(req.params.id) });
});

module.exports = router;
