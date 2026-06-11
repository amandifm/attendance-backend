import { Request, response, Response } from "express";
import { startBreakService } from "./attendance.service.js";
import { asyncHandler } from "../../asyncHandler.js";
import { AuthenticatedUserRequest } from "../../auth/middleware.js";
import { ok } from "../../http.js";
export const startBreakController = 
asyncHandler(
async (
    req: AuthenticatedUserRequest,
    res: Response
) => {
    const userId=req.user?.id;
      if (!userId) {
      return res.status(401).json({ success: false, message: "User is not logged in." });
    }
    const result=await startBreakService(userId);
    console.log(result);
    ok(res,result)
});