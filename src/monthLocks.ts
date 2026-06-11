import { prisma } from "./db.js";

export type AttendanceMonthLockRecord = {
  id: string;
  month: string;
  lockedById: string;
  lockedAt: Date;
  note: string | null;
};

type MonthLockDelegate = {
  findUnique(args: { where: { month: string } }): Promise<AttendanceMonthLockRecord | null>;
  findMany(args: { where?: { month?: string }; orderBy?: { month: "asc" | "desc" } }): Promise<AttendanceMonthLockRecord[]>;
  upsert(args: {
    where: { month: string };
    update: { lockedById: string; lockedAt: Date; note?: string };
    create: { month: string; lockedById: string; note?: string };
  }): Promise<AttendanceMonthLockRecord>;
  delete(args: { where: { month: string } }): Promise<AttendanceMonthLockRecord>;
};

function monthLocks() {
  return (prisma as typeof prisma & { attendanceMonthLock: MonthLockDelegate }).attendanceMonthLock;
}

export function findMonthLock(month: string) {
  return monthLocks().findUnique({ where: { month } });
}

export function listMonthLocks(month?: string) {
  return monthLocks().findMany({
    where: { month },
    orderBy: { month: "desc" }
  });
}

export function upsertMonthLock(input: { month: string; lockedById: string; note?: string }) {
  return monthLocks().upsert({
    where: { month: input.month },
    update: {
      lockedById: input.lockedById,
      lockedAt: new Date(),
      note: input.note
    },
    create: {
      month: input.month,
      lockedById: input.lockedById,
      note: input.note
    }
  });
}

export function deleteMonthLock(month: string) {
  return monthLocks().delete({ where: { month } });
}
