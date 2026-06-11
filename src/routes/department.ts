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

router.get('/', requireAuth, requireRoles("ADMIN", "HR"), asyncHandler(async (req, res) => {
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
  requireRoles("HR", "ADMIN"),
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
export {router as departmentRouter};
