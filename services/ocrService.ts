import Tesseract from 'tesseract.js';
import { AnalysisResponse, TrainingExample } from "../types";

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

// --- VISUAL FINGERPRINTS (Para classificação sem OCR) ---
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
// Calcula a distância entre duas strings (quantas trocas de letras são necessárias)
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

// Verifica se uma palavra alvo (ou algo parecido) existe no texto
const fuzzyContains = (text: string, target: string, tolerance: number = 2): boolean => {
  const words = text.split(/\s+/);
  const targetUpper = target.toUpperCase();
  
  // Verifica palavra por palavra
  for (const word of words) {
    if (Math.abs(word.length - targetUpper.length) > tolerance) continue;
    const dist = levenshteinDistance(word, targetUpper);
    if (dist <= tolerance) return true;
  }
  
  // Verifica frases (sliding window) se o target tiver espaços
  if (targetUpper.includes(' ')) {
      // Implementação simplificada para frases: verifica se o texto contem algo similar
      // Para performance, verificamos substring exata primeiro
      if (text.includes(targetUpper)) return true;
  }
  
  return false;
};

// Interface para resultados visuais
interface VisualFeatures {
  aspectRatio: number;
  edgeDensity: number;
}

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

const classifyVisual = (features: VisualFeatures): { model: string | null, confidence: number } => {
  let bestModel = null;
  let bestScore = 0;

  for (const [model, fingerprint] of Object.entries(VISUAL_FINGERPRINTS)) {
    let score = 0;
    const [minAR, maxAR] = fingerprint.ar;
    if (features.aspectRatio >= minAR && features.aspectRatio <= maxAR) {
      const center = (minAR + maxAR) / 2;
      const dist = Math.abs(features.aspectRatio - center);
      const range = (maxAR - minAR) / 2;
      score += 0.45 * Math.max(0.5, 1 - (dist / range));
    }

    const [minED, maxED] = fingerprint.ed;
    if (features.edgeDensity >= minED && features.edgeDensity <= maxED) {
      const center = (minED + maxED) / 2;
      const dist = Math.abs(features.edgeDensity - center);
      const range = (maxED - minED) / 2;
      score += 0.40 * Math.max(0.5, 1 - (dist / range));
    }

    if (score > bestScore) {
      bestScore = score;
      bestModel = model;
    }
  }

  if (bestScore > 0.5) return { model: bestModel, confidence: bestScore };
  return { model: null, confidence: 0 };
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
    // Binarização suave para não perder detalhes finos
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

export const analyzeLuminaireImage = async (
  base64Image: string,
  trainingData: TrainingExample[]
): Promise<AnalysisResponse> => {
  let worker;
  try {
    const { imgUrl: processedImage, features } = await preprocessImage(base64Image);

    worker = await Tesseract.createWorker('eng');
    // Adicionei caracteres comuns de erro para ajudar no regex depois
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /:',
      tessedit_pageseg_mode: '6' as any,
    });

    const ret = await worker.recognize(processedImage);
    const text = ret.data.text;
    await worker.terminate();

    return processExtractedText(text, features, trainingData);

  } catch (error) {
    console.error(error);
    return {
      model: null,
      rawText: "Erro de Leitura",
      calculatedPower: null,
      confidence: 0,
      reasoning: "Falha OCR"
    };
  }
};

const processExtractedText = (
  text: string, 
  visualFeatures: VisualFeatures, 
  trainingData: TrainingExample[]
): AnalysisResponse => {
  // Limpeza: remove quebras de linha e caracteres inúteis, mantém números e letras
  const cleanText = text.toUpperCase()
    .replace(/[^A-Z0-9\-\. \/:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  let model: string | null = null;
  let power: number | null = null;
  let reasoningParts: string[] = [`OCR: "${cleanText}"`];

  // =========================================================================
  // ESTRATÉGIA 1: APRENDIZADO GENERALISTA (Dynamic Concept Matching)
  // Verifica se o texto contem nomes de modelos que o usuário JÁ ENSINOU
  // =========================================================================
  
  // Extrai lista única de modelos conhecidos (User Training + Built-in)
  const knownModels = new Set<string>();
  trainingData.forEach(t => knownModels.add(t.model));
  Object.keys(MODEL_VALID_POWERS).forEach(m => knownModels.add(m));

  for (const knownModel of knownModels) {
    // Usa busca Fuzzy (tolerante a erros OCR)
    // Ex: Se knownModel="PALLAS" e texto="PA11AS", dá match.
    if (fuzzyContains(cleanText, knownModel, 2)) {
      model = knownModel;
      reasoningParts.push(`Identificado por padrão aprendido: ${model}`);
      break;
    }
  }

  // =========================================================================
  // ESTRATÉGIA 2: MEMÓRIA EXATA (Fallback)
  // =========================================================================
  if (!model) {
    for (const example of trainingData) {
      if (example.ocrSignature && cleanText.includes(example.ocrSignature)) {
        model = example.model;
        if (!power) power = example.power; // Só usa potência da memória se não achar no texto
        reasoningParts.push(`Memória exata`);
        break;
      }
    }
  }

  // =========================================================================
  // ESTRATÉGIA 3: CLASSIFICAÇÃO VISUAL (Último recurso para Modelo)
  // =========================================================================
  if (!model) {
    const visualResult = classifyVisual(visualFeatures);
    if (visualResult.model && visualResult.confidence > 0.6) {
      model = visualResult.model;
      reasoningParts.push(`Visual (AR:${visualFeatures.aspectRatio.toFixed(1)})`);
    }
  }

  // =========================================================================
  // EXTRAÇÃO INTELIGENTE DE POTÊNCIA (Regra x10 Prioritária)
  // =========================================================================
  
  // Extrai todos os números isolados
  const numbers = cleanText.match(/\b\d+\b/g);
  let bestPowerMatch: number | null = null;

  if (numbers) {
    // Filtra anos e voltagens óbvios
    const candidates = numbers.map(n => parseInt(n, 10)).filter(val => {
      return ![110, 127, 220, 230, 240, 380, 2023, 2024, 2025].includes(val);
    });

    for (const val of candidates) {
      let candidatePower = val;
      let appliedRule = false;

      // REGRA DE OURO: 01 a 09 -> Multiplica por 10
      if (val >= 1 && val <= 9) {
        candidatePower = val * 10;
        appliedRule = true;
      }

      // Se temos um modelo, valida contra a tabela dele
      if (model && MODEL_VALID_POWERS[model]) {
        if (MODEL_VALID_POWERS[model].includes(candidatePower)) {
          bestPowerMatch = candidatePower;
          reasoningParts.push(appliedRule ? `Regra (x10) aplicada: ${val}->${candidatePower}W` : `Potência encontrada: ${candidatePower}W`);
          break; // Achamos uma potência válida para o modelo!
        }
      } 
      // Se não temos modelo (ou tabela), aceita valores sensatos (10 a 400)
      else if (candidatePower >= 10 && candidatePower <= 400) {
        // Prioriza o maior valor razoável encontrado (geralmente potência é destaque)
        if (!bestPowerMatch || candidatePower > bestPowerMatch) {
            bestPowerMatch = candidatePower;
        }
      }
    }
  }

  // Se achamos via OCR/Regra, sobrescreve qualquer memória antiga
  if (bestPowerMatch) {
    power = bestPowerMatch;
  }

  // =========================================================================
  // CONCLUSÃO E CONFIANÇA
  // =========================================================================
  let confidence = 0.3;

  if (model && power) {
    // Se modelo e potência foram encontrados e validados
    confidence = 1.0; 
  } else if (model) {
    // Só modelo
    confidence = 0.6;
    reasoningParts.push("Potência não confirmada.");
  } else if (power) {
    // Só potência
    confidence = 0.5;
  }

  return {
    model: model,
    rawText: cleanText,
    calculatedPower: power,
    confidence: confidence,
    reasoning: reasoningParts.join(". ")
  };
};
