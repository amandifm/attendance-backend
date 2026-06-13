import * as faceapi from '@vladmandic/face-api/dist/face-api.node-wasm.js'
import * as canvas from 'canvas'
import path from 'path'

const { Canvas, Image, ImageData } = canvas

faceapi.env.monkeyPatch({
    Canvas: Canvas as any,
    Image: Image as any,
    ImageData: ImageData as any
})

export async function loadDataModels() {
await (faceapi.tf as any).setBackend('wasm');
    await (faceapi.tf as any).ready();
    console.log("Initialized tfjs-backend-wasm successfully");

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