import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {

  // CLEAR OLD DATA
  await prisma.designation.deleteMany({});
  await prisma.department.deleteMany({});

  // CREATE DEPARTMENTS
  await prisma.department.createMany({
    data: [
      {
        name: "Development",
        slug: "development",
        description: "Development department",
      },
      {
        name: "Marketing",
        slug: "marketing",
        description: "Marketing department",
      },
      {
        name: "Design",
        slug: "design",
        description: "Design department",
      },
      {
        name: "Admins",
        slug: "admins",
        description: "Administration department",
      },
      {
        name: "Finance",
        slug: "finance",
        description: "Finance department",
      },
    ],
  });

  const departments = await prisma.department.findMany();

  const departmentMap = Object.fromEntries(
    departments.map((dept) => [dept.slug, dept.id])
  );

  // CREATE DESIGNATIONS
  await prisma.designation.createMany({
    data: [

      // DEVELOPMENT
      {
        departmentId: departmentMap["development"],
        name: "Software Developer Intern",
        slug: "development-software-developer-intern",
        description: "Development intern",
      },

      // MARKETING
      {
        departmentId: departmentMap["marketing"],
        name: "Marketing Intern",
        slug: "marketing-intern",
        description: "Marketing intern",
      },

      // DESIGN
      {
        departmentId: departmentMap["design"],
        name: "Design Intern",
        slug: "design-intern",
        description: "Design intern",
      },

      // ADMINS
      {
        departmentId: departmentMap["admins"],
        name: "Office Assistant Intern",
        slug: "admins-office-assistant-intern",
        description: "Administration intern",
      },

      // FINANCE
      {
        departmentId: departmentMap["finance"],
        name: "Finance Intern",
        slug: "finance-intern",
        description: "Finance intern",
      },
    ],
  });

  console.log("Departments and designations seeded successfully");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });