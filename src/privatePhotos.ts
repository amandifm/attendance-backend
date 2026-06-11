import crypto from "crypto";
import dotenv from 'dotenv'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
dotenv.config();
let s3Client: S3Client | null = null;

function requireS3Config() {
  if (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey || !config.s3EndpointUrl) {
    throw new AppError(500, "S3 photo storage is enabled but S3 configuration is incomplete.");
  }
  return {
    bucket: config.s3Bucket,
    endpoint: config.s3EndpointUrl,
    region: config.s3Region,
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3SecretAccessKey
  };
}

function getS3Client() {
  if (s3Client) {
    return s3Client;
  }
  const s3 = requireS3Config();
  s3Client = new S3Client({
    endpoint: s3.endpoint,
    region: s3.region,
    forcePathStyle: config.s3ForcePathStyle,
    credentials: {
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey
    }
  });
  return s3Client;
}

export function isS3PhotoStorage() {
  return config.privatePhotoStorage === "s3";
}

export async function storeAttendanceSelfie(input: { buffer: Buffer; mimeType: string; extension: string }, employeeId: string) {
  if (!isS3PhotoStorage()) {
    return {};
  }

  const objectKey = `${config.selfieStoragePrefix}/${employeeId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${input.extension}`;
  const s3 = requireS3Config();
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: objectKey,
      Body: input.buffer,
      ContentType: input.mimeType,
      Metadata: {
        employeeId,
        purpose: "attendance-selfie"
      }
    })
  );

  return { objectKey };
}

export async function getPrivatePhotoReadUrl(objectKey: string) {
  if (!isS3PhotoStorage()) {
    return objectKey;
  }
  const s3 = requireS3Config();
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: s3.bucket,
      Key: objectKey
    }),
    { expiresIn: 5 * 60 }
  );
}

export async function deletePrivatePhoto(objectKey: string) {
  if (!objectKey) {
    return;
  }
  if (!isS3PhotoStorage()) {
    return;
  }
  const s3 = requireS3Config();
  await getS3Client().send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: objectKey }));
}

export async function cleanupExpiredSelfies() {
  const cutoff = new Date(Date.now() - config.selfieRetentionDays * 24 * 60 * 60 * 1000);
  const records = await prisma.attendanceRecord.findMany({
    where: {
      faceSelfieObjectKey: { not: null },
      faceCapturedAt: { lt: cutoff }
    },
    select: { id: true, faceSelfieObjectKey: true }
  });

  for (const record of records) {
    if (record.faceSelfieObjectKey) {
      await deletePrivatePhoto(record.faceSelfieObjectKey).catch(() => undefined);
      await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          faceSelfieDataUrl: null,
          faceSelfieObjectKey: null,
          faceLivenessStatus: "SELFIE_RETAINED_PERIOD_EXPIRED"
        }
      });
    }
  }
  return records.length;
}

