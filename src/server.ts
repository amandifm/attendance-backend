import cors from "cors";
import dotenv from 'dotenv'
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { isAppError } from "./errors.js";
import { fail } from "./http.js";
import { attendanceRouter } from "./routes/attendance.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { integrationsRouter } from "./routes/integrations.js";
import { leaveRouter } from "./routes/leave.js";
import { holidaysRouter } from "./routes/holidays.js";
import { notificationsRouter } from "./routes/notifications.js";
import { publicApiRouter } from "./routes/publicApi.js";
import { reportsRouter } from "./routes/reports.js";
import { settingsRouter } from "./routes/settings.js";
import { shiftsRouter } from "./routes/shifts.js";
import { usersRouter } from "./routes/users.js";
import { designationRouter } from "./routes/designation.js";
import { departmentRouter } from "./routes/department.js";
import faceRouter from "./modules/face/routes/faceroute.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { loadDataModels } from "./config/face-api.js";
import { cleanupExpiredSelfies } from "./privatePhotos.js";
import { checkMissingCheckouts } from "./jobs/missingCheckoutJob.js";
import { checkLocationLoss } from "./jobs/locationLossJob.js";
import { locationRouter } from "./routes/location.js";

const result=dotenv.config(); 
const allowedOrigins = [
  "http://localhost:8081",
  "http://localhost:19006",
  "http://192.168.29.21:8081",
  "http://192.168.0.240:8081"
];

const startServer =
  async () => {
    try {
      await loadDataModels();
    } catch (error) {
      console.log(
        "Model loading failed:",
        error
      );

    }
  };
startServer();
const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.use(errorMiddleware)
app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/employees", usersRouter);
app.use("/shifts", shiftsRouter);
app.use("/attendance", attendanceRouter);
app.use("/leave-requests", leaveRouter);
app.use("/holidays", holidaysRouter);
app.use("/reports", reportsRouter);
app.use("/notifications", notificationsRouter);
app.use("/settings", settingsRouter);
app.use("/integrations", integrationsRouter);
app.use("/public-api", publicApiRouter);
app.use('/designation',designationRouter);
app.use('/department',departmentRouter);
app.use('/location',locationRouter);
app.use("/face", faceRouter);
app.use((_req, res) => {
  fail(res, 404, "Route not found.");
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    fail(res, 400, error.issues[0]?.message ?? "Invalid request.");
    return;
  }
  if (isAppError(error)) {
    fail(res, error.status, error.message);
    return;
  }
  console.error(error);
  fail(res, 500, "Internal server error.");
});

import { initSocket } from "./socket.js";

const server = app.listen(config.port, "0.0.0.0", async () => {
  try {
    await prisma.$connect();
    
    // Initialize Socket.io
    initSocket(server);

    console.log(
      `DIFM Attendance Backend running on http://localhost:${config.port}`
    );
    console.log("Database connected successfully");
  } catch (error) {
    console.error("Unable to connect to database", error);
    process.exit(1);
  }
});

cleanupExpiredSelfies().catch((error) => console.error("Selfie retention cleanup failed", error));
setInterval(() => {
  cleanupExpiredSelfies().catch((error) => console.error("Selfie retention cleanup failed", error));
}, 24 * 60 * 60 * 1000);

checkMissingCheckouts().catch((error) => console.error("Missing checkout check failed", error));
setInterval(() => {
  checkMissingCheckouts().catch((error) => console.error("Missing checkout check failed", error));
}, 15 * 60 * 1000);

checkLocationLoss().catch((error) => console.error("Location loss check failed", error));
setInterval(() => {
  checkLocationLoss().catch((error) => console.error("Location loss check failed", error));
}, 5 * 60 * 1000);


process.on("SIGINT", async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

