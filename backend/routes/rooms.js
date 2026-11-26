const express = require('express');
const { appDb } = require('../db');
const { sendError } = require('../utils/errors');

const router = express.Router();

// buildings、classrooms 由資料組的 build_db.py 建在 app.db，後端只讀
// 第一次用到才 prepare，資料表還沒建好時不會讓整個伺服器開不起來
let stmts;
function getStmts() {
  if (!stmts) {
    stmts = {
      listBuildings: appDb.prepare(
        'SELECT id, name, room_prefix, map_x, map_y FROM buildings ORDER BY id'
      ),
      getRoom: appDb.prepare(
        `SELECT c.code, c.room_type, c.floor,
                b.id AS building_id, b.name AS building_name, b.map_x, b.map_y
           FROM classrooms c LEFT JOIN buildings b ON b.id = c.building_id
          WHERE c.code = ?`
      ),
    };
  }
  return stmts;
}

const MAX_ROOMS = 10;
const MAX_CODE_LENGTH = 20;
// 和 build_db.py 一樣的分隔符號：F414、I303
const ROOM_SPLIT_RE = /[、,，;；/]+/;

function isValidCode(code) {
  // eslint-disable-next-line no-control-regex
  return code.length <= MAX_CODE_LENGTH && !/[\u0000-\u001f\u007f]/.test(code);
}

// 查不到的教室也回傳，has_location = false，前端只顯示文字、不標地圖
function findRoom(code) {
  const row = getStmts().getRoom.get(code);
  const info = row ? { ...row } : {
    code, room_type: null, floor: null,
    building_id: null, building_name: null, map_x: null, map_y: null,
  };
  info.has_location = info.building_id !== null;
  return info;
}

// 地圖上所有大樓
router.get('/buildings', (req, res) => {
  res.json(getStmts().listBuildings.all().map((r) => ({ ...r })));
});

// 一次查多間：?codes=F414、I303（可以直接把課程的 classroom 欄位丟進來）
router.get('/', (req, res) => {
  if (typeof req.query.codes !== 'string' || req.query.codes.trim() === '') {
    return sendError(res, 400, 'VALIDATION_ERROR', '請提供 codes，例如 ?codes=F414、I303');
  }
  const codes = [...new Set(req.query.codes.split(ROOM_SPLIT_RE).map((s) => s.trim()).filter(Boolean))];
  if (codes.length === 0 || codes.length > MAX_ROOMS) {
    return sendError(res, 400, 'VALIDATION_ERROR', `一次可以查 1～${MAX_ROOMS} 間教室`);
  }
  if (!codes.every(isValidCode)) {
    return sendError(res, 400, 'VALIDATION_ERROR', '教室代號格式錯誤');
  }
  res.json({ items: codes.map(findRoom) });
});

// 單一教室
router.get('/:code', (req, res) => {
  const code = req.params.code.trim();
  if (!code || !isValidCode(code)) {
    return sendError(res, 400, 'VALIDATION_ERROR', '教室代號格式錯誤');
  }
  const room = findRoom(code);
  if (room.room_type === null) return sendError(res, 404, 'NOT_FOUND', '找不到這間教室');
  res.json(room);
});

module.exports = router;
