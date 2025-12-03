import Tesseract from 'tesseract.js';
import { AnalysisResponse, TrainingExample, VisualFeatures } from "../types";

// --- TABELAS DE REFERÊNCIA (STRICT) ---
const MODEL_VALID_POWERS: Record<string, number[]> = {
  'PALLAS': [23, 33, 47, 60, 75, 90, 110, 130, 155, 200],
  'KINGSUN': [23, 33, 47, 60, 75, 90, 110, 130, 155, 200],
  'HBMI': [50, 75, 100, 150, 200],
  'ORI': [50], // Mantido na tabela para validação, mas filtrado na busca fuzzy se for curto
  'IESNA': [20, 40, 65, 85],
  'HTC': [22, 30, 40, 50, 60, 70, 80, 100, 120],
  'BRIGHTLUX': [20, 30, 40, 50, 60, 100], 
  'SANLIGHT': [20, 30, 40, 50, 60, 100]
};

// --- VISUAL FINGERPRINTS (Para classificação fallback) ---
const VISUAL_FINGERPRINTS: Record<string, { ar: [number, number], ed: [number, number] }> = {
  'PALLAS': { ar: [1.2, 2.5], ed: [0.10, 0.40] },
  'KINGSUN': { ar: [0.8, 1.3], ed: [0.30, 0.60] },
  'HBMI': { ar: [1.5, 3.0], ed: [0.20, 0.50] },
  'HTC': { ar: [0.9, 1.5], ed: [0.15, 0.45] }
};

const DETECT_CONFIG = {
  SCALE_FACTOR: 2.0 
};

// --- UTILS: FUZZY MATCHING (LEVENSHTEIN) ---
const levenshteinDistance = (a: string, b: string): number => {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
};

const fuzzyContains = (text: string, target: string, tolerance: number = 2): boolean => {
  // CRITICAL FIX: Ignora targets muito curtos para evitar falsos positivos como "ORI" em ruído
  if (target.length < 4) return false;

  const words = text.split(/\s+/);
  const targetUpper = target.toUpperCase();
  
  for (const word of words) {
    if (Math.abs(word.length - targetUpper.length) > tolerance) continue;
    const dist = levenshteinDistance(word, targetUpper);
    if (dist <= tolerance) return true;
  }
  
  if (targetUpper.includes(' ')) {
      if (text.includes(targetUpper)) return true;
  }
  
  return false;
};

// --- FUNÇÕES VISUAIS ---

const calculateEdgeDensity = (data: Uint8ClampedArray, width: number, height: number): number => {
  let edges = 0;
  const threshold = 30;
  const totalPixels = width * height;
  const step = 2; 

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width - 1; x += step) {
      const i = (y * width + x) * 4;
      const nextI = (y * width + (x + 1)) * 4;
      const diff = Math.abs(data[i] - data[nextI]);
      if (diff > threshold) edges++;
    }
  }
  return Math.min(1.0, (edges * (step * step)) / totalPixels);
};

const enhanceImage = (ctx: CanvasRenderingContext2D, width: number, height: number): VisualFeatures => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  // Contraste Agressivo
  const contrast = 70; 
  const factor = (255 + contrast) / (255 * (255 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    let newValue = factor * (gray - 128) + 128;
    if (newValue > 160) newValue = 255;
    else if (newValue < 90) newValue = 0; 
    
    data[i] = newValue;
    data[i + 1] = newValue;
    data[i + 2] = newValue;
  }

  ctx.putImageData(imageData, 0, 0);
  const aspectRatio = width / height;
  const edgeDensity = calculateEdgeDensity(data, width, height);
  return { aspectRatio, edgeDensity };
};

const preprocessImage = async (base64Image: string): Promise<{ imgUrl: string, features: VisualFeatures }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { 
        resolve({ imgUrl: base64Image, features: { aspectRatio: img.width/img.height, edgeDensity: 0 } }); 
        return; 
      }

      canvas.width = img.width * DETECT_CONFIG.SCALE_FACTOR;
      canvas.height = img.height * DETECT_CONFIG.SCALE_FACTOR;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const features = enhanceImage(ctx, canvas.width, canvas.height);

      resolve({ imgUrl: canvas.toDataURL('image/jpeg', 0.9), features });
    };
    img.onerror = () => resolve({ imgUrl: base64Image, features: { aspectRatio: 1, edgeDensity: 0 } });
    img.src = `data:image/jpeg;base64,${base64Image}`;
  });
};

// --- MATCHING VISUAL (A "Memória Fotográfica") ---
const findVisualMatch = (currentFeatures: VisualFeatures, trainingData: TrainingExample[]): TrainingExample | null => {
  let bestMatch: TrainingExample | null = null;
  // Distância máxima para considerar "igual" (ajustado empiricamente)
  // AR costuma variar entre 0.5 e 3.0. ED entre 0.0 e 1.0.
  let minDistance = 0.15; 

  for (const example of trainingData) {
    if (!example.features) continue;

    const dAR = Math.abs(currentFeatures.aspectRatio - example.features.aspectRatio);
    const dED = Math.abs(currentFeatures.edgeDensity - example.features.edgeDensity);
    
    // Distância Euclidiana simples
    const distance = Math.sqrt(dAR*dAR + dED*dED);

    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = example;
    }
  }

  return bestMatch;
};

// --- ANALISADOR PRINCIPAL ---
export const analyzeLuminaireImage = async (
  base64Image: string,
  trainingData: TrainingExample[]
): Promise<AnalysisResponse> => {
  
  // 1. Pré-processamento e Extração de Features Visuais
  const { imgUrl: processedImage, features } = await preprocessImage(base64Image);

  // 2. TENTATIVA 1: MEMÓRIA VISUAL (Super Rápido e Preciso para Lotes Repetidos)
  // Se a imagem é visualmente idêntica a uma treinada, usa a resposta treinada.
  const visualMatch = findVisualMatch(features, trainingData);
  if (visualMatch) {
    return {
      model: visualMatch.model,
      calculatedPower: visualMatch.power,
      confidence: 0.99, // Confiança quase total na memória visual
      rawText: "Visual Match",
      reasoning: "Reconhecimento Visual: Identificado por similaridade de imagem com item treinado.",
      features: features
    };
  }

  // 3. OCR (Se não reconheceu visualmente)
  try {
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /:',
      tessedit_pageseg_mode: '6' as any,
    });

    const ret = await worker.recognize(processedImage);
    const text = ret.data.text;
    await worker.terminate();

    const result = processExtractedText(text, features, trainingData);
    result.features = features; // Anexa features para salvar depois
    return result;

  } catch (error) {
    console.error(error);
    return {
      model: null,
      rawText: "Erro de Leitura",
      calculatedPower: null,
      confidence: 0,
      reasoning: "Falha OCR",
      features: features
    };
  }
};

const processExtractedText = (
  text: string, 
  visualFeatures: VisualFeatures, 
  trainingData: TrainingExample[]
): AnalysisResponse => {
  const cleanText = text.toUpperCase()
    .replace(/[^A-Z0-9\-\. \/:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  let model: string | null = null;
  let power: number | null = null;
  let reasoningParts: string[] = [`OCR: "${cleanText}"`];

  // ESTRATÉGIA 2: TEXTO TREINADO (Conceitual)
  const knownModels = new Set<string>();
  trainingData.forEach(t => knownModels.add(t.model));
  Object.keys(MODEL_VALID_POWERS).forEach(m => knownModels.add(m));

  for (const knownModel of knownModels) {
    if (fuzzyContains(cleanText, knownModel, 2)) {
      model = knownModel;
      reasoningParts.push(`Padrão de Texto: ${model}`);
      break;
    }
  }

  // ESTRATÉGIA 3: MEMÓRIA DE ASSINATURA EXATA (Fallback)
  if (!model) {
    for (const example of trainingData) {
      if (example.ocrSignature && cleanText.includes(example.ocrSignature)) {
        model = example.model;
        if (!power) power = example.power;
        reasoningParts.push(`Assinatura OCR Exata`);
        break;
      }
    }
  }

  // EXTRAÇÃO DE POTÊNCIA
  const numbers = cleanText.match(/\b\d+\b/g);
  let bestPowerMatch: number | null = null;

  if (numbers) {
    const candidates = numbers.map(n => parseInt(n, 10)).filter(val => {
      return ![110, 127, 220, 230, 240, 380, 2023, 2024, 2025].includes(val);
    });

    for (const val of candidates) {
      let candidatePower = val;
      let appliedRule = false;

      // REGRA: 01 a 09 -> Multiplica por 10
      if (val >= 1 && val <= 9) {
        candidatePower = val * 10;
        appliedRule = true;
      }

      if (model && MODEL_VALID_POWERS[model]) {
        if (MODEL_VALID_POWERS[model].includes(candidatePower)) {
          bestPowerMatch = candidatePower;
          reasoningParts.push(appliedRule ? `Regra (x10): ${val}->${candidatePower}W` : `Potência: ${candidatePower}W`);
          break;
        }
      } 
      else if (candidatePower >= 10 && candidatePower <= 400) {
        if (!bestPowerMatch || candidatePower > bestPowerMatch) {
            bestPowerMatch = candidatePower;
        }
      }
    }
  }

  if (bestPowerMatch) power = bestPowerMatch;

  // CÁLCULO DE CONFIANÇA
  let confidence = 0.3;
  if (model && power) confidence = 1.0; 
  else if (model) confidence = 0.6;
  else if (power) confidence = 0.5;

  return {
    model: model,
    rawText: cleanText,
    calculatedPower: power,
    confidence: confidence,
    reasoning: reasoningParts.join(". ")
  };
};