import { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { fail } from "../http.js";
import { verifyAccessToken } from "./tokens.js";
import type { AuthUser, AuthUserRole } from "./types.js";

export type AuthenticatedRequest = Request & {
  user: AuthUser;
};

export interface AuthenticatedUserRequest
  extends Request {

  user?: {
    id: string;
    role: string;
  };

}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization");
    let token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    if (!token && typeof req.query.token === "string") {
      token = req.query.token;
    }
    if (!token) {
      throw new AppError(401, "Authentication required.");
    }

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new AppError(401, "Session is no longer valid.");
    }

    if (user.forceLogoutAt && payload.iat && (payload.iat * 1000) < user.forceLogoutAt.getTime()) {
      throw new AppError(401, "Session ended by administrator.");
    }

    (req as AuthenticatedRequest).user = user;
    next();
  } catch (error) {
    const msg = error instanceof AppError ? error.message : "Authentication required.";
    const status = error instanceof AppError ? error.status : 401;
    return fail(res, status, msg);
  }
}

export function requireRoles(...roles: AuthUserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthenticatedRequest).user;
    if (user.role !== "SUPER_ADMIN" && !roles.includes(user.role)) {

      return fail(res, 403, "You do not have access to this action.");
    }
    next();
  };
}
