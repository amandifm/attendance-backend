import dotenv from "dotenv";

dotenv.config();

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: numberEnv("PORT", 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  accessTokenMinutes: numberEnv("ACCESS_TOKEN_MINUTES", 15),
  refreshTokenDays: numberEnv("REFRESH_TOKEN_DAYS", 7),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me",
  emailProvider: process.env.EMAIL_PROVIDER ?? "log",
  emailFrom: process.env.EMAIL_FROM ?? "noreply@difm.tech",
  sendgridApiKey: process.env.SENDGRID_API_KEY,
  faceVerificationUrl: process.env.FACE_VERIFICATION_URL,
  faceVerificationApiKey: process.env.FACE_VERIFICATION_API_KEY,
  privatePhotoStorage: process.env.PRIVATE_PHOTO_STORAGE ?? "database",
  s3EndpointUrl: process.env.S3_ENDPOINT_URL,
  s3Region: process.env.S3_REGION ?? "eu-central-2",
  s3Bucket: process.env.S3_BUCKET,
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  selfieStoragePrefix: process.env.SELFIE_STORAGE_PREFIX ?? "attendance-selfies",
  selfieRetentionDays: numberEnv("SELFIE_RETENTION_DAYS", 180),
  localFaceDistanceThreshold: numberEnv("LOCAL_FACE_DISTANCE_THRESHOLD", 0.65)
};
