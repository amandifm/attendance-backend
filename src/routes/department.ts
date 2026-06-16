import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { prisma } from "../db.js";
import { Designation } from "@prisma/client";
import { Department } from "@prisma/client";
import { ok } from "../http.js";
import { requireRoles } from "../auth/middleware.js";
import { AppError } from "../errors.js";

const router = Router();

router.get('/', requireAuth, asyncHandler(async (req, res) => {
    const departments =
        await prisma.department.findMany({
            orderBy: {
                name: "asc",
            },
        });

    ok(res, departments);
}))

router.get(
  "/:departmentId/designations",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { departmentId } = req.params;
    const department =
      await prisma.department.findUnique({
        where: {
          id: departmentId,
        },
      });
    if (!department) {
      throw new AppError(
        404,
        "Department not found"
      );
    }
    const designations =
      await prisma.designation.findMany({
        where: {
          departmentId: departmentId,
        },
        orderBy: {
          name: "asc",
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });
    ok(res, designations);
  })
);

import { z } from "zod";

const departmentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
  description: z.string().optional(),
});

router.post(
  "/",
  requireAuth,
  requireRoles("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const data = departmentSchema.parse(req.body);
    const existing = await prisma.department.findUnique({ where: { slug: data.slug } });
    if (existing) {
      throw new AppError(400, "Department with this slug already exists.");
    }
    const dept = await prisma.department.create({ data });
    ok(res, dept);
  })
);

router.put(
  "/:id",
  requireAuth,
  requireRoles("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const data = departmentSchema.parse(req.body);
    const existing = await prisma.department.findUnique({ where: { slug: data.slug } });
    if (existing && existing.id !== id) {
      throw new AppError(400, "Department with this slug already exists.");
    }
    const dept = await prisma.department.update({
      where: { id },
      data,
    });
    ok(res, dept);
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireRoles("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    // Check if there are users or designations assigned
    const designations = await prisma.designation.count({ where: { departmentId: id } });
    if (designations > 0) {
      throw new AppError(400, "Cannot delete department with assigned designations.");
    }
    await prisma.department.delete({ where: { id } });
    ok(res, { success: true });
  })
);

export { router as departmentRouter };
