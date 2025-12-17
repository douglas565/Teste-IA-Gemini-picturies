
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
   * Otimizado para ser rápido (max_tokens baixo).
   */
  public async checkImageViability(base64Image: string): Promise<{ valid: boolean; reason: string }> {
    const prompt = `
    TASK: Classify this image for technical analysis.
    
    Is this image a CLOSE-UP view of a specific street light fixture (luminaire head) or its label?
    
    Answer NO if:
    - It shows a whole street pole from distance.
    - It shows a general street view.
    - The object is too far away or tiny.
    - It is completely dark or blurry.
    
    Answer YES only if:
    - The luminaire head fills significant part of the frame.
    - OR a label/sticker is visible.

    RESPONSE FORMAT JSON ONLY:
    {"valid": boolean, "reason": "short explanation"}
    `;

    try {
      const response = await this.callOllama(prompt, base64Image, 100); // 100 tokens max para rapidez
      if (!response) return { valid: true, reason: "Ollama offline, skipping check" };
      
      return {
        valid: response.valid === true,
        reason: response.reason || "AI Decision"
      };
    } catch (e) {
      console.warn("AI Viability Check Failed", e);
      return { valid: true, reason: "Check skipped due to error" }; // Em caso de erro, deixa passar
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
    
    // Resume o conhecimento prévio para poupar tokens, focando nos modelos existentes
    const distinctModels = Array.from(new Set(trainingData.map(t => `${t.model} (${t.power}W)`))).slice(0, 15).join(', ');
    
    const prompt = `
    ROLE: Expert Industrial Inspector.
    
    INPUT DATA:
    1. RAW OCR TEXT DETECTED: "${ocrText}" (May contain typos like '06' instead of '60', 'S0N' instead of 'SON').
    2. VISUAL IMAGE: Provided.
    3. KNOWN MODELS DATABASE: [${distinctModels}]

    TASK:
    Analyze the image to identify the Luminaire Model and Power (Watts).
    
    RULES:
    1. CROSS-CHECK: Compare the OCR text with what you visually see. If OCR says "150" but the label clearly says "100", trust the image.
    2. CORRECTION: If OCR has noise (e.g. "V0LTANA"), fix it ("VOLTANA") based on the Known Models Database.
    3. POWER RULES: 
       - If you see "06", it usually means 60W code.
       - If you see "08" or "09", it means 80W or 90W.
       - "15" usually means 150W if it's a big lamp.
    4. REJECTION: If the image is not a luminaire, set model to null.

    OUTPUT JSON ONLY:
    {
      "model": "NAME (UPPERCASE)",
      "power": NUMBER (Integer Watts),
      "reasoning": "Explain how you used OCR text + Visuals to decide."
    }
    `;

    try {
      const parsed = await this.callOllama(prompt, base64Image, 300);
      if (!parsed) return null;

      return {
        model: parsed.model === "NAME" || parsed.model === "NULL" ? null : parsed.model?.toUpperCase(),
        calculatedPower: typeof parsed.power === 'number' ? parsed.power : null,
        confidence: 0.95, 
        rawText: ocrText,
        reasoning: parsed.reasoning || "AI Analysis",
        aiProvider: 'ollama'
      };
    } catch (error) {
      console.error("Erro na análise Ollama:", error);
      return null;
    }
  }

  // Helper privado para chamadas
  private async callOllama(prompt: string, imageBase64: string, numPredict: number): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

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
            temperature: 0.1, // Muito determinístico
            num_predict: numPredict
          }
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error("Ollama Error");
      const data = await response.json();
      return JSON.parse(data.response);
    } catch (e) {
      return null;
    }
  }
}
