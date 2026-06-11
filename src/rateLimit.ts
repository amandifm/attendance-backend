import { NextFunction, Request, Response } from "express";
import { fail } from "./http.js";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function rateLimit(input: { keyPrefix: string; windowMs: number; max: number }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${input.keyPrefix}:${req.ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + input.windowMs });
      next();
      return;
    }
    if (bucket.count >= input.max) {
      fail(res, 429, "Too many requests. Try again shortly.");
      return;
    }
    bucket.count += 1;
    next();
  };
}
