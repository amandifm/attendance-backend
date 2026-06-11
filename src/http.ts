import { Response } from "express";

export type ApiResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
};

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ ok: true, data } satisfies ApiResult<T>);
}

export function fail(res: Response, status: number, error: string) {
  return res.status(status).json({ ok: false, error } satisfies ApiResult<never>);
}
