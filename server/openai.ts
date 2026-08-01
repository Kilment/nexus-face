import OpenAI from "openai";

/**
 * Constructed lazily. Building the client at module scope threw on import
 * whenever no OpenAI key was set, which broke the research pipeline even
 * though it never calls OpenAI in deterministic mode.
 */
let client: OpenAI | null = null;
function openaiClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    });
  }
  return client;
}

/**
 * Legacy/OpenAI fallback de-identification path.
 * Used when the primary deterministic face-api method fails unexpectedly.
 */
export async function processImageForFaceAnonymizationOpenAI(
  imageBase64: string,
): Promise<string> {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error("Missing AI_INTEGRATIONS_OPENAI_API_KEY for OpenAI fallback");
  }

  const analysisResponse = await openaiClient().chat.completions.create({
    model: process.env.COHORT_VISION_MODEL ?? "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this face photo and describe the facial structure for a de-identified reconstruction.
Include face shape, skin tone, nose, lips, eyebrows, cheekbones, chin, and age presentation.
Do not include identifying details beyond facial structure.`,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 700,
    temperature: 0,
  });

  const faceDescription = analysisResponse.choices[0]?.message?.content || "";

  const generateResponse = await openaiClient().images.generate({
    model: "gpt-image-1",
    prompt: `Create a realistic anonymized face portrait from this description:

${faceDescription}

Requirements:
1. Transparent background
2. No hair
3. Black oval eyes
4. No neck
5. Preserve broad face structure`,
    size: "1024x1024",
    quality: "high",
  });

  const resultBase64 = generateResponse.data?.[0]?.b64_json ?? "";
  if (!resultBase64) {
    throw new Error("OpenAI fallback did not return image output");
  }
  return resultBase64;
}
