import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { AuthUser, AuthUserRole } from "./types.js";

export type AccessTokenPayload = {
  sub: string;
  role: AuthUserRole;
  email: string;
  iat?: number;
};

export function signAccessToken(user: Pick<AuthUser, "id" | "role" | "email">) {
  return jwt.sign(
    { role: user.role, email: user.email } satisfies Omit<AccessTokenPayload, "sub" | "iat">,
    config.jwtAccessSecret,
    {
      subject: user.id,
      expiresIn: `${config.accessTokenMinutes}m`
    }
  );
}

export function signRefreshToken(userId: string) {
  return jwt.sign({ jti: crypto.randomUUID() }, config.jwtRefreshSecret, {
    subject: userId,
    expiresIn: `${config.refreshTokenDays}d`
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.jwtAccessSecret);
  if (typeof decoded === "string" || !decoded.sub || !decoded.role || !decoded.email) {
    throw new Error("Invalid token payload.");
  }
  return {
    sub: decoded.sub,
    role: decoded.role as AuthUserRole,
    email: decoded.email as string,
    iat: (decoded as any).iat
  };
}

export function verifyRefreshToken(token: string) {
  const decoded = jwt.verify(token, config.jwtRefreshSecret);
  if (typeof decoded === "string" || !decoded.sub) {
    throw new Error("Invalid token payload.");
  }
  return { sub: decoded.sub };
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
