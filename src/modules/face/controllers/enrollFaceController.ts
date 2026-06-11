import { Response } from "express";
import { enrollFaceService } from "../services/enrollFaceService.js";
import { AuthenticatedUserRequest } from "../../../auth/middleware.js";
import { prisma } from "../../../db.js";
import { serializeUser } from "../../../serializers.js";

function normalizeFaceDataUrl(faceDataUrl: string) {
  return faceDataUrl.trim()
}

function imageSourceFromDataUrl(faceDataUrl: string) {
  const normalized = normalizeFaceDataUrl(faceDataUrl);
  const match = normalized.match(/^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/]+={0,2})$/);

  if (!match) {
    throw new Error("Face image must be a JPEG or PNG captured by the app.");
  }
  return { imageSource: Buffer.from(match[2].replace(/\s/g, ""), "base64"), normalized };
}

export const enrollFaceController = async (req: AuthenticatedUserRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "User is not logged in." });
    }

    let imageSource = req.file?.buffer;
    let faceReferenceDataUrl = imageSource && req.file
      ? `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`
      : undefined;

    if (!imageSource) {
      const bodyDataUrl = typeof req.body?.faceReferenceDataUrl === "string" ? req.body.faceReferenceDataUrl : undefined;
      if (!bodyDataUrl) {
        return res.status(400).json({ success: false, message: "No face image uploaded." });
      }
      const decoded = imageSourceFromDataUrl(bodyDataUrl);
      imageSource = decoded.imageSource;
      faceReferenceDataUrl = decoded.normalized;
    }

    const result = await enrollFaceService(imageSource);
    await prisma.userFaceProfile.upsert({
      where: { userId },
      create: {
        userId,
        descriptor: result.descriptor,
        referenceImageUrl: null,
        active: true
      },
      update: {
        descriptor: result.descriptor,
        referenceImageUrl: null,
        active: true
      }
    });

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        faceReferenceDataUrl,
        faceRegisteredAt: new Date()
      }
    });

    return res.json({
      ok: true,
      success: true,
      data: serializeUser(user),
      descriptor: result.descriptor
    });
  } catch (error: unknown) {
    return res.status(400).json({
      ok: false,
      success: false,
      error: error instanceof Error ? error.message : "Unable to enroll face."
    });
  }
};
