/**
 * ImageAnalyzer - Avancerad bildanalys med Claude Vision
 *
 * Funktioner:
 * - Komplett bildanalys (objekt, personer, text, färger)
 * - OCR (textextraktion)
 * - Bildgenerering via externa API:er
 * - Alt-text och caption-generering
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";

export interface ImageAnalysisResult {
  description: string;
  objects: Array<{
    name: string;
    confidence: number;
    position: string;
  }>;
  people: Array<{
    description: string;
    estimatedAge: string;
    expression: string;
    position: string;
  }>;
  text: string[];
  colors: string[];
  mood: string;
  composition: string;
  quality: {
    resolution: string;
    lighting: string;
    focus: string;
  };
  suggestedCaption: string;
  suggestedAltText: string;
  customAnswers: Array<{
    question: string;
    answer: string;
  }>;
}

export interface ImageGeneratorConfig {
  openai?: string;
  stability?: string;
  replicate?: string;
}

/**
 * Analysera bild fullständigt med Claude Vision
 */
export async function analyzeImageComprehensive(
  imageSource: string,
  questions: string[] = [],
  apiKey?: string
): Promise<ImageAnalysisResult> {
  const client = new Anthropic({
    apiKey: apiKey || Anthropic.ANTHROPIC_API_KEY,
  });

  // Förbered bildinnehåll
  let imageContent: Anthropic.ImageBlockParam;

  if (imageSource.startsWith("http")) {
    imageContent = {
      type: "image",
      source: { type: "url", url: imageSource },
    };
  } else if (imageSource.startsWith("data:") || !imageSource.includes("/")) {
    imageContent = {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: imageSource.replace(/^data:image\/\w+;base64,/, ""),
      },
    };
  } else {
    const buffer = fs.readFileSync(imageSource);
    const ext = imageSource.split(".").pop()?.toLowerCase() || "jpeg";
    const mediaType =
      ext === "png"
        ? "image/png"
        : ext === "gif"
          ? "image/gif"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";

    imageContent = {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
        data: buffer.toString("base64"),
      },
    };
  }

  const response = await client.messages.create({
    model: "claude-opus-4-5-20251101",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          imageContent,
          {
            type: "text",
            text: `Analysera denna bild fullständigt och returnera JSON.

${
  questions.length > 0
    ? `
Besvara även dessa specifika frågor:
${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}
`
    : ""
}

Returnera exakt detta JSON-format:
{
  "description": "Övergripande beskrivning av bilden",
  "objects": [{"name": "objektnamn", "confidence": 0.95, "position": "center/left/right/top/bottom"}],
  "people": [{"description": "beskrivning", "estimatedAge": "25-35", "expression": "leende", "position": "center"}],
  "text": ["text som syns i bilden"],
  "colors": ["dominerande färger"],
  "mood": "stämningen i bilden",
  "composition": "hur bilden är komponerad",
  "quality": {"resolution": "hög/medium/låg", "lighting": "naturlig/studio/blandad", "focus": "skarp/mjuk"},
  "suggestedCaption": "förslag på bildtext för artikel",
  "suggestedAltText": "tillgänglig alt-text",
  "customAnswers": [{"question": "fråga", "answer": "svar"}]
}`,
          },
        ],
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  // Extrahera JSON från svaret
  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Could not parse image analysis response");
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * OCR - Extrahera text från bild
 */
export async function extractTextFromImage(
  imageSource: string,
  apiKey?: string
): Promise<string> {
  const client = new Anthropic({
    apiKey: apiKey || Anthropic.ANTHROPIC_API_KEY,
  });

  let imageContent: Anthropic.ImageBlockParam;

  if (imageSource.startsWith("http")) {
    imageContent = {
      type: "image",
      source: { type: "url", url: imageSource },
    };
  } else {
    const buffer = fs.readFileSync(imageSource);
    const ext = imageSource.split(".").pop()?.toLowerCase() || "jpeg";
    const mediaType =
      ext === "png"
        ? "image/png"
        : ext === "gif"
          ? "image/gif"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg";

    imageContent = {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
        data: buffer.toString("base64"),
      },
    };
  }

  const response = await client.messages.create({
    model: "claude-opus-4-5-20251101",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          imageContent,
          {
            type: "text",
            text: `Extrahera ALL text som syns i denna bild.

Inkludera:
- Rubriker
- Brödtext
- Etiketter
- Siffror och datum
- Text i tabeller

Bevara formatering och struktur så gott det går.
Om det finns tabeller, formatera dem som Markdown.`,
          },
        ],
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  return content.text;
}

/**
 * Generera alt-text för tillgänglighet
 */
export async function generateAltText(
  imageSource: string,
  context?: string,
  apiKey?: string
): Promise<string> {
  const client = new Anthropic({
    apiKey: apiKey || Anthropic.ANTHROPIC_API_KEY,
  });

  let imageContent: Anthropic.ImageBlockParam;

  if (imageSource.startsWith("http")) {
    imageContent = {
      type: "image",
      source: { type: "url", url: imageSource },
    };
  } else if (imageSource.startsWith("data:")) {
    imageContent = {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: imageSource.replace(/^data:image\/\w+;base64,/, ""),
      },
    };
  } else {
    const buffer = fs.readFileSync(imageSource);
    imageContent = {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: buffer.toString("base64"),
      },
    };
  }

  const response = await client.messages.create({
    model: "claude-opus-4-5-20251101",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          imageContent,
          {
            type: "text",
            text: `Skriv en koncis, beskrivande alt-text för denna bild.

${context ? `Kontext: ${context}` : ""}

Regler:
- Max 125 tecken
- Beskriv vad som syns, inte vad det betyder
- Undvik "bild av" eller "foto av"
- Inkludera viktig text om den finns
- Var specifik men koncis`,
          },
        ],
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  return content.text.trim();
}

/**
 * Bildgenerering via externa API:er
 */
export class ImageGenerator {
  private providers: ImageGeneratorConfig;

  constructor(config: ImageGeneratorConfig = {}) {
    this.providers = {
      openai: config.openai || process.env.OPENAI_API_KEY,
      stability: config.stability || process.env.STABILITY_API_KEY,
      replicate: config.replicate || process.env.REPLICATE_API_TOKEN,
    };
  }

  /**
   * Generera bild med DALL-E 3
   */
  async generateWithDALLE(
    prompt: string,
    options: {
      size?: "1024x1024" | "1792x1024" | "1024x1792";
      quality?: "standard" | "hd";
      n?: number;
    } = {}
  ): Promise<string[]> {
    const { size = "1024x1024", quality = "standard", n = 1 } = options;

    if (!this.providers.openai) {
      throw new Error("OpenAI API key not configured");
    }

    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.providers.openai}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt,
          size,
          quality,
          n,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`DALL-E API error: ${response.status}`);
    }

    const data = await response.json();
    return data.data.map((img: { url: string }) => img.url);
  }

  /**
   * Generera bild med Stability AI
   */
  async generateWithStability(
    prompt: string,
    options: {
      width?: number;
      height?: number;
      steps?: number;
    } = {}
  ): Promise<string[]> {
    const { width = 1024, height = 1024, steps = 30 } = options;

    if (!this.providers.stability) {
      throw new Error("Stability API key not configured");
    }

    const response = await fetch(
      "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.providers.stability}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text_prompts: [{ text: prompt, weight: 1 }],
          cfg_scale: 7,
          width,
          height,
          steps,
          samples: 1,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Stability API error: ${response.status}`);
    }

    const data = await response.json();
    return data.artifacts.map(
      (a: { base64: string }) => `data:image/png;base64,${a.base64}`
    );
  }
}

/**
 * Låt Claude skapa optimal bildprompt och generera
 */
export async function generateImageFromDescription(
  description: string,
  style: "professional" | "artistic" | "photorealistic" = "professional",
  apiKey?: string
): Promise<{ prompt: string; images: string[] }> {
  const client = new Anthropic({
    apiKey: apiKey || Anthropic.ANTHROPIC_API_KEY,
  });

  const response = await client.messages.create({
    model: "claude-opus-4-5-20251101",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Skapa en detaljerad DALL-E/Stable Diffusion prompt för följande beskrivning.

Beskrivning: ${description}
Stil: ${style}

Prompten ska vara:
- Specifik och detaljerad
- Inkludera komposition, ljussättning, stil
- Max 400 tecken
- Endast prompt-texten, ingen förklaring`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type");
  }

  const imagePrompt = content.text.trim();

  // Generera bild
  const generator = new ImageGenerator();
  const images = await generator.generateWithDALLE(imagePrompt);

  return {
    prompt: imagePrompt,
    images,
  };
}

export default {
  analyzeImageComprehensive,
  extractTextFromImage,
  generateAltText,
  ImageGenerator,
  generateImageFromDescription,
};
