import bcrypt from "bcryptjs";
import {
  PrismaClient,
  UserRole,
} from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("Password@123", 12);


  const development = await prisma.department.upsert({
    where: {
      slug: "development",
    },
    update: {},
    create: {
      name: "Development",
      slug: "development",
      description:
        "Development department",
    },
  });
  const marketing = await prisma.department.upsert({
    where: {
      slug: "marketing",
    },
    update: {},
    create: {
      name: "Marketing",
      slug: "marketing",
      description:
        "Marketing department",
    },
  });

  const design = await prisma.department.upsert({
    where: {
      slug: "design",
    },
    update: {},
    create: {
      name: "Design",
      slug: "design",
      description:
        "Design department",
    },
  });

  const admins = await prisma.department.upsert({
    where: {
      slug: "admins",
    },
    update: {},
    create: {
      name: "Admins",
      slug: "admins",
      description:
        "Administration department",
    },
  });
  const finance = await prisma.department.upsert({
    where: {
      slug: "finance",
    },
    update: {},
    create: {
      name: "Finance",
      slug: "finance",
      description:
        "Finance department",
    },
  });
  const softwareDeveloperIntern = await prisma.designation.upsert({
    where: {
      slug:
        "development-software-developer-intern",
    },
    update: {},
    create: {
      name:
        "Software Developer Intern",
      slug:
        "development-software-developer-intern",
      description:
        "Development intern",
      departmentId:
        development.id,
    },
  });

  const marketingIntern = await prisma.designation.upsert({
    where: {
      slug:
        "marketing-intern",
    },
    update: {},
    create: {
      name:
        "Marketing Intern",
      slug:
        "marketing-intern",
      description:
        "Marketing intern",
      departmentId:
        marketing.id,
    },
  });

  const designIntern = await prisma.designation.upsert({
    where: {
      slug:
        "design-intern",
    },
    update: {},
    create: {
      name:
        "Design Intern",
      slug:
        "design-intern",
      description:
        "Design intern",
      departmentId:
        design.id,
    },
  });

  const officeAssistantIntern =await prisma.designation.upsert({
      where: {
        slug:
          "admins-office-assistant-intern",
      },
      update: {},
      create: {
        name:
          "Office Assistant Intern",
        slug:
          "admins-office-assistant-intern",
        description:
          "Administration intern",
        departmentId:
          admins.id,
      },
    });

  const financeIntern = await prisma.designation.upsert({
      where: {
        slug:
          "finance-intern",
      },
      update: {},
      create: {
        name:
          "Finance Intern",
        slug:
          "finance-intern",
        description:
          "Finance intern",
        departmentId:
          finance.id,
      },
    });
  await prisma.user.upsert({
    where: {
      email:
        "superadmin@difm.tech",
    },
    update: {},
    create: {
      id: "u-super-admin",
      name:
        "DIFM Super Admin",
      email:
        "superadmin@difm.tech",
      passwordHash,
      role:
        UserRole.SUPER_ADMIN,
      departmentId:
        admins.id,
      designationId:
        officeAssistantIntern.id,
    },
  });

  await prisma.user.upsert({
    where: {
      email:
        "admin@difm.tech",
    },
    update: {},
    create: {
      id: "u-admin",
      name: "DIFM Admin",
      email:
        "admin@difm.tech",
      passwordHash,
      role:
        UserRole.ADMIN,
      departmentId:
        admins.id,
      designationId:
        officeAssistantIntern.id,
    },
  });

  await prisma.user.upsert({
    where: {
      email:
        "hr@difm.tech",
    },
    update: {},
    create: {
      id: "u-hr",
      name:
        "HR Executive",
      email:
        "hr@difm.tech",
      passwordHash,
      role: UserRole.HR,
      departmentId:
        admins.id,
      designationId:
        officeAssistantIntern.id,
    },
  });

  await prisma.user.upsert({
    where: {
      email:
        "manager@difm.tech",
    },
    update: {},
    create: {
      id: "u-manager",
      name:
        "Development Manager",
      email:
        "manager@difm.tech",
      passwordHash,
      role:
        UserRole.MANAGER,
      departmentId:
        development.id,
      designationId:
        softwareDeveloperIntern.id,
    },
  });

  await prisma.user.upsert({
    where: {
      email:
        "employee@difm.tech",
    },
    update: {},
    create: {
      id:
        "u-employee-1",
      name:
        "Amit Sharma",
      email:
        "employee@difm.tech",
      passwordHash,
      role:
        UserRole.EMPLOYEE,
      departmentId:
        development.id,
      designationId:
        softwareDeveloperIntern.id,
      managerId:
        "u-manager",
    },
  });
  await prisma.companySettings.upsert({
    where: {
      id: "company",
    },
    update: {},
    create: {
      id: "company",
      companyName: "DIFM",
    },
  });

  console.log(
    "Seed completed successfully."
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });