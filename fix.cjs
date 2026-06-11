const fs = require('fs');
let c = fs.readFileSync('src/routes/attendance.ts', 'utf8');

c = c.split('orderBy: [{ date: "asc" }, { createdAt: "asc" }]').join('include: { shift: true },\n        orderBy: [{ date: "asc" }, { createdAt: "asc" }]');

c = c.split('records: await Promise.all(records.map((record) => serializeAttendanceWithPrivatePhoto(record)))').join('records: await Promise.all(records.map(async (record) => {\n          const ser = await serializeAttendanceWithPrivatePhoto(record);\n          return { ...ser, isNightShift: record.shift?.isNightShift ?? false };\n        }))');

fs.writeFileSync('src/routes/attendance.ts', c);
