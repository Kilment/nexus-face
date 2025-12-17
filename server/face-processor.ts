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
  const jawBottom = Math.max(...jawline.map(p => p.y));
  const eyebrowTop = Math.min(...leftEyebrow.map(p => p.y), ...rightEyebrow.map(p => p.y));
  
  const foreheadHeight = faceHeight * 0.45;
  const headTop = eyebrowTop - foreheadHeight;
  
  const neckLength = faceHeight * 0.35;
  const neckBottom = jawBottom + neckLength;
  
  const cheekPadding = faceWidth * 0.15;
  const leftMostJaw = Math.min(...jawline.map(p => p.x)) - cheekPadding;
  const rightMostJaw = Math.max(...jawline.map(p => p.x)) + cheekPadding;
  const actualFaceWidth = rightMostJaw - leftMostJaw;
  
  const outputPadding = faceWidth * 0.1;
  const totalHeight = neckBottom - headTop;
  
  const outputWidth = actualFaceWidth + outputPadding * 2;
  const outputHeight = totalHeight + outputPadding * 2;
  const outputSize = Math.max(outputWidth, outputHeight);
  
  const outputCanvas = createCanvas(outputSize, outputSize);
  const outputCtx = outputCanvas.getContext("2d");
  
  outputCtx.clearRect(0, 0, outputSize, outputSize);
  
  const offsetX = (outputSize - actualFaceWidth) / 2 - leftMostJaw;
  const offsetY = (outputSize - totalHeight) / 2 - headTop;
  
  outputCtx.save();
  outputCtx.beginPath();
  
  const adjustedJawline = jawline.map(p => ({
    x: p.x + offsetX,
    y: p.y + offsetY
  }));
  
  const headCenterX = faceCenterX + offsetX;
  const headTopY = headTop + offsetY;
  const adjustedNeckBottom = neckBottom + offsetY;
  
  const chinIndex = Math.floor(adjustedJawline.length / 2);
  const chinPoint = adjustedJawline[chinIndex];
  
  const neckWidth = faceWidth * 0.45;
  const neckLeft = { x: chinPoint.x - neckWidth / 2, y: adjustedNeckBottom };
  const neckRight = { x: chinPoint.x + neckWidth / 2, y: adjustedNeckBottom };
  
  const leftJawStart = adjustedJawline[0];
  const rightJawEnd = adjustedJawline[adjustedJawline.length - 1];
  
  const leftTemple = { 
    x: leftJawStart.x - cheekPadding, 
    y: leftJawStart.y - faceHeight * 0.1 
  };
  const rightTemple = { 
    x: rightJawEnd.x + cheekPadding, 
    y: rightJawEnd.y - faceHeight * 0.1 
  };
  
  outputCtx.moveTo(neckLeft.x, neckLeft.y);
  
  outputCtx.lineTo(neckLeft.x, chinPoint.y + faceHeight * 0.1);
  
  outputCtx.quadraticCurveTo(
    leftJawStart.x - cheekPadding * 0.5, chinPoint.y,
    leftJawStart.x, leftJawStart.y
  );
  
  outputCtx.lineTo(leftTemple.x, leftTemple.y);
  
  outputCtx.bezierCurveTo(
    leftTemple.x, headTopY + faceHeight * 0.2,
    headCenterX - faceWidth * 0.3, headTopY,
    headCenterX, headTopY
  );
  
  outputCtx.bezierCurveTo(
    headCenterX + faceWidth * 0.3, headTopY,
    rightTemple.x, headTopY + faceHeight * 0.2,
    rightTemple.x, rightTemple.y
  );
  
  outputCtx.lineTo(rightJawEnd.x, rightJawEnd.y);
  
  outputCtx.quadraticCurveTo(
    rightJawEnd.x + cheekPadding * 0.5, chinPoint.y,
    neckRight.x, chinPoint.y + faceHeight * 0.1
  );
  
  outputCtx.lineTo(neckRight.x, neckRight.y);
  
  outputCtx.lineTo(neckLeft.x, neckLeft.y);
  
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
  
  const dotRadiusX = eyeDistance * 0.18;
  const dotRadiusY = dotRadiusX * 0.75;
  
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
