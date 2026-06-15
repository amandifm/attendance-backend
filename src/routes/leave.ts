import { Router } from "express";
import { LeaveStatus, LeaveType } from "@prisma/client";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { audit } from "../audit.js";
import { asyncHandler } from "../asyncHandler.js";
import { parseDateOnly } from "../date.js";
import { prisma } from "../db.js";
import { queueEmail } from "../email.js";
import { AppError } from "../errors.js";
import { ok } from "../http.js";
import { dispatchWebhook } from "../integrations.js";
import { serializeLeave } from "../serializers.js";

const router = Router();

const leaveSchema = z.object({
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  leaveType: z.nativeEnum(LeaveType),
  reason: z.string().min(1)
});

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const requests = await prisma.leaveRequest.findMany({
      where: viewer.role === "EMPLOYEE" ? { employeeId: viewer.id } : undefined,
      orderBy: { requestedAt: "desc" }
    });
    ok(res, requests.map(serializeLeave));
  })
);

router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });
    if (viewer.role === "EMPLOYEE" && !settings.allowEmployeeLeaveRequest) {
      throw new AppError(403, "Employee leave requests are disabled.");
    }

    const input = leaveSchema.parse(req.body);
    const fromDate = parseDateOnly(input.fromDate);
    const toDate = parseDateOnly(input.toDate);
    if (fromDate > toDate) {
      throw new AppError(400, "To date must be after from date.");
    }

    const request = await prisma.leaveRequest.create({
      data: {
        employeeId: viewer.id,
        employeeName: viewer.name,
        fromDate,
        toDate,
        leaveType: input.leaveType,
        reason: input.reason.trim()
      }
    });
    await audit({
      actorId: viewer.id,
      action: "leave.create",
      entityType: "LeaveRequest",
      entityId: request.id,
      ipAddress: req.ip
    });
      ok(res, serializeLeave(request), 201);
  })
);

router.patch(
  "/:id/decision",
  requireAuth,
  requireRoles("ADMIN", "HR", "MANAGER"),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        status: z.nativeEnum(LeaveStatus),
        decisionNote: z.string().optional()
      })
      .refine((value) => value.status === "APPROVED" || value.status === "REJECTED", {
        message: "Decision must be APPROVED or REJECTED."
      })
      .parse(req.body);

    const requestId = req.params.id;
    const current = await prisma.leaveRequest.findUnique({ where: { id: requestId }, include: { employee: true } });
    if (!current) {
      throw new AppError(404, "Leave request not found.");
    }
    if (current.status !== "PENDING") {
      throw new AppError(400, "Only pending requests can be decided.");
    }

    const request = await prisma.leaveRequest.update({
      where: { id: current.id },
      data: {
        status: input.status,
        decidedById: (req as AuthenticatedRequest).user.id,
        decidedAt: new Date(),
        decisionNote: input.decisionNote?.trim()
      }
    });
    await prisma.appNotification.create({
      data: {
        userId: request.employeeId,
        title: `Leave ${input.status.toLowerCase()}`,
        body: `${request.fromDate.toISOString().slice(0, 10)} to ${request.toDate.toISOString().slice(0, 10)} was ${input.status.toLowerCase()}.`,
        type: "LEAVE"
      }
    });
    queueEmail({
      toEmail: current.employee.email,
      subject: `DIFM leave ${input.status.toLowerCase()}`,
      body: `Your leave request from ${request.fromDate.toISOString().slice(0, 10)} to ${request.toDate.toISOString().slice(0, 10)} was ${input.status.toLowerCase()}.`,
      relatedType: "LeaveRequest",
      relatedId: request.id
    }).catch((error) => console.error("Email delivery failed", error));
    await audit({
      actorId: (req as AuthenticatedRequest).user.id,
      action: "leave.decision",
      entityType: "LeaveRequest",
      entityId: request.id,
      metadata: { status: input.status },
      ipAddress: req.ip
    });
    dispatchWebhook("LEAVE_DECIDED", {
      leaveRequestId: request.id,
      employeeId: request.employeeId,
      employeeName: request.employeeName,
      status: request.status
    }).catch((error) => console.error("Webhook dispatch failed", error));
      ok(res, serializeLeave(request));
  })
);

export { router as leaveRouter };
