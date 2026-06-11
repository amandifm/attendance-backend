import { prisma } from "../db.js";
import { queueEmail } from "../email.js";

/**
 * locationLossJob — runs every 5 minutes.
 *
 * Detects employees with active attendance (punched in, not punched out)
 * whose last location ping is older than 5 minutes.
 *
 * Night-shift fix: does NOT raise a false alarm at 00:00 for night-shift employees.
 * The check window is 36h so overnight sessions are still monitored.
 */
export async function checkLocationLoss(): Promise<void> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const activeSince    = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const now            = new Date();
  const utcHour        = now.getUTCHours();

  // ── Night-shift midnight continuity: suppress alerts between 23:55 and 00:05 UTC
  // This prevents false "missing ping" alarms when location pings briefly pause
  // across the calendar midnight boundary for night-shift employees.
  const nearMidnight = (utcHour === 23 && now.getUTCMinutes() >= 55) || (utcHour === 0 && now.getUTCMinutes() <= 5);
  if (nearMidnight) {
    console.log("[LocationLossJob] Skipping midnight window to avoid false night-shift alerts.");
    return;
  }

  const activeRecords = await prisma.attendanceRecord.findMany({
    where: {
      status: "IN_PROGRESS",
      punchInAt: { gte: activeSince },
      punchOutAt: null
    },
    include: {
      locationPings: {
        orderBy: { capturedAt: "desc" },
        take: 1
      },
      employee: { select: { id: true, name: true, email: true } }
    }
  });

  for (const record of activeRecords) {
    const lastPing = record.locationPings[0];

    // Skip if they have pinged recently
    if (lastPing && lastPing.capturedAt > fiveMinutesAgo) continue;

    // Prevent notification spam — check for recent SYSTEM notification (last 10 min)
    const recentAlert = await prisma.appNotification.findFirst({
      where: {
        userId: record.employeeId,
        type: "SYSTEM",
        title: "Location signal lost",
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) }
      }
    });
    if (recentAlert) continue;

    const lastPingTime = lastPing
      ? `Last ping: ${lastPing.capturedAt.toISOString()}`
      : "No ping recorded";

    // Alert the employee
    await prisma.appNotification.create({
      data: {
        userId: record.employee.id,
        title: "Location signal lost",
        body: `Your location signal has not been received for more than 5 minutes. Please ensure location access is enabled. (${lastPingTime})`,
        type: "SYSTEM"
      }
    });

    // Alert HR/Admin
    const hrAdmins = await prisma.user.findMany({
      where: { role: { in: ["HR", "ADMIN", "SUPER_ADMIN"] }, active: true },
      select: { id: true, email: true }
    });

    for (const hr of hrAdmins) {
      await prisma.appNotification.create({
        data: {
          userId: hr.id,
          title: "Location loss detected",
          body: `${record.employeeName}'s location has not been received for >5 min during active shift. (${lastPingTime})`,
          type: "SYSTEM"
        }
      });

      queueEmail({
        toEmail: hr.email,
        subject: `[ALERT] Location loss — ${record.employeeName}`,
        body: `${record.employeeName}'s location signal was lost during an active attendance session.\n${lastPingTime}\nDate: ${record.date.toISOString().slice(0, 10)}`,
        relatedType: "AttendanceRecord",
        relatedId: record.id
      }).catch((err) => console.error("Location loss email failed:", err));
    }

    console.log(`[LocationLossJob] Alert fired for ${record.employeeName} (${record.id})`);
  }
}
