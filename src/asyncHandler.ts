import { NextFunction, Request, Response } from "express";

export function asyncHandler(
  handler: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<unknown>
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error("ASYNC_HANDLER_ERROR:");
      console.error(error);

      next(error);
    }
  };
}