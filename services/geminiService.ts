import { GoogleGenAI, Type } from "@google/genai";
import { GeminiResponse, TrainingExample } from "../types";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const SYSTEM_INSTRUCTION = `
You are an expert industrial optical character recognition (OCR) and object detection system specialized in luminaires (light fixtures).

Your goal is to extract the MODEL NAME and the POWER RATING (Watts) from an image of a luminaire or its label.

CRITICAL POWER CONVERSION RULES:
The label often only shows a number, not "W" or "Watts". You must apply these strict math rules:
1. If the number is between 01 and 09: MULTIPLY BY 10.
   - Example: Label "06" -> 60W
   - Example: Label "08" -> 80W
2. If the number is 10 or greater: USE THE VALUE DIRECTLY.
   - Example: Label "75" -> 75W
   - Example: Label "100" -> 100W

If you see a clear "W" or "Watts" suffix (e.g., "24W"), use that value directly and ignore the conversion rules unless it contradicts the visual size (e.g. a huge lamp labeled 2W is unlikely).

You will be provided with "User Corrections" from previous sessions. Use these as 'few-shot' training examples. If the image looks similar to a previous correction, prefer the user's logic.

Return JSON only.
`;

export const analyzeLuminaireImage = async (
  base64Image: string,
  trainingData: TrainingExample[]
): Promise<GeminiResponse> => {
  
  // Construct the context string from training data
  let trainingContext = "";
  if (trainingData.length > 0) {
    trainingContext = "USER KNOWLEDGE BASE (PREVIOUS CORRECTIONS):\n";
    trainingData.forEach((item, index) => {
      trainingContext += `${index + 1}. Known Model: "${item.model}" has Power: ${item.power}W.\n`;
    });
    trainingContext += "\nUse this knowledge base to aid identification if the image is ambiguous.\n";
  }

  const prompt = `
    ${trainingContext}
    Analyze this image. Identify the luminaire model and calculate the power in Watts based on the label rules provided.
    
    If you are unsure (confidence < 0.7), marks fields as null.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
            { inlineData: { mimeType: 'image/jpeg', data: base64Image }},
            { text: prompt }
        ]
      },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            model: { type: Type.STRING, description: "The alphanumeric model name found." },
            rawLabelNumber: { type: Type.STRING, description: "The raw number seen on the label likely indicating power." },
            calculatedPower: { type: Type.NUMBER, description: "The final calculated Watts based on the rules." },
            confidence: { type: Type.NUMBER, description: "Confidence score between 0 and 1." },
            reasoning: { type: Type.STRING, description: "Brief explanation of how the values were derived." },
          }
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");

    return JSON.parse(text) as GeminiResponse;

  } catch (error) {
    console.error("Gemini Analysis Failed:", error);
    return {
      model: null,
      rawLabelNumber: null,
      calculatedPower: null,
      confidence: 0,
      reasoning: "Failed to connect to AI service."
    };
  }
};
