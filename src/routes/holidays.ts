import { Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../auth/middleware.js";
import { audit } from "../audit.js";
import { asyncHandler } from "../asyncHandler.js";
import { parseDateOnly } from "../date.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { ok } from "../http.js";

const router = Router();

function serializeHoliday(h: {
  id: string;
  date: Date;
  name: string;
  description: string | null;
  createdById: string;
  createdAt: Date;
}) {
  return {
    id: h.id,
    date: h.date.toISOString().slice(0, 10),
    name: h.name,
    description: h.description ?? undefined,
    createdBy: h.createdById,
    createdAt: h.createdAt.toISOString()
  };
}

// ─── GET /holidays ─────────────────────────────────────────────────────────────
// All roles — list holidays for a given year/month
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const year  = typeof req.query.year  === "string" ? parseInt(req.query.year)  : new Date().getUTCFullYear();
    const month = typeof req.query.month === "string" ? parseInt(req.query.month) : undefined;

    const from = month
      ? new Date(Date.UTC(year, month - 1, 1))
      : new Date(Date.UTC(year, 0, 1));
    const to = month
      ? new Date(Date.UTC(year, month, 1))
      : new Date(Date.UTC(year + 1, 0, 1));

    const holidays = await prisma.companyHoliday.findMany({
      where: { date: { gte: from, lt: to } },
      orderBy: { date: "asc" }
    });

    ok(res, holidays.map(serializeHoliday));
  })
);

// ─── POST /holidays ────────────────────────────────────────────────────────────
// Super Admin — add a company holiday
router.post(
  "/",
  requireAuth,
  requireRoles("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const actor = (req as AuthenticatedRequest).user;
    const input = z.object({
      date: z.string().min(1),
      name: z.string().min(1).max(200),
      description: z.string().max(500).optional()
    }).parse(req.body);

    const date = parseDateOnly(input.date);

    // Duplicate check
    const existing = await prisma.companyHoliday.findUnique({ where: { date } });
    if (existing) throw new AppError(409, `A holiday already exists on ${input.date}: "${existing.name}".`);

    const holiday = await prisma.companyHoliday.create({
      data: {
        date,
        name: input.name.trim(),
        description: input.description?.trim(),
        createdById: actor.id
      }
    });

    await audit({
      actorId: actor.id,
      action: "holiday.create",
      entityType: "CompanyHoliday",
      entityId: holiday.id,
      metadata: { date: input.date, name: input.name },
      ipAddress: req.ip
    });

    ok(res, serializeHoliday(holiday), 201);
  })
);

// ─── DELETE /holidays/:id ──────────────────────────────────────────────────────
// Super Admin — remove a holiday
router.delete(
  "/:id",
  requireAuth,
  requireRoles("SUPER_ADMIN", "ADMIN"),
  asyncHandler(async (req, res) => {
    const actor = (req as AuthenticatedRequest).user;
    const holiday = await prisma.companyHoliday.findUnique({ where: { id: req.params.id } });
    if (!holiday) throw new AppError(404, "Holiday not found.");

    await prisma.companyHoliday.delete({ where: { id: holiday.id } });

    await audit({
      actorId: actor.id,
      action: "holiday.delete",
      entityType: "CompanyHoliday",
      entityId: holiday.id,
      metadata: { date: holiday.date.toISOString().slice(0, 10), name: holiday.name },
      ipAddress: req.ip
    });

    ok(res, { deleted: true });
  })
);

// ─── GET /holidays/check?date=YYYY-MM-DD ──────────────────────────────────────
// Check if a given date is a holiday
router.get(
  "/check",
  requireAuth,
  asyncHandler(async (req, res) => {
    const dateStr = typeof req.query.date === "string" ? req.query.date : new Date().toISOString().slice(0, 10);
    const date = parseDateOnly(dateStr);
    const holiday = await prisma.companyHoliday.findUnique({ where: { date } });
    ok(res, {
      date: dateStr,
      isHoliday: !!holiday,
      holiday: holiday ? serializeHoliday(holiday) : null
    });
  })
);

export { router as holidaysRouter };
