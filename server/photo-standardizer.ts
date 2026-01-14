import OpenAI from "openai";
import { createCanvas, loadImage } from "canvas";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const STANDARD_WIDTH = 512;
const STANDARD_HEIGHT = 512;

interface ImageAnalysis {
  brightness: "too_dark" | "too_bright" | "normal";
  contrast: "low" | "high" | "normal";
  zoom: "too_close" | "too_far" | "normal";
  centering: "off_center_left" | "off_center_right" | "off_center_up" | "off_center_down" | "centered";
  adjustments: {
    brightnessAdjust: number;
    contrastAdjust: number;
    shouldCrop: boolean;
    cropSuggestion?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
}

async function analyzeImage(imageBase64: string): Promise<ImageAnalysis> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an image analysis expert. Analyze the provided portrait photo and assess its technical qualities for standardization.
          
Respond ONLY with a JSON object (no markdown, no explanation) with these exact fields:
{
  "brightness": "too_dark" | "too_bright" | "normal",
  "contrast": "low" | "high" | "normal", 
  "zoom": "too_close" | "too_far" | "normal",
  "centering": "off_center_left" | "off_center_right" | "off_center_up" | "off_center_down" | "centered",
  "adjustments": {
    "brightnessAdjust": <number from -50 to 50, positive = brighten>,
    "contrastAdjust": <number from -50 to 50, positive = increase contrast>,
    "shouldCrop": <boolean>,
    "cropSuggestion": { "x": <0-100 percentage>, "y": <0-100 percentage>, "width": <0-100 percentage>, "height": <0-100 percentage> } or null
  }
}

The goal is to standardize photos for consistent medical/clinical comparison. Consider:
- Face should be centered and fill ~60-70% of the frame vertically
- Lighting should be even and neutral
- Good contrast to show facial details clearly`
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
              },
            },
            {
              type: "text",
              text: "Analyze this portrait photo for standardization. Return only the JSON object.",
            },
          ],
        },
      ],
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ImageAnalysis;
    }
    
    return {
      brightness: "normal",
      contrast: "normal",
      zoom: "normal",
      centering: "centered",
      adjustments: {
        brightnessAdjust: 0,
        contrastAdjust: 0,
        shouldCrop: false,
      },
    };
  } catch (error) {
    console.error("Image analysis error:", error);
    return {
      brightness: "normal",
      contrast: "normal",
      zoom: "normal",
      centering: "centered",
      adjustments: {
        brightnessAdjust: 0,
        contrastAdjust: 0,
        shouldCrop: false,
      },
    };
  }
}

function applyBrightnessContrast(
  imageData: ImageData,
  brightness: number,
  contrast: number
): void {
  const data = imageData.data;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let value = data[i + c];
      value += brightness;
      value = factor * (value - 128) + 128;
      data[i + c] = Math.max(0, Math.min(255, value));
    }
  }
}

function normalizeHistogram(imageData: ImageData): void {
  const data = imageData.data;
  let minLum = 255;
  let maxLum = 0;
  
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }
  
  const TARGET_MIN = 20;
  const TARGET_MAX = 235;
  
  if (maxLum - minLum < 10) return;
  
  const scale = (TARGET_MAX - TARGET_MIN) / (maxLum - minLum);
  const offset = TARGET_MIN - minLum * scale;
  
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.max(0, Math.min(255, data[i + c] * scale + offset));
    }
  }
}

export async function standardizePhoto(imageBase64: string): Promise<string> {
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const img = await loadImage(imageBuffer);
  
  const analysis = await analyzeImage(imageBase64);
  console.log("Photo analysis:", JSON.stringify(analysis, null, 2));
  
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = img.width;
  let sourceHeight = img.height;
  
  if (analysis.adjustments.shouldCrop && analysis.adjustments.cropSuggestion) {
    const crop = analysis.adjustments.cropSuggestion;
    sourceX = Math.round((crop.x / 100) * img.width);
    sourceY = Math.round((crop.y / 100) * img.height);
    sourceWidth = Math.round((crop.width / 100) * img.width);
    sourceHeight = Math.round((crop.height / 100) * img.height);
    
    sourceX = Math.max(0, Math.min(sourceX, img.width - 1));
    sourceY = Math.max(0, Math.min(sourceY, img.height - 1));
    sourceWidth = Math.max(1, Math.min(sourceWidth, img.width - sourceX));
    sourceHeight = Math.max(1, Math.min(sourceHeight, img.height - sourceY));
  }
  
  const canvas = createCanvas(STANDARD_WIDTH, STANDARD_HEIGHT);
  const ctx = canvas.getContext("2d");
  
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, STANDARD_WIDTH, STANDARD_HEIGHT);
  
  const aspectRatio = sourceWidth / sourceHeight;
  let drawWidth = STANDARD_WIDTH;
  let drawHeight = STANDARD_HEIGHT;
  let drawX = 0;
  let drawY = 0;
  
  if (aspectRatio > 1) {
    drawHeight = STANDARD_WIDTH / aspectRatio;
    drawY = (STANDARD_HEIGHT - drawHeight) / 2;
  } else {
    drawWidth = STANDARD_HEIGHT * aspectRatio;
    drawX = (STANDARD_WIDTH - drawWidth) / 2;
  }
  
  ctx.drawImage(
    img,
    sourceX, sourceY, sourceWidth, sourceHeight,
    drawX, drawY, drawWidth, drawHeight
  );
  
  const imageData = ctx.getImageData(0, 0, STANDARD_WIDTH, STANDARD_HEIGHT);
  
  normalizeHistogram(imageData as unknown as ImageData);
  
  const brightnessAdjust = analysis.adjustments.brightnessAdjust || 0;
  const contrastAdjust = analysis.adjustments.contrastAdjust || 0;
  
  if (brightnessAdjust !== 0 || contrastAdjust !== 0) {
    applyBrightnessContrast(
      imageData as unknown as ImageData,
      brightnessAdjust,
      contrastAdjust * 2.55
    );
  }
  
  ctx.putImageData(imageData, 0, 0);
  
  console.log("Standardization applied: histogram normalization + AI-guided adjustments");
  
  const pngBuffer = canvas.toBuffer("image/png");
  return pngBuffer.toString("base64");
}
