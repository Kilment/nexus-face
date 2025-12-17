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

function catmullRomSpline(points: {x: number, y: number}[], numSegments: number = 10): {x: number, y: number}[] {
  if (points.length < 2) return points;
  
  const result: {x: number, y: number}[] = [];
  
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[Math.min(points.length - 1, i + 1)];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    
    for (let t = 0; t < numSegments; t++) {
      const tt = t / numSegments;
      const tt2 = tt * tt;
      const tt3 = tt2 * tt;
      
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * tt +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * tt3
      );
      
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * tt +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * tt3
      );
      
      result.push({ x, y });
    }
  }
  
  result.push(points[points.length - 1]);
  return result;
}

function sampleForeheadColor(
  ctx: CanvasRenderingContext2D,
  eyebrowTop: number,
  faceCenterX: number,
  faceWidth: number
): { r: number, g: number, b: number } {
  const sampleY = Math.max(0, eyebrowTop - 10);
  const sampleX = faceCenterX;
  const sampleWidth = Math.floor(faceWidth * 0.3);
  const sampleHeight = 5;
  
  try {
    const imageData = ctx.getImageData(
      Math.max(0, Math.floor(sampleX - sampleWidth / 2)),
      Math.floor(sampleY),
      sampleWidth,
      sampleHeight
    );
    
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      r += imageData.data[i];
      g += imageData.data[i + 1];
      b += imageData.data[i + 2];
      count++;
    }
    
    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count)
    };
  } catch {
    return { r: 220, g: 190, b: 170 };
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
  const chinPoint = jawline[Math.floor(jawline.length / 2)];
  const eyebrowTop = Math.min(...leftEyebrow.map(p => p.y), ...rightEyebrow.map(p => p.y));
  
  const foreheadHeight = faceHeight * 0.55;
  const headTop = eyebrowTop - foreheadHeight;
  
  const skinColor = sampleForeheadColor(ctx, eyebrowTop, faceCenterX, faceWidth);
  
  const padding = faceWidth * 0.2;
  const leftBound = Math.min(...jawline.map(p => p.x)) - padding;
  const rightBound = Math.max(...jawline.map(p => p.x)) + padding;
  const totalWidth = rightBound - leftBound;
  const totalHeight = jawBottom - headTop + padding;
  
  const outputSize = Math.max(totalWidth, totalHeight);
  const outputCanvas = createCanvas(outputSize, outputSize);
  const outputCtx = outputCanvas.getContext("2d");
  
  outputCtx.clearRect(0, 0, outputSize, outputSize);
  
  const offsetX = (outputSize - totalWidth) / 2 - leftBound;
  const offsetY = (outputSize - totalHeight) / 2 - headTop;
  
  const headCenterX = faceCenterX + offsetX;
  const headTopY = headTop + offsetY;
  const headWidth = faceWidth * 0.58;
  const headHeight = foreheadHeight * 1.2;
  
  const gradient = outputCtx.createRadialGradient(
    headCenterX, headTopY + headHeight * 0.6,
    headWidth * 0.3,
    headCenterX, headTopY + headHeight * 0.6,
    headWidth * 1.2
  );
  gradient.addColorStop(0, `rgb(${skinColor.r}, ${skinColor.g}, ${skinColor.b})`);
  gradient.addColorStop(0.7, `rgb(${skinColor.r - 10}, ${skinColor.g - 8}, ${skinColor.b - 5})`);
  gradient.addColorStop(1, `rgba(${skinColor.r - 20}, ${skinColor.g - 15}, ${skinColor.b - 10}, 0.8)`);
  
  outputCtx.fillStyle = gradient;
  outputCtx.beginPath();
  outputCtx.ellipse(headCenterX, headTopY + headHeight * 0.5, headWidth, headHeight * 0.55, 0, 0, Math.PI * 2);
  outputCtx.fill();
  
  const adjustedJawline = jawline.map(p => ({
    x: p.x + offsetX,
    y: p.y + offsetY
  }));
  
  const leftTemple = { x: adjustedJawline[0].x - padding * 0.3, y: adjustedJawline[0].y - faceHeight * 0.2 };
  const rightTemple = { x: adjustedJawline[adjustedJawline.length - 1].x + padding * 0.3, y: adjustedJawline[adjustedJawline.length - 1].y - faceHeight * 0.2 };
  
  const outlinePoints: {x: number, y: number}[] = [];
  
  outlinePoints.push({ x: headCenterX, y: headTopY });
  outlinePoints.push({ x: headCenterX + headWidth * 0.7, y: headTopY + headHeight * 0.15 });
  outlinePoints.push({ x: rightTemple.x + padding * 0.2, y: rightTemple.y - faceHeight * 0.1 });
  outlinePoints.push(rightTemple);
  outlinePoints.push(adjustedJawline[adjustedJawline.length - 1]);
  
  for (let i = adjustedJawline.length - 2; i >= 1; i--) {
    outlinePoints.push(adjustedJawline[i]);
  }
  
  outlinePoints.push(adjustedJawline[0]);
  outlinePoints.push(leftTemple);
  outlinePoints.push({ x: leftTemple.x - padding * 0.2, y: leftTemple.y - faceHeight * 0.1 });
  outlinePoints.push({ x: headCenterX - headWidth * 0.7, y: headTopY + headHeight * 0.15 });
  outlinePoints.push({ x: headCenterX, y: headTopY });
  
  const smoothOutline = catmullRomSpline(outlinePoints, 8);
  
  outputCtx.save();
  outputCtx.beginPath();
  outputCtx.moveTo(smoothOutline[0].x, smoothOutline[0].y);
  for (let i = 1; i < smoothOutline.length; i++) {
    outputCtx.lineTo(smoothOutline[i].x, smoothOutline[i].y);
  }
  outputCtx.closePath();
  outputCtx.clip();
  
  outputCtx.drawImage(canvas, offsetX, offsetY);
  
  outputCtx.restore();
  
  const maskCanvas = createCanvas(outputSize, outputSize);
  const maskCtx = maskCanvas.getContext("2d");
  
  maskCtx.fillStyle = 'black';
  maskCtx.fillRect(0, 0, outputSize, outputSize);
  
  maskCtx.fillStyle = 'white';
  maskCtx.beginPath();
  maskCtx.moveTo(smoothOutline[0].x, smoothOutline[0].y);
  for (let i = 1; i < smoothOutline.length; i++) {
    maskCtx.lineTo(smoothOutline[i].x, smoothOutline[i].y);
  }
  maskCtx.closePath();
  maskCtx.fill();
  
  const finalCanvas = createCanvas(outputSize, outputSize);
  const finalCtx = finalCanvas.getContext("2d");
  
  finalCtx.drawImage(outputCanvas, 0, 0);
  finalCtx.globalCompositeOperation = 'destination-in';
  finalCtx.drawImage(maskCanvas, 0, 0);
  finalCtx.globalCompositeOperation = 'source-over';
  
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
  
  const dotRadiusX = eyeDistance * 0.16;
  const dotRadiusY = dotRadiusX * 0.8;
  
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
