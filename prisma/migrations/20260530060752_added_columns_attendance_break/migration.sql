-- AlterTable
ALTER TABLE "AttendanceBreak" ADD COLUMN     "breakExceededAt" TIMESTAMP(3),
ADD COLUMN     "breakLimitExceeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "breakMinutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyBreakLimitMinutes" INTEGER NOT NULL DEFAULT 60;
