import Tesseract from 'tesseract.js';
import { AnalysisResponse, TrainingExample, VisualFeatures, DetectionResult } from "../types";

// --- TABELAS DE REFERÊNCIA (STRICT) ---
const MODEL_VALID_POWERS: Record<string, number[]> = {
  // Base Existente
  'PALLAS': [23, 33, 47, 60, 75, 90, 110, 130, 155, 200],
  'KINGSUN': [23, 33, 47, 60, 75, 90, 110, 130, 155, 200],
  'HBMI': [50, 75, 100, 150, 200],
  'ORI': [50], 
  'IESNA': [20, 40, 65, 85],
  'HTC': [22, 30, 40, 50, 60, 70, 80, 100, 120],
  'SANLIGHT': [20, 30, 40, 50, 60, 100],

  // --- NOVOS DO PDF ---
  
  // SCHRÉDER
  'SCHREDER': [36, 38, 39, 51, 56, 60, 75, 80, 110, 125, 145, 155, 212, 236],
  'VOLTANA': [39, 56, 60, 75, 80, 110, 145, 212],
  'AKILA': [155, 236],
  'ISLA': [36, 51],
  'STYLAGE': [38],
  'RUBI': [60],
  'GL2': [125],

  // BRIGHTLUX
  'BRIGHTLUX': [40, 50, 65, 130, 150, 213, 230],
  'URBJET': [40, 65, 130, 150, 213, 230],
  'ORI-0504': [50],

  // ALPER
  'ALPER': [35, 40, 60, 90, 100, 130, 200, 210],
  'IP BR': [40, 130, 200, 210],
  'LIPBR': [90, 130, 200],
  'ALP': [60],
  'LPT': [60],
  'BR II': [130],

  // REEME
  'REEME': [51, 65, 82, 130, 290],
  'LD-3P': [51, 65, 82, 130, 290],
  'LD-7P': [65],

  // LEDSTAR / UNICOBA
  'LEDSTAR': [58, 61, 120, 200, 215],
  'UNICOBA': [58, 61, 120, 200, 215],
  'SL VITTA': [58, 120, 200, 215],
  'FLEX': [61],

  // PHILIPS
  'PHILIPS': [58, 127],
  'BRP372': [127],
  'MICENAS': [58],

  // IBILUX
  'IBILUX': [120],
  'EVORA': [120],

  // ILUMATIC
  'ILUMATIC': [60, 100],
  'ARES': [60, 100],

  // ORION
  'ORION': [40, 55, 57, 58, 60, 100, 148, 150],
  'VEGA': [40, 55, 60],
  'CRONOS': [100],
  'NENA': [57],

  // ALUDAX
  'ALUDAX': [60],

  // GOLDEN
  'GOLDEN': [65, 75, 80],
  'SQUARE': [75, 80],

  // ARGOS
  'ARGOS': [30, 62, 120],

  // UNILUMIN
  'UNILUMIN': [35, 120],
  'LEDOLPHIN': [120],
  'OPERA': [35],

  // ARCOBRAS
  'ARCOBRAS': [66, 120],
  'ECOLED': [120],
  'ECO-STB': [66],

  // EMPALUX
  'EMPALUX': [100, 150],

  // TECNOWATT
  'TECNOWATT': [54, 60],
  'MERAK': [54],
  'BORA': [60],
  'FO5': [60],

  // SONERES
  'SONERES': [54],
  'FOSTERI': [54],
  
  // GENERICO
  'BULBO': [35]
};

const DETECT_CONFIG = {
  SCALE_FACTOR: 1.5, 
  MIN_BLOB_PERCENT: 0.12 // Aumentado para 12% da imagem (Ignora objetos muito distantes)
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
  if (target.length < 3) return false; 
  const targetUpper = target.toUpperCase();
  
  if (text.includes(targetUpper)) return true;

  const words = text.split(/[\s\-\/\.]+/);
  
  for (const word of words) {
    if (Math.abs(word.length - targetUpper.length) > tolerance) continue;
    
    const dynamicTolerance = targetUpper.length <= 4 ? 1 : tolerance;
    
    const dist = levenshteinDistance(word, targetUpper);
    if (dist <= dynamicTolerance) return true;
  }
  
  return false;
};

// --- VISION ENGINE: CORES E FEATURES ---

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

const isSkyPixel = (r: number, g: number, b: number) => {
  const [h, s, l] = rgbToHsl(r, g, b);
  // Definição mais rigorosa de céu para não pegar luminárias cinza claro
  if (l > 0.90) return true; // Branco estourado
  if (h > 180 && h < 260 && s > 0.15 && l > 0.45) return true; // Azul do céu
  return false;
};

// Detecta objetos ignorando o céu 
const detectObjectBounds = (data: Uint8ClampedArray, width: number, height: number) => {
  const visited = new Uint8Array(width * height);
  const blobs: {x: number, y: number, w: number, h: number, area: number}[] = [];
  const scanStep = 8; 

  const getIdx = (x: number, y: number) => y * width + x;

  // Pontos totais verificados
  const totalScannedPoints = (width * height) / (scanStep * scanStep);
  const minAreaThreshold = totalScannedPoints * DETECT_CONFIG.MIN_BLOB_PERCENT;

  for (let y = 0; y < height; y += scanStep) {
    for (let x = 0; x < width; x += scanStep) {
      const idx = getIdx(x, y);
      if (visited[idx]) continue;

      const r = data[idx * 4];
      const g = data[idx * 4 + 1];
      const b = data[idx * 4 + 2];

      if (!isSkyPixel(r, g, b)) {
        let minX = x, maxX = x, minY = y, maxY = y;
        let count = 0;
        
        const stack = [{x, y}];
        visited[idx] = 1;
        
        let loopCount = 0;
        const maxLoop = 50000; 

        while (stack.length > 0 && loopCount < maxLoop) {
          loopCount++;
          const p = stack.pop()!;
          count++;

          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;

          const neighbors = [
            {nx: p.x + scanStep, ny: p.y},
            {nx: p.x - scanStep, ny: p.y},
            {nx: p.x, ny: p.y + scanStep},
            {nx: p.x, ny: p.y - scanStep}
          ];

          for (const n of neighbors) {
            if (n.nx >= 0 && n.nx < width && n.ny >= 0 && n.ny < height) {
              const nIdx = getIdx(n.nx, n.ny);
              if (visited[nIdx] === 0) {
                 const nr = data[nIdx * 4];
                 const ng = data[nIdx * 4 + 1];
                 const nb = data[nIdx * 4 + 2];
                 if (!isSkyPixel(nr, ng, nb)) {
                   visited[nIdx] = 1;
                   stack.push({x: n.nx, y: n.ny});
                 }
              }
            }
          }
        }
        
        blobs.push({
          x: minX,
          y: minY,
          w: maxX - minX,
          h: maxY - minY,
          area: count
        });
      }
    }
  }

  const validBlobs = blobs.filter(b => {
    // 1. Filtro de Área: Ignora objetos muito pequenos (longe)
    if (b.area < minAreaThreshold) return false;
    
    // 2. Filtro de Formato: Ignora objetos muito finos (Postes verticais)
    const ar = b.w / b.h;
    if (ar > 4.0 || ar < 0.45) return false; // Aumentado para 0.45: Ignora postes, foca em caixas de luminárias
    
    return true;
  });

  // FALLBACK FIXO: Retorna o centro da imagem se a detecção falhar.
  // Garante consistência para imagens duplicadas.
  if (validBlobs.length === 0) {
    const marginW = Math.floor(width * 0.15); 
    const marginH = Math.floor(height * 0.15);
    return { 
        x: marginW, 
        y: marginH, 
        w: width - (marginW * 2), 
        h: height - (marginH * 2) 
    };
  }

  validBlobs.sort((a, b) => b.area - a.area);
  const best = validBlobs[0];

  const padding = 20;
  return {
    x: Math.max(0, best.x - padding),
    y: Math.max(0, best.y - padding),
    w: Math.min(width - best.x + padding * 2, best.w + padding * 2),
    h: Math.min(height - best.y + padding * 2, best.h + padding * 2)
  };
};

const extractVisualFeatures = (ctx: CanvasRenderingContext2D, width: number, height: number): VisualFeatures => {
  const fullImageData = ctx.getImageData(0, 0, width, height);
  const bounds = detectObjectBounds(fullImageData.data, width, height);
  
  // 1. Extração no Objeto Detectado (Para Formato e Textura)
  const imageData = ctx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h);
  const data = imageData.data;
  
  const step = 4;
  let edges = 0;
  let count = 0;

  for (let y = 0; y < bounds.h - step; y += step) {
    for (let x = 0; x < bounds.w - step; x += step) {
      const i = (y * bounds.w + x) * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      
      const lum = 0.299*r + 0.587*g + 0.114*b;
      
      const iRight = (y * bounds.w + (x + step)) * 4;
      const lumRight = 0.299*data[iRight] + 0.587*data[iRight+1] + 0.114*data[iRight+2];
      
      const iDown = ((y + step) * bounds.w + x) * 4;
      const lumDown = 0.299*data[iDown] + 0.587*data[iDown+1] + 0.114*data[iDown+2];

      if (Math.abs(lum - lumRight) > 25 || Math.abs(lum - lumDown) > 25) {
        edges++;
      }
      count++;
    }
  }

  const edgeDensity = count > 0 ? edges / count : 0;
  const aspectRatio = bounds.h > 0 ? bounds.w / bounds.h : 1;

  // 2. Extração Global Estável (Centro Fixo da Imagem Original)
  // Isso garante que imagens idênticas tenham cores idênticas, independente do recorte do blob
  const centerW = Math.floor(width * 0.4);
  const centerH = Math.floor(height * 0.4);
  const startX = Math.floor((width - centerW) / 2);
  const startY = Math.floor((height - centerH) / 2);
  
  const centerData = ctx.getImageData(startX, startY, centerW, centerH).data;
  let rAcc = 0, gAcc = 0, bAcc = 0, cCount = 0;
  
  for (let i = 0; i < centerData.length; i += 16) { // Amostragem rápida
     rAcc += centerData[i];
     gAcc += centerData[i+1];
     bAcc += centerData[i+2];
     cCount++;
  }
  
  const avgR = cCount > 0 ? rAcc / cCount : 128;
  const avgG = cCount > 0 ? gAcc / cCount : 128;
  const avgB = cCount > 0 ? bAcc / cCount : 128;
  const [h, s, l] = rgbToHsl(avgR, avgG, avgB);

  return {
    aspectRatio,
    edgeDensity,
    hue: h,
    saturation: s,
    brightness: l * 255
  };
};

// Filtro de Nitidez (Sharpen) + Binarização
const applyOcrFilters = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const w = width;
  const h = height;

  const output = new Uint8ClampedArray(data);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const val = 
          5 * data[idx + c]
          - data[((y-1)*w + x)*4 + c]
          - data[((y+1)*w + x)*4 + c]
          - data[(y*w + (x-1))*4 + c]
          - data[(y*w + (x+1))*4 + c];
        
        output[idx + c] = Math.min(255, Math.max(0, val));
      }
      output[idx + 3] = 255; 
    }
  }

  for (let i = 0; i < output.length; i += 4) {
    const gray = output[i] * 0.299 + output[i + 1] * 0.587 + output[i + 2] * 0.114;
    const val = gray > 140 ? 255 : 0;
    data[i] = val;
    data[i+1] = val;
    data[i+2] = val;
  }
  
  ctx.putImageData(imageData, 0, 0);
};

const createInvertedImage = (ctx: CanvasRenderingContext2D, width: number, height: number): string => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];     
    data[i + 1] = 255 - data[i + 1]; 
    data[i + 2] = 255 - data[i + 2]; 
  }
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx?.putImageData(imageData, 0, 0);
  return tempCanvas.toDataURL('image/jpeg', 0.9);
};

const preprocessImage = async (base64Image: string): Promise<{ normalUrl: string, invertedUrl: string, features: VisualFeatures, processedPreview: string }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { 
        resolve({ 
            normalUrl: base64Image, 
            invertedUrl: base64Image,
            features: { aspectRatio: 1, edgeDensity: 0, hue: 0, saturation: 0, brightness: 0 },
            processedPreview: base64Image
        }); 
        return; 
      }

      // Tamanho padronizado crítico para features consistentes
      canvas.width = 800; 
      const scale = 800 / img.width;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // 1. Extrair Features (Antes de destruir a imagem com filtros)
      const features = extractVisualFeatures(ctx, canvas.width, canvas.height);

      // 2. Aplicar Filtros para OCR
      applyOcrFilters(ctx, canvas.width, canvas.height);
      const normalUrl = canvas.toDataURL('image/jpeg', 0.8);
      const processedPreview = normalUrl;
      const invertedUrl = createInvertedImage(ctx, canvas.width, canvas.height);

      resolve({ normalUrl, invertedUrl, features, processedPreview });
    };
    
    img.onerror = () => resolve({ 
        normalUrl: base64Image, 
        invertedUrl: base64Image,
        features: { aspectRatio: 1, edgeDensity: 0, hue: 0, saturation: 0, brightness: 0 },
        processedPreview: base64Image
    });
    
    img.src = `data:image/jpeg;base64,${base64Image}`;
  });
};

export const findVisualMatch = (current: VisualFeatures, trainingData: TrainingExample[]): { match: TrainingExample | null, diff: number } => {
  let bestMatch: TrainingExample | null = null;
  let minDiff = 1.0; 

  for (const example of trainingData) {
    if (!example.features) continue;
    const ef = example.features;

    // Normalização das Diferenças
    const diffAR = Math.abs(current.aspectRatio - ef.aspectRatio) / Math.max(0.1, ef.aspectRatio);
    const diffED = Math.abs(current.edgeDensity - ef.edgeDensity);
    
    // Diferença de Cor (Circular)
    const hueDist = Math.min(Math.abs(current.hue - ef.hue), 360 - Math.abs(current.hue - ef.hue));
    const diffHue = hueDist / 180.0;
    
    // Diferença de Brilho/Saturação (Crítico para imagens idênticas)
    const diffBright = Math.abs(current.brightness - ef.brightness) / 255.0;
    const diffSat = Math.abs(current.saturation - ef.saturation);
    
    // Peso Balanceado: Formato é importante, mas Brilho e Cor confirmam identidade
    const totalDiff = 
        (diffAR * 0.40) + 
        (diffED * 0.30) + 
        (diffHue * 0.10) +
        (diffBright * 0.10) +
        (diffSat * 0.10);

    if (totalDiff < minDiff) {
      minDiff = totalDiff;
      bestMatch = example;
    }
  }

  return { match: bestMatch, diff: minDiff };
};

// Função para re-verificar itens do histórico baseado em um novo aprendizado
export const checkRetrospectiveMatch = (item: DetectionResult, rule: TrainingExample): boolean => {
    // 1. Checagem Visual
    if (item.features && rule.features) {
        // Usa a mesma lógica de findVisualMatch, mas para um único item
        const { diff } = findVisualMatch(item.features, [rule]);
        // Tolerância de 10% para retrospectiva (seguro o suficiente para mesmo modelo)
        if (diff < 0.10) {
            return true;
        }
    }

    // 2. Checagem de Assinatura de Texto (OCR Error Matching)
    if (rule.ocrSignature && item.rawText && item.rawText.includes(rule.ocrSignature)) {
        return true;
    }

    return false;
};

export const analyzeLuminaireImage = async (
  base64Image: string,
  trainingData: TrainingExample[]
): Promise<AnalysisResponse & { processedPreview?: string }> => {
  
  const { normalUrl, invertedUrl, features, processedPreview } = await preprocessImage(base64Image);

  // --- FILTRO DE OBJETOS INVÁLIDOS (POSTES/LONGE) ---
  // Se o Aspect Ratio for menor que 0.40, é muito provável que seja um poste vertical
  // ou uma imagem que o detector não conseguiu recortar bem.
  if (features.aspectRatio < 0.40) {
      return {
          model: null,
          rawText: "Ignorado",
          calculatedPower: null,
          confidence: 0,
          reasoning: "Ignorado: Imagem parece ser um poste ou estar muito distante (Muito vertical/fina).",
          features: features,
          processedPreview: processedPreview
      };
  }

  // 1. Busca Match Visual PRIMEIRO (Para detectar duplicatas exatas)
  const { match: visualMatch, diff: visualDiff } = findVisualMatch(features, trainingData);
  
  // Se for uma cópia EXATA (ou muito próxima) de algo treinado, usamos a memória.
  // 0.05 é uma tolerância muito baixa, indicando praticamente a mesma imagem.
  const isExactDuplicate = visualMatch && visualDiff < 0.05;

  let ocrResult: AnalysisResponse | null = null;
  
  // Só roda OCR se não for uma duplicata óbvia, ou se quisermos confirmar
  // (Rodamos para extrair texto novo caso seja uma luminária igual mas etiqueta diferente)
  try {
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /:Ww',
      tessedit_pageseg_mode: '6' as any,
    });

    const resNormal = await worker.recognize(normalUrl);
    const resInverted = await worker.recognize(invertedUrl);
    await worker.terminate();

    const combinedText = `${resNormal.data.text} \n ${resInverted.data.text}`;
    
    ocrResult = processExtractedText(combinedText, features, trainingData);
  } catch (error) {
    console.error("OCR falhou", error);
  }

  // 3. Cruzamento e Decisão
  let finalModel = ocrResult?.model || null;
  let finalPower = ocrResult?.calculatedPower || null;
  let finalConfidence = ocrResult?.confidence || 0;
  let finalReasoning = ocrResult?.reasoning || "";

  if (isExactDuplicate && visualMatch) {
      // Prioridade TOTAL para a memória se a imagem for visualmente idêntica
      // A menos que o OCR tenha achado uma potência VÁLIDA e DIFERENTE (caso raro de reetiquetagem)
      if (finalPower && finalPower !== visualMatch.power) {
          finalReasoning = `Atenção: Visual idêntico (${(visualDiff*100).toFixed(1)}% diff), mas OCR leu potência diferente (${finalPower}W).`;
          finalConfidence = 0.85; // Alta confiança mas alerta
      } else {
          finalModel = visualMatch.model;
          finalPower = visualMatch.power;
          finalConfidence = 1.0;
          finalReasoning = "Luminária Reconhecida na Memória Visual.";
          finalModel = visualMatch.model; // Força modelo da memória
      }
  } else if (visualMatch && visualDiff < 0.15) {
      // Visual Parecido (Mesmo modelo, outra foto)
      if (!finalModel) {
          finalModel = visualMatch.model;
          finalReasoning += ` | Modelo sugerido por similaridade visual (${(visualDiff*100).toFixed(1)}%).`;
          finalConfidence = Math.max(finalConfidence, 0.75);
      }
      // Cruzamento: Se OCR falhou na potência, usa visual
      if (!finalPower) {
          finalPower = visualMatch.power;
          finalReasoning += ` | Potência sugerida por similaridade.`;
      }
  }

  if (!finalModel && !finalPower && !visualMatch) {
      finalConfidence = 0;
      finalReasoning = "Não identificado. Adicione ao treinamento.";
  }

  return {
    model: finalModel,
    rawText: ocrResult ? ocrResult.rawText : "OCR Ignorado/Falha",
    calculatedPower: finalPower,
    confidence: finalConfidence,
    reasoning: finalReasoning,
    features: features,
    processedPreview: processedPreview
  };
};

const processExtractedText = (
  text: string, 
  visualFeatures: VisualFeatures, 
  trainingData: TrainingExample[]
): AnalysisResponse => {
  const cleanText = text.toUpperCase()
    .replace(/[^A-Z0-9\-\. \/:W]/g, ' ') 
    .replace(/\s+/g, ' ')
    .trim();
  
  let model: string | null = null;
  let power: number | null = null;
  let reasoningParts: string[] = [];

  // 1. Detectar Modelo
  const knownModels = new Set<string>();
  trainingData.forEach(t => knownModels.add(t.model));
  Object.keys(MODEL_VALID_POWERS).forEach(m => knownModels.add(m));

  for (const knownModel of knownModels) {
    if (fuzzyContains(cleanText, knownModel, 2)) {
      model = knownModel;
      reasoningParts.push(`Modelo Texto: ${model}`);
      break;
    }
  }

  // 2. Assinatura de erro
  if (!model) {
    for (const example of trainingData) {
      if (example.ocrSignature && cleanText.includes(example.ocrSignature)) {
        model = example.model;
        if (!power) power = example.power;
        reasoningParts.push(`Assinatura de Erro Conhecida`);
        break;
      }
    }
  }

  // 3. Detectar Potência
  const powerRegex = /(\d+)\s*[Ww]|(\d{2,3})/g;
  const matches = [...cleanText.matchAll(powerRegex)];
  const potentialPowers: number[] = [];

  for (const match of matches) {
      if (match[1]) {
          const val = parseInt(match[1], 10);
          potentialPowers.push(val);
      } 
      else if (match[2]) {
          let val = parseInt(match[2], 10);
          if ([110, 127, 220, 380, 2023, 2024, 2025].includes(val)) continue;
          if (val > 0 && val <= 9) val *= 10;
          potentialPowers.push(val);
      }
  }

  if (model && MODEL_VALID_POWERS[model]) {
      const validSet = MODEL_VALID_POWERS[model];
      const validMatch = potentialPowers.find(p => validSet.includes(p));
      if (validMatch) {
          power = validMatch;
          reasoningParts.push(`Potência Validada: ${power}W`);
      }
  }

  if (!power && potentialPowers.length > 0) {
      const reasonable = potentialPowers.filter(p => p >= 10 && p <= 400);
      if (reasonable.length > 0) {
          power = Math.max(...reasonable);
          reasoningParts.push(`Potência Estimada: ${power}W`);
      }
  }

  let confidence = 0.2;
  if (model && power) confidence = 0.95;
  else if (model) confidence = 0.7;
  else if (power) confidence = 0.5;

  return {
    model: model,
    rawText: cleanText.substring(0, 50),
    calculatedPower: power,
    confidence: confidence,
    reasoning: reasoningParts.length > 0 ? reasoningParts.join(". ") : "Dados insuficientes"
  };
};