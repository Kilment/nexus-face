import * as faceapi from "@vladmandic/face-api";
import * as tf from "@tensorflow/tfjs-node";
import { createCanvas, loadImage, Canvas, Image } from "canvas";
import * as path from "path";
import * as fs from "fs";
import type { LandmarkMetrics } from "@shared/cohort-metrics";

faceapi.env.monkeyPatch({
  Canvas: Canvas as never,
  Image: Image as never,
});

let modelsLoaded = false;

async function loadModels(): Promise<void> {
  if (modelsLoaded) return;

  const modelsPath = path.join(process.cwd(), "server", "models");
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true });
  }

  const modelFiles = fs.readdirSync(modelsPath);
  if (modelFiles.length === 0) {
    const baseUrl =
      "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/";
    const files = [
      "ssd_mobilenetv1_model-weights_manifest.json",
      "ssd_mobilenetv1_model-shard1",
      "ssd_mobilenetv1_model-shard2",
      "face_landmark_68_model-weights_manifest.json",
      "face_landmark_68_model-shard1",
    ];
    for (const file of files) {
      const response = await fetch(baseUrl + file);
      if (!response.ok) throw new Error(`Failed to download model file: ${file}`);
      fs.writeFileSync(path.join(modelsPath, file), Buffer.from(await response.arrayBuffer()));
    }
  }

  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
  modelsLoaded = true;
}

function angleAtVertexDeg(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const v1x = ax - bx;
  const v1y = ay - by;
  const v2x = cx - bx;
  const v2y = cy - by;
  const dot = v1x * v2x + v1y * v2y;
  const cross = v1x * v2y - v1y * v2x;
  const rad = Math.atan2(Math.abs(cross), dot);
  return (rad * 180) / Math.PI;
}

/**
 * 2D landmark proxies from a single RGB portrait. Not cephalometric angles.
 */
export async function computeLandmarkMetrics(imageBase64: string): Promise<LandmarkMetrics> {
  await loadModels();

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const img = await loadImage(imageBuffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const inputTensor = tf.tidy(() => {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return tf.browser.fromPixels(
      {
        data: new Uint8Array(imgData.data),
        width: canvas.width,
        height: canvas.height,
      },
      3,
    );
  });

  const detection = await faceapi.detectSingleFace(inputTensor as never).withFaceLandmarks();
  inputTensor.dispose();

  if (!detection) {
    return {
      leftGonialProxyDeg: 0,
      rightGonialProxyDeg: 0,
      cheekFullnessRatio: 0,
      jawWidthToFaceHeightRatio: 0,
      faceDetected: false,
    };
  }

  const jaw = detection.landmarks.getJawOutline();
  const leftEye = detection.landmarks.getLeftEye();
  const rightEye = detection.landmarks.getRightEye();

  const leftEyeCenter = {
    x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
    y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
  };
  const rightEyeCenter = {
    x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
    y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
  };

  const jawLen = jaw.length;
  const leftIdx = Math.min(5, jawLen - 1);
  const chinIdx = Math.floor(jawLen / 2);
  const rightIdx = Math.max(jawLen - 6, 0);

  const leftGonialProxyDeg = angleAtVertexDeg(
    jaw[leftIdx > 0 ? leftIdx - 1 : 0].x,
    jaw[leftIdx > 0 ? leftIdx - 1 : 0].y,
    jaw[leftIdx].x,
    jaw[leftIdx].y,
    jaw[leftIdx + 1].x,
    jaw[leftIdx + 1].y,
  );

  const rightGonialProxyDeg = angleAtVertexDeg(
    jaw[rightIdx > 0 ? rightIdx - 1 : 0].x,
    jaw[rightIdx > 0 ? rightIdx - 1 : 0].y,
    jaw[rightIdx].x,
    jaw[rightIdx].y,
    jaw[Math.min(rightIdx + 1, jawLen - 1)].x,
    jaw[Math.min(rightIdx + 1, jawLen - 1)].y,
  );

  const jawWidth = Math.hypot(jaw[jawLen - 1].x - jaw[0].x, jaw[jawLen - 1].y - jaw[0].y);
  const faceHeight = Math.hypot(
    leftEyeCenter.x - jaw[chinIdx].x,
    leftEyeCenter.y - jaw[chinIdx].y,
  );
  const cheekSpread = Math.hypot(rightEyeCenter.x - leftEyeCenter.x, rightEyeCenter.y - leftEyeCenter.y);

  const cheekFullnessRatio = faceHeight > 0 ? cheekSpread / faceHeight : 0;
  const jawWidthToFaceHeightRatio = faceHeight > 0 ? jawWidth / faceHeight : 0;

  return {
    leftGonialProxyDeg,
    rightGonialProxyDeg,
    cheekFullnessRatio,
    jawWidthToFaceHeightRatio,
    faceDetected: true,
  };
}
