ALTER TABLE "User"
ADD COLUMN "attendancePolicyAcceptedAt" TIMESTAMP(3),
ADD COLUMN "attendancePolicyVersion" TEXT;

ALTER TABLE "CompanySettings"
ADD COLUMN "attendancePolicyVersion" TEXT NOT NULL DEFAULT 'v1',
ADD COLUMN "attendancePolicyText" TEXT NOT NULL DEFAULT 'I confirm that I will use DIFM Attendance honestly, allow required GPS/camera checks during attendance, and report missed punches or location issues to HR.';
