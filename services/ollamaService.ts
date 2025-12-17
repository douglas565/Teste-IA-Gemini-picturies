
import { AnalysisResponse, TrainingExample } from "../types";

export class OllamaService {
  private host: string;
  private model: string;

  constructor(host: string = 'http://localhost:11434', model: string = 'llava') {
    this.host = host;
    this.model = model;
  }

  public async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/tags`);
      return response.ok;
    } catch (e) {
      return false;
    }
  }

  public async analyzeImage(
    base64Image: string, 
    ocrText: string, 
    trainingData: TrainingExample[]
  ): Promise<AnalysisResponse | null> {
    
    // Constrói contexto de memória (Few-Shot Learning)
    const knownModels = trainingData.map(t => `- ${t.model} (${t.power}W)`).join('\n');
    
    const prompt = `
    You are an AI specialized in identifying street light (luminaire) models and power ratings.
    
    CONTEXT - KNOWN MODELS (USER TRAINED):
    ${knownModels || "None yet."}
    
    OCR TEXT FOUND: "${ocrText}"
    
    TASK:
    1. Look at the image and the OCR text.
    2. Identify the MODEL NAME (e.g., VOLTANA, URBJET, PALLAS). If the image matches a "Known Model" visually, prioritize that.
    3. Identify the POWER in Watts (W). Look for numbers like "150", "100", "06" (means 60W).
    
    OUTPUT FORMAT (JSON ONLY):
    {
      "model": "NAME_OR_NULL",
      "power": NUMBER_OR_NULL,
      "reasoning": "Brief explanation"
    }
    
    Reply ONLY with JSON.
    `;

    try {
      const response = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          images: [base64Image], // Ollama suporta envio direto de base64
          stream: false,
          format: "json", // Força saída JSON (disponível em versões recentes do Ollama)
          options: {
            temperature: 0.2, // Baixa temperatura para ser mais determinístico
            num_predict: 200
          }
        })
      });

      if (!response.ok) throw new Error("Ollama Error");

      const data = await response.json();
      const jsonStr = data.response;
      
      // Tentativa de parsear o JSON retornado pelo LLM
      try {
        const parsed = JSON.parse(jsonStr);
        return {
          model: parsed.model === "NAME_OR_NULL" ? null : parsed.model?.toUpperCase(),
          calculatedPower: parsed.power,
          confidence: 0.9, // Assumimos alta confiança se a AI respondeu estruturado
          rawText: ocrText,
          reasoning: parsed.reasoning || "AI Vision Analysis",
          aiProvider: 'ollama'
        };
      } catch (e) {
        console.warn("Falha ao parsear JSON do Ollama", jsonStr);
        return null;
      }

    } catch (error) {
      console.error("Erro na comunicação com Ollama:", error);
      return null;
    }
  }
}
