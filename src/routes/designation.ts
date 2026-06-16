import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { prisma } from "../db.js";
import { Designation } from "@prisma/client";
import { Department } from "@prisma/client";
import { ok } from "../http.js";
const router=Router();

router.get('/',requireAuth, asyncHandler(async (req, res) => {
    const departments =
      await prisma.designation.findMany({
        orderBy: {
          name: "asc",
        },
      });

    ok(res, departments);
  })
);

import { z } from "zod";
import { AppError } from "../errors.js";
import { requireRoles } from "../auth/middleware.js";

const designationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
  description: z.string().optional(),
  departmentId: z.string().min(1, "Department ID is required"),
});

router.post(
  "/",
  requireAuth,
  requireRoles("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = designationSchema.parse(req.body);
    const existing = await prisma.designation.findUnique({ where: { slug: data.slug } });
    if (existing) {
      throw new AppError(400, "Designation with this slug already exists.");
    }
    const desig = await prisma.designation.create({ data });
    ok(res, desig);
  })
);

router.put(
  "/:id",
  requireAuth,
  requireRoles("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const data = designationSchema.parse(req.body);
    const existing = await prisma.designation.findUnique({ where: { slug: data.slug } });
    if (existing && existing.id !== id) {
      throw new AppError(400, "Designation with this slug already exists.");
    }
    const desig = await prisma.designation.update({
      where: { id },
      data,
    });
    ok(res, desig);
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireRoles("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    // Check if there are users assigned to this designation
    const users = await prisma.user.count({ where: { designationId: id } });
    if (users > 0) {
      throw new AppError(400, "Cannot delete designation with assigned employees.");
    }
    await prisma.designation.delete({ where: { id } });
    ok(res, { success: true });
  })
);

export { router as designationRouter };