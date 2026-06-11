import { Response }
from "express";

import { AuthenticatedUserRequest } from "../../../auth/middleware.js";
import { verifyFaceService } from "../services/verifyFaceService.js";
export const verifyFaceController =
  async (
    req: AuthenticatedUserRequest,
    res: Response
  ) => {
    try {
      if (!req.file?.buffer) {
        return res
          .status(400)
          .json({
            success: false,
            message:
              "No image uploaded",
          });
      }
      const result =await verifyFaceService(req.user!.id,req.file.buffer );
      return res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            error.message,
        });
    }
  };
