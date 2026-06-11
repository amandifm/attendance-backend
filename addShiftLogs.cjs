const fs = require('fs');

let ser = fs.readFileSync('src/serializers.ts', 'utf8');
if (!ser.includes('serializeShiftChangeLog')) {
  ser += `
export function serializeShiftChangeLog(log: import("@prisma/client").ShiftChangeLog & { changedBy?: { name: string } }) {
  return {
    id: log.id,
    shiftId: log.shiftId,
    changedById: log.changedById,
    changedByName: log.changedBy?.name ?? "Unknown",
    oldValue: log.oldValue,
    newValue: log.newValue,
    reason: log.reason ?? undefined,
    createdAt: log.createdAt.toISOString()
  };
}
`;
  fs.writeFileSync('src/serializers.ts', ser);
}

let shifts = fs.readFileSync('src/routes/shifts.ts', 'utf8');
if (!shifts.includes('"/logs/:employeeId"')) {
  let route = `
// ==========================================
// GET /shifts/logs/:employeeId
// HR/Admin: get shift change logs for an employee
// ==========================================
router.get(
  "/logs/:employeeId",
  requireAuth,
  requireRoles("ADMIN", "HR", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { employeeId } = req.params;
    const logs = await prisma.shiftChangeLog.findMany({
      where: { shift: { employeeId } },
      include: { changedBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" }
    });
    const { serializeShiftChangeLog } = await import("../serializers.js");
    ok(res, logs.map(serializeShiftChangeLog));
  })
);
`;
  shifts = shifts.replace('export { router as shiftsRouter };', route + '\nexport { router as shiftsRouter };');
  fs.writeFileSync('src/routes/shifts.ts', shifts);
}
