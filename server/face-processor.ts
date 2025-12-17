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
  
  const padding = 0.1;
  const paddingX = box.width * padding;
  const paddingY = box.height * padding;
  
  const topY = Math.max(0, Math.min(...leftEyebrow.map(p => p.y), ...rightEyebrow.map(p => p.y)) - paddingY * 2);
  const bottomY = Math.min(img.height, Math.max(...jawline.map(p => p.y)) + paddingY * 0.5);
  const leftX = Math.max(0, box.x - paddingX);
  const rightX = Math.min(img.width, box.x + box.width + paddingX);
  
  const cropWidth = rightX - leftX;
  const cropHeight = bottomY - topY;
  
  const outputSize = Math.max(cropWidth, cropHeight);
  const outputCanvas = createCanvas(outputSize, outputSize);
  const outputCtx = outputCanvas.getContext("2d");
  
  outputCtx.clearRect(0, 0, outputSize, outputSize);
  
  outputCtx.save();
  outputCtx.beginPath();
  
  const faceOutline: { x: number; y: number }[] = [];
  
  const rightBrowPoints = [...rightEyebrow].reverse();
  const leftBrowPoints = [...leftEyebrow];
  
  const foreheadHeight = paddingY * 1.5;
  const foreheadLeft = { x: leftBrowPoints[0].x - leftX, y: leftBrowPoints[0].y - topY - foreheadHeight };
  const foreheadRight = { x: rightBrowPoints[0].x - leftX, y: rightBrowPoints[0].y - topY - foreheadHeight };
  const foreheadMid = { 
    x: (foreheadLeft.x + foreheadRight.x) / 2, 
    y: Math.min(foreheadLeft.y, foreheadRight.y) - foreheadHeight * 0.5 
  };
  
  faceOutline.push({ x: foreheadLeft.x, y: Math.max(0, foreheadLeft.y) });
  faceOutline.push({ x: foreheadMid.x, y: Math.max(0, foreheadMid.y) });
  faceOutline.push({ x: foreheadRight.x, y: Math.max(0, foreheadRight.y) });
  
  for (const p of rightBrowPoints) {
    faceOutline.push({ x: p.x - leftX, y: p.y - topY });
  }
  
  const rightTemple = { x: jawline[0].x - leftX + paddingX * 0.3, y: jawline[0].y - topY };
  faceOutline.push(rightTemple);
  
  for (const p of jawline) {
    faceOutline.push({ x: p.x - leftX, y: p.y - topY });
  }
  
  const leftTemple = { x: jawline[jawline.length - 1].x - leftX - paddingX * 0.3, y: jawline[jawline.length - 1].y - topY };
  faceOutline.push(leftTemple);
  
  for (const p of leftBrowPoints.reverse()) {
    faceOutline.push({ x: p.x - leftX, y: p.y - topY });
  }
  
  if (faceOutline.length > 0) {
    outputCtx.moveTo(faceOutline[0].x, faceOutline[0].y);
    for (let i = 1; i < faceOutline.length; i++) {
      outputCtx.lineTo(faceOutline[i].x, faceOutline[i].y);
    }
    outputCtx.closePath();
    outputCtx.clip();
  }
  
  const offsetX = (outputSize - cropWidth) / 2;
  const offsetY = (outputSize - cropHeight) / 2;
  
  outputCtx.drawImage(
    canvas,
    leftX, topY, cropWidth, cropHeight,
    offsetX, offsetY, cropWidth, cropHeight
  );
  
  outputCtx.restore();
  
  const adjustedLeftEye = leftEye.map(p => ({
    x: p.x - leftX + offsetX,
    y: p.y - topY + offsetY
  }));
  const adjustedRightEye = rightEye.map(p => ({
    x: p.x - leftX + offsetX,
    y: p.y - topY + offsetY
  }));
  
  const leftEyeCenter = {
    x: adjustedLeftEye.reduce((sum, p) => sum + p.x, 0) / adjustedLeftEye.length,
    y: adjustedLeftEye.reduce((sum, p) => sum + p.y, 0) / adjustedLeftEye.length
  };
  const rightEyeCenter = {
    x: adjustedRightEye.reduce((sum, p) => sum + p.x, 0) / adjustedRightEye.length,
    y: adjustedRightEye.reduce((sum, p) => sum + p.y, 0) / adjustedRightEye.length
  };
  
  const eyeDistance = Math.sqrt(
    Math.pow(rightEyeCenter.x - leftEyeCenter.x, 2) +
    Math.pow(rightEyeCenter.y - leftEyeCenter.y, 2)
  );
  const dotRadius = eyeDistance * 0.12;
  
  outputCtx.fillStyle = "#000000";
  outputCtx.beginPath();
  outputCtx.arc(leftEyeCenter.x, leftEyeCenter.y, dotRadius, 0, Math.PI * 2);
  outputCtx.fill();
  
  outputCtx.beginPath();
  outputCtx.arc(rightEyeCenter.x, rightEyeCenter.y, dotRadius, 0, Math.PI * 2);
  outputCtx.fill();
  
  const pngBuffer = outputCanvas.toBuffer("image/png");
  return pngBuffer.toString("base64");
}
