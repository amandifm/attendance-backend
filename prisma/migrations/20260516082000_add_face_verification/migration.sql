ALTER TABLE "AttendanceRecord"
ADD COLUMN "faceVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "faceVerificationStatus" TEXT,
ADD COLUMN "faceSelfieDataUrl" TEXT,
ADD COLUMN "faceCapturedAt" TIMESTAMP(3);
