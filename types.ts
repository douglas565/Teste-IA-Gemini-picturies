export interface DetectionResult {
  id: string;
  timestamp: number;
  imageUrl: string;
  model: string | null;
  power: number | null;
  confidence: number;
  reasoning: string;
  status: 'confirmed' | 'pending_review' | 'auto_detected';
}

export interface TrainingExample {
  model: string;
  power: number;
  visualDescription?: string; // Optional context about what was seen
}

// Response structure expected from Gemini
export interface GeminiResponse {
  model: string | null;
  rawLabelNumber: string | null; // The number found on the label (e.g., "06" or "100")
  calculatedPower: number | null;
  confidence: number;
  reasoning: string;
}
