
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

  /**
   * STEP 1: Verificação Rápida (Pre-OCR)
   * Verifica se a imagem é adequada (close-up) ou se é lixo (poste inteiro, rua, escuro).
   * Otimizado para ser rápido, mas com timeout seguro para hardware local.
   */
  public async checkImageViability(base64Image: string): Promise<{ valid: boolean; reason: string }> {
    const prompt = `
    TASK: Industrial Inspection Filter.
    
    IS THIS IMAGE A CLOSE-UP OF A LUMINAIRE HEAD?
    
    CRITERIA FOR "NO" (INVALID):
    - Image shows a COMPLETE STREET POLE (post) from top to bottom.
    - Image is a wide street scene (cars, road visible).
    - The luminaire is a tiny dot in the sky.
    - Image is pitch black or completely blurry.
    
    CRITERIA FOR "YES" (VALID):
    - The image is Zoomed In on the lamp fixture.
    - We can clearly see the shape of the luminaire head.
    - Or we can see a label/sticker.

    RESPONSE FORMAT JSON ONLY:
    {"valid": boolean, "reason": "Reason for decision"}
    `;

    try {
      // 60s timeout para garantir que rodar em CPU não quebre na primeira carga
      const response = await this.callOllama(prompt, base64Image, 100, 60000); 
      if (!response) return { valid: true, reason: "Ollama silent, proceeding safely" };
      
      return {
        valid: response.valid === true,
        reason: response.reason || "AI Filter Decision"
      };
    } catch (e) {
      console.warn("AI Viability Check Failed", e);
      return { valid: true, reason: "Check skipped due to error" };
    }
  }

  /**
   * STEP 2: Análise Profunda (Post-OCR)
   * Cruza o texto lido pelo Tesseract com a visão da IA e o histórico de treinamento.
   */
  public async analyzeImage(
    base64Image: string, 
    ocrText: string, 
    trainingData: TrainingExample[]
  ): Promise<AnalysisResponse | null> {
    
    // Resume o conhecimento prévio
    const distinctModels = Array.from(new Set(trainingData.map(t => `${t.model} (${t.power}W)`))).slice(0, 20).join(', ');
    
    const prompt = `
    ROLE: Local AI Assistant for Street Lighting Inventory.
    
    CONTEXT - USER KNOWLEDGE BASE (PREVIOUSLY LEARNED ITEMS):
    [${distinctModels}]
    
    INPUT:
    - RAW OCR TEXT: "${ocrText}"
    - IMAGE: Provided.

    TASK:
    1. VALIDATE: Does the OCR text match the visual image? 
    2. CORRECT: If OCR says "VOLT ANA" and Knowledge Base has "VOLTANA", correct it.
    3. SEARCH: Look for numbers indicating Watts (W).
       - Rule: "06" = 60W, "15" = 150W (if high pressure sodium look).
       - Rule: "LED" labels usually show direct watts like "100W".
    
    OUTPUT JSON ONLY:
    {
      "model": "NAME (UPPERCASE) or NULL",
      "power": NUMBER (Integer Watts) or NULL,
      "reasoning": "Short explanation referencing Visuals + OCR + Knowledge Base"
    }
    `;

    try {
      const parsed = await this.callOllama(prompt, base64Image, 300, 60000);
      if (!parsed) return null;

      return {
        model: parsed.model === "NAME" || parsed.model === "NULL" ? null : parsed.model?.toUpperCase(),
        calculatedPower: typeof parsed.power === 'number' ? parsed.power : null,
        confidence: 0.90, // Confiança alta pois passou pelo filtro duplo
        rawText: ocrText,
        reasoning: parsed.reasoning || "AI Analysis Local",
        aiProvider: 'ollama'
      };
    } catch (error) {
      console.error("Erro na análise Ollama:", error);
      return null;
    }
  }

  // Helper privado para chamadas
  private async callOllama(prompt: string, imageBase64: string, numPredict: number, timeoutMs: number = 40000): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          images: [imageBase64],
          stream: false,
          format: "json",
          options: {
            temperature: 0.1, // Extremo determinismo para consistência
            num_predict: numPredict,
            num_ctx: 2048 // Garante contexto suficiente para a lista de modelos
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error("Ollama Error");
      const data = await response.json();
      
      // Limpeza básica caso o modelo retorne markdown ```json ... ```
      let cleanJson = data.response.trim();
      if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '');
      }
      
      return JSON.parse(cleanJson);
    } catch (e) {
      console.warn("Ollama Call Error", e);
      return null;
    }
  }
}
