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
// AR = Aspect Ratio (Largura / Altura)
// ED = Edge Density (Quantidade de detalhes/bordas na imagem 0.0 a 1.0)
const VISUAL_FINGERPRINTS: Record<string, { ar: [number, number], ed: [number, number] }> = {
  'PALLAS': { ar: [1.2, 2.5], ed: [0.10, 0.40] },     // Geralmente retangular, design limpo
  'KINGSUN': { ar: [0.8, 1.3], ed: [0.30, 0.60] },    // Mais quadrada, muitos aletas de dissipação
  'HBMI': { ar: [1.5, 3.0], ed: [0.20, 0.50] },       // Alongada
  'HTC': { ar: [0.9, 1.5], ed: [0.15, 0.45] }
};

const DETECT_CONFIG = {
  CANNY_THRESHOLD_1: 30,
  CANNY_THRESHOLD_2: 100,
  SCALE_FACTOR: 2.0 
};

// Interface para resultados visuais
interface VisualFeatures {
  aspectRatio: number;
  edgeDensity: number;
}

/**
 * Calcula a densidade de bordas (simulação de Canny/Sobel simples)
 * Percorre os pixels e conta quantas mudanças bruscas de cor existem
 */
const calculateEdgeDensity = (data: Uint8ClampedArray, width: number, height: number): number => {
  let edges = 0;
  const threshold = 30; // Diferença mínima para considerar uma borda
  const totalPixels = width * height;

  // Amostragem (pula alguns pixels para performance)
  const step = 2; 

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width - 1; x += step) {
      const i = (y * width + x) * 4;
      const nextI = (y * width + (x + 1)) * 4;
      
      // Compara apenas luminosidade (canal R simplificado pois é escala de cinza já)
      const diff = Math.abs(data[i] - data[nextI]);
      
      if (diff > threshold) {
        edges++;
      }
    }
  }

  // Normaliza (multiplica por step^2 pois pulamos pixels)
  return Math.min(1.0, (edges * (step * step)) / totalPixels);
};

/**
 * Classifica o modelo baseado APENAS nas características visuais
 * Pesos Ajustados: Aspect Ratio (0.45) e Edge Density (0.40)
 */
const classifyVisual = (features: VisualFeatures): { model: string | null, confidence: number } => {
  let bestModel = null;
  let bestScore = 0;

  for (const [model, fingerprint] of Object.entries(VISUAL_FINGERPRINTS)) {
    let score = 0;

    // 1. Aspect Ratio (Peso 0.45 - Prioridade Alta)
    const [minAR, maxAR] = fingerprint.ar;
    if (features.aspectRatio >= minAR && features.aspectRatio <= maxAR) {
      // Pontuação gradativa: quanto mais no centro do range, maior a nota
      const center = (minAR + maxAR) / 2;
      const dist = Math.abs(features.aspectRatio - center);
      const range = (maxAR - minAR) / 2;
      const quality = 1 - (dist / range); // 0 a 1
      score += 0.45 * Math.max(0.5, quality);
    }

    // 2. Edge Density (Peso 0.40 - Prioridade Alta)
    const [minED, maxED] = fingerprint.ed;
    if (features.edgeDensity >= minED && features.edgeDensity <= maxED) {
      const center = (minED + maxED) / 2;
      const dist = Math.abs(features.edgeDensity - center);
      const range = (maxED - minED) / 2;
      const quality = 1 - (dist / range);
      score += 0.40 * Math.max(0.5, quality);
    }

    // Se passou de um threshold mínimo
    if (score > bestScore) {
      bestScore = score;
      bestModel = model;
    }
  }

  // Retorna apenas se tiver uma confiança razoável
  if (bestScore > 0.5) {
    return { model: bestModel, confidence: bestScore };
  }
  
  return { model: null, confidence: 0 };
};

const enhanceImage = (ctx: CanvasRenderingContext2D, width: number, height: number): VisualFeatures => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Ajuste de contraste linear
  const contrast = 50; 
  const factor = (255 + contrast) / (255 * (255 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    let newValue = factor * (gray - 128) + 128;
    
    if (newValue > 180) newValue = 255;
    else if (newValue < 80) newValue = 0; 

    data[i] = newValue;
    data[i + 1] = newValue;
    data[i + 2] = newValue;
  }

  ctx.putImageData(imageData, 0, 0);

  // Calcula features visuais na imagem processada
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
      // Default features caso falhe o contexto
      if (!ctx) { 
        resolve({ 
          imgUrl: base64Image, 
          features: { aspectRatio: img.width/img.height, edgeDensity: 0 } 
        }); 
        return; 
      }

      canvas.width = img.width * DETECT_CONFIG.SCALE_FACTOR;
      canvas.height = img.height * DETECT_CONFIG.SCALE_FACTOR;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Processa e extrai features
      const features = enhanceImage(ctx, canvas.width, canvas.height);

      resolve({ 
        imgUrl: canvas.toDataURL('image/jpeg', 0.9),
        features
      });
    };
    img.onerror = () => resolve({ 
      imgUrl: base64Image, 
      features: { aspectRatio: 1, edgeDensity: 0 } 
    });
    img.src = `data:image/jpeg;base64,${base64Image}`;
  });
};

export const analyzeLuminaireImage = async (
  base64Image: string,
  trainingData: TrainingExample[]
): Promise<AnalysisResponse> => {
  let worker;
  try {
    // 1. Pré-processamento e Extração de Features Visuais
    const { imgUrl: processedImage, features } = await preprocessImage(base64Image);

    // 2. OCR
    worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /',
      tessedit_pageseg_mode: '6' as any,
    });

    const ret = await worker.recognize(processedImage);
    const text = ret.data.text;
    await worker.terminate();

    // 3. Processamento Combinado (Texto + Visual)
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
  const cleanText = text.toUpperCase()
    .replace(/[^A-Z0-9\-\. \/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  let model: string | null = null;
  let power: number | null = null;
  let reasoningParts: string[] = [`OCR: "${cleanText}"`];

  // --- 1. APRENDIZADO POR ASSINATURA ---
  for (const example of trainingData) {
    if (example.ocrSignature && cleanText.includes(example.ocrSignature)) {
      model = example.model;
      power = example.power;
      reasoningParts.push(`Memória (Assinatura: ${example.ocrSignature})`);
      return {
        model, rawText: cleanText, calculatedPower: power, confidence: 1.0, 
        reasoning: reasoningParts.join(". ")
      };
    }
  }

  // --- 2. DETECÇÃO DE MODELO VIA REGEX ---
  const modelPatterns = [
    { regex: /PALLAS|PA11AS|P4LLAS/i, name: 'PALLAS' },
    { regex: /KING\s?SUN|K1NG/i, name: 'KINGSUN' },
    { regex: /BRIGHT\s?LUX/i, name: 'BRIGHTLUX' },
    { regex: /SAN\s?LIGHT/i, name: 'SANLIGHT' },
    { regex: /H\s?B\s?M\s?I/i, name: 'HBMI' },
    { regex: /H\.?T\.?C/i, name: 'HTC' },
    { regex: /IESNA/i, name: 'IESNA' },
    { regex: /ORI\b/i, name: 'ORI' }
  ];

  for (const p of modelPatterns) {
    if (p.regex.test(cleanText)) {
      model = p.name;
      break;
    }
  }

  // --- 2b. CLASSIFICAÇÃO VISUAL (FALLBACK) ---
  // Se o OCR falhou em achar o modelo, usamos geometria
  if (!model) {
    const visualResult = classifyVisual(visualFeatures);
    if (visualResult.model && visualResult.confidence > 0.6) {
      model = visualResult.model;
      reasoningParts.push(`Modelo sugerido visualmente (AR:${visualFeatures.aspectRatio.toFixed(1)}, ED:${visualFeatures.edgeDensity.toFixed(2)})`);
    }
  }

  // --- 3. EXTRAÇÃO DE POTÊNCIA ---
  const numbers = cleanText.match(/\b\d+\b/g);
  
  if (numbers) {
    const validNumbers = numbers.filter(n => {
      const val = parseInt(n, 10);
      if ([110, 127, 220, 230, 240, 380, 2023, 2024, 2025].includes(val)) return false;
      return true;
    });

    for (const numStr of validNumbers) {
      const val = parseInt(numStr, 10);
      let potentialPower = val;
      let converted = false;

      // REGRA: 01 a 09 -> Multiplica por 10
      if (val >= 1 && val <= 9) {
        potentialPower = val * 10;
        converted = true;
      }

      if (model && MODEL_VALID_POWERS[model]) {
        if (MODEL_VALID_POWERS[model].includes(potentialPower)) {
          power = potentialPower;
          reasoningParts.push(`Potência ${power}W (Tabela ${model})`);
          break;
        }
      } 
      else if (!power && potentialPower >= 10 && potentialPower <= 500) {
        power = potentialPower; 
      }
    }
  }

  // Fallback Pallas específico
  if (model === 'PALLAS' && !power) {
     if (cleanText.includes(' 06 ') || cleanText.endsWith(' 06')) power = 60;
     if (cleanText.includes(' 08 ') || cleanText.endsWith(' 08')) power = 80;
  }

  return {
    model: model,
    rawText: cleanText,
    calculatedPower: power,
    confidence: (model && power) ? 0.9 : (model ? 0.7 : 0.3),
    reasoning: reasoningParts.join(". ") || "Não identificado."
  };
};
