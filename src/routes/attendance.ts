import { Request, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { audit } from "../audit.js";
import { asyncHandler } from "../asyncHandler.js";
import { parseDateOnly, todayDateOnly } from "../date.js";
import { prisma } from "../db.js";
import { queueEmail } from "../email.js";
import { AppError } from "../errors.js";
import { verifyFace } from "../faceVerification.js";
import { ok } from "../http.js";
import { dispatchWebhook } from "../integrations.js";
import { findMonthLock } from "../monthLocks.js";
import { cleanupExpiredSelfies, storeAttendanceSelfie } from "../privatePhotos.js";
import { rateLimit } from "../rateLimit.js";
import { serializeAttendance, serializeAttendanceWithPrivatePhoto, serializeCorrection, serializeDispute } from "../serializers.js";
import { upload } from "../middleware/multer.js";
import { verifyFaceService } from "../modules/face/services/verifyFaceService.js";
const router = Router();

const optionalNumber = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? undefined : Number(value)),
  z.number()
);

const optionalBoolean = z.preprocess(
  (value) => {
    if (value === "" || value === undefined || value === null) {
      return undefined;
    }
    if (value === "true" || value === true) {
      return true;
    }
    if (value === "false" || value === false) {
      return false;
    }
    return value;
  },
  z.boolean()
);

type RequestImage = {
  source: Buffer;
  dataUrl: string;
  mimeType: string;
  extension: string;
};

function imageFromRequest(req: Request): RequestImage {
  if (req.file?.buffer) {
    const mimeType = req.file.mimetype === "image/png" ? "image/png" : "image/jpeg";
    return {
      source: req.file.buffer,
      dataUrl: `data:${mimeType};base64,${req.file.buffer.toString("base64")}`,
      mimeType,
      extension: mimeType === "image/png" ? "png" : "jpg"
    };
  }
  const dataUrl = typeof req.body?.faceSelfieDataUrl === "string" ? req.body.faceSelfieDataUrl : undefined;
  if (!dataUrl) {
    throw new AppError(400, "Image is required");
  }
  let normalized = dataUrl.trim();
  while (/^data:image\/(jpeg|jpg|png);base64,data:image\//.test(normalized)) {
    normalized = normalized.replace(/^data:image\/(jpeg|jpg|png);base64,/, "");
  }
  const match = normalized.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    throw new AppError(400, "Image must be a JPEG or PNG captured by the app.");
  }
  const mimeType = match[1] === "png" ? "image/png" : "image/jpeg";
  const base64 = match[2].replace(/\s/g, "");
  return {
    source: Buffer.from(base64, "base64"),
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    extension: mimeType === "image/png" ? "png" : "jpg"
  };
}

const punchSchema = z.object({
  locationName: z.string().optional(),
  latitude: optionalNumber.pipe(z.number().min(-90).max(90)).optional(),
  longitude: optionalNumber.pipe(z.number().min(-180).max(180)).optional(),
  accuracyMeters: optionalNumber.optional(),
  deviceId: z.string().optional(),
  mocked: optionalBoolean.optional(),
  faceSelfieDataUrl: z.string().optional()
});

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/, "Month must be in YYYY-MM format.");
const correctionSchema = z.object({
  requestedPunchInAt: z.string().datetime().optional(),
  requestedPunchOutAt: z.string().datetime().optional(),
  reason: z.string().min(5).max(500)
});
const correctionDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  decisionNote: z.string().max(500).optional()
});
const locationPingSchema = z.object({
  locationName: z.string().optional(),
  latitude: optionalNumber.pipe(z.number().min(-90).max(90)),
  longitude: optionalNumber.pipe(z.number().min(-180).max(180)),
  accuracyMeters: optionalNumber.optional(),
  mocked: optionalBoolean.optional()
});

function distanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const earthRadiusMeters = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validateLocation(
  input: z.infer<typeof punchSchema>,
  settings: {
    requireLocationForPunch: boolean;
    defaultLatitude: number | null;
    defaultLongitude: number | null;
    geofenceRadiusMeters: number;
  },
  skipGeofence = false
) {
  if (!settings.requireLocationForPunch) {
    return undefined;
  }
  if (!skipGeofence && input.mocked) {
    throw new AppError(403, "Mock location detected. Disable mock GPS before using attendance.");
  }
  if (input.latitude === undefined || input.longitude === undefined) {
    throw new AppError(400, "Location is required for attendance.");
  }
  if (!skipGeofence && input.accuracyMeters !== undefined && input.accuracyMeters > 100) {
    throw new AppError(400, "GPS accuracy is too low. Move to an open area and try again.");
  }
  if (settings.defaultLatitude === null || settings.defaultLongitude === null) {
    return { risk: "LOCATION_CAPTURED_NO_GEOFENCE" };
  }

  const distance = distanceMeters(
    { latitude: settings.defaultLatitude, longitude: settings.defaultLongitude },
    { latitude: input.latitude, longitude: input.longitude }
  );
  // Saturday / WFH exception: record distance but don't block
  if (!skipGeofence && distance > settings.geofenceRadiusMeters) {
    throw new AppError(400, `You are outside the attendance geofence by ${Math.round(distance)}m.`);
  }
  return { distanceMeters: Math.round(distance), accuracyMeters: input.accuracyMeters };
}


function locationRiskFromDistance(distanceMeters?: number, accuracyMeters?: number) {
  if (accuracyMeters !== undefined && accuracyMeters > 75) {
    return "LOW_ACCURACY";
  }
  if (distanceMeters !== undefined && distanceMeters > 5000) {
    return "FAR_FROM_GEOFENCE";
  }
  return undefined;
}

async function findActiveAttendance(employeeId: string) {
  const today = parseDateOnly(todayDateOnly());
  const activeSince = new Date(Date.now() - 36 * 60 * 60 * 1000);
  return prisma.attendanceRecord.findFirst({
    where: {
      employeeId,
      OR: [
        { date: today },
        { punchOutAt: null, punchInAt: { gte: activeSince } }
      ]
    },
    include: {
      breaks: {
        where: { endedAt: null },
        orderBy: { startedAt: "desc" },
        take: 1
      }
    },
    orderBy: { punchInAt: "desc" }
  });
}

// function validateFaceSelfie(faceSelfieDataUrl?: string) {
//   if (!faceSelfieDataUrl) {
//     throw new AppError(400, "Face selfie is required for punch in.");
//   }
//   if (!faceSelfieDataUrl.startsWith("data:image/jpeg;base64,")) {
//     throw new AppError(400, "Face selfie must be a JPEG image captured by the app.");
//   }
//   if (faceSelfieDataUrl.length > 2_000_000) {
//     throw new AppError(400, "Face selfie is too large. Retake the photo and try again.");
//   }
//   return faceSelfieDataUrl;
// }

function ensurePolicyAccepted(user: { attendancePolicyAcceptedAt: Date | null; attendancePolicyVersion: string | null }, settings: { attendancePolicyVersion: string }) {
  if (!user.attendancePolicyAcceptedAt || user.attendancePolicyVersion !== settings.attendancePolicyVersion) {
    throw new AppError(403, "Accept the latest attendance policy before punching in.");
  }
}

function monthRange(month: string) {
  monthSchema.parse(month);
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end };
}

function monthKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 7);
}

async function ensureMonthOpen(date: Date) {
  const lock = await findMonthLock(monthKeyFromDate(date));
  if (lock) {
    throw new AppError(409, `Attendance month ${lock.month} is locked.`);
  }
}

function attendanceTotals(records: Array<{ status: string; totalMinutes: number | null; breakMinutes: number; lateMinutes: number }>) {
  return records.reduce(
    (summary, record) => ({
      records: summary.records + 1,
      presentDays: summary.presentDays + (record.status === "PRESENT" ? 1 : 0),
      inProgressDays: summary.inProgressDays + (record.status === "IN_PROGRESS" ? 1 : 0),
      netMinutes: summary.netMinutes + (record.totalMinutes ?? 0),
      breakMinutes: summary.breakMinutes + record.breakMinutes,
      lateMinutes: summary.lateMinutes + record.lateMinutes
    }),
    { records: 0, presentDays: 0, inProgressDays: 0, netMinutes: 0, breakMinutes: 0, lateMinutes: 0 }
  );
}

function recalculateAttendance(input: {
  punchInAt: Date | null;
  punchOutAt: Date | null;
  breakMinutes: number;
}) {
  if (!input.punchInAt || !input.punchOutAt) {
    return {
      grossMinutes: null,
      totalMinutes: null,
      status: input.punchInAt ? "IN_PROGRESS" : "MISSED_PUNCH"
    } as const;
  }

  const grossMinutes = Math.max(0, Math.round((input.punchOutAt.getTime() - input.punchInAt.getTime()) / 60000));
  const totalMinutes = Math.max(0, grossMinutes - input.breakMinutes);
  return {
    grossMinutes,
    totalMinutes,
    status: totalMinutes >= 540 ? "PRESENT" : totalMinutes > 0 ? "HALF_DAY" : "MISSED_PUNCH"
  } as const;
}

router.get(
  "/",
  requireAuth,
  requireRoles("ADMIN", "HR", "MANAGER"),
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === "string" ? parseDateOnly(req.query.from) : undefined;
    const to = typeof req.query.to === "string" ? parseDateOnly(req.query.to) : undefined;
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const records = await prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        date: from || to ? { gte: from, lte: to } : undefined
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }]
    });

    ok(res, await Promise.all(records.map((record) => serializeAttendanceWithPrivatePhoto(record))));
  })
);

router.get(
  "/today",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const record = await findActiveAttendance(user.id);
    ok(res, record ? await serializeAttendanceWithPrivatePhoto(record, record.breaks[0]?.startedAt) : null);
  })
);

router.get(
  "/history",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const month = typeof req.query.month === "string" ? req.query.month : todayDateOnly().slice(0, 7);
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : viewer.id;
    const { start, end } = monthRange(month);

    if (viewer.role === "EMPLOYEE" && employeeId !== viewer.id) {
      throw new AppError(403, "Employees can only view their own attendance history.");
    }

    const records = await prisma.attendanceRecord.findMany({
      where: {
        employeeId,
        date: { gte: start, lt: end }
      },
      include: { shift: true },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }]
    });

    ok(res, {
      month,
      employeeId,
      summary: attendanceTotals(records),
      records: await Promise.all(records.map(async (record) => {
          const ser = await serializeAttendanceWithPrivatePhoto(record);
          return { ...ser, isNightShift: record.shift?.isNightShift ?? false };
        }))
    });
  })
);

router.get(
  "/corrections",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const employeeId = typeof req.query.employeeId === "string" ? req.query.employeeId : undefined;
    const corrections = await prisma.attendanceCorrectionRequest.findMany({
      where: {
        employeeId: viewer.role === "EMPLOYEE" ? viewer.id : employeeId,
        status: status === "PENDING" || status === "APPROVED" || status === "REJECTED" ? status : undefined
      },
      orderBy: { requestedAt: "desc" }
    });

    ok(res, corrections.map(serializeCorrection));
  })
);

router.post(
  "/punch-in",
  requireAuth,
  upload.single("image"),
  rateLimit({ keyPrefix: "attendance.punch_in", windowMs: 60 * 1000, max: 8 }),
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const input = punchSchema.parse(req.body);
    const image = imageFromRequest(req);
    const faceResult =
      await verifyFaceService(
        user.id,
        image.source
      );
    if (!faceResult.matched) {
      throw new AppError(
        403,
        "Face verification failed"
      );
    }
    let dateKey = todayDateOnly();
    let date = parseDateOnly(dateKey);
    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });
    const now = new Date();
    
    // Cross-midnight check
    const yesterday = new Date(date);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    let shift = await prisma.shift.findFirst({
      where: {
        employeeId: user.id,
        OR: [
          { date },
          {
            date: yesterday,
            isNightShift: true,
            endAt: { gte: new Date(now.getTime() - 4 * 60 * 60 * 1000) }
          },
          {
            startAt: { lte: now },
            endAt: { gte: now }
          }
        ],
        status: { not: "CANCELLED" }
      },
      orderBy: { startAt: "desc" }
    });

    if (shift && shift.date.getTime() === yesterday.getTime()) {
      date = yesterday;
      dateKey = yesterday.toISOString().slice(0, 10);
    }

    await ensureMonthOpen(date);

    // Fall back to the employee's active default shift template if no date-specific shift found
    let templateShift: { startAt: Date; endAt: Date; id?: string; locationName: string } | null = null;
    if (!shift) {
      const template = await prisma.shiftTemplate.findFirst({
        where: { employeeId: user.id, active: true }
      });
      if (template) {
        let targetDate = date;
        const [startHour, startMin] = template.startTime.split(":").map(Number);
        const [endHour, endMin] = template.endTime.split(":").map(Number);

        if (template.isNightShift) {
          const yEnd = new Date(yesterday);
          yEnd.setUTCHours(endHour, endMin, 0, 0);
          yEnd.setUTCDate(yEnd.getUTCDate() + 1);
          if (now <= new Date(yEnd.getTime() + 4 * 60 * 60 * 1000)) {
            targetDate = yesterday;
            date = yesterday;
            dateKey = yesterday.toISOString().slice(0, 10);
          }
        }

        // Build virtual startAt/endAt for today using the template times
        const todayBase = new Date(targetDate);
        const virtualStartAt = new Date(todayBase);
        virtualStartAt.setUTCHours(startHour, startMin, 0, 0);
        const virtualEndAt = new Date(todayBase);
        virtualEndAt.setUTCHours(endHour, endMin, 0, 0);
        // Handle overnight shifts where end is next day
        if (virtualEndAt <= virtualStartAt) {
          virtualEndAt.setUTCDate(virtualEndAt.getUTCDate() + 1);
        }
        templateShift = {
          startAt: virtualStartAt,
          endAt: virtualEndAt,
          locationName: template.locationName
        };
      } else {
        // Fall back to system-wide default shift
        const [startHour, startMin] = settings.defaultShiftStartTime.split(":").map(Number);
        const [endHour, endMin] = settings.defaultShiftEndTime.split(":").map(Number);
        const todayBase = new Date(date);
        const virtualStartAt = new Date(todayBase);
        virtualStartAt.setUTCHours(startHour, startMin, 0, 0);
        const virtualEndAt = new Date(todayBase);
        virtualEndAt.setUTCHours(endHour, endMin, 0, 0);
        if (virtualEndAt <= virtualStartAt) {
          virtualEndAt.setUTCDate(virtualEndAt.getUTCDate() + 1);
        }
        templateShift = {
          startAt: virtualStartAt,
          endAt: virtualEndAt,
          locationName: settings.defaultLocation
        };
      }
    }

    if (!shift && !templateShift && settings.requireShiftForPunch) {
      throw new AppError(400, "No shift assigned for today. Contact HR.");
    }

    // Use date-specific shift first, otherwise fall back to template's virtual times
    const effectiveShift = shift ?? templateShift;
    ensurePolicyAccepted(user, settings);

    const existing = await prisma.attendanceRecord.findFirst({
      where: { employeeId: user.id, date }
    });
    if (existing?.punchInAt) {
      ok(res, await serializeAttendanceWithPrivatePhoto(existing));
      return;
    }

    // if (!user.faceReferenceDataUrl || !user.faceRegisteredAt) {
    //   throw new AppError(400, "Register your face before punching in.");
    // }
    // ── Saturday rule: GPS required but geofence radius NOT enforced ──────────
    const isSaturday = now.getUTCDay() === 6;

    // ── WFH / location exception check ───────────────────────────────────────
    const locationException = await prisma.locationExceptionRequest.findFirst({
      where: {
        employeeId: user.id,
        date,
        status: "APPROVED"
      }
    });
    const skipGeofence = isSaturday || !!locationException;

    const locationValidation = validateLocation(input, settings, skipGeofence);
    const storedSelfie = await storeAttendanceSelfie(
      {
        buffer: image.source,
        mimeType: image.mimeType,
        extension: image.extension
      },
      user.id
    );
    const punchInAt = now;
    const rawLateMinutes = effectiveShift
      ? Math.max(0, Math.round((punchInAt.getTime() - effectiveShift.startAt.getTime()) / 60000))
      : 0;
    const lateMinutes = Math.max(0, rawLateMinutes - settings.shiftGraceMinutes);
    const lateStatus: string | null =
      rawLateMinutes <= settings.shiftGraceMinutes ? null :
      rawLateMinutes <= settings.lateMarkThresholdMinutes ? "LATE_MARK" :
                             "LATE_WARNING";
    // ── Risk level calculation ─────────────────────────────────────────────
    let riskLevel: string | null = null;
    if (locationException) riskLevel = null; // explicitly approved WFH
    else if (isSaturday) riskLevel = null;   // Saturday — geofence relaxed by policy
    else if (input.mocked) riskLevel = "blocked";
    else if (locationValidation && "risk" in locationValidation && locationValidation.risk) {
      riskLevel = locationValidation.risk === "HIGH" ? "spoof_suspected" : "manual_review";
    }

    const record = await prisma.attendanceRecord.create({
      data: {
        employeeId: user.id,
        employeeName: user.name,
        shiftId: shift?.id,
        date,
        punchInAt,
        punchInLocation: input.locationName || effectiveShift?.locationName || settings.defaultLocation,
        punchInLatitude: input.latitude,
        punchInLongitude: input.longitude,
        deviceId: input.deviceId,
        ipAddress: req.ip,
        faceVerified: faceResult.matched,
        faceVerificationStatus: "LOCAL_FACE_MATCH",
        faceMatchScore: faceResult.similarityScore,
        faceLivenessStatus: "LOCAL_FACE_ONLY",
        faceSelfieDataUrl: undefined,
        faceSelfieObjectKey: storedSelfie.objectKey,
        faceCapturedAt: punchInAt,
        lateMinutes,
        lateStatus,
        riskLevel,
        status: "IN_PROGRESS"
      }
    });

    if (shift) {
      await prisma.shift.update({
        where: { id: shift.id },
        data: { status: "IN_PROGRESS" }
      });
    }
    await prisma.appNotification.create({
      data: {
        userId: user.id,
        title: "Punch in recorded",
        body: `${dateKey} at ${punchInAt.toLocaleTimeString()}`,
        type: "ATTENDANCE"
      }
    });
    queueEmail({
      toEmail: user.email,
      subject: "DIFM punch in recorded",
      body: `Your punch in was recorded for ${dateKey} at ${punchInAt.toISOString()}.`,
      relatedType: "AttendanceRecord",
      relatedId: record.id
    }).catch((error) => console.error("Email delivery failed", error));
    await audit({
      actorId: user.id,
      action: "attendance.punch_in",
      entityType: "AttendanceRecord",
      entityId: record.id,
      metadata: {
        shiftId: shift?.id, lateMinutes, faceDistance:
          faceResult.distance, faceMatchScore: faceResult.similarityScore, locationValidation
      },
      ipAddress: req.ip
    });
    dispatchWebhook("ATTENDANCE_PUNCH_IN", {
      attendanceId: record.id,
      employeeId: record.employeeId,
      employeeName: record.employeeName,
      punchInAt: record.punchInAt?.toISOString(),
      status: record.status
    }).catch((error) => console.error("Webhook dispatch failed", error));

    cleanupExpiredSelfies().catch((error) => console.error("Selfie retention cleanup failed", error));
    ok(res, await serializeAttendanceWithPrivatePhoto(record), 201);
  })
);

router.post(
  "/punch-out",
  requireAuth,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const input = punchSchema.parse(req.body);
    const image = imageFromRequest(req);
    const faceResult =
      await verifyFaceService(
        user.id,
        image.source
      );
    console.log("faceResult === ", faceResult);
    if (!faceResult.matched) {
      throw new AppError(
        403,
        "Face verification failed"
      );
    }
    const existing = await findActiveAttendance(user.id);
    if (!existing?.punchInAt) {
      throw new AppError(400, "Punch in before punching out.");
    }
    if (existing.punchOutAt) {
      ok(res, await serializeAttendanceWithPrivatePhoto(existing));
      return;
    }

    const punchOutAt = new Date();
    await ensureMonthOpen(existing.date);
    const openBreak = existing.breaks[0];
    if (openBreak) {
      throw new AppError(400, "End your break before punching out.");
    }
    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });
    const locationValidation = validateLocation(input, settings);
    const grossMinutes = Math.max(
      0,
      Math.round((punchOutAt.getTime() - existing.punchInAt.getTime()) / 60000)
    );
    const totalMinutes = Math.max(0, grossMinutes - existing.breakMinutes);
    const record = await prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        punchOutAt,
        punchOutLocation: input.locationName,
        punchOutLatitude: input.latitude,
        punchOutLongitude: input.longitude,
        grossMinutes,
        totalMinutes,
        status: totalMinutes >= 540 ? "PRESENT" : totalMinutes > 0 ? "HALF_DAY" : "MISSED_PUNCH"
      }
    });

    if (existing.shiftId) {
      await prisma.shift.update({
        where: { id: existing.shiftId },
        data: { status: "COMPLETED" }
      });
    }
    await prisma.appNotification.create({
      data: {
        userId: user.id,
        title: "Punch out recorded",
        body: `${record.date.toISOString().slice(0, 10)}, total ${record.totalMinutes ?? 0} minutes`,
        type: "ATTENDANCE"
      }
    });
    queueEmail({
      toEmail: user.email,
      subject: "DIFM punch out recorded",
      body: `Your punch out was recorded. Net minutes: ${record.totalMinutes ?? 0}.`,
      relatedType: "AttendanceRecord",
      relatedId: record.id
    }).catch((error) => console.error("Email delivery failed", error));
    await audit({
      actorId: user.id,
      action: "attendance.punch_out",
      entityType: "AttendanceRecord",
      entityId: record.id,
      metadata: {
        grossMinutes, totalMinutes, locationValidation, faceDistance:
          faceResult.distance, faceMatchScore: faceResult.similarityScore
      },
      ipAddress: req.ip
    });
    dispatchWebhook("ATTENDANCE_PUNCH_OUT", {
      attendanceId: record.id,
      employeeId: record.employeeId,
      employeeName: record.employeeName,
      punchOutAt: record.punchOutAt?.toISOString(),
      totalMinutes: record.totalMinutes,
      status: record.status
    }).catch((error) => console.error("Webhook dispatch failed", error));

    ok(res, await serializeAttendanceWithPrivatePhoto(record));
  })
);

router.post(
  "/:id/corrections",
  requireAuth,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const input = correctionSchema.parse(req.body);
    if (!input.requestedPunchInAt && !input.requestedPunchOutAt) {
      throw new AppError(400, "Request at least one punch time correction.");
    }

    const attendance = await prisma.attendanceRecord.findUnique({ where: { id: req.params.id } });
    if (!attendance) {
      throw new AppError(404, "Attendance record not found.");
    }
    await ensureMonthOpen(attendance.date);
    if (attendance.employeeId !== user.id) {
      throw new AppError(403, "You can only request corrections for your own attendance.");
    }

    const existingPending = await prisma.attendanceCorrectionRequest.findFirst({
      where: { attendanceId: attendance.id, status: "PENDING" }
    });
    if (existingPending) {
      throw new AppError(409, "A correction request is already pending for this record.");
    }

    const correction = await prisma.attendanceCorrectionRequest.create({
      data: {
        attendanceId: attendance.id,
        employeeId: user.id,
        employeeName: user.name,
        requestedPunchInAt: input.requestedPunchInAt ? new Date(input.requestedPunchInAt) : undefined,
        requestedPunchOutAt: input.requestedPunchOutAt ? new Date(input.requestedPunchOutAt) : undefined,
        reason: input.reason.trim()
      }
    });
    await audit({
      actorId: user.id,
      action: "attendance.correction_request",
      entityType: "AttendanceCorrectionRequest",
      entityId: correction.id,
      metadata: { attendanceId: attendance.id },
      ipAddress: req.ip
    });

    ok(res, serializeCorrection(correction), 201);
  })
);

router.patch(
  "/corrections/:id/decision",
  requireAuth,
  requireRoles("ADMIN", "HR", "MANAGER"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = correctionDecisionSchema.parse(req.body);
    const correction = await prisma.attendanceCorrectionRequest.findUnique({
      where: { id: req.params.id },
      include: { attendance: true }
    });
    if (!correction) {
      throw new AppError(404, "Correction request not found.");
    }
    if (correction.status !== "PENDING") {
      throw new AppError(409, "Correction request is already decided.");
    }
    await ensureMonthOpen(correction.attendance.date);

    const decidedAt = new Date();
    if (input.status === "REJECTED") {
      const rejected = await prisma.attendanceCorrectionRequest.update({
        where: { id: correction.id },
        data: {
          status: "REJECTED",
          decidedById: viewer.id,
          decidedAt,
          decisionNote: input.decisionNote?.trim()
        }
      });
      await audit({
        actorId: viewer.id,
        action: "attendance.correction_reject",
        entityType: "AttendanceCorrectionRequest",
        entityId: rejected.id,
        ipAddress: req.ip
      });
      dispatchWebhook("CORRECTION_DECIDED", {
        correctionId: rejected.id,
        attendanceId: rejected.attendanceId,
        employeeId: rejected.employeeId,
        status: rejected.status
      }).catch((error) => console.error("Webhook dispatch failed", error));
      ok(res, serializeCorrection(rejected));
      return;
    }

    const punchInAt = correction.requestedPunchInAt ?? correction.attendance.punchInAt;
    const punchOutAt = correction.requestedPunchOutAt ?? correction.attendance.punchOutAt;
    if (punchInAt && punchOutAt && punchOutAt <= punchInAt) {
      throw new AppError(400, "Corrected punch out must be after punch in.");
    }
    const recalculated = recalculateAttendance({
      punchInAt,
      punchOutAt,
      breakMinutes: correction.attendance.breakMinutes
    });

    const approved = await prisma.$transaction(async (tx) => {
      await tx.attendanceRecord.update({
        where: { id: correction.attendanceId },
        data: {
          punchInAt,
          punchOutAt,
          grossMinutes: recalculated.grossMinutes,
          totalMinutes: recalculated.totalMinutes,
          status: recalculated.status
        }
      });
      return tx.attendanceCorrectionRequest.update({
        where: { id: correction.id },
        data: {
          status: "APPROVED",
          decidedById: viewer.id,
          decidedAt,
          decisionNote: input.decisionNote?.trim()
        }
      });
    });
    await audit({
      actorId: viewer.id,
      action: "attendance.correction_approve",
      entityType: "AttendanceCorrectionRequest",
      entityId: approved.id,
      metadata: { attendanceId: correction.attendanceId, recalculated },
      ipAddress: req.ip
    });
    dispatchWebhook("CORRECTION_DECIDED", {
      correctionId: approved.id,
      attendanceId: approved.attendanceId,
      employeeId: approved.employeeId,
      status: approved.status
    }).catch((error) => console.error("Webhook dispatch failed", error));

    ok(res, serializeCorrection(approved));
  })
);

router.post(
  "/break-start",
  requireAuth,
  asyncHandler(async (req, res) => {
    console.log("Break start request body:", req.body);
    const user = (req as AuthenticatedRequest).user;
    const existing = await findActiveAttendance(user.id);
    if (!existing?.punchInAt || existing.punchOutAt) {
      throw new AppError(400, "You need an active attendance session to start a break.");
    }
    if (existing.breaks[0]) {
      throw new AppError(400, "A break is already running.");
    }

    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });
    const effectiveBreakLimit = settings.defaultBreakDurationMinutes ?? user.dailyBreakLimitMinutes;

    console.log("Existing break minutes before starting new break:", existing.breakMinutes);
    console.log("Effective daily break limit : ", effectiveBreakLimit)
    if (existing.breakMinutes >= effectiveBreakLimit) {
      throw new AppError(400, `Daily break limit of ${effectiveBreakLimit} minutes reached.`);
    }
    await ensureMonthOpen(existing.date);
    const startedAt = new Date();
    await prisma.attendanceBreak.create({
      data: {
        attendanceId: existing.id,
        startedAt
      }
    });
    const record = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: existing.id } });
    await audit({
      actorId: user.id,
      action: "attendance.break_start",
      entityType: "AttendanceRecord",
      entityId: record.id,
      ipAddress: req.ip
    });

    ok(res, await serializeAttendanceWithPrivatePhoto(record, startedAt), 201);
  })
);

router.post(
  "/location-ping",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const input = locationPingSchema.parse(req.body);
    const existing = await findActiveAttendance(user.id);
    if (!existing?.punchInAt || existing.punchOutAt) {
      throw new AppError(400, "Location pings require an active attendance session.");
    }
    await ensureMonthOpen(existing.date);
    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });
    const validation = validateLocation(input, settings);
    const risk =
      validation && "risk" in validation
        ? validation.risk
        : locationRiskFromDistance(validation?.distanceMeters, input.accuracyMeters);
    const ping = await prisma.attendanceLocationPing.create({
      data: {
        attendanceId: existing.id,
        employeeId: user.id,
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyMeters: input.accuracyMeters,
        locationName: input.locationName,
        risk
      }
    });

    ok(res, {
      id: ping.id,
      capturedAt: ping.capturedAt.toISOString(),
      risk: ping.risk ?? undefined
    }, 201);
  })
);

router.post(
  "/break-end",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const existing = await findActiveAttendance(user.id);
    const openBreak = existing?.breaks[0];
    console.log("Open break to end:", openBreak?.startedAt);
    console.log("Current time:", openBreak?.endedAt);
    if (!existing?.punchInAt || existing.punchOutAt || !openBreak) {
      throw new AppError(400, "No active break to end.");
    }
    await ensureMonthOpen(existing.date);
    const endedAt = new Date();
    const addedBreakMinutes = Math.max(0, Math.round((endedAt.getTime() - openBreak.startedAt.getTime()) / 60000));
    const newBreakMinutes = existing.breakMinutes + addedBreakMinutes;

    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });
    const effectiveBreakLimit = settings.defaultBreakDurationMinutes ?? user.dailyBreakLimitMinutes;

    const exceededBreakMinutes = newBreakMinutes > effectiveBreakLimit;
    if (exceededBreakMinutes) {
      await prisma.appNotification.create({
        data: {
          userId: user.id,
          title: "Break Limit Exceeded",
          body: `${user.name} has exceeded the Break Limit of ${effectiveBreakLimit} minutes with a total of ${newBreakMinutes} break minutes today.`,
          type: "BREAK"
        }
      });
    }
    await prisma.attendanceBreak.update({
      where: { id: openBreak.id },
      data: { endedAt, breakMinutes: addedBreakMinutes }
    });
    const grossMinutes = Math.max(0, Math.round((endedAt.getTime() - existing.punchInAt.getTime()) / 60000));
    const record = await prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        breakMinutes: newBreakMinutes,
        breakLimitExceeded: exceededBreakMinutes,
        breakExceededAt: exceededBreakMinutes
          ? new Date()
          : null,
        grossMinutes,
        totalMinutes: Math.max(0, grossMinutes - newBreakMinutes)
      }
    });
    await audit({
      actorId: user.id,
      action: "attendance.break_end",
      entityType: "AttendanceRecord",
      entityId: record.id,
      metadata: { addedBreakMinutes, newBreakMinutes },
      ipAddress: req.ip
    });

    ok(res, await serializeAttendanceWithPrivatePhoto(record));
  })
);

// ─── PATCH /attendance/override/:id — Super Admin manual override ─────────────
router.patch(
  "/override/:id",
  requireAuth,
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = z.object({
      punchInAt:  z.string().datetime().optional(),
      punchOutAt: z.string().datetime().optional(),
      status:     z.enum(["PRESENT", "IN_PROGRESS", "ABSENT", "MISSED_PUNCH", "HALF_DAY"]).optional(),
      lateMinutes:z.number().int().min(0).optional(),
      reason:     z.string().min(5).max(1000)
    }).parse(req.body);

    const record = await prisma.attendanceRecord.findUnique({ where: { id: req.params.id } });
    if (!record) throw new AppError(404, "Attendance record not found.");

    // Recalculate gross/total minutes if times are being changed
    let grossMinutes = record.grossMinutes;
    let totalMinutes = record.totalMinutes;
    if (input.punchInAt && input.punchOutAt) {
      grossMinutes = Math.max(0, Math.round(
        (new Date(input.punchOutAt).getTime() - new Date(input.punchInAt).getTime()) / 60000
      ));
      totalMinutes = Math.max(0, grossMinutes - record.breakMinutes);
    }

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        punchInAt:   input.punchInAt   ? new Date(input.punchInAt)  : undefined,
        punchOutAt:  input.punchOutAt  ? new Date(input.punchOutAt) : undefined,
        status:      input.status      ?? undefined,
        lateMinutes: input.lateMinutes ?? undefined,
        grossMinutes,
        totalMinutes
      },
      include: { breaks: { orderBy: { startedAt: "asc" } } }
    });

    await audit({
      actorId: viewer.id,
      action: "attendance.manual_override",
      entityType: "AttendanceRecord",
      entityId: updated.id,
      metadata: { reason: input.reason, changes: input },
      ipAddress: req.ip
    });

    ok(res, await serializeAttendanceWithPrivatePhoto(updated));
  })
);

// ─── Attendance Dispute Flow ─────────────────────────────────────────────────

// POST /attendance/dispute — employee opens a dispute
router.post(
  "/dispute",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const input = z.object({
      attendanceId: z.string().min(1),
      reason: z.string().min(10).max(1000)
    }).parse(req.body);

    const record = await prisma.attendanceRecord.findUnique({ where: { id: input.attendanceId } });
    if (!record) throw new AppError(404, "Attendance record not found.");
    if (record.employeeId !== user.id) throw new AppError(403, "You can only dispute your own attendance records.");

    // One open dispute per record
    const existing = await prisma.attendanceDispute.findFirst({
      where: { attendanceId: input.attendanceId, status: { in: ["OPEN", "HR_REVIEWED"] } }
    });
    if (existing) throw new AppError(409, "An open dispute already exists for this attendance record.");

    const dispute = await prisma.attendanceDispute.create({
      data: {
        attendanceId: input.attendanceId,
        employeeId: user.id,
        employeeName: user.name,
        reason: input.reason.trim()
      }
    });

    // Notify HR
    const hrs = await prisma.user.findMany({
      where: { role: { in: ["HR", "ADMIN"] }, active: true },
      select: { id: true }
    });
    for (const hr of hrs) {
      await prisma.appNotification.create({
        data: {
          userId: hr.id,
          title: "New attendance dispute",
          body: `${user.name} has disputed their attendance on ${record.date.toISOString().slice(0, 10)}.`,
          type: "ATTENDANCE"
        }
      });
    }

    await audit({
      actorId: user.id,
      action: "attendance.dispute_open",
      entityType: "AttendanceDispute",
      entityId: dispute.id,
      ipAddress: req.ip
    });

    ok(res, serializeDispute(dispute), 201);
  })
);

// GET /attendance/disputes — list disputes
router.get(
  "/disputes",
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

    const disputes = await prisma.attendanceDispute.findMany({
      where: {
        employeeId,
        status: (status as any) ?? undefined
      },
      orderBy: { requestedAt: "desc" }
    });

    ok(res, disputes.map(serializeDispute));
  })
);

// PATCH /attendance/disputes/:id/review — HR adds note + marks HR_REVIEWED
router.patch(
  "/disputes/:id/review",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = z.object({
      hrNote: z.string().min(2).max(500)
    }).parse(req.body);

    const dispute = await prisma.attendanceDispute.findUnique({ where: { id: req.params.id } });
    if (!dispute) throw new AppError(404, "Dispute not found.");
    if (dispute.status !== "OPEN") throw new AppError(409, "Dispute is not in OPEN status.");

    const updated = await prisma.attendanceDispute.update({
      where: { id: dispute.id },
      data: {
        status: "HR_REVIEWED",
        hrNote: input.hrNote.trim(),
        reviewedById: viewer.id,
        reviewedAt: new Date()
      }
    });

    // Notify Super Admins for final decision
    const superAdmins = await prisma.user.findMany({
      where: { role: "SUPER_ADMIN", active: true },
      select: { id: true }
    });
    for (const sa of superAdmins) {
      await prisma.appNotification.create({
        data: {
          userId: sa.id,
          title: "Dispute reviewed by HR — awaiting your decision",
          body: `Dispute by ${dispute.employeeName} reviewed. HR note: ${input.hrNote.slice(0, 80)}`,
          type: "ATTENDANCE"
        }
      });
    }

    await audit({
      actorId: viewer.id,
      action: "attendance.dispute_hr_review",
      entityType: "AttendanceDispute",
      entityId: updated.id,
      ipAddress: req.ip
    });

    ok(res, serializeDispute(updated));
  })
);

// PATCH /attendance/disputes/:id/resolve — Super Admin final resolution
router.patch(
  "/disputes/:id/resolve",
  requireAuth,
  requireRoles("SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = z.object({
      status: z.enum(["RESOLVED", "DISMISSED"]),
      superAdminNote: z.string().min(2).max(500),
      // Optionally correct the attendance record during resolution
      correction: z.object({
        punchInAt:  z.string().datetime().optional(),
        punchOutAt: z.string().datetime().optional(),
        attendanceStatus: z.enum(["PRESENT", "ABSENT", "MISSED_PUNCH", "HALF_DAY"]).optional()
      }).optional()
    }).parse(req.body);

    const dispute = await prisma.attendanceDispute.findUnique({ where: { id: req.params.id } });
    if (!dispute) throw new AppError(404, "Dispute not found.");
    if (dispute.status === "RESOLVED" || dispute.status === "DISMISSED") {
      throw new AppError(409, "Dispute is already closed.");
    }

    const updated = await prisma.attendanceDispute.update({
      where: { id: dispute.id },
      data: {
        status: input.status,
        superAdminNote: input.superAdminNote.trim(),
        resolvedById: viewer.id,
        resolvedAt: new Date()
      }
    });

    // Optionally apply correction to the attendance record
    if (input.correction) {
      const c = input.correction;
      await prisma.attendanceRecord.update({
        where: { id: dispute.attendanceId },
        data: {
          punchInAt:  c.punchInAt  ? new Date(c.punchInAt)  : undefined,
          punchOutAt: c.punchOutAt ? new Date(c.punchOutAt) : undefined,
          status:     c.attendanceStatus ?? undefined
        }
      });
    }

    // Notify the employee
    await prisma.appNotification.create({
      data: {
        userId: dispute.employeeId,
        title: `Attendance dispute ${input.status === "RESOLVED" ? "resolved" : "dismissed"}`,
        body: input.superAdminNote.slice(0, 120),
        type: "ATTENDANCE"
      }
    });

    await audit({
      actorId: viewer.id,
      action: "attendance.dispute_resolve",
      entityType: "AttendanceDispute",
      entityId: updated.id,
      metadata: { status: input.status },
      ipAddress: req.ip
    });

    ok(res, serializeDispute(updated));
  })
);

// ─── PATCH /attendance/bulk-review ──────────────────────────────────────────
// HR Admin: approve or reject multiple correction requests in one call.
router.patch(
  "/bulk-review",
  requireAuth,
  requireRoles("ADMIN", "HR"),
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const input = z.object({
      ids: z.array(z.string()).min(1).max(100),
      action: z.enum(["APPROVE", "REJECT"]),
      note: z.string().max(500).optional()
    }).parse(req.body);

    const status = input.action === "APPROVE" ? "APPROVED" : "REJECTED";

    // Fetch all targeted corrections that are still PENDING
    const corrections = await prisma.attendanceCorrectionRequest.findMany({
      where: { id: { in: input.ids }, status: "PENDING" }
    });

    if (corrections.length === 0) {
      throw new AppError(400, "No pending correction requests found for the given IDs.");
    }

    const results = [];

    for (const correction of corrections) {
      const updated = await prisma.attendanceCorrectionRequest.update({
        where: { id: correction.id },
        data: {
          status,
          decidedById: viewer.id,
          decidedAt:   new Date(),
          decisionNote: input.note?.trim()
        }
      });

      // If approved, apply the requested times to the attendance record
      if (status === "APPROVED") {
        await prisma.attendanceRecord.update({
          where: { id: correction.attendanceId },
          data: {
            punchInAt:  correction.requestedPunchInAt  ?? undefined,
            punchOutAt: correction.requestedPunchOutAt ?? undefined
          }
        });
      }

      // Notify employee
      await prisma.appNotification.create({
        data: {
          userId: correction.employeeId,
          title: `Correction request ${status.toLowerCase()}`,
          body: input.note?.slice(0, 100) ?? `Your correction request was ${status.toLowerCase()}.`,
          type: "ATTENDANCE"
        }
      });

      await audit({
        actorId: viewer.id,
        action: `attendance.correction_${status.toLowerCase()}`,
        entityType: "AttendanceCorrectionRequest",
        entityId: correction.id,
        metadata: { bulkReview: true, note: input.note },
        ipAddress: req.ip
      });

      results.push({ id: correction.id, status });
    }

    ok(res, { processed: results.length, skipped: input.ids.length - corrections.length, results });
  })
);

// ─── POST /attendance/face-spoof-alert ────────────────────────────────────────
// System/Internal: fired when face match fails or liveness check fails.
// Alerts HR/Admin immediately and blocks the punch-in.
router.post(
  "/face-spoof-alert",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const input = z.object({
      reason:     z.enum(["FACE_MISMATCH", "LIVENESS_FAIL", "SPOOF_DETECTED", "LOW_CONFIDENCE"]),
      confidence: z.number().min(0).max(1).optional(),
      deviceId:   z.string().optional(),
      date:       z.string().optional()
    }).parse(req.body);

    // Write an audit record
    await audit({
      actorId: user.id,
      action: "attendance.face_spoof_alert",
      entityType: "User",
      entityId: user.id,
      metadata: { reason: input.reason, confidence: input.confidence, deviceId: input.deviceId },
      ipAddress: req.ip
    });

    const dateLabel = input.date ?? new Date().toISOString().slice(0, 10);

    // Notify all HR/Admin users
    const hrAdmins = await prisma.user.findMany({
      where: { role: { in: ["HR", "ADMIN", "SUPER_ADMIN"] }, active: true },
      select: { id: true, email: true }
    });

    for (const hr of hrAdmins) {
      await prisma.appNotification.create({
        data: {
          userId: hr.id,
          title: "⚠️ Face Verification Alert",
          body: `${user.name} failed face verification on ${dateLabel}. Reason: ${input.reason}. Confidence: ${input.confidence ?? "N/A"}`,
          type: "ATTENDANCE"
        }
      });

      queueEmail({
        toEmail: hr.email,
        subject: `[DIFM ALERT] Face verification failure — ${user.name}`,
        body: `Employee ${user.name} (${user.email}) failed face verification on ${dateLabel}.\n\nReason: ${input.reason}\nConfidence Score: ${input.confidence ?? "N/A"}\nDevice ID: ${input.deviceId ?? "N/A"}\nIP: ${req.ip}\n\nCheck-in was blocked.`,
        relatedType: "User",
        relatedId: user.id
      }).catch((err) => console.error("Face spoof alert email failed:", err));
    }

    ok(res, { alerted: true, reason: input.reason });
  })
);

export { router as attendanceRouter };