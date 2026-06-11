import { Router } from "express";
import { asyncHandler } from "../asyncHandler.js";
import { parseDateOnly } from "../date.js";
import { prisma } from "../db.js";
import { ok } from "../http.js";
import { requireApiKey } from "../integrations.js";
import { rateLimit } from "../rateLimit.js";
import { serializeAttendance, serializeLeave, serializeShift } from "../serializers.js";

const router = Router();

router.get(
  "/attendance-summary",
  rateLimit({ keyPrefix: "public.attendance", windowMs: 60 * 60 * 1000, max: 100 }),
  requireApiKey("attendance:read"),
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === "string" ? parseDateOnly(req.query.from) : undefined;
    const to = typeof req.query.to === "string" ? parseDateOnly(req.query.to) : undefined;
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const records = await prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        date: from || to ? { gte: from, lte: to } : undefined
      },
      orderBy: [{ date: "desc" }, { employeeName: "asc" }],
      take: 500
    });
    ok(res, records.map((record) => serializeAttendance(record)));
  })
);

router.get(
  "/shift-schedule",
  rateLimit({ keyPrefix: "public.shifts", windowMs: 60 * 60 * 1000, max: 100 }),
  requireApiKey("shifts:read"),
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === "string" ? parseDateOnly(req.query.date) : undefined;
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const shifts = await prisma.shift.findMany({
      where: { date, employeeId, status: { not: "CANCELLED" } },
      orderBy: [{ date: "desc" }, { employeeName: "asc" }],
      take: 500
    });
    ok(res, shifts.map(serializeShift));
  })
);

router.get(
  "/leave-status",
  rateLimit({ keyPrefix: "public.leave", windowMs: 60 * 60 * 1000, max: 100 }),
  requireApiKey("leave:read"),
  asyncHandler(async (req, res) => {
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const requests = await prisma.leaveRequest.findMany({
      where: { employeeId },
      orderBy: { requestedAt: "desc" },
      take: 500
    });
    ok(res, requests.map(serializeLeave));
  })
);

export { router as publicApiRouter };
