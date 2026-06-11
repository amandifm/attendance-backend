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

export {router as designationRouter};