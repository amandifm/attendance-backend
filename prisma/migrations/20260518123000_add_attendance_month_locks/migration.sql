CREATE TABLE "AttendanceMonthLock" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "lockedById" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "AttendanceMonthLock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceMonthLock_month_key" ON "AttendanceMonthLock"("month");
CREATE INDEX "AttendanceMonthLock_lockedAt_idx" ON "AttendanceMonthLock"("lockedAt");

ALTER TABLE "AttendanceMonthLock" ADD CONSTRAINT "AttendanceMonthLock_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
