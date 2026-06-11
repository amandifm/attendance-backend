import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function updateGrace() {
  await prisma.companySettings.updateMany({
    data: {
      shiftGraceMinutes: 5
    }
  });
  console.log("Grace period updated to 5 minutes!");
}

updateGrace().finally(() => prisma.$disconnect());
