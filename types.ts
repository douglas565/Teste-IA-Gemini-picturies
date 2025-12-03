export interface DetectionResult {
  id: string;
  timestamp: number;
  imageUrl: string;
  model: string | null;
  power: number | null;
  confidence: number;
  reasoning: string;
  rawText?: string; // O que o OCR leu de verdade
  status: 'confirmed' | 'pending_review' | 'auto_detected';
}

export interface TrainingExample {
  model: string;
  power: number;
  ocrSignature?: string; // O padrão de texto "errado" que identifica este modelo
  visualDescription?: string;
}

// Response structure for the internal OCR service
export interface AnalysisResponse {
  model: string | null;
  rawText: string;
  calculatedPower: number | null;
  confidence: number;
  reasoning: string;
}

export interface GeminiResponse {
  model: string | null;
  rawLabelNumber: string | null;
  calculatedPower: number | null;
  confidence: number;
  reasoning: string;
}