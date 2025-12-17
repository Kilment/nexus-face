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
  const nose = landmarks.getNose();
  
  const faceWidth = box.width;
  const faceHeight = box.height;
  
  const faceCenterX = box.x + faceWidth / 2;
  const jawBottom = Math.max(...jawline.map(p => p.y));
  const eyebrowTop = Math.min(...leftEyebrow.map(p => p.y), ...rightEyebrow.map(p => p.y));
  
  const foreheadHeight = faceHeight * 0.35;
  const headTop = eyebrowTop - foreheadHeight;
  
  const outputPadding = faceWidth * 0.15;
  const outputWidth = faceWidth + outputPadding * 2;
  const totalFaceHeight = jawBottom - headTop;
  const outputHeight = totalFaceHeight + outputPadding * 2;
  
  const outputSize = Math.max(outputWidth, outputHeight);
  const outputCanvas = createCanvas(outputSize, outputSize);
  const outputCtx = outputCanvas.getContext("2d");
  
  outputCtx.clearRect(0, 0, outputSize, outputSize);
  
  const offsetX = (outputSize - faceWidth) / 2 - (box.x);
  const offsetY = (outputSize - totalFaceHeight) / 2 - headTop;
  
  outputCtx.save();
  outputCtx.beginPath();
  
  const adjustedJawline = jawline.map(p => ({
    x: p.x + offsetX,
    y: p.y + offsetY
  }));
  
  const leftTemple = { 
    x: adjustedJawline[0].x, 
    y: adjustedJawline[0].y - faceHeight * 0.15 
  };
  const rightTemple = { 
    x: adjustedJawline[adjustedJawline.length - 1].x, 
    y: adjustedJawline[adjustedJawline.length - 1].y - faceHeight * 0.15 
  };
  
  const headCenterX = faceCenterX + offsetX;
  const headTopY = headTop + offsetY;
  
  const headRadius = faceWidth * 0.52;
  
  outputCtx.moveTo(adjustedJawline[0].x, adjustedJawline[0].y);
  
  for (let i = 1; i < adjustedJawline.length; i++) {
    outputCtx.lineTo(adjustedJawline[i].x, adjustedJawline[i].y);
  }
  
  outputCtx.bezierCurveTo(
    rightTemple.x + faceWidth * 0.1, rightTemple.y - faceHeight * 0.2,
    headCenterX + headRadius * 0.8, headTopY + faceHeight * 0.1,
    headCenterX, headTopY
  );
  
  outputCtx.bezierCurveTo(
    headCenterX - headRadius * 0.8, headTopY + faceHeight * 0.1,
    leftTemple.x - faceWidth * 0.1, leftTemple.y - faceHeight * 0.2,
    adjustedJawline[0].x, adjustedJawline[0].y
  );
  
  outputCtx.closePath();
  outputCtx.clip();
  
  outputCtx.drawImage(canvas, offsetX, offsetY);
  
  outputCtx.restore();
  
  const leftEyeCenter = {
    x: leftEye.reduce((sum, p) => sum + p.x, 0) / leftEye.length + offsetX,
    y: leftEye.reduce((sum, p) => sum + p.y, 0) / leftEye.length + offsetY
  };
  const rightEyeCenter = {
    x: rightEye.reduce((sum, p) => sum + p.x, 0) / rightEye.length + offsetX,
    y: rightEye.reduce((sum, p) => sum + p.y, 0) / rightEye.length + offsetY
  };
  
  const eyeDistance = Math.sqrt(
    Math.pow(rightEyeCenter.x - leftEyeCenter.x, 2) +
    Math.pow(rightEyeCenter.y - leftEyeCenter.y, 2)
  );
  
  const leftEyeWidth = Math.max(...leftEye.map(p => p.x)) - Math.min(...leftEye.map(p => p.x));
  const leftEyeHeight = Math.max(...leftEye.map(p => p.y)) - Math.min(...leftEye.map(p => p.y));
  const rightEyeWidth = Math.max(...rightEye.map(p => p.x)) - Math.min(...rightEye.map(p => p.x));
  const rightEyeHeight = Math.max(...rightEye.map(p => p.y)) - Math.min(...rightEye.map(p => p.y));
  
  const dotRadiusX = eyeDistance * 0.18;
  const dotRadiusY = dotRadiusX * 0.7;
  
  outputCtx.fillStyle = "#000000";
  
  outputCtx.beginPath();
  outputCtx.ellipse(leftEyeCenter.x, leftEyeCenter.y, dotRadiusX, dotRadiusY, 0, 0, Math.PI * 2);
  outputCtx.fill();
  
  outputCtx.beginPath();
  outputCtx.ellipse(rightEyeCenter.x, rightEyeCenter.y, dotRadiusX, dotRadiusY, 0, 0, Math.PI * 2);
  outputCtx.fill();
  
  const pngBuffer = outputCanvas.toBuffer("image/png");
  return pngBuffer.toString("base64");
}
