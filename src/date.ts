import { AppError } from "./errors.js";

export function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, "Date must be in YYYY-MM-DD format.");
  }
  return new Date(`${value}T00:00:00.000Z`);
}

export function combineDateAndTime(date: string, time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new AppError(400, "Time must be in HH:mm format.");
  }
  return new Date(`${date}T${time}:00.000Z`);
}

export function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}
