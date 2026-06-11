import { prisma } from "../db.js";

export async function checkMissingCheckouts() {
  try {
    // A 30-minute grace period
    const gracePeriodThreshold = new Date(Date.now() - 30 * 60 * 1000);

    // Find all attendance records that have a punch in, no punch out, are not already flagged, and the shift ended > 30 minutes ago
    const pendingRecords = await prisma.attendanceRecord.findMany({
      where: {
        punchOutAt: null,
        missingCheckout: false,
        shift: {
          endAt: {
            lt: gracePeriodThreshold,
          },
        },
      },
      include: {
        employee: true,
        shift: true,
      },
    });

    if (pendingRecords.length === 0) {
      return;
    }

    console.log(`[Job:MissingCheckout] Found ${pendingRecords.length} missing check-outs.`);

    // Find all HR and SUPER_ADMIN users to notify
    const hrUsers = await prisma.user.findMany({
      where: {
        role: { in: ["HR", "SUPER_ADMIN", "ADMIN"] },
        active: true,
      },
      select: { id: true },
    });

    for (const record of pendingRecords) {
      // 1. Mark as missed punch and set missingCheckout flag
      await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          missingCheckout: true,
          status: "MISSED_PUNCH",
        },
      });

      // 2. Alert HR
      const notifications = hrUsers.map((hr) => ({
        userId: hr.id,
        title: "Missing Check-Out Alert",
        body: `Shift ended for ${record.employeeName} but no check-out was recorded.`,
        type: "ATTENDANCE" as const,
      }));

      if (notifications.length > 0) {
        await prisma.appNotification.createMany({
          data: notifications,
        });
      }
    }
  } catch (error) {
    console.error("[Job:MissingCheckout] Error during check:", error);
  }
}
