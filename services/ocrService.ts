
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
  // Aumentado para permitir leitura de objetos distantes
  MAX_WIDTH: 2000, 
  // Reduzido para evitar descartar etiquetas pequenas
  MIN_BLOB_PERCENT: 0.005 
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

const fuzzyContains = (text: string, target: string, defaultTolerance: number = 2): boolean => {
  if (target.length < 2) return false; 
  const targetUpper = target.toUpperCase();
  
  // Strict check for very short models to avoid false positives (e.g. 'ALP' inside 'ALPHA')
  if (text.includes(targetUpper)) return true;

  const words = text.split(/[\s\-\/\.:,]+/);
  
  for (const word of words) {
    if (Math.abs(word.length - targetUpper.length) > defaultTolerance) continue;
    
    // Dynamic Tolerance based on length
    let tolerance = defaultTolerance;
    if (targetUpper.length <= 3) tolerance = 0; // ALP, ORI, LED must be exact
    else if (targetUpper.length <= 5) tolerance = 1; // Short names allow 1 error
    
    const dist = levenshteinDistance(word, targetUpper);
    if (dist <= tolerance) return true;
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
  
  // FIX CRÍTICO: Etiquetas são brancas (L alto). 
  // O código antigo ignorava L > 0.90 achando que era sol/céu.
  // Agora só ignoramos se for Azul E Claro (Céu), ou Azul e Saturado.
  
  const isBlueHue = (h > 170 && h < 270);
  
  // Céu Azul Claro
  if (isBlueHue && s > 0.2 && l > 0.4) return true;
  
  // Céu Branco/Cinza nublado (muito difícil distinguir de etiquetas brancas, então somos conservadores)
  // Só removemos se for EXTREMAMENTE brilhante e EXTREMAMENTE desaturado (quase estourado do sol)
  // mas mantemos se tiver um pouco de "sujeira" (labels nunca são branco perfeito #FFFFFF)
  if (l > 0.98 && s < 0.05) return true; 

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
        const maxLoop = 80000; 

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
    if (b.area < minAreaThreshold) return false;
    const ar = b.w / b.h;
    // Relaxed Aspect Ratio to allow long labels
    if (ar > 8.0 || ar < 0.1) return false; 
    return true;
  });

  if (validBlobs.length === 0) {
    const marginW = Math.floor(width * 0.15); 
    const marginH = Math.floor(height * 0.15);
    return { 
        x: marginW, 
        y: marginH, 
        w: width - (marginW * 2), 
        h: height - (marginH * 2),
        isFallback: true,
        area: 0
    };
  }

  validBlobs.sort((a, b) => b.area - a.area);
  const best = validBlobs[0];

  const padding = 30; // Mais padding para garantir que não cortamos a borda da etiqueta
  return {
    x: Math.max(0, best.x - padding),
    y: Math.max(0, best.y - padding),
    w: Math.min(width - best.x + padding * 2, best.w + padding * 2),
    h: Math.min(height - best.y + padding * 2, best.h + padding * 2),
    isFallback: false,
    area: best.area
  };
};

const extractVisualFeatures = (ctx: CanvasRenderingContext2D, width: number, height: number, bounds: any): VisualFeatures => {
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

  const centerW = Math.floor(width * 0.4);
  const centerH = Math.floor(height * 0.4);
  const startX = Math.floor((width - centerW) / 2);
  const startY = Math.floor((height - centerH) / 2);
  
  const centerData = ctx.getImageData(startX, startY, centerW, centerH).data;
  let rAcc = 0, gAcc = 0, bAcc = 0, cCount = 0;
  
  for (let i = 0; i < centerData.length; i += 16) { 
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

const applyOcrFilters = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const w = width;
  const h = height;

  const output = new Uint8ClampedArray(data);

  // Sharpening Kernel
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

  // Binarization with Threshold
  for (let i = 0; i < output.length; i += 4) {
    const gray = output[i] * 0.299 + output[i + 1] * 0.587 + output[i + 2] * 0.114;
    // Increased threshold to keep more details in bright labels
    const val = gray > 150 ? 255 : 0; 
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

const cropAndUpscale = (
  ctx: CanvasRenderingContext2D, 
  bounds: {x: number, y: number, w: number, h: number},
  fullWidth: number,
  fullHeight: number
): { normalUrl: string, invertedUrl: string } => {
  const cropCanvas = document.createElement('canvas');
  const cropCtx = cropCanvas.getContext('2d');
  
  // Se o crop for muito pequeno, upscaling agressivo
  const isSmall = (bounds.w * bounds.h) < (fullWidth * fullHeight * 0.2);
  const scale = isSmall ? 2.5 : 1.2;

  cropCanvas.width = bounds.w * scale;
  cropCanvas.height = bounds.h * scale;

  if (cropCtx) {
    cropCtx.imageSmoothingEnabled = true;
    cropCtx.imageSmoothingQuality = 'high';
    cropCtx.drawImage(
      ctx.canvas, 
      bounds.x, bounds.y, bounds.w, bounds.h, 
      0, 0, cropCanvas.width, cropCanvas.height
    );

    applyOcrFilters(cropCtx, cropCanvas.width, cropCanvas.height);
    
    const normalUrl = cropCanvas.toDataURL('image/jpeg', 0.9);
    const invertedUrl = createInvertedImage(cropCtx, cropCanvas.width, cropCanvas.height);
    return { normalUrl, invertedUrl };
  }
  
  return { normalUrl: '', invertedUrl: '' };
};

// --- SELEÇÃO DE MELHOR IMAGEM (BEST SHOT) ---
const calculateImageScore = async (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if(!ctx) { resolve(0); return; }

        // Redimensiona para análise rápida (max 600px)
        const maxDim = 600;
        let w = img.width;
        let h = img.height;
        if(w > maxDim || h > maxDim) {
            const r = Math.min(maxDim/w, maxDim/h);
            w = Math.floor(w*r);
            h = Math.floor(h*r);
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        
        const imageData = ctx.getImageData(0, 0, w, h);
        const bounds = detectObjectBounds(imageData.data, w, h);
        
        // Se for fallback (não achou objeto), score baixo
        if(bounds.isFallback) {
          resolve(0.1);
          return;
        }

        // Score base: 
        // 1. Zoom (Área relativa) - Peso 60%
        // 2. Contraste/Bordas - Peso 40%
        const objectAreaRatio = (bounds.w * bounds.h) / (w * h);
        const features = extractVisualFeatures(ctx, w, h, bounds);
        
        // Bônus se a imagem for brilhante (etiqueta iluminada) mas não estourada
        const brightnessBonus = (features.brightness > 100 && features.brightness < 240) ? 0.2 : 0;
        
        const score = (objectAreaRatio * 0.6) + (features.edgeDensity * 0.4) + brightnessBonus;
        resolve(score);
      };
      img.onerror = () => resolve(0);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(0);
    reader.readAsDataURL(file);
  });
};

export const selectBestImageFromBatch = async (files: File[]): Promise<File> => {
  if (files.length === 0) throw new Error("Batch vazio");
  if (files.length === 1) return files[0];

  let bestFile = files[0];
  let maxScore = -1;

  for (const file of files) {
    const score = await calculateImageScore(file);
    if (score > maxScore) {
      maxScore = score;
      bestFile = file;
    }
  }
  return bestFile;
};

// --- PROCESSAMENTO PRINCIPAL ---

const preprocessImage = async (base64Image: string): Promise<{ 
  normalUrl: string, 
  invertedUrl: string, 
  fullResizedUrl: string, // URL da imagem cheia, apenas redimensionada
  features: VisualFeatures, 
  processedPreview: string,
  isFallback: boolean
}> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { 
        resolve({ 
            normalUrl: base64Image, 
            invertedUrl: base64Image,
            fullResizedUrl: base64Image,
            features: { aspectRatio: 1, edgeDensity: 0, hue: 0, saturation: 0, brightness: 0 },
            processedPreview: base64Image,
            isFallback: true
        }); 
        return; 
      }

      const maxDim = DETECT_CONFIG.MAX_WIDTH;
      let width = img.width;
      let height = img.height;
      
      if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;
      
      ctx.drawImage(img, 0, 0, width, height);
      
      // Cria versão Full Resized (para OCR de segurança se o crop falhar)
      const fullResizedUrl = canvas.toDataURL('image/jpeg', 0.8);
      
      const fullImageData = ctx.getImageData(0, 0, width, height);
      const bounds = detectObjectBounds(fullImageData.data, width, height);
      const features = extractVisualFeatures(ctx, width, height, bounds);
      const { normalUrl, invertedUrl } = cropAndUpscale(ctx, bounds, width, height);

      resolve({ 
        normalUrl, 
        invertedUrl, 
        fullResizedUrl,
        features, 
        processedPreview: normalUrl,
        isFallback: !!bounds.isFallback
      });
    };
    
    img.onerror = () => resolve({ 
        normalUrl: base64Image, 
        invertedUrl: base64Image,
        fullResizedUrl: base64Image,
        features: { aspectRatio: 1, edgeDensity: 0, hue: 0, saturation: 0, brightness: 0 },
        processedPreview: base64Image,
        isFallback: true
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

    const diffAR = Math.abs(current.aspectRatio - ef.aspectRatio) / Math.max(0.1, ef.aspectRatio);
    const diffED = Math.abs(current.edgeDensity - ef.edgeDensity);
    
    const hueDist = Math.min(Math.abs(current.hue - ef.hue), 360 - Math.abs(current.hue - ef.hue));
    const diffHue = hueDist / 180.0;
    
    const diffBright = Math.abs(current.brightness - ef.brightness) / 255.0;
    const diffSat = Math.abs(current.saturation - ef.saturation);
    
    const totalDiff = 
        (diffAR * 0.45) + 
        (diffED * 0.35) + 
        (diffHue * 0.10) +
        (diffBright * 0.05) +
        (diffSat * 0.05);

    if (totalDiff < minDiff) {
      minDiff = totalDiff;
      bestMatch = example;
    }
  }

  return { match: bestMatch, diff: minDiff };
};

export const checkRetrospectiveMatch = (item: DetectionResult, rule: TrainingExample): boolean => {
    if (item.features && rule.features) {
        const { diff } = findVisualMatch(item.features, [rule]);
        if (diff < 0.15) {
            return true;
        }
    }
    if (rule.ocrSignature && item.rawText && item.rawText.includes(rule.ocrSignature)) {
        return true;
    }
    return false;
};

export const analyzeLuminaireImage = async (
  base64Image: string,
  trainingData: TrainingExample[]
): Promise<AnalysisResponse & { processedPreview?: string }> => {
  
  const { normalUrl, invertedUrl, fullResizedUrl, features, processedPreview, isFallback } = await preprocessImage(base64Image);

  let localResult: AnalysisResponse = {
      model: null,
      rawText: isFallback ? "Objeto Distante" : "",
      calculatedPower: null,
      confidence: isFallback ? 0.1 : 0, 
      reasoning: isFallback ? "Local: Objeto muito pequeno ou distante." : "",
      features: features
  };

  const { match: visualMatch, diff: visualDiff } = findVisualMatch(features, trainingData);
  const isExactDuplicate = visualMatch && visualDiff < 0.05;

  if (isExactDuplicate && visualMatch) {
      return {
          model: visualMatch.model,
          rawText: "Duplicata Exata",
          calculatedPower: visualMatch.power,
          confidence: 1.0,
          reasoning: "Reconhecido na Memória Visual (Duplicata Exata).",
          features: features,
          processedPreview: processedPreview
      };
  }

  // --- ESTRATÉGIA HÍBRIDA DE OCR ---
  try {
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /:Ww',
      tessedit_pageseg_mode: '6' as any, // Assume uniform text block
    });

    let combinedText = "";

    // 1. Tenta OCR no Crop (Normal)
    const resNormal = await worker.recognize(normalUrl);
    combinedText += ` ${resNormal.data.text}`;

    // 2. Tenta OCR no Crop (Invertido) - ajuda com texto branco em fundo escuro
    const resInverted = await worker.recognize(invertedUrl);
    combinedText += ` ${resInverted.data.text}`;

    // 3. SE a confiança for baixa ou texto curto, tenta na imagem COMPLETA (Segurança contra Crop ruim)
    if (combinedText.length < 10 || !combinedText.match(/\d/)) {
         await worker.setParameters({ tessedit_pageseg_mode: '3' as any }); // Auto segmentation for full image
         const resFull = await worker.recognize(fullResizedUrl);
         combinedText += ` \n ${resFull.data.text}`;
    }

    await worker.terminate();

    const processedOcr = processExtractedText(combinedText, features, trainingData);
    
    localResult = {
        ...processedOcr,
        features, 
        reasoning: "OCR: " + processedOcr.reasoning
    };
    
    // --- LÓGICA DE FUSÃO VISUAL + OCR ---
    if (visualMatch && visualDiff < 0.20) {
          const similarity = ((1 - visualDiff) * 100).toFixed(0);
          
          if (localResult.model && localResult.calculatedPower) {
              if (localResult.model === visualMatch.model) {
                  localResult.confidence = Math.max(localResult.confidence, 0.98);
                  localResult.reasoning += ` | Confirmado visualmente (${similarity}%).`;
              }
          }
          
          if (!localResult.model) {
              localResult.model = visualMatch.model;
              localResult.confidence = Math.max(localResult.confidence, 0.75);
              localResult.reasoning += ` | Modelo sugerido por similaridade visual (${similarity}%).`;
          }

          if (localResult.model && !localResult.calculatedPower) {
              if (localResult.model === visualMatch.model || !localResult.model) {
                  localResult.calculatedPower = visualMatch.power;
                  localResult.confidence = Math.max(localResult.confidence, 0.85);
                  localResult.reasoning += ` | Potência estimada por padrão visual similar (${similarity}%).`;
              }
          }

          if (!localResult.model && !localResult.calculatedPower) {
              localResult.model = visualMatch.model;
              localResult.calculatedPower = visualMatch.power;
              localResult.confidence = 0.65; 
              localResult.reasoning = `Estimativa baseada puramente em similaridade visual (${similarity}%). Verificar etiqueta.`;
          }
    }

  } catch (error) {
    console.error("OCR Local falhou", error);
    if (visualMatch && visualDiff < 0.20) {
        localResult.model = visualMatch.model;
        localResult.calculatedPower = visualMatch.power;
        localResult.confidence = 0.5;
        localResult.reasoning = "OCR Falhou. Sugestão visual.";
    }
  }

  return { ...localResult, processedPreview };
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

  // --- DETECÇÃO DE MODELO ---
  const knownModels = new Set<string>();
  trainingData.forEach(t => knownModels.add(t.model));
  Object.keys(MODEL_VALID_POWERS).forEach(m => knownModels.add(m));

  // Sort by length desc to match longest first (e.g. BRIGHTLUX URBJET before BRIGHTLUX)
  const sortedModels = Array.from(knownModels).sort((a, b) => b.length - a.length);

  for (const knownModel of sortedModels) {
    if (fuzzyContains(cleanText, knownModel, 2)) {
      model = knownModel;
      reasoningParts.push(`Modelo Identificado: ${model}`);
      break;
    }
  }

  // Backup: Assinatura de erro
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

  // --- DETECÇÃO DE POTÊNCIA (REGEX MELHORADA) ---
  
  // 1. Prioridade Máxima: Número + W (ex: 150W, 150 W, 150WATTS)
  // Regex: Borda de palavra \b, número, espaço opcional, W ou WATTS, borda de palavra
  const explicitPowerRegex = /\b(\d{2,3})\s?(W|WATTS)\b/g;
  const explicitMatches = [...cleanText.matchAll(explicitPowerRegex)];
  
  const explicitPowers = explicitMatches.map(m => parseInt(m[1], 10));

  if (explicitPowers.length > 0) {
     // Filtra outliers (ex: 220W voltagem confundida é raro escrito assim, mas acontece. Filtrar ano 2024)
     const validExplicit = explicitPowers.filter(p => p > 10 && p < 500 && p !== 220 && p !== 127 && p !== 110);
     if (validExplicit.length > 0) {
         power = Math.max(...validExplicit); // Assume maior potência (projetores as vezes tem soma)
         reasoningParts.push(`Potência Explícita Encontrada: ${power}W`);
     }
  }

  // 2. Se não achou explícito, busca números soltos que casam com a tabela do modelo
  if (!power) {
      const looseNumberRegex = /\b(\d{2,3})\b/g;
      const looseMatches = [...cleanText.matchAll(looseNumberRegex)];
      const potentialPowers = looseMatches.map(m => parseInt(m[1], 10))
         .filter(p => ![110, 127, 220, 380, 2023, 2024, 2025].includes(p)); // Filtra voltagens comuns e anos

      if (model && MODEL_VALID_POWERS[model]) {
          const validSet = MODEL_VALID_POWERS[model];
          // Interseção entre números encontrados e potências válidas do modelo
          const validMatch = potentialPowers.find(p => validSet.includes(p));
          
          if (validMatch) {
              power = validMatch;
              reasoningParts.push(`Potência Validada na Tabela (${model}): ${power}W`);
          }
      } else if (potentialPowers.length > 0) {
           // Heurística para números pequenos sem modelo: Códigos como "08" -> 80W?
           // O código original fazia isso. Vamos manter com cuidado.
           // Se tiver muitos números, é arriscado.
           // Vamos tentar achar números comuns de iluminação pública: 50, 60, 80, 100, 150...
           const commmonStreetLights = [30, 40, 50, 58, 60, 70, 80, 90, 100, 120, 150, 180, 200, 250];
           const bestGuess = potentialPowers.find(p => commmonStreetLights.includes(p));
           if (bestGuess) {
              power = bestGuess;
              reasoningParts.push(`Potência Comum Detectada: ${power}W (Incerto)`);
           }
      }
  }
  
  // Regra de multiplicação antiga (ex: "06" -> 60W)
  if (!power) {
      const smallNumRegex = /\b0([1-9])\b/g; // 06, 08...
      const smallMatch = smallNumRegex.exec(cleanText);
      if (smallMatch) {
          power = parseInt(smallMatch[1], 10) * 10;
          reasoningParts.push(`Regra de Código Curto (0${smallMatch[1]} -> ${power}W)`);
      }
  }

  let confidence = 0.2;
  if (model && power) confidence = 0.92;
  else if (model) confidence = 0.7;
  else if (power) confidence = 0.6;

  return {
    model: model,
    rawText: cleanText.substring(0, 80), // Aumentado preview
    calculatedPower: power,
    confidence: confidence,
    reasoning: reasoningParts.length > 0 ? reasoningParts.join(". ") : "Dados insuficientes"
  };
};
