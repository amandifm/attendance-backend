/*
  Warnings:

  - You are about to drop the column `breakExceededAt` on the `AttendanceBreak` table. All the data in the column will be lost.
  - You are about to drop the column `breakLimitExceeded` on the `AttendanceBreak` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AttendanceBreak" DROP COLUMN "breakExceededAt",
DROP COLUMN "breakLimitExceeded";

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "breakExceededAt" TIMESTAMP(3),
ADD COLUMN     "breakLimitExceeded" BOOLEAN NOT NULL DEFAULT false;
