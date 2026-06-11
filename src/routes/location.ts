import { Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { audit } from "../audit.js";
import { asyncHandler } from "../asyncHandler.js";
import { parseDateOnly } from "../date.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { ok } from "../http.js";
import { serializeLocationException, serializeLocationPing } from "../serializers.js";

const router = Router();

// ─── GET /location/history/:userId ───────────────────────────────────────────
// HR/Admin/SuperAdmin: audit trail of all location pings for an employee
router.get(
  "/history/:userId",
  requireAuth,
  requireRoles("ADMIN", "HR", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const to   = typeof req.query.to   === "string" ? new Date(req.query.to)   : undefined;
    const limit = Math.min(Number(req.query.limit ?? 500), 1000);

    const pings = await prisma.attendanceLocationPing.findMany({
      where: {
        employeeId: userId,
        capturedAt: from || to ? { gte: from, lte: to } : undefined
      },
      orderBy: { capturedAt: "desc" },
      take: limit
    });

    ok(res, pings.map(serializeLocationPing));
  })
);

// ─── PATCH /location/review/:id ───────────────────────────────────────────────
// HR/Admin: approve or flag a suspicious location ping
router.patch(
  "/review/:id",
  requireAuth,
  requireRoles("ADMIN", "HR", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = z.object({
      reviewStatus: z.enum(["APPROVED", "FLAGGED", "PENDING_REVIEW"]),
      reviewNote: z.string().max(500).optional()
    }).parse(req.body);

    const ping = await prisma.attendanceLocationPing.findUnique({ where: { id: req.params.id } });
    if (!ping) throw new AppError(404, "Location ping not found.");

    const updated = await prisma.attendanceLocationPing.update({
      where: { id: ping.id },
      data: {
        reviewStatus: input.reviewStatus,
        reviewNote: input.reviewNote?.trim(),
        reviewedById: viewer.id,
        reviewedAt: new Date()
      }
    });

    await audit({
      actorId: viewer.id,
      action: "location_ping.review",
      entityType: "AttendanceLocationPing",
      entityId: updated.id,
      metadata: { reviewStatus: input.reviewStatus },
      ipAddress: req.ip
    });

    ok(res, serializeLocationPing(updated));
  })
);

// ─── POST /location/exception-request ────────────────────────────────────────
// Employee requests WFH / relaxed geofence for a specific day
router.post(
  "/exception-request",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const input = z.object({
      date: z.string().min(1),
      reason: z.string().min(5).max(500)
    }).parse(req.body);

    const date = parseDateOnly(input.date);

    // Check for duplicate
    const existing = await prisma.locationExceptionRequest.findFirst({
      where: { employeeId: user.id, date, status: { not: "REJECTED" } }
    });
    if (existing) throw new AppError(409, "A location exception request already exists for this date.");

    const request = await prisma.locationExceptionRequest.create({
      data: {
        employeeId: user.id,
        employeeName: user.name,
        date,
        reason: input.reason.trim()
      }
    });

    await audit({
      actorId: user.id,
      action: "location_exception.request",
      entityType: "LocationExceptionRequest",
      entityId: request.id,
      ipAddress: req.ip
    });

    ok(res, serializeLocationException(request), 201);
  })
);

// ─── GET /location/exception-requests ────────────────────────────────────────
// HR/Admin: list all WFH/location exception requests
router.get(
  "/exception-requests",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const employeeId =
      viewer.role === "EMPLOYEE"
        ? viewer.id
        : typeof req.query.employeeId === "string"
        ? req.query.employeeId
        : undefined;

    const requests = await prisma.locationExceptionRequest.findMany({
      where: {
        employeeId,
        status:
          status === "PENDING" || status === "APPROVED" || status === "REJECTED"
            ? status
            : undefined
      },
      orderBy: { requestedAt: "desc" }
    });

    ok(res, requests.map(serializeLocationException));
  })
);

// ─── PATCH /location/exception-requests/:id ──────────────────────────────────
// HR/Admin/SuperAdmin: approve or reject a WFH request
router.patch(
  "/exception-requests/:id",
  requireAuth,
  requireRoles("ADMIN", "HR", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = z.object({
      status: z.enum(["APPROVED", "REJECTED"]),
      decisionNote: z.string().max(500).optional()
    }).parse(req.body);

    const request = await prisma.locationExceptionRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new AppError(404, "Location exception request not found.");
    if (request.status !== "PENDING") throw new AppError(409, "Request is already decided.");

    const updated = await prisma.locationExceptionRequest.update({
      where: { id: request.id },
      data: {
        status: input.status,
        decidedById: viewer.id,
        decidedAt: new Date(),
        decisionNote: input.decisionNote?.trim()
      }
    });

    // Notify the employee
    await prisma.appNotification.create({
      data: {
        userId: request.employeeId,
        title: `WFH/Location exception ${input.status === "APPROVED" ? "approved" : "rejected"}`,
        body: `Your location exception for ${request.date.toISOString().slice(0, 10)} was ${input.status.toLowerCase()}.`,
        type: "ATTENDANCE"
      }
    });

    await audit({
      actorId: viewer.id,
      action: "location_exception.decision",
      entityType: "LocationExceptionRequest",
      entityId: updated.id,
      metadata: { status: input.status },
      ipAddress: req.ip
    });

    ok(res, serializeLocationException(updated));
  })
);

export { router as locationRouter };
