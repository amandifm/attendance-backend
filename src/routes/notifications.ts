import { Router } from "express";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { ok } from "../http.js";
import { serializeNotification } from "../serializers.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const skip = parseInt(req.query.skip as string) || 0;
    const take = parseInt(req.query.take as string) || 100;
    
    const notifications = await prisma.appNotification.findMany({
      where: { userId: viewer.id },
      orderBy: { createdAt: "desc" },
      skip,
      take
    });
    ok(res, notifications.map(serializeNotification));
  })
);

router.patch(
  "/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const notificationId = req.params.id;
    const notification = await prisma.appNotification.findUnique({ where: { id: notificationId } });
    if (!notification) {
      throw new AppError(404, "Notification not found.");
    }
    if (viewer.role === "EMPLOYEE" && notification.userId !== viewer.id) {
      throw new AppError(403, "You do not have access to this notification.");
    }

    const updated = await prisma.appNotification.update({
      where: { id: notification.id },
      data: { read: true }
    });
    ok(res, serializeNotification(updated));
  })
);

// ─── DELETE /notifications/all ────────────────────────────────────────────────
router.delete(
  "/all",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    await prisma.appNotification.deleteMany({
      where: { userId: viewer.id }
    });
    ok(res, { deletedAll: true });
  })
);

router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    const notificationId = req.params.id;
    const notification = await prisma.appNotification.findUnique({ where: { id: notificationId } });
    if (!notification) {
      throw new AppError(404, "Notification not found.");
    }
    if (viewer.role === "EMPLOYEE" && notification.userId !== viewer.id) {
      throw new AppError(403, "You do not have access to this notification.");
    }

    await prisma.appNotification.delete({
      where: { id: notification.id }
    });
    ok(res, { deleted: true });
  })
);

// ─── GET /notifications/history ───────────────────────────────────────────────
// HR/Admin: combined log of in-app notifications + email deliveries with status.
router.get(
  "/history",
  requireAuth,
  requireRoles("ADMIN", "HR", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 200), 500);
    const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;

    const [notifications, emails] = await Promise.all([
      prisma.appNotification.findMany({
        where: userId ? { userId } : undefined,
        orderBy: { createdAt: "desc" },
        take: limit
      }),
      prisma.emailDelivery.findMany({
        where: userId
          ? { toEmail: { contains: userId } }   // best-effort user filter
          : undefined,
        orderBy: { createdAt: "desc" },
        take: limit
      })
    ]);

    ok(res, {
      inApp: notifications.map(serializeNotification),
      emails: emails.map(e => ({
        id:          e.id,
        toEmail:     e.toEmail,
        subject:     e.subject,
        status:      e.status,
        provider:    e.provider  ?? undefined,
        error:       e.error     ?? undefined,
        relatedType: e.relatedType ?? undefined,
        relatedId:   e.relatedId  ?? undefined,
        createdAt:   e.createdAt.toISOString(),
        sentAt:      e.sentAt?.toISOString()
      }))
    });
  })
);

// ─── POST /notifications/mark-all-read ────────────────────────────────────────
router.post(
  "/mark-all-read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const viewer = (req as AuthenticatedRequest).user;
    await prisma.appNotification.updateMany({
      where: { userId: viewer.id, read: false },
      data:  { read: true }
    });
    ok(res, { markedRead: true });
  })
);


export { router as notificationsRouter };

