/*
  Warnings:

  - A unique constraint covering the columns `[departmentId,name]` on the table `Designation` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `departmentId` to the `Designation` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Designation_name_key";

-- AlterTable
ALTER TABLE "Designation" ADD COLUMN     "departmentId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Designation_departmentId_name_key" ON "Designation"("departmentId", "name");

-- AddForeignKey
ALTER TABLE "Designation" ADD CONSTRAINT "Designation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
