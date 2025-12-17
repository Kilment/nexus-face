import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY
});

export async function processImageForFaceAnonymization(imageBase64: string): Promise<string> {
  try {
    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this face photo and provide a detailed description for recreating it as an anonymized portrait. Include:
1. Approximate face shape (oval, round, square, heart, oblong)
2. Skin tone (describe precisely: light, fair, medium, olive, tan, brown, dark brown, etc.)
3. Nose shape and size
4. Lip shape, fullness, and color
5. Eyebrow shape, thickness, and color
6. Cheekbone prominence
7. Chin shape
8. Any distinctive facial structure features
9. Approximate age range
10. Gender presentation

Be very specific about colors and proportions. This will be used to generate an anonymized version with black dot eyes and no hair.`
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 800
    });

    const faceDescription = analysisResponse.choices[0]?.message?.content || "";
    console.log("Face analysis:", faceDescription);

    const generateResponse = await openai.images.generate({
      model: "gpt-image-1",
      prompt: `Create a realistic anonymized face portrait with these EXACT characteristics from the analyzed face:

${faceDescription}

CRITICAL REQUIREMENTS:
1. TRANSPARENT BACKGROUND - the background must be completely transparent (PNG with alpha)
2. NO HAIR - the head should be completely bald with smooth skin matching the face skin tone
3. BLACK OVAL EYES - replace the eyes with solid black filled oval shapes, no iris or whites visible
4. NO NECK - crop the image at the chin/jawline, showing only the face
5. PRESERVE FACE STRUCTURE - keep the exact face shape, nose, mouth, eyebrows, cheekbones as described
6. REALISTIC SKIN TEXTURE - match the skin tone and texture from the description
7. CENTERED COMPOSITION - the face should be centered and fill most of the frame
8. CLEAN EDGES - smooth edges around the face silhouette

The result should look like a medical/clinical anonymization photo - recognizable face structure but with identifying features (eyes, hair) anonymized.`,
      size: "1024x1024",
      quality: "high"
    });

    const resultBase64 = generateResponse.data?.[0]?.b64_json ?? "";
    return resultBase64;
  } catch (error) {
    console.error("Error processing image with OpenAI:", error);
    throw new Error("Failed to process image");
  }
}
