'use strict';

const { assertDatabase, parseClassrooms, ValidationError } = require('./course-utils');

/** 取得所有大樓與地圖座標。 */
function listBuildings(appDb) {
  assertDatabase(appDb, 'appDb');
  return appDb.prepare(
    'SELECT id, name, room_prefix, map_x, map_y FROM buildings ORDER BY id',
  ).all().map((row) => ({ ...row }));
}

/** 依課程 classroom 欄位查詢每間教室的大樓、樓層及地圖位置。 */
function getClassroomInfo(appDb, classroomText) {
  assertDatabase(appDb, 'appDb');
  const codes = parseClassrooms(classroomText);
  const lookup = appDb.prepare(
    `SELECT c.code, c.room_type, c.floor,
            b.id AS building_id, b.name AS building_name, b.map_x, b.map_y
       FROM classrooms c
       LEFT JOIN buildings b ON b.id = c.building_id
      WHERE c.code = ?`,
  );

  return codes.map((code) => {
    const row = lookup.get(code);
    const info = row
      ? { ...row }
      : {
          code,
          room_type: null,
          floor: null,
          building_id: null,
          building_name: null,
          map_x: null,
          map_y: null,
        };
    info.has_location = info.building_id !== null;
    return info;
  });
}

/**
 * 將教室代號同步到 app.db。主要供管理者新增／修改課程時使用。
 * appDb 必須是已開啟連線；是否 commit 由呼叫端控制。
 */
function syncClassrooms(appDb, classroomText) {
  assertDatabase(appDb, 'appDb');
  const codes = Array.isArray(classroomText)
    ? classroomText
    : parseClassrooms(classroomText);
  if (!codes.every((code) => typeof code === 'string' && code.trim())) {
    throw new ValidationError('教室代號必須是非空字串');
  }

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

  for (const rawCode of codes) {
    const code = rawCode.trim();
    const match = code.match(/^([A-Za-z]{1,2})(\d+)$/);
    if (!match) {
      upsert.run(code, null, null, 'special');
      continue;
    }
    let prefix = match[1].toUpperCase();
    if (prefix === 'IB') prefix = 'I';
    const digits = match[2];
    const floor = digits.length >= 3 ? Number(digits[0]) : null;
    upsert.run(code, prefixToBuilding.get(prefix) ?? null, floor, 'room');
  }
  return codes.length;
}

module.exports = {
  listBuildings,
  getClassroomInfo,
  syncClassrooms,
};
