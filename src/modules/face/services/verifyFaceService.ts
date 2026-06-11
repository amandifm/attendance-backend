import faceapi from "../../../config/face-api.js";

import canvas from "canvas";

import { prisma }
from "../../../db.js";
import { config } from "../../../config.js";
import { FaceImageSource, enrollFaceService } from "./enrollFaceService.js";
import { AppError } from "../../../errors.js";

function imageSourceFromDataUrl(faceDataUrl: string) {
  let normalized = faceDataUrl.trim();
  while (/^data:image\/(jpeg|jpg|png);base64,data:image\//.test(normalized)) {
    normalized = normalized.replace(/^data:image\/(jpeg|jpg|png);base64,/, "");
  }
  const match = normalized.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    throw new Error("Registered face image is invalid. Register face again.");
  }
  return Buffer.from(match[2].replace(/\s/g, ""), "base64");
}

async function getOrCreateFaceProfile(userId: string) {
  const existing = await prisma.userFaceProfile.findUnique({ where: { userId } });
  if (existing) {
    return existing;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.faceReferenceDataUrl) {
    throw new Error("Face profile not found. Register your face again.");
  }

  const referenceImage = imageSourceFromDataUrl(user.faceReferenceDataUrl);
  const enrolled = await enrollFaceService(referenceImage);
  return prisma.userFaceProfile.upsert({
    where: { userId },
    create: {
      userId,
      descriptor: enrolled.descriptor,
      referenceImageUrl: null
    },
    update: {
      descriptor: enrolled.descriptor,
      referenceImageUrl: null,
      active: true
    }
  });
}

export const verifyFaceService =
  async (
    userId :string,
    imageSource: FaceImageSource,
  ) => {
    const img =await canvas.loadImage(imageSource);
    const detection =
      await faceapi.detectSingleFace(img as any,new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
    if (!detection) {
      throw new AppError(400, "No face detected in the image. Please ensure your face is clearly visible.");
    }
    const profile = await getOrCreateFaceProfile(userId);
    const storedDescriptor =new Float32Array(profile.descriptor as number[] );
    const newDescriptor = detection.descriptor;
    const distance =faceapi.euclideanDistance( storedDescriptor, newDescriptor );
    const matched = distance <= config.localFaceDistanceThreshold;
    return {
      matched,
      distance,
      similarityScore:
        Math.max(0, 1 - distance),
      threshold: config.localFaceDistanceThreshold,
    };
  };
