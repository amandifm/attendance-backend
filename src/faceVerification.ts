import crypto from "crypto";
import { config } from "./config.js";
import { AppError } from "./errors.js";

type FaceVerificationInput = {
  referenceDataUrl: string;
  selfieDataUrl: string;
  required: boolean;
  threshold: number;
};

type FaceVerificationResult = {
  verified: boolean;
  status: string;
  score?: number;
  livenessStatus?: string;
};

function fingerprint(dataUrl: string) {
  return crypto.createHash("sha256").update(dataUrl).digest("hex");
}

export async function verifyFace(input: FaceVerificationInput): Promise<FaceVerificationResult> {
  if (config.faceVerificationUrl && config.faceVerificationApiKey) {
    const response = await fetch(config.faceVerificationUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.faceVerificationApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        referenceImage: input.referenceDataUrl,
        selfieImage: input.selfieDataUrl,
        threshold: input.threshold
      })
    });

    if (!response.ok) {
      throw new AppError(502, `Face verification provider returned ${response.status}.`);
    }

    const payload = (await response.json()) as {
      verified?: boolean;
      score?: number;
      livenessStatus?: string;
      status?: string;
    };
    const score = typeof payload.score === "number" ? payload.score : undefined;
    const verified = Boolean(payload.verified) && (score === undefined || score >= input.threshold);
    return {
      verified,
      score,
      livenessStatus: payload.livenessStatus ?? "PROVIDER_CHECKED",
      status: payload.status ?? (verified ? "BIOMETRIC_MATCH" : "BIOMETRIC_REJECTED")
    };
  }

  if (input.required) {
    throw new AppError(503, "Biometric face matching is required but no provider is configured.");
  }

  return {
    verified: true,
    status: "SELFIE_CAPTURED_PROVIDER_NOT_CONFIGURED",
    livenessStatus: fingerprint(input.referenceDataUrl) === fingerprint(input.selfieDataUrl) ? "RETAKE_REQUIRED" : "LOCAL_CAPTURE_ONLY"
  };
}
