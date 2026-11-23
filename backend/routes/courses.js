const express = require('express');
const { courseDb } = require('../db');

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

  if (grade === null || weekday === null || page === null || pageSize === null) {
    return res.status(400).json({ error: '查詢參數格式錯誤' });
  }
  if (page === undefined) page = 1;
  if (pageSize === undefined) pageSize = 10;
  if (courseType && !COURSE_TYPES.includes(courseType)) {
    return res.status(400).json({ error: 'course_type 只能是「必修」或「選修」' });
  }

  const where = [];
  const params = [];
  const add = (sql, ...values) => { where.push(sql); params.push(...values); };

  if (str(q.semester)) add('c.semester = ?', str(q.semester));
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
      ORDER BY c.department, c.class_name, c.name
      LIMIT ? OFFSET ?`
  ).all(...params, pageSize, (page - 1) * pageSize);

  res.json({ total, page, page_size: pageSize, items });
});

const listDepartments = courseDb.prepare('SELECT DISTINCT department FROM courses ORDER BY department');
const listDepartmentsBySemester = courseDb.prepare(
  'SELECT DISTINCT department FROM courses WHERE semester = ? ORDER BY department'
);

router.get('/departments', (req, res) => {
  const semester = str(req.query.semester);
  const rows = semester ? listDepartmentsBySemester.all(semester) : listDepartments.all();
  res.json(rows.map((r) => r.department));
});

const getCourse = courseDb.prepare('SELECT * FROM courses WHERE id = ?');
const getTimeslots = courseDb.prepare(
  `SELECT weekday, start_period, end_period FROM course_timeslots
    WHERE course_id = ? ORDER BY weekday, start_period`
);

router.get('/:id', (req, res) => {
  const course = getCourse.get(req.params.id);
  if (!course) return res.status(404).json({ error: '找不到這門課' });
  res.json({ ...course, timeslots: getTimeslots.all(req.params.id) });
});

module.exports = router;
