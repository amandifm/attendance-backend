import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { ok } from "../http.js";
import { serializeUser } from "../serializers.js";
import { asyncHandler } from "../asyncHandler.js";
import { AuthenticatedRequest, requireAuth } from "../auth/middleware.js";
import { hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "../auth/tokens.js";
import { audit } from "../audit.js";
import { rateLimit } from "../rateLimit.js";

const router = Router();

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(6)
});

router.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = changePasswordSchema.parse(req.body);
    const user = (req as AuthenticatedRequest).user;
    
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      throw new AppError(400, "Current password is incorrect.");
    }
    
    const newHash = await bcrypt.hash(input.newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash }
    });
    
    await audit({
      actorId: user.id,
      action: "auth.password_change",
      entityType: "User",
      entityId: user.id,
      ipAddress: req.ip
    });
    
    ok(res, { success: true });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

router.post(
  "/login",
  rateLimit({ keyPrefix: "auth.login", windowMs: 15 * 60 * 1000, max: 20 }),
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email: input.email.trim().toLowerCase() }
    });

    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new AppError(401, "Invalid email or password.");
    }
    if (!user.active) {
      throw new AppError(403, "This user is inactive. Contact HR.");
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user.id);
    const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt
      }
    });
    await audit({
      actorId: user.id,
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      ipAddress: req.ip
    });

    // ── Device Change Alert (P1) ──────────────────────────────────────────────
    // deviceId comes from the mobile client header; if omitted we use user-agent
    const deviceId = (typeof req.headers["x-device-id"] === "string" ? req.headers["x-device-id"] : null)
      ?? req.headers["user-agent"]?.slice(0, 200)
      ?? "unknown";

    const previousLogin = await prisma.deviceLoginLog.findFirst({
      where: { userId: user.id },
      orderBy: { loginAt: "desc" }
    });

    const isNewDevice = !previousLogin || previousLogin.deviceId !== deviceId;

    await prisma.deviceLoginLog.create({
      data: {
        userId:    user.id,
        deviceId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"]?.slice(0, 500) ?? null,
        flagged:   isNewDevice && !!previousLogin,   // only flag if NOT first-ever login
        flagReason: isNewDevice && previousLogin ? `New device detected (prev: ${previousLogin.deviceId?.slice(0, 60)})` : null
      }
    });

    if (isNewDevice && previousLogin) {
      // Notify HR/Admin of the device change
      const hrAdmins = await prisma.user.findMany({
        where: { role: { in: ["HR", "ADMIN", "SUPER_ADMIN"] }, active: true },
        select: { id: true }
      });
      for (const hr of hrAdmins) {
        await prisma.appNotification.create({
          data: {
            userId: hr.id,
            title:  "🔒 Device Change Detected",
            body:   `${user.name} logged in from a new device. IP: ${req.ip ?? "unknown"}`,
            type:   "SYSTEM"
          }
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    ok(res, {
      user: serializeUser(user),
      token: accessToken,
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + config.accessTokenMinutes * 60 * 1000).toISOString()
    });
  })
);

router.post(
  "/accept-policy",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthenticatedRequest).user;
    const settings = await prisma.companySettings.upsert({
      where: { id: "company" },
      update: {},
      create: {}
    });
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        attendancePolicyAcceptedAt: new Date(),
        attendancePolicyVersion: settings.attendancePolicyVersion
      }
    });
    await audit({
      actorId: user.id,
      action: "auth.policy_accept",
      entityType: "User",
      entityId: user.id,
      metadata: { policyVersion: settings.attendancePolicyVersion },
      ipAddress: req.ip
    });
    ok(res, serializeUser(updated));
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const input = refreshSchema.parse(req.body);
    const payload = verifyRefreshToken(input.refreshToken);
    const tokenHash = hashToken(input.refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, "Refresh token is no longer valid.");
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new AppError(401, "Session is no longer valid.");
    }

    const nextRefreshToken = signRefreshToken(user.id);
    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() }
      }),
      prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(nextRefreshToken),
          expiresAt: new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000)
        }
      })
    ]);

    ok(res, {
      user: serializeUser(user),
      token: signAccessToken(user),
      refreshToken: nextRefreshToken,
      expiresAt: new Date(Date.now() + config.accessTokenMinutes * 60 * 1000).toISOString()
    });
  })
);

router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = refreshSchema.partial().parse(req.body);
    if (input.refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(input.refreshToken), userId: (req as AuthenticatedRequest).user.id },
        data: { revokedAt: new Date() }
      });
    }
    await audit({
      actorId: (req as AuthenticatedRequest).user.id,
      action: "auth.logout",
      entityType: "User",
      entityId: (req as AuthenticatedRequest).user.id,
      ipAddress: req.ip
    });
    ok(res, { loggedOut: true });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    ok(res, serializeUser((req as AuthenticatedRequest).user));
  })
);

export { router as authRouter };
