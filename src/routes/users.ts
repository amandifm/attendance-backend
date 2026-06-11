import bcrypt from "bcryptjs";
import { Router } from "express";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { audit } from "../audit.js";
import { asyncHandler } from "../asyncHandler.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { ok } from "../http.js";
import { serializeUser } from "../serializers.js";
import { enrollFaceService } from "../modules/face/services/enrollFaceService.js";

const router = Router();
const defaultPassword = "Password@123";

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.nativeEnum(UserRole),
  departmentId: z.string().min(1).default("General"),
  designationId: z.string().min(1),
  managerId: z.string().optional(),
  phone: z.string().optional()
});

const faceRegistrationSchema = z.object({
  faceReferenceDataUrl: z.string().min(1)
});

function validateFaceImage(faceDataUrl: string) {
  const normalized = normalizeFaceDataUrl(faceDataUrl);
  const match = normalized.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2] === "undefined") {
    throw new AppError(400, "Face image must be a valid JPEG or PNG captured by the app.");
  }
  if (faceDataUrl.length > 2_000_000) {
    throw new AppError(400, "Face image is too large. Retake the photo and try again.");
  }
}

function normalizeFaceDataUrl(faceDataUrl: string) {
  let normalized = faceDataUrl.trim();
  while (/^data:image\/(jpeg|jpg|png);base64,data:image\//.test(normalized)) {
    normalized = normalized.replace(/^data:image\/(jpeg|jpg|png);base64,/, "");
  }
  return normalized;
}

function ensureRoleMutationAllowed(actorRole: string, targetRole?: string) {
  if (!targetRole) {
    return;
  }
  if (targetRole === "SUPER_ADMIN" && actorRole !== "SUPER_ADMIN") {
    throw new AppError(403, "Only Super Admin can create or assign Super Admin users.");
  }
  if ((targetRole === "ADMIN" || targetRole === "HR") && actorRole === "HR") {
    throw new AppError(403, "HR can only manage employee and manager accounts.");
  }
}

router.get(
  "/",
  requireAuth,
  requireRoles("ADMIN", "HR", "MANAGER"),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: { name: "asc" } });
    ok(res, users.map(serializeUser));
  })
);

router.post(
  "/",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    console.log("this was the reequest...");
    const input = userSchema.parse(req.body);
    const viewer = (req as AuthenticatedRequest).user;
    ensureRoleMutationAllowed(viewer.role, input.role);
    const existing = await prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (existing) {
      throw new AppError(409, "A user with this email already exists.");
    }
    const department =
      await prisma.department.findUnique({
        where: {
          id: input.departmentId,
        },
      });

    if (!department) {
      throw new AppError(
        404,
        "Department not found"
      );
    }
    const designation =
      await prisma.designation.findUnique({
        where: {
          id: input.designationId,
        },
      });
      
    if (!designation) {
      throw new AppError(
        404,
        "Designation not found"
      );
    }
    if (
      designation.departmentId !== department.id
    ) {
      throw new AppError(
        400,
        "Designation does not belong to selected department"
      );
    }

    const user =
      await prisma.user.create({
        data: {
          name: input.name.trim(),
          email: input.email
            .trim()
            .toLowerCase(),
          passwordHash:
            await bcrypt.hash(
              defaultPassword,
              12
            ),
          role: input.role,
          departmentId: department.id,
          designationId: designation.id,
          managerId: input.managerId,
          phone: input.phone?.trim(),
        },
        include: {
          departmentRelation: true,
          designationRelation: true,
        },
      });
    await audit({
      actorId: (req as AuthenticatedRequest).user.id,
      action: "user.create",
      entityType: "User",
      entityId: user.id,
      ipAddress: req.ip
    });

    ok(res, serializeUser(user), 201);
  })
);

router.post(
  "/me/face",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = faceRegistrationSchema.parse(req.body);
    validateFaceImage(input.faceReferenceDataUrl);
    const normalizedFaceReferenceDataUrl = normalizeFaceDataUrl(input.faceReferenceDataUrl);
    const enrolled = await enrollFaceService(normalizedFaceReferenceDataUrl);

    const user = await prisma.user.update({
      where: { id: viewer.id },
      data: {
        faceReferenceDataUrl: normalizedFaceReferenceDataUrl,
        faceRegisteredAt: new Date()
      }
    });
    await prisma.userFaceProfile.upsert({
      where: { userId: viewer.id },
      create: {
        userId: viewer.id,
        descriptor: enrolled.descriptor,
        referenceImageUrl: null
      },
      update: {
        descriptor: enrolled.descriptor,
        referenceImageUrl: null,
        active: true
      }
    });
    await audit({
      actorId: viewer.id,
      action: "user.face_register",
      entityType: "User",
      entityId: viewer.id,
      ipAddress: req.ip
    });

    ok(res, serializeUser(user));
  })
);

router.patch(
  "/:id",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const input = userSchema.partial().parse(req.body);
    const viewer = (req as AuthenticatedRequest).user;
    ensureRoleMutationAllowed(viewer.role, input.role);
    const userId = req.params.id;
    const current = await prisma.user.findUnique({ where: { id: userId } });
    if (!current) {
      throw new AppError(404, "User not found.");
    }
    ensureRoleMutationAllowed(viewer.role, current.role);

    const nextEmail = input.email?.trim().toLowerCase();
    if (nextEmail && nextEmail !== current.email) {
      const existing = await prisma.user.findUnique({ where: { email: nextEmail } });
      if (existing) {
        throw new AppError(409, "A user with this email already exists.");
      }
    }

    const nextDepartmentId = input.departmentId?.trim() ?? current.departmentId;
    const nextDesignationId = input.designationId?.trim() ?? current.designationId;
    if (!nextDepartmentId || !nextDesignationId) {
      throw new AppError(400, "Department and designation are required.");
    }
    const [department, designation] = await Promise.all([
      prisma.department.findUnique({ where: { id: nextDepartmentId } }),
      prisma.designation.findUnique({ where: { id: nextDesignationId } })
    ]);
    if (!department) {
      throw new AppError(404, "Department not found");
    }
    if (!designation) {
      throw new AppError(404, "Designation not found");
    }
    if (designation.departmentId !== department.id) {
      throw new AppError(400, "Designation does not belong to selected department");
    }

    const updated = await prisma.user.update({
      where: { id: current.id },
      data: {
        name: input.name?.trim(),
        email: nextEmail,
        role: input.role,
        departmentId: nextDepartmentId,
        designationId: nextDesignationId,
        managerId: input.managerId,
        phone: input.phone?.trim()
      }
    });
    await audit({
      actorId: viewer.id,
      action: "user.update",
      entityType: "User",
      entityId: updated.id,
      metadata: { before: serializeUser(current), after: serializeUser(updated) },
      ipAddress: req.ip
    });

    ok(res, serializeUser(updated));
  })
);

router.patch(
  "/:id/status",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const input = z.object({ active: z.boolean() }).parse(req.body);
    const viewer = (req as AuthenticatedRequest).user;
    const current = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!current) {
      throw new AppError(404, "User not found.");
    }
    ensureRoleMutationAllowed(viewer.role, current.role);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { active: input.active }
    });
    await audit({
      actorId: viewer.id,
      action: "user.status",
      entityType: "User",
      entityId: user.id,
      metadata: { active: input.active },
      ipAddress: req.ip
    });

    ok(res, serializeUser(user));
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const current = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!current) throw new AppError(404, "User not found.");
    ensureRoleMutationAllowed(viewer.role, current.role);

    const userId = req.params.id;
    
    await prisma.appNotification.deleteMany({ where: { userId } });
    await prisma.userFaceProfile.deleteMany({ where: { userId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.deviceLoginLog.deleteMany({ where: { userId } });
    
    await prisma.shiftChangeLog.deleteMany({ where: { shift: { employeeId: userId } } });
    await prisma.shift.deleteMany({ where: { employeeId: userId } });
    await prisma.shiftTemplate.deleteMany({ where: { employeeId: userId } });
    
    await prisma.attendanceLocationPing.deleteMany({ where: { employeeId: userId } });
    await prisma.attendanceBreak.deleteMany({ where: { attendance: { employeeId: userId } } });
    await prisma.attendanceCorrectionRequest.deleteMany({ where: { employeeId: userId } });
    await prisma.attendanceDispute.deleteMany({ where: { employeeId: userId } });
    await prisma.attendanceRecord.deleteMany({ where: { employeeId: userId } });
    
    await prisma.leaveRequest.deleteMany({ where: { employeeId: userId } });
    await prisma.locationExceptionRequest.deleteMany({ where: { employeeId: userId } });

    try {
      await prisma.user.delete({ where: { id: userId } });
    } catch (e: any) {
      if (
        e.code === "P2003" || 
        (e.message && e.message.includes("violates RESTRICT setting")) ||
        (e.message && e.message.includes("Foreign key constraint failed"))
      ) {
        throw new AppError(400, "Cannot delete employee because they are linked to administrative records (e.g., they assigned shifts or approved leaves). Please deactivate them instead.");
      }
      throw e;
    }
    await audit({
      actorId: viewer.id,
      action: "user.delete",
      entityType: "User",
      entityId: req.params.id,
      ipAddress: req.ip
    });

    ok(res, { deleted: true });
  })
);

router.patch(
  "/:id/reset-face",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const current = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!current) throw new AppError(404, "User not found.");
    ensureRoleMutationAllowed(viewer.role, current.role);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        faceReferenceDataUrl: null,
        faceRegisteredAt: null
      }
    });

    await prisma.userFaceProfile.deleteMany({
      where: { userId: req.params.id }
    });

    await audit({
      actorId: viewer.id,
      action: "user.reset_face",
      entityType: "User",
      entityId: user.id,
      ipAddress: req.ip
    });

    ok(res, serializeUser(user));
  })
);

router.patch(
  "/:id/reset-password",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const current = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!current) throw new AppError(404, "User not found.");
    ensureRoleMutationAllowed(viewer.role, current.role);

    const defaultPasswordHash = await bcrypt.hash(defaultPassword, 12);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash: defaultPasswordHash }
    });

    await audit({
      actorId: viewer.id,
      action: "user.reset_password",
      entityType: "User",
      entityId: user.id,
      ipAddress: req.ip
    });

    ok(res, serializeUser(user));
  })
);

router.post(
  "/:id/force-logout",
  requireAuth,
  requireRoles("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { reason } = req.body;
    if (!reason || typeof reason !== "string") {
      throw new AppError(400, "A reason is required to force logout.");
    }
    const viewer = (req as AuthenticatedRequest).user;
    
    await prisma.user.update({
      where: { id: req.params.id },
      data: { forceLogoutAt: new Date() }
    });
    
    await prisma.refreshToken.deleteMany({
      where: { userId: req.params.id }
    });
    
    // Automatically punch out the user if they have an active attendance
    const activeAttendance = await prisma.attendanceRecord.findFirst({
      where: { employeeId: req.params.id, punchOutAt: null }
    });
    if (activeAttendance && activeAttendance.punchInAt) {
      const punchOutAt = new Date();
      const openBreak = await prisma.attendanceBreak.findFirst({
        where: { attendanceId: activeAttendance.id, endedAt: null }
      });
      let addedBreakMinutes = 0;
      if (openBreak) {
        addedBreakMinutes = Math.max(0, Math.round((punchOutAt.getTime() - openBreak.startedAt.getTime()) / 60000));
        await prisma.attendanceBreak.update({
          where: { id: openBreak.id },
          data: { endedAt: punchOutAt, breakMinutes: addedBreakMinutes }
        });
      }
      const newBreakMinutes = activeAttendance.breakMinutes + addedBreakMinutes;
      const grossMinutes = Math.max(0, Math.round((punchOutAt.getTime() - activeAttendance.punchInAt.getTime()) / 60000));
      const totalMinutes = Math.max(0, grossMinutes - newBreakMinutes);
      
      await prisma.attendanceRecord.update({
        where: { id: activeAttendance.id },
        data: {
          punchOutAt,
          punchOutLocation: "System (Force Logout)",
          breakMinutes: newBreakMinutes,
          grossMinutes,
          totalMinutes,
          status: totalMinutes >= 540 ? "PRESENT" : totalMinutes > 0 ? "HALF_DAY" : "MISSED_PUNCH"
        }
      });
    }

    await audit({
      actorId: viewer.id,
      action: "FORCE_LOGOUT",
      entityType: "User",
      entityId: req.params.id,
      metadata: { reason },
      ipAddress: req.ip
    });
    
    ok(res, { success: true });
  })
);

export { router as usersRouter };
