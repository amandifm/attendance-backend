import { Router } from "express";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { audit } from "../audit.js";
import { asyncHandler } from "../asyncHandler.js";
import { AppError } from "../errors.js";
import { prisma } from "../db.js";
import { ok } from "../http.js";
import { deleteMonthLock, findMonthLock, listMonthLocks, upsertMonthLock } from "../monthLocks.js";
import { serializeFinalization, serializeMonthLock } from "../serializers.js";
import { z } from "zod";
import { queueEmail } from "../email.js";
import ExcelJS from "exceljs";


const router = Router();

const monthPattern = /^\d{4}-\d{2}$/;

function monthRange(month: string) {
  if (!monthPattern.test(month)) {
    throw new AppError(400, "Month must be in YYYY-MM format.");
  }
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end };
}

function csvValue(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function payrollValue(record: { status: string; totalMinutes: number | null; lateMinutes: number }, settings: {
  payrollStandardDailyMinutes: number;
  payrollHalfDayMinutes: number;
}) {
  const minutes = record.totalMinutes ?? 0;
  if (record.status === "PRESENT" && minutes >= settings.payrollStandardDailyMinutes) {
    return { payableDay: 1, payrollStatus: "FULL_DAY" };
  }
  if (minutes >= settings.payrollHalfDayMinutes) {
    return { payableDay: 0.5, payrollStatus: "HALF_DAY" };
  }
  if (minutes > 0) {
    return { payableDay: 0, payrollStatus: "SHORT_HOURS" };
  }
  return { payableDay: 0, payrollStatus: record.status };
}

router.get(
  "/attendance-summary",
  requireAuth,
  requireRoles("ADMIN", "HR", "MANAGER"),
  asyncHandler(async (_req, res) => {
    const [assignedShifts, completedShifts, attendanceRecords, presentCount, pendingLeaves, approvedLeaves] =
      await Promise.all([
        prisma.shift.count(),
        prisma.shift.count({ where: { status: "COMPLETED" } }),
        prisma.attendanceRecord.count(),
        prisma.attendanceRecord.count({ where: { status: "PRESENT" } }),
        prisma.leaveRequest.count({ where: { status: "PENDING" } }),
        prisma.leaveRequest.count({ where: { status: "APPROVED" } })
      ]);

    ok(res, {
      assignedShifts,
      completedShifts,
      attendanceRecords,
      presentCount,
      pendingLeaves,
      approvedLeaves
    });
  })
);

router.get(
  "/live-dashboard",
  requireAuth,
  requireRoles("ADMIN", "HR", "MANAGER"),
  asyncHandler(async (_req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const start = new Date(`${today}T00:00:00.000Z`);
    const end = new Date(`${today}T23:59:59.999Z`);
    const staleLocationCutoff = new Date(Date.now() - 5 * 60 * 1000);

    const [
      activeEmployees,
      shifts,
      templates,
      attendance,
      pendingLeaves,
      pendingCorrections,
      companySettings
    ] = await Promise.all([
      prisma.user.count({ where: { role: "EMPLOYEE", active: true } }),
      prisma.shift.findMany({
        where: { date: start, status: { not: "CANCELLED" } },
        orderBy: [{ startAt: "asc" }, { employeeName: "asc" }]
      }),
      prisma.shiftTemplate.findMany({
        where: { active: true }
      }),
      prisma.attendanceRecord.findMany({
        where: { date: { gte: start, lte: end } },
        include: {
          locationPings: {
            orderBy: { capturedAt: "desc" },
            take: 1
          },
          breaks: {
            where: { endedAt: null },
            take: 1
          }
        },
        orderBy: [{ punchInAt: "desc" }, { employeeName: "asc" }]
      }),
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
      prisma.attendanceCorrectionRequest.count({ where: { status: "PENDING" } }),
      prisma.companySettings.upsert({ where: { id: "company" }, update: {}, create: {} })
    ]);

    const handledEmployees = new Set<string>();
    const attendanceByShift = new Map(attendance.map((record) => [record.shiftId, record]));
    const attendanceByEmp = new Map(attendance.map((record) => [record.employeeId, record]));

    const rows = [];

    for (const shift of shifts) {
      handledEmployees.add(shift.employeeId);
      const record = attendanceByShift.get(shift.id) || attendanceByEmp.get(shift.employeeId);
      const lastPing = record?.locationPings?.[0];
      const activeBreak = record?.breaks?.[0];
      const locationStatus = !record?.punchInAt
        ? "NOT_STARTED"
        : record.punchOutAt
          ? "ENDED"
          : !lastPing
            ? "NO_PING"
            : lastPing.capturedAt < staleLocationCutoff
              ? "STALE"
              : "LIVE";

      rows.push({
        employeeId: shift.employeeId,
        employeeName: shift.employeeName,
        shiftId: shift.id,
        shiftTime: `${shift.startTime}-${shift.endTime}`,
        locationName: shift.locationName,
        shiftStatus: shift.status,
        attendanceStatus: record?.status ?? "ABSENT",
        punchInAt: record?.punchInAt?.toISOString(),
        punchOutAt: record?.punchOutAt?.toISOString(),
        punchInLocation: record?.punchInLocation ?? undefined,
        punchOutLocation: record?.punchOutLocation ?? undefined,
        punchInLatitude: record?.punchInLatitude ?? undefined,
        punchInLongitude: record?.punchInLongitude ?? undefined,
        punchOutLatitude: record?.punchOutLatitude ?? undefined,
        punchOutLongitude: record?.punchOutLongitude ?? undefined,
        lateMinutes: record?.lateMinutes ?? 0,
        lateStatus: (record as any)?.lateStatus ?? null,
        locationStatus,
        isOnBreak: !!activeBreak,
        activeBreakStartedAt: activeBreak?.startedAt?.toISOString(),
        breakMinutes: record?.breakMinutes ?? 0
      });
    }

    for (const template of templates) {
      if (handledEmployees.has(template.employeeId)) continue;
      handledEmployees.add(template.employeeId);

      const record = attendanceByEmp.get(template.employeeId);
      const lastPing = record?.locationPings?.[0];
      const activeBreak = record?.breaks?.[0];
      const locationStatus = !record?.punchInAt
        ? "NOT_STARTED"
        : record.punchOutAt
          ? "ENDED"
          : !lastPing
            ? "NO_PING"
            : lastPing.capturedAt < staleLocationCutoff
              ? "STALE"
              : "LIVE";

      rows.push({
        employeeId: template.employeeId,
        employeeName: template.employeeName,
        shiftId: template.id,
        shiftTime: `${template.startTime}-${template.endTime}`,
        locationName: template.locationName,
        shiftStatus: record ? "IN_PROGRESS" : "PENDING",
        attendanceStatus: record?.status ?? "ABSENT",
        punchInAt: record?.punchInAt?.toISOString(),
        punchOutAt: record?.punchOutAt?.toISOString(),
        punchInLocation: record?.punchInLocation ?? undefined,
        punchOutLocation: record?.punchOutLocation ?? undefined,
        punchInLatitude: record?.punchInLatitude ?? undefined,
        punchInLongitude: record?.punchInLongitude ?? undefined,
        punchOutLatitude: record?.punchOutLatitude ?? undefined,
        punchOutLongitude: record?.punchOutLongitude ?? undefined,
        lateMinutes: record?.lateMinutes ?? 0,
        lateStatus: (record as any)?.lateStatus ?? null,
        locationStatus,
        isOnBreak: !!activeBreak,
        activeBreakStartedAt: activeBreak?.startedAt?.toISOString(),
        breakMinutes: record?.breakMinutes ?? 0
      });
    }

    for (const record of attendance) {
      if (handledEmployees.has(record.employeeId)) continue;
      handledEmployees.add(record.employeeId);

      const lastPing = record.locationPings?.[0];
      const activeBreak = record.breaks?.[0];
      const locationStatus = !record.punchInAt
        ? "NOT_STARTED"
        : record.punchOutAt
          ? "ENDED"
          : !lastPing
            ? "NO_PING"
            : lastPing.capturedAt < staleLocationCutoff
              ? "STALE"
              : "LIVE";

      rows.push({
        employeeId: record.employeeId,
        employeeName: record.employeeName,
        shiftId: record.id,
        shiftTime: "Flexible/Unknown",
        locationName: record.punchInLocation || "Unknown",
        shiftStatus: "IN_PROGRESS",
        attendanceStatus: record.status ?? "PRESENT",
        punchInAt: record.punchInAt?.toISOString(),
        punchOutAt: record.punchOutAt?.toISOString(),
        punchInLocation: record.punchInLocation ?? undefined,
        punchOutLocation: record.punchOutLocation ?? undefined,
        punchInLatitude: record.punchInLatitude ?? undefined,
        punchInLongitude: record.punchInLongitude ?? undefined,
        punchOutLatitude: record.punchOutLatitude ?? undefined,
        punchOutLongitude: record.punchOutLongitude ?? undefined,
        lateMinutes: record.lateMinutes ?? 0,
        lateStatus: (record as any)?.lateStatus ?? null,
        locationStatus,
        isOnBreak: !!activeBreak,
        activeBreakStartedAt: activeBreak?.startedAt?.toISOString(),
        breakMinutes: record?.breakMinutes ?? 0
      });
    }

    const inProgress = attendance.filter((record) => record.status === "IN_PROGRESS").length;
    const completed = attendance.filter((record) => record.punchOutAt).length;
    const missingLocation = rows.filter((row) => row.locationStatus === "NO_PING" || row.locationStatus === "STALE").length;

    ok(res, {
      date: today,
      summary: {
        activeEmployees,
        assignedToday: rows.length,
        inProgress,
        completed,
        pendingLeaves,
        pendingCorrections,
        missingLocation,
        sessionHours: companySettings.sessionHours
      },
      rows
    });
  })
);

router.get(
  "/payroll-export",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
    const { start, end } = monthRange(month);
    const [records, settings] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: {
          date: { gte: start, lt: end }
        },
        orderBy: [{ employeeName: "asc" }, { date: "asc" }]
      }),
      prisma.companySettings.upsert({ where: { id: "company" }, update: {}, create: {} })
    ]);
    const lateCountByEmployee = new Map<string, number>();
    const payableByEmployee = new Map<string, number>();
    for (const record of records) {
      lateCountByEmployee.set(record.employeeId, (lateCountByEmployee.get(record.employeeId) ?? 0) + (record.lateMinutes > 0 ? 1 : 0));
      const value = payrollValue(record, settings);
      payableByEmployee.set(record.employeeId, (payableByEmployee.get(record.employeeId) ?? 0) + value.payableDay);
    }
    const rows = [
      [
        "Employee ID",
        "Employee Name",
        "Date",
        "Status",
        "Punch In",
        "Punch Out",
        "Gross Minutes",
        "Break Minutes",
        "Net Minutes",
        "Late Minutes",
        "Payable Day",
        "Payroll Status",
        "Monthly Late Count",
        "Late Deduction Day",
        "Bonus Eligible"
      ],
      ...records.map((record) => {
        const value = payrollValue(record, settings);
        const lateCount = lateCountByEmployee.get(record.employeeId) ?? 0;
        const lateDeductionDay =
          lateCount <= 5  ? 0 :
          lateCount <= 8  ? 0.5 :
          lateCount <= 12 ? 1 : 2;
        return [
          record.employeeId,
          record.employeeName,
          record.date.toISOString().slice(0, 10),
          record.status,
          record.punchInAt?.toISOString() ?? "",
          record.punchOutAt?.toISOString() ?? "",
          record.grossMinutes ?? "",
          record.breakMinutes,
          record.totalMinutes ?? "",
          record.lateMinutes,
          value.payableDay,
          value.payrollStatus,
          lateCount,
          lateDeductionDay,
          lateCount <= settings.payrollBonusMaxLateCount ? "YES" : "NO"
        ];
      })
    ];

    ok(res, {
      month,
      fileName: `difm-payroll-attendance-${month}.csv`,
      recordCount: records.length,
      summary: Array.from(payableByEmployee.entries()).map(([employeeId, payableDays]) => ({
        employeeId,
        payableDays,
        lateCount: lateCountByEmployee.get(employeeId) ?? 0
      })),
      csv: rows.map((row) => row.map(csvValue).join(",")).join("\n")
    });
  })
);

router.get(
  "/super-admin-dashboard",
  requireAuth,
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (_req, res) => {
    const [users, lockedMonths, emailFailures, webhookFailures, auditEvents, apiKeys] = await Promise.all([
      prisma.user.count(),
      prisma.attendanceMonthLock.count(),
      prisma.emailDelivery.count({ where: { status: "FAILED" } }),
      prisma.webhookDelivery.count({ where: { status: "FAILED" } }),
      prisma.auditLog.count(),
      prisma.apiKey.count({ where: { active: true } })
    ]);
    ok(res, { users, lockedMonths, emailFailures, webhookFailures, auditEvents, activeApiKeys: apiKeys });
  })
);

router.get(
  "/email-deliveries",
  requireAuth,
  requireRoles("SUPER_ADMIN", "ADMIN", "HR"),
  asyncHandler(async (_req, res) => {
    const deliveries = await prisma.emailDelivery.findMany({
      orderBy: { createdAt: "desc" },
      take: 100
    });
    ok(res, deliveries.map((item) => ({
      id: item.id,
      toEmail: item.toEmail,
      subject: item.subject,
      status: item.status,
      provider: item.provider ?? undefined,
      error: item.error ?? undefined,
      relatedType: item.relatedType ?? undefined,
      relatedId: item.relatedId ?? undefined,
      createdAt: item.createdAt.toISOString(),
      sentAt: item.sentAt?.toISOString()
    })));
  })
);

router.get(
  "/month-locks",
  requireAuth,
  requireRoles("ADMIN", "HR", "MANAGER"),
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    if (month) {
      monthRange(month);
    }
    const locks = await listMonthLocks(month);
    ok(res, locks.map(serializeMonthLock));
  })
);

router.post(
  "/month-locks/:month",
  requireAuth,
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const month = req.params.month;
    monthRange(month);
    const input = { note: typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : undefined };
    const lock = await upsertMonthLock({ month, lockedById: viewer.id, note: input.note });
    await audit({
      actorId: viewer.id,
      action: "attendance_month.lock",
      entityType: "AttendanceMonthLock",
      entityId: lock.id,
      metadata: { month },
      ipAddress: req.ip
    });
    ok(res, serializeMonthLock(lock), 201);
  })
);

router.delete(
  "/month-locks/:month",
  requireAuth,
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const month = req.params.month;
    monthRange(month);
    const lock = await findMonthLock(month);
    if (!lock) {
      ok(res, { unlocked: true });
      return;
    }
    await deleteMonthLock(month);
    await audit({
      actorId: viewer.id,
      action: "attendance_month.unlock",
      entityType: "AttendanceMonthLock",
      entityId: lock.id,
      metadata: { month },
      ipAddress: req.ip
    });
    ok(res, { unlocked: true });
  })
);

// ─── Attendance Finalization (HR step before Super Admin lock) ────────────────

/**
 * POST /reports/finalize-month
 * HR/Admin submits a month for Super Admin review before lock.
 * Idempotent — re-submitting updates the note and timestamp.
 */
router.post(
  "/finalize-month",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM"),
      note: z.string().max(500).optional()
    }).parse(req.body);

    // Cannot finalize an already-locked month
    const lock = await findMonthLock(input.month);
    if (lock) throw new AppError(409, `Month ${input.month} is already locked by Super Admin.`);

    const finalization = await prisma.attendanceMonthFinalization.upsert({
      where: { month: input.month },
      update: { finalizedById: viewer.id, finalizedAt: new Date(), note: input.note?.trim() },
      create: { month: input.month, finalizedById: viewer.id, note: input.note?.trim() }
    });

    // Notify Super Admins
    const superAdmins = await prisma.user.findMany({
      where: { role: "SUPER_ADMIN", active: true },
      select: { id: true, email: true }
    });
    for (const sa of superAdmins) {
      await prisma.appNotification.create({
        data: {
          userId: sa.id,
          title: "Month ready for lock",
          body: `${viewer.name} has finalized attendance for ${input.month}. Please review and lock.`,
          type: "SYSTEM"
        }
      });
      queueEmail({
        toEmail: sa.email,
        subject: `[DIFM] Attendance finalized for ${input.month} — ready for lock`,
        body: `${viewer.name} submitted attendance data for ${input.month} for your review.\n\nNote: ${input.note ?? "—"}`,
        relatedType: "AttendanceMonthFinalization",
        relatedId: finalization.id
      }).catch((err) => console.error("Finalization email failed:", err));
    }

    await audit({
      actorId: viewer.id,
      action: "attendance_month.finalize",
      entityType: "AttendanceMonthFinalization",
      entityId: finalization.id,
      metadata: { month: input.month },
      ipAddress: req.ip
    });

    ok(res, serializeFinalization(finalization), 201);
  })
);

/**
 * GET /reports/finalize-month?month=YYYY-MM
 * Check finalization status of a month.
 */
router.get(
  "/finalize-month",
  requireAuth,
  requireRoles("ADMIN", "HR", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
    const finalization = await prisma.attendanceMonthFinalization.findUnique({ where: { month } });
    const lock = await findMonthLock(month);
    ok(res, {
      month,
      finalized: !!finalization,
      locked: !!lock,
      finalization: finalization ? serializeFinalization(finalization) : null,
      lock: lock ? { month: lock.month, lockedAt: lock.lockedAt.toISOString(), lockedBy: lock.lockedById } : null
    });
  })
);

// ─── Locked Month Edit Request ────────────────────────────────────────────────

/**
 * POST /reports/locked-edit-request
 * HR/Admin requests a change to a locked month's attendance.
 * Super Admin is notified to approve/reject.
 * This creates an audit entry + notification — Super Admin must unlock manually.
 */
router.post(
  "/locked-edit-request",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM"),
      reason: z.string().min(10).max(1000),
      attendanceIds: z.array(z.string()).optional()
    }).parse(req.body);

    const lock = await findMonthLock(input.month);
    if (!lock) throw new AppError(400, `Month ${input.month} is not locked. No edit request needed.`);

    const logEntry = await prisma.auditLog.create({
      data: {
        actorId: viewer.id,
        action: "attendance_month.locked_edit_request",
        entityType: "AttendanceMonthLock",
        entityId: lock.id,
        metadata: {
          month: input.month,
          reason: input.reason,
          attendanceIds: input.attendanceIds ?? []
        },
        ipAddress: req.ip
      }
    });

    // Notify Super Admins
    const superAdmins = await prisma.user.findMany({
      where: { role: "SUPER_ADMIN", active: true },
      select: { id: true, email: true }
    });
    for (const sa of superAdmins) {
      await prisma.appNotification.create({
        data: {
          userId: sa.id,
          title: "Locked month edit request",
          body: `${viewer.name} is requesting an edit to locked month ${input.month}. Reason: ${input.reason.slice(0, 100)}`,
          type: "SYSTEM"
        }
      });
      queueEmail({
        toEmail: sa.email,
        subject: `[DIFM] Locked month edit request — ${input.month}`,
        body: `${viewer.name} has requested an edit to the locked month ${input.month}.\n\nReason: ${input.reason}\n\nAffected records: ${input.attendanceIds?.join(", ") ?? "not specified"}`,
        relatedType: "AuditLog",
        relatedId: logEntry.id
      }).catch((err) => console.error("Locked edit request email failed:", err));
    }

    ok(res, {
      requested: true,
      month: input.month,
      reason: input.reason,
      requestedBy: viewer.id,
      auditLogId: logEntry.id
    });
  })
);

// ─── Monthly Summary ──────────────────────────────────────────────────────────

/**
 * GET /attendance/monthly-summary?month=YYYY-MM
 * Accessible to all roles (employees see only their own).
 * Returns per-employee aggregation: absent days, late marks, payable days, bonus status.
 */
router.get(
  "/monthly-summary",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
    const employeeId =
      viewer.role === "EMPLOYEE"
        ? viewer.id
        : typeof req.query.employeeId === "string"
        ? req.query.employeeId
        : undefined;

    const { start, end } = monthRange(month);

    const [records, settings] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: {
          employeeId,
          date: { gte: start, lt: end }
        },
        orderBy: [{ employeeName: "asc" }, { date: "asc" }]
      }),
      prisma.companySettings.upsert({ where: { id: "company" }, update: {}, create: {} })
    ]);

    // Group by employee
    const byEmployee = new Map<string, typeof records>();
    for (const r of records) {
      if (!byEmployee.has(r.employeeId)) byEmployee.set(r.employeeId, []);
      byEmployee.get(r.employeeId)!.push(r);
    }

    const summary = Array.from(byEmployee.entries()).map(([empId, empRecords]) => {
      const name = empRecords[0]?.employeeName ?? empId;
      let presentDays = 0, absentDays = 0, halfDays = 0, lateMarkCount = 0, payableDays = 0;

      for (const r of empRecords) {
        const minutes = r.totalMinutes ?? 0;
        if (r.status === "PRESENT" || r.status === "IN_PROGRESS") {
          presentDays++;
          if (minutes >= settings.payrollStandardDailyMinutes) payableDays += 1;
          else if (minutes >= settings.payrollHalfDayMinutes) { halfDays++; payableDays += 0.5; }
        } else if (r.status === "ABSENT" || r.status === "MISSED_PUNCH") {
          absentDays++;
        } else if (r.status === "HALF_DAY" || r.status === "SHORT_HOURS") {
          halfDays++;
          if (minutes >= settings.payrollHalfDayMinutes) payableDays += 0.5;
        }
        if (r.lateMinutes > 0) lateMarkCount++;
      }

      const lateDeductionDays = Math.max(0, lateMarkCount - settings.payrollLateDeductionAfter) * 0.5;
      const bonusEligible = lateMarkCount <= settings.payrollBonusMaxLateCount;

      return {
        employeeId: empId,
        employeeName: name,
        month,
        totalDays: empRecords.length,
        presentDays,
        absentDays,
        halfDays,
        lateMarkCount,
        payableDays: Math.max(0, payableDays - lateDeductionDays),
        lateDeductionDays,
        bonusEligible
      };
    });

    ok(res, { month, summary });
  })
);

// ─── Bonus Eligibility Check ──────────────────────────────────────────────────

/**
 * GET /reports/bonus-eligibility/:userId?month=YYYY-MM
 * Checks if an employee qualifies for bonus:
 *   0 absent days + ≤ payrollBonusMaxLateCount late marks + 0 unapproved leaves
 */
router.get(
  "/bonus-eligibility/:userId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer  = (req as AuthenticatedRequest).user;
    const userId  = req.params.userId;

    // Employees can only check themselves
    if (viewer.role === "EMPLOYEE" && viewer.id !== userId) {
      throw new AppError(403, "You can only check your own bonus eligibility.");
    }

    const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
    const { start, end } = monthRange(month);

    const [records, leaves, settings, holidays] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { employeeId: userId, date: { gte: start, lt: end } }
      }),
      prisma.leaveRequest.findMany({
        where: {
          employeeId: userId,
          status: { not: "APPROVED" },
          fromDate: { lte: end },
          toDate:   { gte: start }
        }
      }),
      prisma.companySettings.upsert({ where: { id: "company" }, update: {}, create: {} }),
      // holidays in month (excluded from absent count)
      prisma.companyHoliday.findMany({ where: { date: { gte: start, lt: end } } })
    ]);

    const holidayDates = new Set(holidays.map(h => h.date.toISOString().slice(0, 10)));

    let absentDays = 0, lateMarkCount = 0;
    for (const r of records) {
      const dateKey = r.date.toISOString().slice(0, 10);
      if (holidayDates.has(dateKey)) continue;
      if (r.status === "ABSENT" || r.status === "MISSED_PUNCH") absentDays++;
      if (r.lateMinutes > 0) lateMarkCount++;
    }

    const unapprovedLeaves = leaves.length;
    const eligible = absentDays === 0 && lateMarkCount <= settings.payrollBonusMaxLateCount && unapprovedLeaves === 0;

    ok(res, {
      userId,
      month,
      absentDays,
      lateMarkCount,
      maxAllowedLateMarks: settings.payrollBonusMaxLateCount,
      unapprovedLeaves,
      bonusEligible: eligible,
      reasons: [
        absentDays > 0              ? `${absentDays} absent day(s)` : null,
        lateMarkCount > settings.payrollBonusMaxLateCount
                                    ? `${lateMarkCount} late mark(s) — max ${settings.payrollBonusMaxLateCount}` : null,
        unapprovedLeaves > 0        ? `${unapprovedLeaves} unapproved leave request(s)` : null
      ].filter(Boolean)
    });
  })
);

// ─── Final Settlement Attendance Report ───────────────────────────────────────

/**
 * GET /reports/final-settlement/:userId?exitMonth=YYYY-MM
 * Generates exit-month attendance report for relieving letter / full-and-final.
 * Includes payable days, deductions, disputes, and late marks.
 */
router.get(
  "/final-settlement/:userId",
  requireAuth,
  requireRoles("ADMIN", "HR", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const userId = req.params.userId;
    const month  = typeof req.query.exitMonth === "string" ? req.query.exitMonth : new Date().toISOString().slice(0, 7);
    const { start, end } = monthRange(month);

    const [employee, records, disputes, leaves, settings, holidays] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, joiningDate: true } }),
      prisma.attendanceRecord.findMany({
        where: { employeeId: userId, date: { gte: start, lt: end } },
        orderBy: { date: "asc" }
      }),
      prisma.attendanceDispute.findMany({
        where: { employeeId: userId, requestedAt: { gte: start, lt: end } }
      }),
      prisma.leaveRequest.findMany({
        where: { employeeId: userId, status: "APPROVED", fromDate: { lte: end }, toDate: { gte: start } }
      }),
      prisma.companySettings.upsert({ where: { id: "company" }, update: {}, create: {} }),
      prisma.companyHoliday.findMany({ where: { date: { gte: start, lt: end } } })
    ]);

    if (!employee) throw new AppError(404, "Employee not found.");

    const holidayDates = new Set(holidays.map(h => h.date.toISOString().slice(0, 10)));
    let presentDays = 0, absentDays = 0, halfDays = 0, lateMarkCount = 0, payableDays = 0;

    for (const r of records) {
      const dateKey = r.date.toISOString().slice(0, 10);
      if (holidayDates.has(dateKey)) continue;
      const minutes = r.totalMinutes ?? 0;
      if (r.status === "PRESENT" || r.status === "IN_PROGRESS") {
        presentDays++;
        if (minutes >= settings.payrollStandardDailyMinutes) payableDays++;
        else if (minutes >= settings.payrollHalfDayMinutes) { halfDays++; payableDays += 0.5; }
      } else if (r.status === "ABSENT" || r.status === "MISSED_PUNCH") {
        absentDays++;
      } else if (r.status === "HALF_DAY" || r.status === "SHORT_HOURS") {
        halfDays++;
        if (minutes >= settings.payrollHalfDayMinutes) payableDays += 0.5;
      }
      if (r.lateMinutes > 0) lateMarkCount++;
    }

    // Spec: 6-8 lates = 0.5 day, 9-12 = 1 day, >12 = 2 days
    const lateDeductionDays = lateMarkCount <= 5 ? 0
      : lateMarkCount <= 8  ? 0.5
      : lateMarkCount <= 12 ? 1
      : 2;

    const netPayableDays = Math.max(0, payableDays - lateDeductionDays);

    ok(res, {
      employee: { id: employee.id, name: employee.name, email: employee.email, joiningDate: employee.joiningDate?.toISOString().slice(0, 10) },
      exitMonth: month,
      workingDays: records.length - holidayDates.size,
      holidays: holidays.length,
      presentDays,
      absentDays,
      halfDays,
      lateMarkCount,
      lateDeductionDays,
      payableDays,
      netPayableDays,
      approvedLeaves: leaves.length,
      disputes: disputes.map(d => ({
        id: d.id, reason: d.reason, status: d.status, requestedAt: d.requestedAt.toISOString()
      })),
      bonusEligible: lateMarkCount <= settings.payrollBonusMaxLateCount && absentDays === 0,
      generatedAt: new Date().toISOString()
    });
  })
);

// ─── Location Audit Export ────────────────────────────────────────────────────

/**
 * GET /reports/location-audit-export
 * HR Admin / Super Admin — Export location pings + risk flags as CSV.
 * Supports ?from=YYYY-MM-DD&to=YYYY-MM-DD&employeeId=&riskOnly=true
 */
router.get(
  "/location-audit-export",
  requireAuth,
  requireRoles("ADMIN", "HR", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const from       = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const to         = typeof req.query.to   === "string" ? new Date(req.query.to)   : undefined;
    const riskOnly   = req.query.riskOnly === "true";

    const pings = await prisma.attendanceLocationPing.findMany({
      where: {
        employeeId,
        capturedAt: from || to ? { gte: from, lte: to } : undefined,
        risk: riskOnly ? { not: null } : undefined
      },
      orderBy: [{ employeeId: "asc" }, { capturedAt: "desc" }],
      take: 10000
    });

    const header = ["Ping ID", "Employee ID", "Attendance ID", "Latitude", "Longitude", "Accuracy (m)", "Risk", "Review Status", "Review Note", "Captured At"];
    const rows = pings.map(p => [
      p.id, p.employeeId, p.attendanceId,
      p.latitude, p.longitude,
      p.accuracyMeters ?? "",
      p.risk ?? "",
      p.reviewStatus ?? "",
      p.reviewNote ?? "",
      p.capturedAt.toISOString()
    ]);

    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

    ok(res, {
      fileName: `difm-location-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      recordCount: pings.length,
      csv
    });
  })
);

// ─── Attendance Export (XLSX) ───────────────────────────────────────────────────

/**
 * GET /reports/attendance-export
 * HR Admin / Super Admin — Export attendance records as XLSX.
 * Supports ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get(
  "/attendance-export",
  requireAuth,
  requireRoles("ADMIN", "HR", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const fromStr = typeof req.query.from === "string" ? req.query.from : undefined;
    const toStr = typeof req.query.to === "string" ? req.query.to : undefined;

    if (!fromStr || !toStr) {
      throw new AppError(400, "Missing from or to date");
    }
    const start = new Date(`${fromStr}T00:00:00.000Z`);
    const end = new Date(`${toStr}T23:59:59.999Z`);

    const records = await prisma.attendanceRecord.findMany({
      where: {
        date: { gte: start, lte: end }
      },
      orderBy: [{ date: "asc" }, { employeeName: "asc" }]
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Attendance');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Employee ID', key: 'employeeId', width: 20 },
      { header: 'Employee Name', key: 'employeeName', width: 25 },
      { header: 'Punch In', key: 'punchIn', width: 25 },
      { header: 'Punch Out', key: 'punchOut', width: 25 },
      { header: 'Location', key: 'location', width: 25 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Gross Minutes', key: 'grossMinutes', width: 15 },
      { header: 'Break Minutes', key: 'breakMinutes', width: 15 },
      { header: 'Net Minutes', key: 'netMinutes', width: 15 },
      { header: 'Late Minutes', key: 'lateMinutes', width: 15 }
    ];

    sheet.getRow(1).font = { bold: true };

    for (const record of records) {
      sheet.addRow({
        date: record.date.toISOString().slice(0, 10),
        employeeId: record.employeeId,
        employeeName: record.employeeName,
        punchIn: record.punchInAt ? record.punchInAt.toISOString() : "",
        punchOut: record.punchOutAt ? record.punchOutAt.toISOString() : "",
        location: record.punchInLocation ?? "",
        status: record.status,
        grossMinutes: record.grossMinutes ?? 0,
        breakMinutes: record.breakMinutes ?? 0,
        netMinutes: record.totalMinutes ?? 0,
        lateMinutes: record.lateMinutes ?? 0
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-export-${fromStr}-to-${toStr}.xlsx"`);
    
    await workbook.xlsx.write(res);
    res.end();
  })
);

export { router as reportsRouter };