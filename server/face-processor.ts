import * as faceapi from "@vladmandic/face-api";
import * as tf from "@tensorflow/tfjs-node";
import { createCanvas, loadImage, Canvas, Image } from "canvas";
import * as path from "path";
import * as fs from "fs";

let modelsLoaded = false;

faceapi.env.monkeyPatch({
  Canvas: Canvas as any,
  Image: Image as any,
});

async function loadModels(): Promise<void> {
  if (modelsLoaded) return;
  
  const modelsPath = path.join(process.cwd(), "server", "models");
  
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true });
  }
  
  const modelFiles = fs.readdirSync(modelsPath);
  if (modelFiles.length === 0) {
    console.log("Face detection models not found. Downloading...");
    await downloadModels(modelsPath);
  }
  
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
  
  modelsLoaded = true;
  console.log("Face detection models loaded successfully");
}

async function downloadModels(modelsPath: string): Promise<void> {
  const baseUrl = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/";
  const modelFiles = [
    "ssd_mobilenetv1_model-weights_manifest.json",
    "ssd_mobilenetv1_model-shard1",
    "ssd_mobilenetv1_model-shard2",
    "face_landmark_68_model-weights_manifest.json",
    "face_landmark_68_model-shard1"
  ];
  
  for (const file of modelFiles) {
    try {
      const response = await fetch(baseUrl + file);
      if (!response.ok) {
        throw new Error(`Failed to download model file: ${file}`);
      }
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(path.join(modelsPath, file), Buffer.from(buffer));
      console.log(`Downloaded: ${file}`);
    } catch (error) {
      console.error(`Error downloading ${file}:`, error);
      throw error;
    }
  }
}

export async function processImageForFaceAnonymization(imageBase64: string): Promise<string> {
  await loadModels();
  
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const img = await loadImage(imageBuffer);
  
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  
  const inputTensor = tf.tidy(() => {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return tf.browser.fromPixels({
      data: new Uint8Array(imgData.data),
      width: canvas.width,
      height: canvas.height
    }, 3);
  });

  const detection = await faceapi
    .detectSingleFace(inputTensor as any)
    .withFaceLandmarks();
  
  inputTensor.dispose();
  
  if (!detection) {
    throw new Error("No face detected in the image");
  }
  
  const { landmarks, detection: faceDetection } = detection;
  const box = faceDetection.box;
  
  const jawline = landmarks.getJawOutline();
  const leftEyebrow = landmarks.getLeftEyeBrow();
  const rightEyebrow = landmarks.getRightEyeBrow();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  
  const faceWidth = box.width;
  const faceHeight = box.height;
  
  const faceCenterX = box.x + faceWidth / 2;
  
  const eyebrowTop = Math.min(...leftEyebrow.map(p => p.y), ...rightEyebrow.map(p => p.y));
  const jawBottom = Math.max(...jawline.map(p => p.y));
  
  const foreheadPadding = faceHeight * 0.35;
  const chinPadding = faceHeight * 0.08;
  
  const ovalTop = eyebrowTop - foreheadPadding;
  const ovalBottom = jawBottom + chinPadding;
  const ovalCenterY = (ovalTop + ovalBottom) / 2;
  const ovalHeight = ovalBottom - ovalTop;
  const ovalWidth = faceWidth * 1.15;
  
  const outputWidth = Math.ceil(ovalWidth * 1.1);
  const outputHeight = Math.ceil(ovalHeight * 1.1);
  
  const sourceX = Math.max(0, Math.min(faceCenterX - outputWidth / 2, img.width - outputWidth));
  const sourceY = Math.max(0, Math.min(ovalCenterY - outputHeight / 2, img.height - outputHeight));
  
  const clampedWidth = Math.min(outputWidth, img.width - sourceX);
  const clampedHeight = Math.min(outputHeight, img.height - sourceY);
  
  const outputCanvas = createCanvas(clampedWidth, clampedHeight);
  const outputCtx = outputCanvas.getContext("2d");
  
  outputCtx.drawImage(
    canvas,
    sourceX, sourceY, clampedWidth, clampedHeight,
    0, 0, clampedWidth, clampedHeight
  );
  
  const maskCanvas = createCanvas(clampedWidth, clampedHeight);
  const maskCtx = maskCanvas.getContext("2d");
  
  const ovalCenterXOutput = clampedWidth / 2;
  const ovalCenterYOutput = clampedHeight / 2;
  const ovalRadiusX = ovalWidth / 2;
  const ovalRadiusY = ovalHeight / 2;
  
  maskCtx.fillStyle = 'white';
  maskCtx.beginPath();
  maskCtx.ellipse(ovalCenterXOutput, ovalCenterYOutput, ovalRadiusX, ovalRadiusY, 0, 0, Math.PI * 2);
  maskCtx.fill();
  
  const finalCanvas = createCanvas(clampedWidth, clampedHeight);
  const finalCtx = finalCanvas.getContext("2d");
  
  finalCtx.drawImage(outputCanvas, 0, 0);
  finalCtx.globalCompositeOperation = 'destination-in';
  finalCtx.drawImage(maskCanvas, 0, 0);
  finalCtx.globalCompositeOperation = 'source-over';
  
  const leftEyeCenter = {
    x: Math.max(0, Math.min(leftEye.reduce((sum, p) => sum + p.x, 0) / leftEye.length - sourceX, clampedWidth)),
    y: Math.max(0, Math.min(leftEye.reduce((sum, p) => sum + p.y, 0) / leftEye.length - sourceY, clampedHeight))
  };
  const rightEyeCenter = {
    x: Math.max(0, Math.min(rightEye.reduce((sum, p) => sum + p.x, 0) / rightEye.length - sourceX, clampedWidth)),
    y: Math.max(0, Math.min(rightEye.reduce((sum, p) => sum + p.y, 0) / rightEye.length - sourceY, clampedHeight))
  };
  
  const eyeDistance = Math.sqrt(
    Math.pow(rightEyeCenter.x - leftEyeCenter.x, 2) +
    Math.pow(rightEyeCenter.y - leftEyeCenter.y, 2)
  );
  
  const dotRadiusX = eyeDistance * 0.15;
  const dotRadiusY = dotRadiusX * 0.75;
  
  finalCtx.fillStyle = "#000000";
  
  finalCtx.beginPath();
  finalCtx.ellipse(leftEyeCenter.x, leftEyeCenter.y, dotRadiusX, dotRadiusY, 0, 0, Math.PI * 2);
  finalCtx.fill();
  
  finalCtx.beginPath();
  finalCtx.ellipse(rightEyeCenter.x, rightEyeCenter.y, dotRadiusX, dotRadiusY, 0, 0, Math.PI * 2);
  finalCtx.fill();
  
  const pngBuffer = finalCanvas.toBuffer("image/png");
  return pngBuffer.toString("base64");
}
