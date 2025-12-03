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

const isNotSkyPixel = (r: number, g: number, b: number) => {
  const brightness = (r + g + b) / 3;
  // Sky heuristic: Very bright OR blue-dominant
  // Ajustado para ser menos agressivo em dias nublados
  const isSky = brightness > 220 || (b > r + 20 && b > g + 20 && brightness > 160);
  return !isSky;
};

// Detecta objetos usando componentes conectados simplificado
const detectObjectBounds = (data: Uint8ClampedArray, width: number, height: number) => {
  const visited = new Uint8Array(width * height); // 0 = unvisited
  const blobs: {x: number, y: number, w: number, h: number, area: number}[] = [];
  const scanStep = 4; // Performance optimization

  const getIdx = (x: number, y: number) => y * width + x;

  for (let y = 0; y < height; y += scanStep) {
    for (let x = 0; x < width; x += scanStep) {
      const idx = getIdx(x, y);
      if (visited[idx]) continue;

      const r = data[idx * 4];
      const g = data[idx * 4 + 1];
      const b = data[idx * 4 + 2];

      if (isNotSkyPixel(r, g, b)) {
        // Start Flood Fill
        let minX = x, maxX = x, minY = y, maxY = y;
        let count = 0;
        const stack = [{x, y}];
        visited[idx] = 1;

        // Limit stack size/depth to prevent browser freeze on huge blobs
        let loopSafety = 0;
        const maxLoop = 100000; 

        while (stack.length > 0 && loopSafety < maxLoop) {
          loopSafety++;
          const p = stack.pop()!;
          count++;

          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;

          // Neighbors (Check coarse grid)
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
                 if (isNotSkyPixel(nr, ng, nb)) {
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
          w: maxX - minX + scanStep,
          h: maxY - minY + scanStep,
          area: count // This is 'stepped' area unit
        });
      }
    }
  }

  // FILTRO INTELIGENTE
  const totalSteppedArea = (width * height) / (scanStep * scanStep);
  const minArea = totalSteppedArea * 0.01; // 1% da imagem

  const validBlobs = blobs.filter(b => {
    // 1. Filtro de Área (Percentual)
    if (b.area < minArea) return false;

    const ar = b.w / b.h;

    // 2. Filtro de Formato (Shape)
    // Ignora "Muito Curto e Largo" (ex: fios)
    if (ar > 3.0) return false; 
    
    // Ignora "Muito Alto e Fino" (ex: postes isolados)
    if (ar < 0.2) return false;

    return true;
  });

  if (validBlobs.length === 0) {
    // Fallback: Centro da imagem
    const cx = width / 2, cy = height / 2;
    return { x: cx - width/4, y: cy - height/4, w: width/2, h: height/2 };
  }

  // Seleciona o maior blob válido
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
  
  // 1. DETECT OBJECT BOUNDS (Filtros de Contorno)
  const bounds = detectObjectBounds(fullImageData.data, width, height);
  
  // FILTRO DE ÁREA (Percentual da Imagem)
  const imageArea = width * height;
  const objectArea = bounds.w * bounds.h;
  const coverageRatio = objectArea / imageArea;

  // Se o objeto for muito pequeno (< 5%) ou ocupar a imagem toda (provavelmente erro),
  // ajustamos os bounds para o centro para tentar ler algo, mas a feature será "ruim".
  let finalBounds = bounds;
  // Fallback suave
  if (coverageRatio < 0.01) {
     const cx = width / 2, cy = height / 2;
     finalBounds = { x: cx - width/4, y: cy - height/4, w: width/2, h: height/2 };
  }

  // FILTRO DE FORMATO (Aspect Ratio)
  const objectAR = finalBounds.w / finalBounds.h;
  
  // Extrai dados APENAS de dentro do Bounding Box detectado
  const imageData = ctx.getImageData(finalBounds.x, finalBounds.y, finalBounds.w, finalBounds.h);
  const data = imageData.data;
  
  let rTotal = 0, gTotal = 0, bTotal = 0;
  let edges = 0;
  const step = 2;
  const cropWidth = finalBounds.w;
  const cropHeight = finalBounds.h;

  for (let y = 0; y < cropHeight - 1; y += step) {
    for (let x = 0; x < cropWidth - 1; x += step) {
      const i = (y * cropWidth + x) * 4;
      
      rTotal += data[i];
      gTotal += data[i + 1];
      bTotal += data[i + 2];

      const gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
      
      const iRight = (y * cropWidth + (x + 1)) * 4;
      const grayRight = data[iRight] * 0.299 + data[iRight+1] * 0.587 + data[iRight+2] * 0.114;

      const iDown = ((y + 1) * cropWidth + x) * 4;
      const grayDown = data[iDown] * 0.299 + data[iDown+1] * 0.587 + data[iDown+2] * 0.114;

      const diffH = Math.abs(gray - grayRight);
      const diffV = Math.abs(gray - grayDown);

      if (diffH > 20 || diffV > 20) {
        edges++;
      }
    }
  }

  const pixelCount = (cropWidth * cropHeight) / (step * step);
  const avgR = rTotal / pixelCount;
  const avgG = gTotal / pixelCount;
  const avgB = bTotal / pixelCount;

  const [hue, saturation, lightness] = rgbToHsl(avgR, avgG, avgB);
  const edgeDensity = Math.min(1.0, (edges * step) / (cropWidth * cropHeight));

  return {
    aspectRatio: objectAR, // Usa o AR do objeto detectado
    edgeDensity: edgeDensity,
    hue: hue,
    saturation: saturation,
    brightness: lightness * 255
  };
};

const applyOcrFilters = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  const contrast = 60; 
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
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // Feature extraction agora usa detecção de objeto
      const features = extractVisualFeatures(ctx, canvas.width, canvas.height);

      applyOcrFilters(ctx, canvas.width, canvas.height);
      const normalUrl = canvas.toDataURL('image/jpeg', 0.9);

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

const findVisualMatch = (current: VisualFeatures, trainingData: TrainingExample[]): TrainingExample | null => {
  let bestMatch: TrainingExample | null = null;
  let minDiff = 0.05; 

  for (const example of trainingData) {
    if (!example.features) continue;
    const ef = example.features;

    // Comparação focada em Formato e Textura
    const diffAR = Math.abs(current.aspectRatio - ef.aspectRatio) / Math.max(current.aspectRatio, ef.aspectRatio);
    const diffED = Math.abs(current.edgeDensity - ef.edgeDensity);

    const hueDist = Math.min(Math.abs(current.hue - ef.hue), 360 - Math.abs(current.hue - ef.hue));
    const diffHue = hueDist / 180.0;
    const diffSat = Math.abs(current.saturation - ef.saturation);
    const diffBri = Math.abs(current.brightness - ef.brightness) / 255.0;
    const colorScore = (diffHue * 0.6) + (diffSat * 0.2) + (diffBri * 0.2); 
    
    // Pesos ajustados: AR (60%), ED (30%), Cor (10%)
    const totalDiff = (diffAR * 0.60) + (diffED * 0.30) + (colorScore * 0.10);

    if (totalDiff < minDiff) {
      minDiff = totalDiff;
      bestMatch = example;
    }
  }

  return bestMatch;
};

export const analyzeLuminaireImage = async (
  base64Image: string,
  trainingData: TrainingExample[]
): Promise<AnalysisResponse> => {
  
  const { normalUrl, invertedUrl, features } = await preprocessImage(base64Image);

  // MEMÓRIA VISUAL
  const visualMatch = findVisualMatch(features, trainingData);
  
  if (visualMatch) {
    return {
      model: visualMatch.model,
      calculatedPower: visualMatch.power,
      confidence: 0.98,
      rawText: "Visual Match (Objeto Confirmado)",
      reasoning: "Reconhecimento Visual: Formato e Textura compatíveis com base de conhecimento.",
      features: features
    };
  }

  try {
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /:',
      tessedit_pageseg_mode: '6' as any,
    });

    const resNormal = await worker.recognize(normalUrl);
    const resInverted = await worker.recognize(invertedUrl);
    await worker.terminate();

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

  const numbers = cleanText.match(/\b\d+\b/g);
  let bestPowerMatch: number | null = null;

  if (numbers) {
    const candidates = numbers.map(n => parseInt(n, 10)).filter(val => {
      return ![110, 127, 220, 230, 240, 380, 2023, 2024, 2025].includes(val);
    });

    for (const val of candidates) {
      let candidatePower = val;
      let appliedRule = false;

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