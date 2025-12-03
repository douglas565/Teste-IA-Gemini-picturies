export interface VisualFeatures {
  aspectRatio: number;
  edgeDensity: number;
}

export interface DetectionResult {
  id: string;
  timestamp: number;
  imageUrl: string;
  model: string | null;
  power: number | null;
  confidence: number;
  reasoning: string;
  rawText?: string;
  features?: VisualFeatures; // Memória visual da imagem
  status: 'confirmed' | 'pending_review' | 'auto_detected';
}

export interface TrainingExample {
  model: string;
  power: number;
  ocrSignature?: string;
  features?: VisualFeatures; // Memória visual treinada
  visualDescription?: string;
}

export interface AnalysisResponse {
  model: string | null;
  rawText: string;
  calculatedPower: number | null;
  confidence: number;
  reasoning: string;
  features?: VisualFeatures;
}

export interface GeminiResponse {
  model: string | null;
  rawLabelNumber: string | null;
  calculatedPower: number | null;
  confidence: number;
  reasoning: string;
}