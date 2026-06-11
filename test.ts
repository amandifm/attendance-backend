import { PrismaClient } from '@prisma/client'; 
const prisma = new PrismaClient(); 
async function main() { 
  console.log('Shifts: ', await prisma.shift.findMany()); 
  console.log('Templates: ', await prisma.shiftTemplate.findMany()); 
} 
main().catch(console.error).finally(() => prisma.$disconnect());
