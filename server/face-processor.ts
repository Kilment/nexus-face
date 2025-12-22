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

function catmullRomSpline(points: {x: number, y: number}[], numSegments: number = 12): {x: number, y: number}[] {
  if (points.length < 4) return points;
  
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

function sampleSkinColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): { r: number, g: number, b: number } {
  try {
    const sampleX = Math.max(0, Math.floor(x));
    const sampleY = Math.max(0, Math.floor(y));
    const sampleW = Math.max(1, Math.floor(width));
    const sampleH = Math.max(1, Math.floor(height));
    
    const imageData = ctx.getImageData(sampleX, sampleY, sampleW, sampleH);
    
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i + 3] > 0) {
        r += imageData.data[i];
        g += imageData.data[i + 1];
        b += imageData.data[i + 2];
        count++;
      }
    }
    
    if (count === 0) return { r: 210, g: 180, b: 160 };
    
    return {
      r: Math.round(r / count),
      g: Math.round(g / count),
      b: Math.round(b / count)
    };
  } catch {
    return { r: 210, g: 180, b: 160 };
  }
}

function stackBlur(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number): void {
  if (radius < 1) return;
  
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;
  
  const wm = width - 1;
  const hm = height - 1;
  const div = radius + radius + 1;
  
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const a: number[] = [];
  
  let rsum: number, gsum: number, bsum: number, asum: number;
  let p: number, p1: number, p2: number;
  let yp: number, yi: number, yw: number;
  
  const mul_sum = 1 / div;
  
  yw = yi = 0;
  
  for (let y = 0; y < height; y++) {
    rsum = gsum = bsum = asum = 0;
    
    for (let i = -radius; i <= radius; i++) {
      p = (yi + Math.min(wm, Math.max(0, i))) * 4;
      rsum += pixels[p];
      gsum += pixels[p + 1];
      bsum += pixels[p + 2];
      asum += pixels[p + 3];
    }
    
    for (let x = 0; x < width; x++) {
      r[yi] = rsum * mul_sum;
      g[yi] = gsum * mul_sum;
      b[yi] = bsum * mul_sum;
      a[yi] = asum * mul_sum;
      
      p1 = (yi + Math.min(wm, x + radius + 1)) * 4;
      p2 = (yi + Math.max(0, x - radius)) * 4;
      
      rsum += pixels[p1] - pixels[p2];
      gsum += pixels[p1 + 1] - pixels[p2 + 1];
      bsum += pixels[p1 + 2] - pixels[p2 + 2];
      asum += pixels[p1 + 3] - pixels[p2 + 3];
      
      yi++;
    }
    yw += width;
  }
  
  for (let x = 0; x < width; x++) {
    rsum = gsum = bsum = asum = 0;
    yp = -radius * width;
    
    for (let i = -radius; i <= radius; i++) {
      yi = Math.max(0, yp) + x;
      rsum += r[yi];
      gsum += g[yi];
      bsum += b[yi];
      asum += a[yi];
      yp += width;
    }
    
    yi = x;
    
    for (let y = 0; y < height; y++) {
      pixels[yi * 4] = rsum * mul_sum;
      pixels[yi * 4 + 1] = gsum * mul_sum;
      pixels[yi * 4 + 2] = bsum * mul_sum;
      pixels[yi * 4 + 3] = asum * mul_sum;
      
      p1 = x + Math.min(hm, y + radius + 1) * width;
      p2 = x + Math.max(0, y - radius) * width;
      
      rsum += r[p1] - r[p2];
      gsum += g[p1] - g[p2];
      bsum += b[p1] - b[p2];
      asum += a[p1] - a[p2];
      
      yi += width;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
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
  
  const foreheadHeight = faceHeight * 0.55;
  const headTop = eyebrowTop - foreheadHeight;
  
  const neckLength = faceHeight * 0.4;
  const neckBottom = jawBottom + neckLength;
  
  const skinColor = sampleSkinColor(ctx, faceCenterX - faceWidth * 0.15, eyebrowTop - 15, faceWidth * 0.3, 10);
  
  const cheekPadding = faceWidth * 0.08;
  const leftBound = Math.min(...jawline.map(p => p.x)) - cheekPadding;
  const rightBound = Math.max(...jawline.map(p => p.x)) + cheekPadding;
  const totalWidth = rightBound - leftBound;
  const totalHeight = neckBottom - headTop;
  
  const superSample = 2;
  const outputSize = Math.max(totalWidth, totalHeight) * 1.1;
  const ssSize = outputSize * superSample;
  
  const offsetX = (outputSize - totalWidth) / 2 - leftBound;
  const offsetY = (outputSize - totalHeight) / 2 - headTop;
  
  const ssOffsetX = offsetX * superSample;
  const ssOffsetY = offsetY * superSample;
  const ssFaceWidth = faceWidth * superSample;
  const ssFaceHeight = faceHeight * superSample;
  
  const ssMaskCanvas = createCanvas(ssSize, ssSize);
  const ssMaskCtx = ssMaskCanvas.getContext("2d");
  
  const adjustedJawline = jawline.map(p => ({
    x: p.x * superSample + ssOffsetX,
    y: p.y * superSample + ssOffsetY
  }));
  
  const headCenterX = faceCenterX * superSample + ssOffsetX;
  const headTopY = headTop * superSample + ssOffsetY;
  const neckBottomY = neckBottom * superSample + ssOffsetY;
  
  const chinIndex = Math.floor(adjustedJawline.length / 2);
  const chinPoint = adjustedJawline[chinIndex];
  
  const neckWidth = ssFaceWidth * 0.45;
  const neckLeft = { x: chinPoint.x - neckWidth / 2, y: neckBottomY };
  const neckRight = { x: chinPoint.x + neckWidth / 2, y: neckBottomY };
  
  const leftJaw = adjustedJawline[0];
  const rightJaw = adjustedJawline[adjustedJawline.length - 1];
  
  const leftTemple = { x: leftJaw.x - cheekPadding * superSample, y: leftJaw.y - ssFaceHeight * 0.15 };
  const rightTemple = { x: rightJaw.x + cheekPadding * superSample, y: rightJaw.y - ssFaceHeight * 0.15 };
  
  const headWidth = ssFaceWidth * 0.6;
  
  const outlinePoints: {x: number, y: number}[] = [];
  
  outlinePoints.push(neckLeft);
  outlinePoints.push({ x: neckLeft.x - ssFaceWidth * 0.05, y: (neckLeft.y + adjustedJawline[1].y) / 2 });
  outlinePoints.push({ x: adjustedJawline[1].x - cheekPadding * superSample * 0.5, y: adjustedJawline[1].y });
  outlinePoints.push({ x: leftJaw.x - cheekPadding * superSample * 0.8, y: leftJaw.y });
  outlinePoints.push(leftTemple);
  outlinePoints.push({ x: leftTemple.x - ssFaceWidth * 0.05, y: headTopY + ssFaceHeight * 0.3 });
  outlinePoints.push({ x: headCenterX - headWidth * 0.85, y: headTopY + ssFaceHeight * 0.1 });
  outlinePoints.push({ x: headCenterX - headWidth * 0.5, y: headTopY });
  outlinePoints.push({ x: headCenterX, y: headTopY - ssFaceHeight * 0.02 });
  outlinePoints.push({ x: headCenterX + headWidth * 0.5, y: headTopY });
  outlinePoints.push({ x: headCenterX + headWidth * 0.85, y: headTopY + ssFaceHeight * 0.1 });
  outlinePoints.push({ x: rightTemple.x + ssFaceWidth * 0.05, y: headTopY + ssFaceHeight * 0.3 });
  outlinePoints.push(rightTemple);
  outlinePoints.push({ x: rightJaw.x + cheekPadding * superSample * 0.8, y: rightJaw.y });
  outlinePoints.push({ x: adjustedJawline[adjustedJawline.length - 2].x + cheekPadding * superSample * 0.5, y: adjustedJawline[adjustedJawline.length - 2].y });
  outlinePoints.push({ x: neckRight.x + ssFaceWidth * 0.05, y: (neckRight.y + adjustedJawline[adjustedJawline.length - 2].y) / 2 });
  outlinePoints.push(neckRight);
  outlinePoints.push(neckLeft);
  
  const smoothOutline = catmullRomSpline(outlinePoints, 16);
  
  ssMaskCtx.fillStyle = 'white';
  ssMaskCtx.beginPath();
  ssMaskCtx.moveTo(smoothOutline[0].x, smoothOutline[0].y);
  for (let i = 1; i < smoothOutline.length; i++) {
    ssMaskCtx.lineTo(smoothOutline[i].x, smoothOutline[i].y);
  }
  ssMaskCtx.closePath();
  ssMaskCtx.fill();
  
  stackBlur(ssMaskCtx, ssSize, ssSize, 3);
  
  const maskCanvas = createCanvas(outputSize, outputSize);
  const maskCtx = maskCanvas.getContext("2d");
  maskCtx.drawImage(ssMaskCanvas, 0, 0, ssSize, ssSize, 0, 0, outputSize, outputSize);
  
  const outputCanvas = createCanvas(outputSize, outputSize);
  const outputCtx = outputCanvas.getContext("2d");
  
  const headTopOutput = headTop + offsetY;
  const foreheadY = eyebrowTop + offsetY - 5;
  const headCenterOutput = faceCenterX + offsetX;
  const headWidthOutput = headWidth / superSample;
  
  const scalpGradient = outputCtx.createRadialGradient(
    headCenterOutput, headTopOutput + foreheadHeight * 0.3,
    faceWidth * 0.1,
    headCenterOutput, headTopOutput + foreheadHeight * 0.3,
    headWidthOutput * 1.3
  );
  scalpGradient.addColorStop(0, `rgb(${skinColor.r}, ${skinColor.g}, ${skinColor.b})`);
  scalpGradient.addColorStop(0.5, `rgb(${Math.max(0, skinColor.r - 5)}, ${Math.max(0, skinColor.g - 4)}, ${Math.max(0, skinColor.b - 3)})`);
  scalpGradient.addColorStop(1, `rgb(${Math.max(0, skinColor.r - 15)}, ${Math.max(0, skinColor.g - 12)}, ${Math.max(0, skinColor.b - 8)})`);
  
  outputCtx.fillStyle = scalpGradient;
  outputCtx.beginPath();
  outputCtx.ellipse(headCenterOutput, headTopOutput + foreheadHeight * 0.35, headWidthOutput, foreheadHeight * 0.6, 0, 0, Math.PI * 2);
  outputCtx.fill();
  
  outputCtx.drawImage(canvas, offsetX, offsetY);
  
  outputCtx.save();
  outputCtx.beginPath();
  
  const outputOutline = smoothOutline.map(p => ({ x: p.x / superSample, y: p.y / superSample }));
  outputCtx.moveTo(outputOutline[0].x, outputOutline[0].y);
  for (let i = 1; i < outputOutline.length; i++) {
    outputCtx.lineTo(outputOutline[i].x, outputOutline[i].y);
  }
  outputCtx.closePath();
  
  outputCtx.globalCompositeOperation = 'destination-out';
  outputCtx.fillStyle = 'black';
  outputCtx.rect(0, 0, outputSize, outputSize);
  outputCtx.fill('evenodd');
  outputCtx.restore();
  
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
