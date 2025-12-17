import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";

// This is using Replit's AI Integrations service, which provides OpenAI-compatible API access
// without requiring your own API key. Charges are billed to your Replit credits.
// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

export async function processImageForFaceAnonymization(imageBase64: string): Promise<string> {
  const prompt = `Transform this photo into an anonymized face portrait with these specific requirements:
1. Remove the entire background completely - make it fully transparent
2. Remove all hair from the head - create a smooth, bald appearance matching the skin tone
3. Remove the neck and any body parts below the chin - crop to face only
4. Replace the eyes with solid black filled oval/circular shapes (like the reference shows)
5. Keep the face structure, nose, mouth, eyebrows, and facial features visible
6. The final result should be just an isolated face with a transparent background
7. Output as a clean PNG with transparent background

The result should look like an anonymized face mask - showing facial features but with black oval eyes and no identifying features like hair or background.`;

  try {
    const imageBuffer = Buffer.from(imageBase64, "base64");
    const imageFile = await toFile(Readable.from(imageBuffer), "image.png", { type: "image/png" });

    const response = await openai.images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt,
      size: "1024x1024",
    });

    const resultBase64 = response.data?.[0]?.b64_json ?? "";
    return resultBase64;
  } catch (error) {
    console.error("Error processing image with OpenAI:", error);
    throw new Error("Failed to process image");
  }
}

export async function generateProcessedFace(imageBase64: string): Promise<string> {
  const prompt = `Create a stylized anonymized face portrait based on this input image:
1. Render ONLY the face - no hair, no neck, no background
2. The face should have a smooth, bald head appearance
3. Replace the eyes with solid black filled ovals/circles
4. Keep facial features like nose, mouth, eyebrows visible
5. Match the skin tone of the original image
6. The result must have a completely transparent background
7. Create a clean, oval-shaped face silhouette that ends at the chin

This is for a medical/clinical anonymization purpose. The face should be recognizable in shape but have no identifying features like eyes or hair.`;

  try {
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
    });

    const resultBase64 = response.data?.[0]?.b64_json ?? "";
    return resultBase64;
  } catch (error) {
    console.error("Error generating face with OpenAI:", error);
    throw new Error("Failed to generate processed face");
  }
}
