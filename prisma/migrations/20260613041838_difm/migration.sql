-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "lateStatus" TEXT,
ADD COLUMN     "missingCheckout" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "defaultBreakDurationMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "defaultShiftEndTime" TEXT NOT NULL DEFAULT '17:00',
ADD COLUMN     "defaultShiftStartTime" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "lateMarkThresholdMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "lateWarningThresholdMinutes" INTEGER NOT NULL DEFAULT 30,
ALTER COLUMN "shiftGraceMinutes" SET DEFAULT 5;

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "isNightShift" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ShiftTemplate" ADD COLUMN     "isNightShift" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "forceLogoutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "expo_token" TEXT,
    "created_at" TIMESTAMP(6),

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);
