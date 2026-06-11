export type AuthUserRole = "SUPER_ADMIN" | "ADMIN" | "HR" | "MANAGER" | "EMPLOYEE";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: AuthUserRole;
  departmentId: string|null;
  designationId: string |null;
  managerId: string | null;
  forceLogoutAt?: Date | null;
  phone: string | null;
  joiningDate: Date;
  faceReferenceDataUrl: string | null;
  faceRegisteredAt: Date | null;
  attendancePolicyAcceptedAt: Date | null;
  attendancePolicyVersion: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  dailyBreakLimitMinutes:number
};
