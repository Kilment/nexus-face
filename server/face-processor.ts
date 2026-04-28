import * as faceapi from "@vladmandic/face-api";
import * as tf from "@tensorflow/tfjs-node";
import { createCanvas, loadImage, Canvas, Image } from "canvas";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

let modelsLoaded = false;
let cachedPipelineInfo: DeIdPipelineInfo | null = null;

const MODEL_FILES = [
  "ssd_mobilenetv1_model-weights_manifest.json",
  "ssd_mobilenetv1_model-shard1",
  "ssd_mobilenetv1_model-shard2",
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model-shard1",
] as const;

const RETRY_SCALES = [1, 0.85, 1.15, 0.7, 1.3] as const;
const MIN_FACE_AREA_RATIO = 0.02;
const MAX_DETECTION_DIMENSION = 1280;
const FACE_DETECTION_TIMEOUT_MS = 8000;

export interface DeIdPipelineInfo {
  pipelineVersion: string;
  modelSource: string;
  modelChecksums: Record<string, string>;
  modelIntegrityStrict: boolean;
  integrityMode: "Default" | "Pinned";
}

faceapi.env.monkeyPatch({
  Canvas: Canvas as any,
  Image: Image as any,
});

async function loadModels(): Promise<void> {
  if (modelsLoaded && cachedPipelineInfo) return;
  
  const modelsPath = path.join(process.cwd(), "server", "models");
  
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true });
  }
  
  const modelFiles = fs.readdirSync(modelsPath);
  if (modelFiles.length === 0) {
    console.log("Face detection models not found. Downloading...");
    await downloadModels(modelsPath);
  }

  const strictRequested = process.env.DEID_STRICT_MODEL_CHECKSUMS === "true";
  const hasPinnedChecksums = !!process.env.DEID_MODEL_SHA256_JSON;
  const shouldEnforcePinnedChecksums = strictRequested && hasPinnedChecksums;
  const modelChecksums = await ensureModelIntegrity(modelsPath, shouldEnforcePinnedChecksums);
  
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
  
  modelsLoaded = true;
  cachedPipelineInfo = {
    pipelineVersion: "deid-faceapi-1.1.0",
    modelSource:
      "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/",
    modelChecksums,
    modelIntegrityStrict: shouldEnforcePinnedChecksums,
    integrityMode: shouldEnforcePinnedChecksums ? "Pinned" : "Default",
  };
  console.log("Face detection models loaded successfully");
}

async function downloadModels(modelsPath: string): Promise<void> {
  const baseUrl = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/";
  
  for (const file of MODEL_FILES) {
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

function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function ensureModelIntegrity(
  modelsPath: string,
  enforcePinnedChecksums: boolean,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const expectedRaw = process.env.DEID_MODEL_SHA256_JSON;
  let expected: Record<string, string> | null = null;
  if (enforcePinnedChecksums && expectedRaw) {
    try {
      expected = JSON.parse(expectedRaw) as Record<string, string>;
    } catch {
      throw new Error("Invalid DEID_MODEL_SHA256_JSON");
    }
  }

  for (const file of MODEL_FILES) {
    const filePath = path.join(modelsPath, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing de-identification model file: ${file}`);
    }
    const digest = sha256(fs.readFileSync(filePath));
    out[file] = digest;
    if (expected?.[file] && expected[file] !== digest) {
      const message = `Model checksum mismatch for ${file}`;
      if (enforcePinnedChecksums) throw new Error(message);
      console.warn(`${message}; proceeding with default de-identification mode`);
    }
  }

  return out;
}

async function detectFaceWithRetries(canvas: Canvas): Promise<any | null> {
  const pickBestDetection = (detections: any[]): any | null => {
    if (!detections.length) return null;
    return detections
      .slice()
      .sort(
        (a, b) =>
          b.detection.box.width * b.detection.box.height -
          a.detection.box.width * a.detection.box.height,
      )[0];
  };

  const mapDetectionBackToOriginal = (detection: any, inv: number): any => ({
    ...detection,
    detection: {
      ...detection.detection,
      box: {
        ...detection.detection.box,
        x: detection.detection.box.x * inv,
        y: detection.detection.box.y * inv,
        width: detection.detection.box.width * inv,
        height: detection.detection.box.height * inv,
      },
    },
    landmarks: {
      ...detection.landmarks,
      positions: detection.landmarks.positions.map((p: any) => ({
        ...p,
        x: p.x * inv,
        y: p.y * inv,
      })),
      getJawOutline: () =>
        detection.landmarks
          .getJawOutline()
          .map((p: any) => ({ ...p, x: p.x * inv, y: p.y * inv })),
      getLeftEyeBrow: () =>
        detection.landmarks
          .getLeftEyeBrow()
          .map((p: any) => ({ ...p, x: p.x * inv, y: p.y * inv })),
      getRightEyeBrow: () =>
        detection.landmarks
          .getRightEyeBrow()
          .map((p: any) => ({ ...p, x: p.x * inv, y: p.y * inv })),
      getLeftEye: () =>
        detection.landmarks
          .getLeftEye()
          .map((p: any) => ({ ...p, x: p.x * inv, y: p.y * inv })),
      getRightEye: () =>
        detection.landmarks
          .getRightEye()
          .map((p: any) => ({ ...p, x: p.x * inv, y: p.y * inv })),
    },
  });

  for (const scale of RETRY_SCALES) {
    const scaledW = Math.max(1, Math.round(canvas.width * scale));
    const scaledH = Math.max(1, Math.round(canvas.height * scale));
    const scaled = createCanvas(scaledW, scaledH);
    const sctx = scaled.getContext("2d");
    sctx.drawImage(canvas, 0, 0, scaledW, scaledH);

    const tensor = tf.tidy(() => {
      const imgData = sctx.getImageData(0, 0, scaledW, scaledH);
      return tf.browser.fromPixels(
        {
          data: new Uint8Array(imgData.data),
          width: scaledW,
          height: scaledH,
        },
        3,
      );
    });

    let detection = await faceapi.detectSingleFace(tensor as any).withFaceLandmarks();
    if (!detection) {
      const all = await faceapi.detectAllFaces(tensor as any).withFaceLandmarks();
      detection = pickBestDetection(all);
    }
    tensor.dispose();
    if (detection) {
      if (scale === 1) return detection;
      // Map detection back into original coordinate space.
      const inv = 1 / scale;
      return mapDetectionBackToOriginal(detection, inv);
    }
  }
  return null;
}

async function detectFaceWithBudget(canvas: Canvas): Promise<any | null> {
  try {
    return await Promise.race<any | null>([
      detectFaceWithRetries(canvas),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), FACE_DETECTION_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return null;
  }
}

export function getDeIdPipelineInfo(): DeIdPipelineInfo | null {
  return cachedPipelineInfo;
}

function preprocessForDetection(img: Image): Canvas {
  const longest = Math.max(img.width, img.height);
  if (longest <= MAX_DETECTION_DIMENSION) {
    const originalCanvas = createCanvas(img.width, img.height);
    const originalCtx = originalCanvas.getContext("2d");
    originalCtx.drawImage(img, 0, 0);
    return originalCanvas;
  }

  const scale = MAX_DETECTION_DIMENSION / longest;
  const targetW = Math.max(1, Math.round(img.width * scale));
  const targetH = Math.max(1, Math.round(img.height * scale));
  const resized = createCanvas(targetW, targetH);
  const rctx = resized.getContext("2d");
  rctx.drawImage(img, 0, 0, targetW, targetH);
  return resized;
}

function fallbackAnonymizeWithoutFace(canvas: Canvas): string {
  const width = canvas.width;
  const height = canvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const ovalRx = width * 0.44;
  const ovalRy = height * 0.48;

  const masked = createCanvas(width, height);
  const mctx = masked.getContext("2d");
  mctx.drawImage(canvas, 0, 0);

  const maskCanvas = createCanvas(width, height);
  const kctx = maskCanvas.getContext("2d");
  kctx.fillStyle = "white";
  kctx.beginPath();
  kctx.ellipse(cx, cy, ovalRx, ovalRy, 0, 0, Math.PI * 2);
  kctx.fill();

  mctx.globalCompositeOperation = "destination-in";
  mctx.drawImage(maskCanvas, 0, 0);
  mctx.globalCompositeOperation = "source-over";

  const eyeY = cy - ovalRy * 0.18;
  const eyeDx = ovalRx * 0.34;
  const dotRx = Math.max(8, width * 0.035);
  const dotRy = dotRx * 0.72;

  mctx.fillStyle = "#000000";
  mctx.beginPath();
  mctx.ellipse(cx - eyeDx, eyeY, dotRx, dotRy, 0, 0, Math.PI * 2);
  mctx.fill();
  mctx.beginPath();
  mctx.ellipse(cx + eyeDx, eyeY, dotRx, dotRy, 0, 0, Math.PI * 2);
  mctx.fill();

  return masked.toBuffer("image/png").toString("base64");
}

export async function processImageForFaceAnonymization(imageBase64: string): Promise<string> {
  await loadModels();
  
  if (!imageBase64 || imageBase64.length < 32) {
    throw new Error("Invalid image data for de-identification");
  }

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const img = await loadImage(imageBuffer);
  if (img.width < 64 || img.height < 64) {
    throw new Error("Image too small for robust de-identification");
  }
  
  const canvas = preprocessForDetection(img);
  
  const detection = await detectFaceWithBudget(canvas);
  
  if (!detection) {
    console.warn("No face detected. Falling back to deterministic center-based anonymization.");
    return fallbackAnonymizeWithoutFace(canvas);
  }
  
  const { landmarks, detection: faceDetection } = detection;
  const box = faceDetection.box;
  // Landmark and box coords are in preprocess canvas pixel space — compare area to canvas, not full-res image.
  const faceAreaRatio = (box.width * box.height) / (canvas.width * canvas.height);
  if (faceAreaRatio < MIN_FACE_AREA_RATIO) {
    console.warn("Detected face is too small. Falling back to deterministic center-based anonymization.");
    return fallbackAnonymizeWithoutFace(canvas);
  }
  
  const jawline = landmarks.getJawOutline();
  const leftEyebrow = landmarks.getLeftEyeBrow();
  const rightEyebrow = landmarks.getRightEyeBrow();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  
  const faceWidth = box.width;
  const faceHeight = box.height;
  
  const faceCenterX = box.x + faceWidth / 2;
  
  const eyebrowTop = Math.min(...leftEyebrow.map((p: any) => p.y), ...rightEyebrow.map((p: any) => p.y));
  const jawBottom = Math.max(...jawline.map((p: any) => p.y));
  
  const foreheadPadding = faceHeight * 0.35;
  const chinPadding = faceHeight * 0.08;
  
  const ovalTop = eyebrowTop - foreheadPadding;
  const ovalBottom = jawBottom + chinPadding;
  const ovalCenterY = (ovalTop + ovalBottom) / 2;
  const ovalHeight = ovalBottom - ovalTop;
  const ovalWidth = faceWidth * 1.15;
  
  const outputWidth = Math.ceil(ovalWidth * 1.1);
  const outputHeight = Math.ceil(ovalHeight * 1.1);
  
  const sourceX = Math.max(
    0,
    Math.min(faceCenterX - outputWidth / 2, canvas.width - outputWidth),
  );
  const sourceY = Math.max(
    0,
    Math.min(ovalCenterY - outputHeight / 2, canvas.height - outputHeight),
  );

  const clampedWidth = Math.min(outputWidth, canvas.width - sourceX);
  const clampedHeight = Math.min(outputHeight, canvas.height - sourceY);
  
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
    x: Math.max(0, Math.min(leftEye.reduce((sum: number, p: any) => sum + p.x, 0) / leftEye.length - sourceX, clampedWidth)),
    y: Math.max(0, Math.min(leftEye.reduce((sum: number, p: any) => sum + p.y, 0) / leftEye.length - sourceY, clampedHeight))
  };
  const rightEyeCenter = {
    x: Math.max(0, Math.min(rightEye.reduce((sum: number, p: any) => sum + p.x, 0) / rightEye.length - sourceX, clampedWidth)),
    y: Math.max(0, Math.min(rightEye.reduce((sum: number, p: any) => sum + p.y, 0) / rightEye.length - sourceY, clampedHeight))
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
