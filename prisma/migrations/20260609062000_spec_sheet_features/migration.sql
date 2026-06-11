-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'HR_REVIEWED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "LocationExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "AttendanceLocationPing" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewStatus" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "riskLevel" TEXT;

-- CreateTable
CREATE TABLE "AttendanceMonthFinalization" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "finalizedById" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "AttendanceMonthFinalization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceDispute" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "hrNote" TEXT,
    "superAdminNote" TEXT,
    "reviewedById" TEXT,
    "resolvedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceDispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationExceptionRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "LocationExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationExceptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceMonthFinalization_month_key" ON "AttendanceMonthFinalization"("month");

-- CreateIndex
CREATE INDEX "AttendanceMonthFinalization_month_idx" ON "AttendanceMonthFinalization"("month");

-- CreateIndex
CREATE INDEX "AttendanceDispute_employeeId_status_idx" ON "AttendanceDispute"("employeeId", "status");

-- CreateIndex
CREATE INDEX "AttendanceDispute_attendanceId_idx" ON "AttendanceDispute"("attendanceId");

-- CreateIndex
CREATE INDEX "LocationExceptionRequest_employeeId_date_idx" ON "LocationExceptionRequest"("employeeId", "date");

-- CreateIndex
CREATE INDEX "LocationExceptionRequest_status_idx" ON "LocationExceptionRequest"("status");

-- AddForeignKey
ALTER TABLE "AttendanceMonthFinalization" ADD CONSTRAINT "AttendanceMonthFinalization_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceDispute" ADD CONSTRAINT "AttendanceDispute_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationExceptionRequest" ADD CONSTRAINT "LocationExceptionRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationExceptionRequest" ADD CONSTRAINT "LocationExceptionRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
