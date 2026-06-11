import faceapi from "../../../config/face-api.js";
import * as canvas from "canvas";
import { AppError } from "../../../errors.js";

export type FaceImageSource = string | Buffer;

export const enrollFaceService =
  async (
    imageSource: FaceImageSource
  ) => {
    try {
      const img = await canvas.loadImage(imageSource);
      const detection = await faceapi.detectSingleFace(img as any, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection) {
        throw new AppError(400, "No face detected in the image. Please ensure your face is clearly visible.");
      }
      return {
        descriptor:
          Array.from(
            detection.descriptor
          ),
      };
    } catch (e) {
      console.log(e);
      throw e;

    }

  };
