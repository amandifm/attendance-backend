import * as faceapi from '@vladmandic/face-api'
import * as canvas from 'canvas'
import path from 'path'
import { createRequire } from 'module';

const customRequire = createRequire(import.meta.url);

try {
    customRequire('@tensorflow/tfjs-node');
    console.log("Loaded @tensorflow/tfjs-node native backend");
} catch (e) {
    console.warn("Failed to load @tensorflow/tfjs-node. Falling back to pure JS backend.");
}
const { Canvas, Image, ImageData } = canvas


faceapi.env.monkeyPatch({
    Canvas: Canvas as any,
    Image: Image as any,
    ImageData: ImageData as any
})


export async function loadDataModels() {
    const MODEL_URL =
        path.join(
            process.cwd(),
            "src",
            "models"
        );
    await faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_URL);

}


export default faceapi;