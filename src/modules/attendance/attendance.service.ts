import { prisma } from "../../db.js";
export const startBreakService = async (
  userId: string
) => {
  const attendance =
    await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: userId,
        punchOutAt: null,
      },
    });

  if (!attendance) {
    throw new Error(
      "You must check in before starting a break"
    );
  }

  const activeBreak =
    await prisma.attendanceBreak.findFirst({
      where: {
        attendanceId: attendance.id,
        endedAt: null,
      },
    });

  if (activeBreak) {
    throw new Error(
      "Break already active"
    );
  }

  const breakRecord =
    await prisma.attendanceBreak.create({
      data: {
        attendanceId: attendance.id,
        startedAt: new Date(),
      },
    });

  return {
    success: true,
    breakId: breakRecord.id,
    startedAt: breakRecord.startedAt,
  };
};
export const endBreakService = async (
  userId: string
) => {
  const attendance =
    await prisma.attendanceRecord.findFirst({
      where: {
        employeeId: userId,
        punchOutAt: null,
      },
      include: {
        employee: true,
      },
    });

  if (!attendance) {
    throw new Error(
      "Attendance not found"
    );
  }

  const activeBreak =
    await prisma.attendanceBreak.findFirst({
      where: {
        attendanceId: attendance.id,
        endedAt: null,
      },
    });

  if (!activeBreak) {
    throw new Error(
      "No active break found"
    );
  }

  const endedAt = new Date();

  const breakMinutes =
    Math.floor(
      (endedAt.getTime() -
        activeBreak.startedAt.getTime()) /
      60000
    );

  await prisma.attendanceBreak.update({
    where: {
      id: activeBreak.id,
    },
    data: {
      endedAt,
      breakMinutes,
    },
  });

  const allBreaks =
    await prisma.attendanceBreak.findMany({
      where: {
        attendanceId: attendance.id,
      },
    });

  const totalBreakMinutes =
    allBreaks.reduce(
      (sum, item) =>
        sum + item.breakMinutes,
      0
    );

  const exceeded =
    totalBreakMinutes >
    attendance.employee.dailyBreakLimitMinutes;

  await prisma.attendanceRecord.update({
    where: {
      id: attendance.id,
    },
    data: {
      breakMinutes: totalBreakMinutes,
      breakLimitExceeded: exceeded,
      breakExceededAt: exceeded
        ? new Date()
        : null,
    },
  });

  if (exceeded) {
    await prisma.appNotification.create({
      data: {
        userId,
        title: "Break Limit Exceeded",
        body: `You exceeded your daily break limit of ${attendance.employee.dailyBreakLimitMinutes} minutes.`,
        type: "BREAK",
      },
    });
    const hrUsers =
      await prisma.user.findMany({
        where: {
          role: "HR",
        },
      });
    await prisma.appNotification.createMany({
      data: hrUsers.map((hr) => ({
        userId: hr.id,
        title: "Break Limit Exceeded",
        body: `${attendance.employeeName} exceeded break limit (${totalBreakMinutes} mins)`,
        type: "BREAK",
      })),
    });
  }
  return {
    success: true,
    breakMinutes,
    totalBreakMinutes,
    exceeded,
  };
};