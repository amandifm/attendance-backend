ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

ALTER TABLE "AttendanceRecord"
  ADD COLUMN IF NOT EXISTS "faceMatchScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "faceLivenessStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "faceSelfieObjectKey" TEXT;

ALTER TABLE "CompanySettings"
  ADD COLUMN IF NOT EXISTS "requireBiometricFaceMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "faceMatchThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS "payrollStandardDailyMinutes" INTEGER NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS "payrollHalfDayMinutes" INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS "payrollLateGraceCount" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "payrollLateDeductionAfter" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS "payrollBonusMaxLateCount" INTEGER NOT NULL DEFAULT 2;

CREATE TABLE IF NOT EXISTS "EmailDelivery" (
  "id" TEXT NOT NULL,
  "toEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT,
  "error" TEXT,
  "relatedType" TEXT,
  "relatedId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "EmailDelivery_status_createdAt_idx" ON "EmailDelivery"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "EmailDelivery_relatedType_relatedId_idx" ON "EmailDelivery"("relatedType", "relatedId");
