import {
  AppNotification,
  AttendanceDispute,
  AttendanceLocationPing,
  AttendanceMonthFinalization,
  AttendanceRecord,
  LeaveRequest,
  LocationExceptionRequest,
  Shift,
  ShiftTemplate,
  User
} from "@prisma/client";
import { getPrivatePhotoReadUrl, isS3PhotoStorage } from "./privatePhotos.js";


type SerializableSettings = {
  companyName: string;
  defaultLocation: string;
  defaultLatitude?: number | null;
  defaultLongitude?: number | null;
  geofenceRadiusMeters?: number;
  shiftGraceMinutes: number;
  sessionHours: number;
  allowEmployeeLeaveRequest: boolean;
  requireShiftForPunch: boolean;
  requireLocationForPunch?: boolean;
  attendancePolicyVersion?: string;
  attendancePolicyText?: string;
  requireBiometricFaceMatch?: boolean;
  faceMatchThreshold?: number;
  payrollStandardDailyMinutes?: number;
  payrollHalfDayMinutes?: number;
  payrollLateGraceCount?: number;
  payrollLateDeductionAfter?: number;
  payrollBonusMaxLateCount?: number;
  updatedAt: Date;
};

type SerializableCorrection = {
  id: string;
  attendanceId: string;
  employeeId: string;
  employeeName: string;
  requestedPunchInAt?: Date | null;
  requestedPunchOutAt?: Date | null;
  reason: string;
  status: string;
  requestedAt: Date;
  decidedById?: string | null;
  decidedAt?: Date | null;
  decisionNote?: string | null;
};

type SerializableMonthLock = {
  id: string;
  month: string;
  lockedById: string;
  lockedAt: Date;
  note?: string | null;
};

export function serializeUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    departmentId: user.departmentId,
    designationId: user.designationId,
    managerId: user.managerId ?? undefined,
    phone: user.phone ?? undefined,
    joiningDate: user.joiningDate.toISOString().slice(0, 10),
    faceRegisteredAt: user.faceRegisteredAt?.toISOString(),
    faceVerificationReady: Boolean(user.faceReferenceDataUrl && user.faceRegisteredAt),
    attendancePolicyAcceptedAt: user.attendancePolicyAcceptedAt?.toISOString(),
    attendancePolicyVersion: user.attendancePolicyVersion ?? undefined,
    active: user.active
  };
}

export function serializeShift(shift: Shift) {
  return {
    id: shift.id,
    employeeId: shift.employeeId,
    employeeName: shift.employeeName,
    date: shift.date.toISOString().slice(0, 10),
    startTime: shift.startTime,
    endTime: shift.endTime,
    type: shift.type,
    isNightShift: shift.isNightShift,
    locationName: shift.locationName,
    notes: shift.notes ?? undefined,
    status: shift.status,
    assignedBy: shift.assignedById,
    assignedAt: shift.assignedAt.toISOString(),
    updatedAt: shift.updatedAt.toISOString()
  };
}

export function serializeShiftTemplate(template: ShiftTemplate) {
  return {
    id: template.id,
    employeeId: template.employeeId,
    employeeName: template.employeeName,
    startTime: template.startTime,
    endTime: template.endTime,
    type: template.type,
    isNightShift: template.isNightShift,
    locationName: template.locationName,
    notes: template.notes ?? undefined,
    active: template.active,
    assignedBy: template.assignedById,
    assignedAt: template.assignedAt.toISOString(),
    updatedAt: template.updatedAt.toISOString()
  };
}

export function serializeAttendance(record: AttendanceRecord, activeBreakStartedAt?: Date | null) {
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    shiftId: record.shiftId ?? "unassigned",
    date: record.date.toISOString().slice(0, 10),
    punchInAt: record.punchInAt?.toISOString(),
    punchOutAt: record.punchOutAt?.toISOString(),
    punchInLocation: record.punchInLocation ?? undefined,
    punchOutLocation: record.punchOutLocation ?? undefined,
    punchInLatitude: record.punchInLatitude ?? undefined,
    punchInLongitude: record.punchInLongitude ?? undefined,
    punchOutLatitude: record.punchOutLatitude ?? undefined,
    punchOutLongitude: record.punchOutLongitude ?? undefined,
    faceVerified: record.faceVerified,
    faceVerificationStatus: record.faceVerificationStatus ?? undefined,
    faceMatchScore: record.faceMatchScore ?? undefined,
    faceLivenessStatus: record.faceLivenessStatus ?? undefined,
    faceSelfieDataUrl: record.faceSelfieDataUrl ?? undefined,
    faceSelfieObjectKey: record.faceSelfieObjectKey ?? undefined,
    faceCapturedAt: record.faceCapturedAt?.toISOString(),
    totalMinutes: record.totalMinutes ?? undefined,
    grossMinutes: record.grossMinutes ?? undefined,
    breakMinutes: record.breakMinutes,
    lateMinutes: record.lateMinutes,
    lateStatus: (record as any).lateStatus ?? undefined,
    activeBreakStartedAt: activeBreakStartedAt?.toISOString(),
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

export async function serializeAttendanceWithPrivatePhoto(record: AttendanceRecord, activeBreakStartedAt?: Date | null) {
  const serialized = serializeAttendance(record, activeBreakStartedAt);
  if (isS3PhotoStorage() && record.faceSelfieObjectKey) {
    return {
      ...serialized,
      faceSelfieDataUrl: await getPrivatePhotoReadUrl(record.faceSelfieObjectKey)
    };
  }
  return serialized;
}

export function serializeLeave(request: LeaveRequest) {
  return {
    id: request.id,
    employeeId: request.employeeId,
    employeeName: request.employeeName,
    fromDate: request.fromDate.toISOString().slice(0, 10),
    toDate: request.toDate.toISOString().slice(0, 10),
    leaveType: request.leaveType,
    reason: request.reason,
    status: request.status,
    requestedAt: request.requestedAt.toISOString(),
    decidedBy: request.decidedById ?? undefined,
    decidedAt: request.decidedAt?.toISOString(),
    decisionNote: request.decisionNote ?? undefined
  };
}

export function serializeNotification(item: AppNotification) {
  return {
    id: item.id,
    userId: item.userId,
    title: item.title,
    body: item.body,
    type: item.type,
    read: item.read,
    createdAt: item.createdAt.toISOString()
  };
}

export function serializeSettings(settings: SerializableSettings) {
  return {
    companyName: settings.companyName,
    defaultLocation: settings.defaultLocation,
    defaultLatitude: settings.defaultLatitude ?? undefined,
    defaultLongitude: settings.defaultLongitude ?? undefined,
    geofenceRadiusMeters: settings.geofenceRadiusMeters ?? 200,
    shiftGraceMinutes: settings.shiftGraceMinutes,
    defaultShiftStartTime: settings.defaultShiftStartTime ?? "09:00",
    defaultShiftEndTime: settings.defaultShiftEndTime ?? "17:00",
    lateMarkThresholdMinutes: settings.lateMarkThresholdMinutes ?? 15,
    lateWarningThresholdMinutes: settings.lateWarningThresholdMinutes ?? 30,
    defaultBreakDurationMinutes: settings.defaultBreakDurationMinutes ?? 60,
    sessionHours: settings.sessionHours,
    allowEmployeeLeaveRequest: settings.allowEmployeeLeaveRequest,
    requireShiftForPunch: settings.requireShiftForPunch,
    requireLocationForPunch: settings.requireLocationForPunch ?? true,
    attendancePolicyVersion: settings.attendancePolicyVersion ?? "v1",
    attendancePolicyText: settings.attendancePolicyText ?? "",
    requireBiometricFaceMatch: settings.requireBiometricFaceMatch ?? false,
    faceMatchThreshold: settings.faceMatchThreshold ?? 0.75,
    payrollStandardDailyMinutes: settings.payrollStandardDailyMinutes ?? 480,
    payrollHalfDayMinutes: settings.payrollHalfDayMinutes ?? 240,
    payrollLateGraceCount: settings.payrollLateGraceCount ?? 5,
    payrollLateDeductionAfter: settings.payrollLateDeductionAfter ?? 8,
    payrollBonusMaxLateCount: settings.payrollBonusMaxLateCount ?? 2,
    updatedAt: settings.updatedAt.toISOString()
  };
}

export function serializeCorrection(request: SerializableCorrection) {
  return {
    id: request.id,
    attendanceId: request.attendanceId,
    employeeId: request.employeeId,
    employeeName: request.employeeName,
    requestedPunchInAt: request.requestedPunchInAt?.toISOString(),
    requestedPunchOutAt: request.requestedPunchOutAt?.toISOString(),
    reason: request.reason,
    status: request.status,
    requestedAt: request.requestedAt.toISOString(),
    decidedBy: request.decidedById ?? undefined,
    decidedAt: request.decidedAt?.toISOString(),
    decisionNote: request.decisionNote ?? undefined
  };
}

export function serializeMonthLock(lock: SerializableMonthLock) {
  return {
    id: lock.id,
    month: lock.month,
    lockedBy: lock.lockedById,
    lockedAt: lock.lockedAt.toISOString(),
    note: lock.note ?? undefined
  };
}

export function serializeFinalization(item: AttendanceMonthFinalization) {
  return {
    id: item.id,
    month: item.month,
    finalizedBy: item.finalizedById,
    finalizedAt: item.finalizedAt.toISOString(),
    note: item.note ?? undefined
  };
}

export function serializeDispute(item: AttendanceDispute) {
  return {
    id: item.id,
    attendanceId: item.attendanceId,
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    reason: item.reason,
    status: item.status,
    hrNote: item.hrNote ?? undefined,
    superAdminNote: item.superAdminNote ?? undefined,
    reviewedBy: item.reviewedById ?? undefined,
    resolvedBy: item.resolvedById ?? undefined,
    reviewedAt: item.reviewedAt?.toISOString(),
    resolvedAt: item.resolvedAt?.toISOString(),
    requestedAt: item.requestedAt.toISOString()
  };
}

export function serializeLocationException(item: LocationExceptionRequest) {
  return {
    id: item.id,
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    date: item.date.toISOString().slice(0, 10),
    reason: item.reason,
    status: item.status,
    decidedBy: item.decidedById ?? undefined,
    decidedAt: item.decidedAt?.toISOString(),
    decisionNote: item.decisionNote ?? undefined,
    requestedAt: item.requestedAt.toISOString()
  };
}

export function serializeLocationPing(ping: AttendanceLocationPing) {
  return {
    id: ping.id,
    attendanceId: ping.attendanceId,
    employeeId: ping.employeeId,
    latitude: ping.latitude,
    longitude: ping.longitude,
    accuracyMeters: ping.accuracyMeters ?? undefined,
    locationName: ping.locationName ?? undefined,
    risk: ping.risk ?? undefined,
    reviewStatus: ping.reviewStatus ?? undefined,
    reviewNote: ping.reviewNote ?? undefined,
    reviewedBy: ping.reviewedById ?? undefined,
    reviewedAt: ping.reviewedAt?.toISOString(),
    capturedAt: ping.capturedAt.toISOString()
  };
}
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
