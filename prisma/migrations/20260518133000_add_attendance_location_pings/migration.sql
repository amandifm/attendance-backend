CREATE TABLE "AttendanceLocationPing" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracyMeters" DOUBLE PRECISION,
    "locationName" TEXT,
    "risk" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceLocationPing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AttendanceLocationPing_attendanceId_capturedAt_idx" ON "AttendanceLocationPing"("attendanceId", "capturedAt");
CREATE INDEX "AttendanceLocationPing_employeeId_capturedAt_idx" ON "AttendanceLocationPing"("employeeId", "capturedAt");

ALTER TABLE "AttendanceLocationPing" ADD CONSTRAINT "AttendanceLocationPing_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
