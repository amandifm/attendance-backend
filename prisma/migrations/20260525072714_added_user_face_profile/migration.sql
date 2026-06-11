-- CreateTable
CREATE TABLE "UserFaceProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "descriptor" JSONB NOT NULL,
    "referenceImageUrl" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFaceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserFaceProfile_userId_key" ON "UserFaceProfile"("userId");

-- AddForeignKey
ALTER TABLE "UserFaceProfile" ADD CONSTRAINT "UserFaceProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
