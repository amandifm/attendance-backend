import { Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { audit } from "../audit.js";
import { asyncHandler } from "../asyncHandler.js";
import { prisma } from "../db.js";
import { ok } from "../http.js";
import { serializeSettings } from "../serializers.js";

const router = Router();

const settingsSchema = z.object({
  companyName: z.string().min(1).optional(),
  defaultLocation: z.string().min(1).optional(),
  defaultLatitude: z.number().min(-90).max(90).nullable().optional(),
  defaultLongitude: z.number().min(-180).max(180).nullable().optional(),
  geofenceRadiusMeters: z.number().int().min(25).max(10000).optional(),
  shiftGraceMinutes: z.number().int().min(0).max(240).optional(),
  defaultShiftStartTime: z.string().regex(/^\d{2}:\d{2}$/, "Format must be HH:MM").optional(),
  defaultShiftEndTime: z.string().regex(/^\d{2}:\d{2}$/, "Format must be HH:MM").optional(),
  lateMarkThresholdMinutes: z.number().int().min(0).max(240).optional(),
  lateWarningThresholdMinutes: z.number().int().min(0).max(240).optional(),
  defaultBreakDurationMinutes: z.number().int().min(0).max(240).optional(),
  sessionHours: z.number().int().min(1).max(24).optional(),
  allowEmployeeLeaveRequest: z.boolean().optional(),
  requireShiftForPunch: z.boolean().optional(),
  requireLocationForPunch: z.boolean().optional(),
  attendancePolicyVersion: z.string().min(1).max(40).optional(),
  attendancePolicyText: z.string().min(10).max(2000).optional(),
  requireBiometricFaceMatch: z.boolean().optional(),
  faceMatchThreshold: z.number().min(0).max(1).optional(),
  payrollStandardDailyMinutes: z.number().int().min(60).max(1440).optional(),
  payrollHalfDayMinutes: z.number().int().min(30).max(720).optional(),
  payrollLateGraceCount: z.number().int().min(0).max(31).optional(),
  payrollLateDeductionAfter: z.number().int().min(0).max(31).optional(),
  payrollBonusMaxLateCount: z.number().int().min(0).max(31).optional()
});

router.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });
    ok(res, serializeSettings(settings));
  })
);

router.patch(
  "/",
  requireAuth,
  requireRoles("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const input = settingsSchema.parse(req.body);
    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      create: input,
      update: input
    });
    await audit({
      actorId: (req as AuthenticatedRequest).user.id,
      action: "settings.update",
      entityType: "CompanySettings",
      entityId: "company",
      metadata: input,
      ipAddress: req.ip
    });

    ok(res, serializeSettings(settings));
  })
);

export { router as settingsRouter };
