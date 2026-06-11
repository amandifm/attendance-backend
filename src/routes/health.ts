import { Router } from "express";
import { ok } from "../http.js";

const router = Router();

router.get("/", (_req, res) => {
  ok(res, {
    service: "difm-attendance-backend",
    status: "ok",
    checkedAt: new Date().toISOString()
  });
});

export { router as healthRouter };
