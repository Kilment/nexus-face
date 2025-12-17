import * as faceapi from "@vladmandic/face-api";
import * as tf from "@tensorflow/tfjs-node";
import { Canvas, createCanvas, loadImage, Image } from "canvas";
import * as path from "path";
import * as fs from "fs";

let modelsLoaded = false;

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
    "ssd_mobilenetv1_model-shard1.shard.bin",
    "ssd_mobilenetv1_model-shard2.shard.bin",
    "face_landmark_68_model-weights_manifest.json",
    "face_landmark_68_model-shard1.shard.bin"
  ];
  
  for (const file of modelFiles) {
    try {
      const response = await fetch(baseUrl + file);
      if (!response.ok) {
        console.log(`Failed to download ${file} from primary source, trying alternate...`);
        const altUrl = `https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/${file.replace('.shard.bin', '')}`;
        const altResponse = await fetch(altUrl);
        if (!altResponse.ok) {
          throw new Error(`Failed to download model file: ${file}`);
        }
        const buffer = await altResponse.arrayBuffer();
        const saveAs = file.replace('.shard.bin', '');
        fs.writeFileSync(path.join(modelsPath, saveAs), Buffer.from(buffer));
        console.log(`Downloaded: ${saveAs}`);
        continue;
      }
      const buffer = await response.arrayBuffer();
      const saveAs = file.replace('.shard.bin', '');
      fs.writeFileSync(path.join(modelsPath, saveAs), Buffer.from(buffer));
      console.log(`Downloaded: ${saveAs}`);
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
  
  const canvas = createCanvas(img.width, img.height) as unknown as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
  
  const detection = await faceapi
    .detectSingleFace(canvas)
    .withFaceLandmarks();
  
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
  
  for (const p of leftBrowPoints) {
    faceOutline.push({ x: p.x - leftX, y: p.y - topY });
  }
  
  const offsetX = (outputSize - cropWidth) / 2;
  const offsetY = (outputSize - cropHeight) / 2;
  
  if (faceOutline.length > 0) {
    outputCtx.moveTo(faceOutline[0].x + offsetX, faceOutline[0].y + offsetY);
    for (let i = 1; i < faceOutline.length; i++) {
      outputCtx.lineTo(faceOutline[i].x + offsetX, faceOutline[i].y + offsetY);
    }
    outputCtx.closePath();
    outputCtx.clip();
  }
  
  outputCtx.drawImage(
    img as unknown as CanvasImageSource,
    leftX, topY, cropWidth, cropHeight,
    offsetX, offsetY, cropWidth, cropHeight
  );
  
  outputCtx.restore();
  
  const leftEyeCenter = {
    x: leftEye.reduce((sum, p) => sum + p.x, 0) / leftEye.length - leftX + offsetX,
    y: leftEye.reduce((sum, p) => sum + p.y, 0) / leftEye.length - topY + offsetY
  };
  const rightEyeCenter = {
    x: rightEye.reduce((sum, p) => sum + p.x, 0) / rightEye.length - leftX + offsetX,
    y: rightEye.reduce((sum, p) => sum + p.y, 0) / rightEye.length - topY + offsetY
  };
  
  const leftEyeWidth = Math.max(...leftEye.map(p => p.x)) - Math.min(...leftEye.map(p => p.x));
  const leftEyeHeight = Math.max(...leftEye.map(p => p.y)) - Math.min(...leftEye.map(p => p.y));
  const rightEyeWidth = Math.max(...rightEye.map(p => p.x)) - Math.min(...rightEye.map(p => p.x));
  const rightEyeHeight = Math.max(...rightEye.map(p => p.y)) - Math.min(...rightEye.map(p => p.y));
  
  const eyeScaleFactor = 1.3;
  
  outputCtx.fillStyle = "black";
  
  outputCtx.beginPath();
  outputCtx.ellipse(
    leftEyeCenter.x,
    leftEyeCenter.y,
    (leftEyeWidth / 2) * eyeScaleFactor,
    (leftEyeHeight / 2) * eyeScaleFactor * 1.2,
    0, 0, Math.PI * 2
  );
  outputCtx.fill();
  
  outputCtx.beginPath();
  outputCtx.ellipse(
    rightEyeCenter.x,
    rightEyeCenter.y,
    (rightEyeWidth / 2) * eyeScaleFactor,
    (rightEyeHeight / 2) * eyeScaleFactor * 1.2,
    0, 0, Math.PI * 2
  );
  outputCtx.fill();
  
  const resultBuffer = outputCanvas.toBuffer("image/png");
  return resultBuffer.toString("base64");
}
