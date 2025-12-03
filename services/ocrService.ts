import Tesseract from 'tesseract.js';
import { AnalysisResponse, TrainingExample, VisualFeatures } from "../types";

// --- TABELAS DE REFERÊNCIA (STRICT) ---
const MODEL_VALID_POWERS: Record<string, number[]> = {
  'PALLAS': [23, 33, 47, 60, 75, 90, 110, 130, 155, 200],
  'KINGSUN': [23, 33, 47, 60, 75, 90, 110, 130, 155, 200],
  'HBMI': [50, 75, 100, 150, 200],
  'ORI': [50], 
  'IESNA': [20, 40, 65, 85],
  'HTC': [22, 30, 40, 50, 60, 70, 80, 100, 120],
  'BRIGHTLUX': [20, 30, 40, 50, 60, 100], 
  'SANLIGHT': [20, 30, 40, 50, 60, 100]
};

const DETECT_CONFIG = {
  SCALE_FACTOR: 2.0 
};

// --- UTILS: FUZZY MATCHING ---
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

// --- VISION ENGINE: CORES E FEATURES ---

// Converte RGB para HSL (Matiz, Saturação, Luminosidade)
const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
};

const extractVisualFeatures = (ctx: CanvasRenderingContext2D, width: number, height: number): VisualFeatures => {
  // Amostragem Central: Analisa apenas o miolo (50%) da imagem para ignorar céu/fundo
  const startX = Math.floor(width * 0.25);
  const endX = Math.floor(width * 0.75);
  const startY = Math.floor(height * 0.25);
  const endY = Math.floor(height * 0.75);

  const imageData = ctx.getImageData(startX, startY, endX - startX, endY - startY);
  const data = imageData.data;
  
  let rTotal = 0, gTotal = 0, bTotal = 0;
  let edges = 0;
  const step = 4; // Amostragem para performance
  const cropWidth = endX - startX;
  const cropHeight = endY - startY;

  // Análise de Cor Média e Textura (Edge) no crop central
  for (let y = 0; y < cropHeight; y += step) {
    for (let x = 0; x < cropWidth - 1; x += step) {
      const i = (y * cropWidth + x) * 4;
      
      // Acumula Cor
      rTotal += data[i];
      gTotal += data[i + 1];
      bTotal += data[i + 2];

      // Detecta Borda (Horizontal simples)
      const nextI = (y * cropWidth + (x + 1)) * 4;
      const diff = Math.abs(data[i] - data[nextI]); // Diferença de brilho
      if (diff > 30) edges++;
    }
  }

  const pixelCount = (cropWidth * cropHeight) / (step * step);
  const avgR = rTotal / pixelCount;
  const avgG = gTotal / pixelCount;
  const avgB = bTotal / pixelCount;

  // Calcula HSL
  const [hue, saturation, lightness] = rgbToHsl(avgR, avgG, avgB);

  // Calcula Densidade de Borda
  const edgeDensity = Math.min(1.0, (edges * step) / (cropWidth * cropHeight));

  return {
    aspectRatio: width / height, // Aspect Ratio usa a imagem inteira
    edgeDensity: edgeDensity,
    hue: hue,
    saturation: saturation,
    brightness: lightness * 255
  };
};

// Aplica filtros APENAS para o OCR (destrutivo para cores)
const applyOcrFilters = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  // Contraste Extremo e Binarização Suave
  const contrast = 60; 
  const factor = (255 + contrast) / (255 * (255 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    // Grayscale
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    
    // Contraste
    let newValue = factor * (gray - 128) + 128;
    
    // Thresholding suave para manter detalhes finos
    if (newValue > 180) newValue = 255; // Limpa fundo branco
    else if (newValue < 80) newValue = 0; // Reforça texto preto
    
    data[i] = newValue;
    data[i + 1] = newValue;
    data[i + 2] = newValue;
  }
  ctx.putImageData(imageData, 0, 0);
};

const createInvertedImage = (ctx: CanvasRenderingContext2D, width: number, height: number): string => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  // Inverte cores (Negativo)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];     // R
    data[i + 1] = 255 - data[i + 1]; // G
    data[i + 2] = 255 - data[i + 2]; // B
  }
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx?.putImageData(imageData, 0, 0);
  
  return tempCanvas.toDataURL('image/jpeg', 0.9);
};

const preprocessImage = async (base64Image: string): Promise<{ normalUrl: string, invertedUrl: string, features: VisualFeatures }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { 
        resolve({ 
            normalUrl: base64Image, 
            invertedUrl: base64Image,
            features: { aspectRatio: 1, edgeDensity: 0, hue: 0, saturation: 0, brightness: 0 } 
        }); 
        return; 
      }

      canvas.width = img.width * DETECT_CONFIG.SCALE_FACTOR;
      canvas.height = img.height * DETECT_CONFIG.SCALE_FACTOR;
      
      // 1. Desenha imagem original
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // 2. Extrai Features da imagem COLORIDA original (Central Crop)
      const features = extractVisualFeatures(ctx, canvas.width, canvas.height);

      // 3. Aplica filtros para OCR (Modifica o canvas para Preto e Branco)
      applyOcrFilters(ctx, canvas.width, canvas.height);
      const normalUrl = canvas.toDataURL('image/jpeg', 0.9);

      // 4. Cria versão invertida (Dual-Pass para etiquetas metálicas)
      const invertedUrl = createInvertedImage(ctx, canvas.width, canvas.height);

      resolve({ normalUrl, invertedUrl, features });
    };
    
    img.onerror = () => resolve({ 
        normalUrl: base64Image, 
        invertedUrl: base64Image,
        features: { aspectRatio: 1, edgeDensity: 0, hue: 0, saturation: 0, brightness: 0 } 
    });
    
    img.src = `data:image/jpeg;base64,${base64Image}`;
  });
};

// --- MATCHING VISUAL PONDERADO ---
const findVisualMatch = (current: VisualFeatures, trainingData: TrainingExample[]): TrainingExample | null => {
  let bestMatch: TrainingExample | null = null;
  
  // Limite super estrito para "Auto Match" (5% de diferença global)
  let minDiff = 0.05; 

  for (const example of trainingData) {
    if (!example.features) continue;
    const ef = example.features;

    // 1. Diferença de Aspect Ratio (Formato) - PESO MÁXIMO (50%)
    const diffAR = Math.abs(current.aspectRatio - ef.aspectRatio) / Math.max(current.aspectRatio, ef.aspectRatio);

    // 2. Diferença de Textura (Edge) - PESO ALTO (35%)
    const diffED = Math.abs(current.edgeDensity - ef.edgeDensity);

    // 3. Diferença de Cor (Hue) - PESO BAIXO (15%) - Reduzido para evitar ruído de luz do dia
    const hueDist = Math.min(Math.abs(current.hue - ef.hue), 360 - Math.abs(current.hue - ef.hue));
    const diffHue = hueDist / 180.0;
    
    // Auxiliares de Cor
    const diffSat = Math.abs(current.saturation - ef.saturation);
    const diffBri = Math.abs(current.brightness - ef.brightness) / 255.0;

    const colorScore = (diffHue * 0.6) + (diffSat * 0.2) + (diffBri * 0.2); 
    
    // Score Final Rebalanceado
    // AR(0.50) + Texture(0.35) + Color(0.15)
    const totalDiff = (diffAR * 0.50) + (diffED * 0.35) + (colorScore * 0.15);

    if (totalDiff < minDiff) {
      minDiff = totalDiff;
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
  
  // 1. Processamento: Extração Visual Central + Filtros OCR Dual-Pass
  const { normalUrl, invertedUrl, features } = await preprocessImage(base64Image);

  // 2. MEMÓRIA VISUAL ESTRITA
  const visualMatch = findVisualMatch(features, trainingData);
  
  if (visualMatch) {
    return {
      model: visualMatch.model,
      calculatedPower: visualMatch.power,
      confidence: 0.98,
      rawText: "Visual Match (Identidade Confirmada)",
      reasoning: "Reconhecimento Visual: Formato e Textura > 95% compatíveis.",
      features: features
    };
  }

  // 3. OCR Dual-Pass (Normal + Invertido)
  try {
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /:',
      tessedit_pageseg_mode: '6' as any,
    });

    // Pass 1: Imagem Normal
    const resNormal = await worker.recognize(normalUrl);
    
    // Pass 2: Imagem Invertida (Para etiquetas metálicas)
    const resInverted = await worker.recognize(invertedUrl);
    
    await worker.terminate();

    // Combina os textos para análise
    const combinedText = `${resNormal.data.text} | ${resInverted.data.text}`;

    const result = processExtractedText(combinedText, features, trainingData);
    result.features = features; 
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
  let reasoningParts: string[] = [`OCR: "${cleanText.substring(0, 30)}..."`];

  // ESTRATÉGIA 2: TEXTO TREINADO
  const knownModels = new Set<string>();
  trainingData.forEach(t => knownModels.add(t.model));
  Object.keys(MODEL_VALID_POWERS).forEach(m => knownModels.add(m));

  for (const knownModel of knownModels) {
    if (fuzzyContains(cleanText, knownModel, 2)) {
      model = knownModel;
      reasoningParts.push(`Texto: ${model}`);
      break;
    }
  }

  // ESTRATÉGIA 3: ASSINATURA EXATA
  if (!model) {
    for (const example of trainingData) {
      if (example.ocrSignature && cleanText.includes(example.ocrSignature)) {
        model = example.model;
        if (!power) power = example.power;
        reasoningParts.push(`Assinatura OCR`);
        break;
      }
    }
  }

  // EXTRAÇÃO DE POTÊNCIA
  const numbers = cleanText.match(/\b\d+\b/g);
  let bestPowerMatch: number | null = null;

  if (numbers) {
    const candidates = numbers.map(n => parseInt(n, 10)).filter(val => {
      // Filtra voltagens e anos comuns
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
  else if (model) confidence = 0.7;
  else if (power) confidence = 0.5;

  return {
    model: model,
    rawText: cleanText,
    calculatedPower: power,
    confidence: confidence,
    reasoning: reasoningParts.join(". ")
  };
};