import { Router } from "express";
import { ShiftStatus, ShiftType } from "@prisma/client";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { audit } from "../audit.js";
import { asyncHandler } from "../asyncHandler.js";
import { combineDateAndTime, parseDateOnly } from "../date.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { ok } from "../http.js";
import { serializeShift, serializeShiftTemplate } from "../serializers.js";

const router = Router();

const shiftSchema = z.object({
  employeeId: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  type: z.nativeEnum(ShiftType).default("DAY"),
    isNightShift: z.boolean().optional(),
  locationName: z.string().optional(),
  notes: z.string().optional()
});

const shiftTemplateSchema = z.object({
  employeeId: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  type: z.nativeEnum(ShiftType).default("DAY"),
    isNightShift: z.boolean().optional(),
  locationName: z.string().optional(),
  notes: z.string().optional()
});

// ─── Date-specific shift routes ───────────────────────────────────────────────

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const date = typeof req.query.date === "string" ? req.query.date : undefined;

    const shifts = await prisma.shift.findMany({
      where: {
        employeeId: viewer.role === "EMPLOYEE" ? viewer.id : employeeId,
        date: date ? parseDateOnly(date) : undefined
      },
      orderBy: [{ date: "desc" }, { startAt: "asc" }]
    });

    ok(res, shifts.map(serializeShift));
  })
);

router.post(
  "/",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const input = shiftSchema.parse(req.body);
    const date = parseDateOnly(input.date);
    const startAt = combineDateAndTime(input.date, input.startTime);
    let endAt = combineDateAndTime(input.date, input.endTime);
    if (input.type === "NIGHT" && endAt <= startAt) {
      endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    }
    if (endAt <= startAt) {
      throw new AppError(400, "End time must be after start time.");
    }

    const employee = await prisma.user.findUnique({ where: { id: input.employeeId } });
    if (!employee || employee.role !== "EMPLOYEE" || !employee.active) {
      throw new AppError(400, "Select an active employee.");
    }

    const duplicate = await prisma.shift.findFirst({
      where: {
        employeeId: employee.id,
        date,
        status: { not: "CANCELLED" }
      }
    });
    if (duplicate) {
      throw new AppError(409, "This employee already has an active shift on this date.");
    }

    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });

    const shift = await prisma.shift.create({
      data: {
        employeeId: employee.id,
        employeeName: employee.name,
        date,
        startAt,
        endAt,
        startTime: input.startTime,
        endTime: input.endTime,
        type: input.type,
          isNightShift: input.isNightShift ?? false,
          locationName: input.locationName?.trim() || settings.defaultLocation,
        notes: input.notes?.trim(),
        assignedById: (req as AuthenticatedRequest).user.id
      }
    });

    await prisma.appNotification.create({
      data: {
        userId: employee.id,
        title: "Shift assigned",
        body: `${input.date} ${shift.startTime}-${shift.endTime} at ${shift.locationName}`,
        type: "SHIFT"
      }
    });
    await audit({
      actorId: (req as AuthenticatedRequest).user.id,
      action: "shift.create",
      entityType: "Shift",
      entityId: shift.id,
      ipAddress: req.ip
    });

    ok(res, serializeShift(shift), 201);
  })
);

router.put(
  "/:id",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const input = shiftSchema.parse(req.body);
    const shiftId = req.params.id;
    const current = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!current) throw new AppError(404, "Shift not found.");

    const date = parseDateOnly(input.date);
    const startAt = combineDateAndTime(input.date, input.startTime);
    let endAt = combineDateAndTime(input.date, input.endTime);
    if (input.type === "NIGHT" && endAt <= startAt) {
      endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    }
    if (endAt <= startAt) throw new AppError(400, "End time must be after start time.");

    const employee = await prisma.user.findUnique({ where: { id: input.employeeId } });
    if (!employee || employee.role !== "EMPLOYEE" || !employee.active) {
      throw new AppError(400, "Select an active employee.");
    }

    const duplicate = await prisma.shift.findFirst({
      where: {
        id: { not: current.id },
        employeeId: employee.id,
        date,
        status: { not: "CANCELLED" }
      }
    });
    if (duplicate) {
      throw new AppError(409, "This employee already has an active shift on this date.");
    }

    const updated = await prisma.shift.update({
      where: { id: shiftId },
      data: {
        employeeId: employee.id,
        employeeName: employee.name,
        date,
        startAt,
        endAt,
        startTime: input.startTime,
        endTime: input.endTime,
        type: input.type,
        isNightShift: input.isNightShift ?? current.isNightShift,
        locationName: input.locationName?.trim() || current.locationName,
        notes: input.notes?.trim()
      }
    });

    await prisma.shiftChangeLog.create({
      data: {
        shiftId: current.id,
        changedById: (req as AuthenticatedRequest).user.id,
        oldValue: serializeShift(current),
        newValue: serializeShift(updated),
        reason: "Admin/HR manual edit"
      }
    });

    await audit({
      actorId: (req as AuthenticatedRequest).user.id,
      action: "shift.update",
      entityType: "Shift",
      entityId: updated.id,
      ipAddress: req.ip
    });

    ok(res, serializeShift(updated));
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const shiftId = req.params.id;
    const current = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!current) throw new AppError(404, "Shift not found.");

    const removed = await prisma.shift.update({
      where: { id: shiftId },
      data: { status: "CANCELLED" }
    });

    await prisma.shiftChangeLog.create({
      data: {
        shiftId: current.id,
        changedById: (req as AuthenticatedRequest).user.id,
        oldValue: serializeShift(current),
        newValue: serializeShift(removed),
        reason: "Admin/HR removed shift"
      }
    });

    await audit({
      actorId: (req as AuthenticatedRequest).user.id,
      action: "shift.delete",
      entityType: "Shift",
      entityId: shiftId,
      ipAddress: req.ip
    });

    ok(res, serializeShift(removed));
  })
);

router.patch(
  "/:id/status",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const input = z.object({ status: z.nativeEnum(ShiftStatus), reason: z.string().optional() }).parse(req.body);
    const shiftId = req.params.id;
    const current = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!current) {
      throw new AppError(404, "Shift not found.");
    }

    const updated = await prisma.shift.update({
      where: { id: current.id },
      data: { status: input.status }
    });
    await prisma.shiftChangeLog.create({
      data: {
        shiftId: current.id,
        changedById: (req as AuthenticatedRequest).user.id,
        oldValue: serializeShift(current),
        newValue: serializeShift(updated),
        reason: input.reason
      }
    });
    await audit({
      actorId: (req as AuthenticatedRequest).user.id,
      action: "shift.status",
      entityType: "Shift",
      entityId: updated.id,
      metadata: { status: input.status },
      ipAddress: req.ip
    });

    ok(res, serializeShift(updated));
  })
);

// ─── Shift template (persistent / default) routes ────────────────────────────

/**
 * GET /shifts/templates
 * - HR/Admin: all active templates (optionally filtered by ?employeeId=)
 * - Employee: their own active template
 */
router.get(
  "/templates",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const employeeId =
      viewer.role === "EMPLOYEE"
        ? viewer.id
        : typeof req.query.employeeId === "string"
        ? req.query.employeeId
        : undefined;

    const templates = await prisma.shiftTemplate.findMany({
      where: { employeeId, active: true },
      orderBy: { assignedAt: "desc" }
    });

    ok(res, templates.map(serializeShiftTemplate));
  })
);

/**
 * POST /shifts/templates
 * Assign or override a permanent default shift for an employee.
 * Deactivates any existing active template first (soft-delete / audit-safe).
 */
router.post(
  "/templates",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const input = shiftTemplateSchema.parse(req.body);
    const actor = (req as AuthenticatedRequest).user;

    const employee = await prisma.user.findUnique({ where: { id: input.employeeId } });
    if (!employee || employee.role !== "EMPLOYEE" || !employee.active) {
      throw new AppError(400, "Select an active employee.");
    }

    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });

    // Soft-deactivate any existing active template for this employee
    await prisma.shiftTemplate.updateMany({
      where: { employeeId: employee.id, active: true },
      data: { active: false }
    });

    const template = await prisma.shiftTemplate.create({
      data: {
        employeeId: employee.id,
        employeeName: employee.name,
        startTime: input.startTime,
        endTime: input.endTime,
        type: input.type,
          isNightShift: input.isNightShift ?? false,
          locationName: input.locationName?.trim() || settings.defaultLocation,
        notes: input.notes?.trim(),
        assignedById: actor.id
      }
    });

    await prisma.appNotification.create({
      data: {
        userId: employee.id,
        title: "Default shift assigned",
        body: `Your default shift is now ${template.startTime}–${template.endTime} at ${template.locationName}`,
        type: "SHIFT"
      }
    });
    await audit({
      actorId: actor.id,
      action: "shift_template.create",
      entityType: "ShiftTemplate",
      entityId: template.id,
      ipAddress: req.ip
    });

    ok(res, serializeShiftTemplate(template), 201);
  })
);

/**
 * DELETE /shifts/templates/:employeeId
 * Deactivates (removes) the active default shift for an employee.
 */
router.delete(
  "/templates/:employeeId",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const actor = (req as AuthenticatedRequest).user;
    const { employeeId } = req.params;

    const existing = await prisma.shiftTemplate.findFirst({
      where: { employeeId, active: true }
    });
    if (!existing) {
      throw new AppError(404, "No active default shift template found for this employee.");
    }

    const deactivated = await prisma.shiftTemplate.update({
      where: { id: existing.id },
      data: { active: false }
    });

    await audit({
      actorId: actor.id,
      action: "shift_template.remove",
      entityType: "ShiftTemplate",
      entityId: deactivated.id,
      ipAddress: req.ip
    });

    ok(res, serializeShiftTemplate(deactivated));
  })
);

/**
 * GET /shifts/calendar?month=YYYY-MM&employeeId=
 * Returns full monthly calendar for an employee: shifts + holidays + WFH exceptions.
 * Employees see only their own. HR/Admin can query any employee.
 */
router.get(
  "/calendar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);

    if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError(400, "Month must be YYYY-MM.");

    const employeeId =
      viewer.role === "EMPLOYEE"
        ? viewer.id
        : typeof req.query.employeeId === "string"
        ? req.query.employeeId
        : viewer.id;

    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end   = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

    const [shifts, template, attendance, holidays, wfhExceptions] = await Promise.all([
      // Date-specific shifts for this month
      prisma.shift.findMany({
        where: { employeeId, date: { gte: start, lt: end } },
        orderBy: { date: "asc" }
      }),
      // Default shift template
      prisma.shiftTemplate.findFirst({ where: { employeeId, active: true } }),
      // Attendance records
      prisma.attendanceRecord.findMany({
        where: { employeeId, date: { gte: start, lt: end } },
        orderBy: { date: "asc" }
      }),
      // Company holidays in month
      prisma.companyHoliday.findMany({
        where: { date: { gte: start, lt: end } },
        orderBy: { date: "asc" }
      }),
      // Approved WFH exceptions in month
      prisma.locationExceptionRequest.findMany({
        where: { employeeId, date: { gte: start, lt: end }, status: "APPROVED" }
      })
    ]);

    // Build a lookup map: dateKey → shift
    const shiftByDate  = new Map(shifts.map(s => [s.date.toISOString().slice(0, 10), s]));
    const attendByDate = new Map(attendance.map(a => [a.date.toISOString().slice(0, 10), a]));
    const holidayByDate = new Map(holidays.map(h => [h.date.toISOString().slice(0, 10), h]));
    const wfhByDate    = new Map(wfhExceptions.map(w => [w.date.toISOString().slice(0, 10), w]));

    // Generate every calendar day in the month
    const daysInMonth = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    const days = [];

    for (let i = 0; i < daysInMonth; i++) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), i + 1));
      const dateKey = d.toISOString().slice(0, 10);
      const dayOfWeek = d.getUTCDay(); // 0=Sun, 6=Sat

      const shift     = shiftByDate.get(dateKey);
      const attend    = attendByDate.get(dateKey);
      const holiday   = holidayByDate.get(dateKey);
      const wfh       = wfhByDate.get(dateKey);
      const isSunday  = dayOfWeek === 0;
      const isSaturday = dayOfWeek === 6;

      // Determine effective shift (date-specific OR template)
      const effectiveShift = shift ?? (template ? {
        startTime: template.startTime,
        endTime:   template.endTime,
        type: template.type,
          isNightShift: template.isNightShift,
        locationName: template.locationName,
        isTemplate: true
      } : null);

      days.push({
        date:       dateKey,
        dayOfWeek,
        isSaturday,
        isSunday,
        isHoliday:  !!holiday,
        holidayName: holiday?.name ?? null,
        isWFH:      !!wfh,
        shift: effectiveShift ? {
          shiftId:     (shift as any)?.id ?? null,
          startTime:   effectiveShift.startTime,
          endTime:     effectiveShift.endTime,
          type: effectiveShift.type,
            isNightShift: effectiveShift.isNightShift,
            // DAY | EVENING | NIGHT
          locationName: effectiveShift.locationName,
          isTemplate:  !(shift),
        } : null,
        attendance: attend ? {
          id:           attend.id,
          status:       attend.status,
          punchInAt:    attend.punchInAt?.toISOString() ?? null,
          punchOutAt:   attend.punchOutAt?.toISOString() ?? null,
          lateMinutes:  attend.lateMinutes,
          totalMinutes: attend.totalMinutes ?? null,
          riskLevel:    (attend as any).riskLevel ?? null
        } : null
      });
    }

    ok(res, {
      month,
      employeeId,
      totalDays:   daysInMonth,
      holidays:    holidays.map(h => ({ date: h.date.toISOString().slice(0, 10), name: h.name })),
      wfhDays:     wfhExceptions.map(w => w.date.toISOString().slice(0, 10)),
      days
    });
  })
);


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

export { router as shiftsRouter };
