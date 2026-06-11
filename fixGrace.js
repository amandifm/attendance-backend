const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateGrace() {
  await prisma.companySettings.updateMany({
    data: {
      shiftGraceMinutes: 5,
      payrollLateDeductionAfter: 5, // Ensures deduction starts after 5 late marks
    }
  });
  console.log("Grace period updated to 5 minutes!");
}

updateGrace().finally(() => prisma.$disconnect());
