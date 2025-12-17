

import Tesseract from 'tesseract.js';
import { AnalysisResponse, TrainingExample, VisualFeatures, DetectionResult, OllamaConfig } from "../types";
import { OllamaService } from './ollamaService';

// --- INTERFACES INTERNAS ---
interface PreprocessResult {
  normalUrl: string;
  invertedUrl: string;
  fullResizedUrl: string; // Usado para mandar para IA (menos processado)
  features: VisualFeatures;
  processedPreview: string;
  validation: {
    isValid: boolean;
    reason: string;
  };
}

// =============================================================================
// CLASSE 1: VISION PROCESSOR
// =============================================================================
class VisionProcessor {
  private static readonly DETECT_CONFIG = {
    MAX_WIDTH: 2000,
    // Reduzi a exigência de tamanho mínimo. Antes estava rejeitando fotos boas mas um pouco distantes.
    MIN_BLOB_PERCENT: 0.02, 
    MAX_VERTICAL_ASPECT: 3.0 
  };

  public async preprocess(base64Image: string): Promise<PreprocessResult> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(this.createFallbackResult(base64Image, "Erro Contexto Canvas"));
          return;
        }

        const { width, height } = this.resizeDimensions(img.width, img.height);
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const fullResizedUrl = canvas.toDataURL('image/jpeg', 0.8);
        const fullImageData = ctx.getImageData(0, 0, width, height);
        
        // 1. Detecção Inteligente de Objeto
        const detection = this.detectObjectBounds(fullImageData.data, width, height);
        
        // Se a detecção heurística falhar muito feio, a gente ainda deixa passar
        // para o Ollama tentar salvar, a menos que seja puramente ruído.
        if (detection.isSceneNoise) {
            resolve({
                normalUrl: base64Image,
                invertedUrl: base64Image,
                fullResizedUrl: fullResizedUrl,
                features: { aspectRatio: 1, edgeDensity: 0, hue: 0, saturation: 0, brightness: 0 },
                processedPreview: fullResizedUrl,
                validation: { isValid: false, reason: "Apenas cenário (céu/rua) detectado." }
            });
            return;
        }

        const features = this.extractVisualFeatures(ctx, width, height, detection);
        
        const { normalUrl, invertedUrl, finalWidth } = this.cropAndUpscale(ctx, detection, width, height);

        // Se estiver muito longe, avisamos, mas se tiver AI, ela pode tentar ver o formato
        let isValid = true;
        let reason = "OK";
        
        if (finalWidth < 150) {
             isValid = false; 
             reason = "Muito Distante";
        }

        resolve({
          normalUrl,
          invertedUrl,
          fullResizedUrl: fullResizedUrl, // Imagem original redimensionada (contexto para IA)
          features,
          processedPreview: normalUrl, // Crop processado (para OCR)
          validation: { isValid, reason }
        });
      };
      
      img.onerror = () => resolve(this.createFallbackResult(base64Image, "Erro Carregamento Imagem"));
      img.src = `data:image/jpeg;base64,${base64Image}`;
    });
  }

  public async calculateImageScore(file: File): Promise<number> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if(!ctx) { resolve(0); return; }

          const maxDim = 600;
          const { width, height } = this.resizeDimensions(img.width, img.height, maxDim);
          
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          
          const imageData = ctx.getImageData(0, 0, width, height);
          const bounds = this.detectObjectBounds(imageData.data, width, height);
          
          if(bounds.isSceneNoise) {
            resolve(0); 
            return;
          }

          const objectAreaRatio = (bounds.w * bounds.h) / (width * height);
          const features = this.extractVisualFeatures(ctx, width, height, bounds);
          const score = (objectAreaRatio * 0.7) + (features.edgeDensity * 0.3);
          resolve(score);
        };
        img.onerror = () => resolve(0);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(0);
      reader.readAsDataURL(file);
    });
  }

  private resizeDimensions(w: number, h: number, max: number = VisionProcessor.DETECT_CONFIG.MAX_WIDTH) {
    if (w > max || h > max) {
      const ratio = Math.min(max / w, max / h);
      return { width: Math.floor(w * ratio), height: Math.floor(h * ratio) };
    }
    return { width: w, height: h };
  }

  private createFallbackResult(base64Image: string, reason: string): PreprocessResult {
    return {
      normalUrl: base64Image,
      invertedUrl: base64Image,
      fullResizedUrl: base64Image,
      features: { aspectRatio: 1, edgeDensity: 0, hue: 0, saturation: 0, brightness: 0 },
      processedPreview: base64Image,
      validation: { isValid: false, reason }
    };
  }

  // Lógica Avançada de Detecção
  private detectObjectBounds(data: Uint8ClampedArray, width: number, height: number) {
    const visited = new Uint8Array(width * height);
    const blobs: {x: number, y: number, w: number, h: number, area: number, maxY: number}[] = [];
    const scanStep = 8; 

    const getIdx = (x: number, y: number) => y * width + x;
    const totalPixels = width * height;
    const minPixelCount = totalPixels * VisionProcessor.DETECT_CONFIG.MIN_BLOB_PERCENT;

    for (let y = 0; y < height; y += scanStep) {
      for (let x = 0; x < width; x += scanStep) {
        const idx = getIdx(x, y);
        if (visited[idx]) continue;

        const r = data[idx * 4];
        const g = data[idx * 4 + 1];
        const b = data[idx * 4 + 2];

        if (!this.isSkyPixel(r, g, b)) {
          let minX = x, maxX = x, minY = y, maxY = y;
          let count = 0;
          const stack = [{x, y}];
          visited[idx] = 1;
          
          let loopCount = 0;
          const maxLoop = 150000; 

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
                   if (!this.isSkyPixel(nr, ng, nb)) {
                     visited[nIdx] = 1;
                     stack.push({x: n.nx, y: n.ny});
                   }
                }
              }
            }
          }
          blobs.push({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, area: count, maxY: maxY });
        }
      }
    }

    const validBlobs = blobs.filter(b => {
      if (b.area < (minPixelCount / (scanStep * scanStep))) return false;
      if (b.maxY > height * 0.99) return false; // Toca o chão
      return true;
    });

    if (validBlobs.length === 0) {
      return { 
          x: 0, y: 0, w: 0, h: 0,
          isFallback: true, 
          isSceneNoise: true,
          reason: "Cena Ampla / Apenas Fundo Detectado"
      };
    }

    validBlobs.sort((a, b) => b.area - a.area);
    const best = validBlobs[0];
    const padding = 20;

    return {
      x: Math.max(0, best.x - padding),
      y: Math.max(0, best.y - padding),
      w: Math.min(width - best.x + padding * 2, best.w + padding * 2),
      h: Math.min(height - best.y + padding * 2, best.h + padding * 2),
      isFallback: false,
      isSceneNoise: false,
      reason: null
    };
  }

  private extractVisualFeatures(ctx: CanvasRenderingContext2D, width: number, height: number, bounds: any): VisualFeatures {
    const imageData = ctx.getImageData(bounds.x, bounds.y, bounds.w, bounds.h);
    const data = imageData.data;
    const step = 4;
    let edges = 0;
    let count = 0;

    for (let y = 0; y < bounds.h - step; y += step) {
      for (let x = 0; x < bounds.w - step; x += step) {
        const i = (y * bounds.w + x) * 4;
        const lum = this.getLuminance(data, i);
        const lumRight = this.getLuminance(data, (y * bounds.w + (x + step)) * 4);
        const lumDown = this.getLuminance(data, ((y + step) * bounds.w + x) * 4);
        if (Math.abs(lum - lumRight) > 20 || Math.abs(lum - lumDown) > 20) edges++;
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
       rAcc += centerData[i]; gAcc += centerData[i+1]; bAcc += centerData[i+2]; cCount++;
    }
    const avgR = cCount > 0 ? rAcc / cCount : 128;
    const avgG = cCount > 0 ? gAcc / cCount : 128;
    const avgB = cCount > 0 ? bAcc / cCount : 128;
    const [h, s, l] = this.rgbToHsl(avgR, avgG, avgB);

    return { aspectRatio, edgeDensity, hue: h, saturation: s, brightness: l * 255 };
  }

  private cropAndUpscale(ctx: CanvasRenderingContext2D, bounds: any, fullWidth: number, fullHeight: number) {
    const cropCanvas = document.createElement('canvas');
    const cropCtx = cropCanvas.getContext('2d');
    
    const isSmall = (bounds.w * bounds.h) < (fullWidth * fullHeight * 0.15);
    const scale = isSmall ? 3.0 : 1.5;

    cropCanvas.width = bounds.w * scale;
    cropCanvas.height = bounds.h * scale;

    if (cropCtx) {
      cropCtx.imageSmoothingEnabled = true;
      cropCtx.imageSmoothingQuality = 'high';
      cropCtx.drawImage(ctx.canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, cropCanvas.width, cropCanvas.height);
      this.applyOcrFilters(cropCtx, cropCanvas.width, cropCanvas.height);
      const normalUrl = cropCanvas.toDataURL('image/jpeg', 0.9);
      const invertedUrl = this.createInvertedImage(cropCtx, cropCanvas.width, cropCanvas.height);
      return { normalUrl, invertedUrl, finalWidth: cropCanvas.width };
    }
    return { normalUrl: '', invertedUrl: '', finalWidth: 0 };
  }

  private applyOcrFilters(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const output = new Uint8ClampedArray(data);

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const val = 5 * data[idx + c]
            - data[((y-1)*w + x)*4 + c] - data[((y+1)*w + x)*4 + c]
            - data[(y*w + (x-1))*4 + c] - data[(y*w + (x+1))*4 + c];
          output[idx + c] = Math.min(255, Math.max(0, val));
        }
        output[idx + 3] = 255;
      }
    }

    for (let i = 0; i < output.length; i += 4) {
      const gray = output[i] * 0.299 + output[i + 1] * 0.587 + output[i + 2] * 0.114;
      const val = gray > 160 ? 255 : 0; 
      data[i] = data[i+1] = data[i+2] = val;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  private createInvertedImage(ctx: CanvasRenderingContext2D, w: number, h: number): string {
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];     
      data[i + 1] = 255 - data[i + 1]; 
      data[i + 2] = 255 - data[i + 2]; 
    }
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    t.getContext('2d')?.putImageData(imageData, 0, 0);
    return t.toDataURL('image/jpeg', 0.9);
  }

  private getLuminance(data: Uint8ClampedArray, i: number) {
    return 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
  }

  private rgbToHsl(r: number, g: number, b: number) {
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
  }

  private isSkyPixel(r: number, g: number, b: number): boolean {
    const [h, s, l] = this.rgbToHsl(r, g, b);
    const isBlueHue = (h > 170 && h < 270);
    if (isBlueHue && s > 0.15 && l > 0.3) return true;
    if (l > 0.95 && s < 0.1) return true; 
    return false;
  }
}

// =============================================================================
// CLASSE 2: OCR DISPATCHER (SINGLETON)
// =============================================================================
class OCRDispatcher {
  private static instance: OCRDispatcher;
  private scheduler: Tesseract.Scheduler | null = null;
  private isInitializing = false;
  private readonly MAX_WORKERS = Math.min(navigator.hardwareConcurrency || 4, 4);

  private constructor() {}

  public static getInstance(): OCRDispatcher {
    if (!OCRDispatcher.instance) {
      OCRDispatcher.instance = new OCRDispatcher();
    }
    return OCRDispatcher.instance;
  }

  public async getScheduler(): Promise<Tesseract.Scheduler> {
    if (this.scheduler) return this.scheduler;
    if (this.isInitializing) {
        while(this.isInitializing) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (this.scheduler) return this.scheduler;
    }

    this.isInitializing = true;
    const tempScheduler = Tesseract.createScheduler();
    const workerPromises = Array(this.MAX_WORKERS).fill(0).map(async () => {
      const worker = await Tesseract.createWorker('eng');
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /:Ww',
        tessedit_pageseg_mode: '6' as any, 
      });
      return worker;
    });

    const workers = await Promise.all(workerPromises);
    workers.forEach(w => tempScheduler.addWorker(w));
    
    this.scheduler = tempScheduler;
    this.isInitializing = false;
    return this.scheduler;
  }
}

// =============================================================================
// CLASSE 3: KNOWLEDGE REPOSITORY
// =============================================================================
class KnowledgeRepository {
  private readonly MODEL_VALID_POWERS: Record<string, number[]> = {
    'PALLAS': [23, 33, 47, 60, 75, 90, 110, 130, 155, 200],
    'KINGSUN': [23, 33, 47, 60, 75, 90, 110, 130, 155, 200],
    'HBMI': [50, 75, 100, 150, 200],
    'SCHREDER': [36, 38, 39, 51, 56, 60, 75, 80, 110, 125, 145, 155, 212, 236],
    'VOLTANA': [39, 56, 60, 75, 80, 110, 145, 212],
    'URBJET': [40, 65, 130, 150, 213, 230],
    'BRIGHTLUX': [40, 50, 65, 130, 150, 213, 230],
    'ALPER': [35, 40, 60, 90, 100, 130, 200, 210],
    'REEME': [51, 65, 82, 130, 290],
    'LEDSTAR': [58, 61, 120, 200, 215],
    'PHILIPS': [58, 127],
    'ORION': [40, 55, 57, 58, 60, 100, 148, 150],
    'TECNOWATT': [54, 60],
    'MERAK': [54],
    'BORA': [60]
  };

  private levenshtein(a: string, b: string): number {
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
  }

  public fuzzyContains(text: string, target: string, defaultTolerance: number = 2): boolean {
    if (target.length < 2) return false; 
    const targetUpper = target.toUpperCase();
    if (text.includes(targetUpper)) return true;

    const words = text.split(/[\s\-\/\.:,]+/);
    for (const word of words) {
      if (Math.abs(word.length - targetUpper.length) > defaultTolerance) continue;
      
      let tolerance = defaultTolerance;
      if (targetUpper.length <= 3) tolerance = 0;
      else if (targetUpper.length <= 5) tolerance = 1;
      
      if (this.levenshtein(word, targetUpper) <= tolerance) return true;
    }
    return false;
  }

  public findVisualMatch(current: VisualFeatures, trainingData: TrainingExample[]): { match: TrainingExample | null, diff: number } {
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
      const totalDiff = (diffAR * 0.45) + (diffED * 0.35) + (diffHue * 0.10) + (diffBright * 0.05) + (diffSat * 0.05);

      if (totalDiff < minDiff) {
        minDiff = totalDiff;
        bestMatch = example;
      }
    }
    return { match: bestMatch, diff: minDiff };
  }

  public checkRetrospectiveMatch(item: DetectionResult, rule: TrainingExample): boolean {
      if (item.features && rule.features) {
          const { diff } = this.findVisualMatch(item.features, [rule]);
          if (diff < 0.15) return true;
      }
      return false;
  }

  public interpretText(text: string, trainingData: TrainingExample[]): AnalysisResponse {
    const cleanText = text.toUpperCase()
      .replace(/[^A-Z0-9\-\. \/:W]/g, ' ') 
      .replace(/\s+/g, ' ')
      .trim();
    
    let model: string | null = null;
    let power: number | null = null;
    let reasoningParts: string[] = [];

    const knownModels = new Set<string>();
    trainingData.forEach(t => knownModels.add(t.model));
    Object.keys(this.MODEL_VALID_POWERS).forEach(m => knownModels.add(m));
    const sortedModels = Array.from(knownModels).sort((a, b) => b.length - a.length);

    for (const knownModel of sortedModels) {
      if (this.fuzzyContains(cleanText, knownModel, 2)) {
        model = knownModel;
        reasoningParts.push(`Modelo Identificado: ${model}`);
        break;
      }
    }

    if (model) {
        const combinedRegex = new RegExp(`${model}[^0-9]{0,10}(\\d{2,3})`, 'i');
        const combinedMatch = cleanText.match(combinedRegex);
        if (combinedMatch && combinedMatch[1]) {
            const rawVal = parseInt(combinedMatch[1], 10);
            if (this.isValidPower(rawVal)) {
                const validSet = this.MODEL_VALID_POWERS[model];
                if (!validSet || validSet.includes(rawVal)) {
                    power = rawVal;
                    reasoningParts.push(`Padrão "Modelo + Valor" (${model} ${power})`);
                }
            }
        }
    }

    if (!power) {
        const explicitPowerRegex = /\b(\d{2,3})\s?(W|WATTS)\b/g;
        const explicitMatches = [...cleanText.matchAll(explicitPowerRegex)];
        const explicitPowers = explicitMatches.map(m => parseInt(m[1], 10)).filter(p => this.isValidPower(p));
        if (explicitPowers.length > 0) {
            power = Math.max(...explicitPowers);
            reasoningParts.push(`Potência Explícita: ${power}W`);
        }
    }

    if (!power) {
        const looseNumberRegex = /\b(\d{2,3})\b/g;
        const looseMatches = [...cleanText.matchAll(looseNumberRegex)];
        const potentialPowers = looseMatches.map(m => parseInt(m[1], 10)).filter(p => this.isValidPower(p));
        if (model && this.MODEL_VALID_POWERS[model]) {
            const validMatch = potentialPowers.find(p => this.MODEL_VALID_POWERS[model].includes(p));
            if (validMatch) {
                power = validMatch;
                reasoningParts.push(`Potência Tabela (${model}): ${power}W`);
            }
        }
    }
    
    let confidence = 0.2;
    if (model && power) confidence = 0.92;
    else if (model) confidence = 0.7;
    else if (power) confidence = 0.6;

    return {
      model,
      rawText: cleanText.substring(0, 80),
      calculatedPower: power,
      confidence,
      reasoning: reasoningParts.length > 0 ? reasoningParts.join(". ") : "Dados insuficientes",
      aiProvider: 'local_heuristic'
    };
  }

  private isValidPower(p: number): boolean {
    return p > 10 && p < 500 && ![110, 127, 220, 380, 2023, 2024, 2025].includes(p);
  }
}

// =============================================================================
// CLASSE 4: LUMINAIRE SERVICE (FACADE)
// =============================================================================
export class LuminaireService {
  private vision: VisionProcessor;
  private ocrDispatcher: OCRDispatcher;
  private knowledge: KnowledgeRepository;
  private ollamaConfig: OllamaConfig = { enabled: false, model: 'llava', host: 'http://localhost:11434' };

  constructor() {
    this.vision = new VisionProcessor();
    this.ocrDispatcher = OCRDispatcher.getInstance();
    this.knowledge = new KnowledgeRepository();
  }

  public setOllamaConfig(config: OllamaConfig) {
    this.ollamaConfig = config;
  }

  public async selectBestImage(files: File[]): Promise<File> {
    if (files.length === 0) throw new Error("Batch vazio");
    if (files.length === 1) return files[0];
    let bestFile = files[0];
    let maxScore = -1;
    for (const file of files) {
      const score = await this.vision.calculateImageScore(file);
      if (score > maxScore) {
        maxScore = score;
        bestFile = file;
      }
    }
    return bestFile;
  }

  public checkRetrospectiveMatch(item: DetectionResult, rule: TrainingExample): boolean {
    return this.knowledge.checkRetrospectiveMatch(item, rule);
  }

  public async analyze(base64Image: string, trainingData: TrainingExample[]): Promise<AnalysisResponse> {
    // 1. Visão Computacional
    const prep = await this.vision.preprocess(base64Image);
    
    // Se a validação heurística falhou FEIO, mas temos Ollama, damos uma chance para o Ollama
    // a menos que seja puramente "ruído de cena".
    if (!prep.validation.isValid && !this.ollamaConfig.enabled) {
        return {
            model: null,
            rawText: "",
            calculatedPower: null,
            confidence: 0,
            reasoning: `Ignorado: ${prep.validation.reason}`,
            features: prep.features,
            processedPreview: prep.processedPreview
        };
    }

    // 2. Busca Match Visual Exato (Cache)
    const { match: visualMatch, diff: visualDiff } = this.knowledge.findVisualMatch(prep.features, trainingData);
    if (visualMatch && visualDiff < 0.05) {
        return {
            model: visualMatch.model,
            rawText: "Duplicata Exata",
            calculatedPower: visualMatch.power,
            confidence: 1.0,
            reasoning: "Reconhecido na Memória Visual (Duplicata Exata).",
            features: prep.features,
            processedPreview: prep.processedPreview,
            aiProvider: 'user_corrected'
        };
    }

    // 3. OCR Tradicional (Heurístico)
    let heuristicResult: AnalysisResponse = {
        model: null, rawText: "", calculatedPower: null, confidence: 0, reasoning: "", aiProvider: 'local_heuristic'
    };
    
    try {
        const scheduler = await this.ocrDispatcher.getScheduler();
        let combinedText = "";
        const p1 = scheduler.addJob('recognize', prep.normalUrl).then((res: any) => combinedText += ` ${res.data.text}`);
        const p2 = scheduler.addJob('recognize', prep.invertedUrl).then((res: any) => combinedText += ` ${res.data.text}`);
        await Promise.all([p1, p2]);
        
        heuristicResult = this.knowledge.interpretText(combinedText, trainingData);
    } catch (e) {
        console.error("Erro OCR", e);
    }

    // 4. Inteligência Artificial (Ollama)
    // Usamos Ollama se:
    // a) Está ativado
    // b) O método heurístico não tem certeza absoluta (confiança < 0.9) OU o usuário quer validação sempre
    let ollamaResult: AnalysisResponse | null = null;
    
    if (this.ollamaConfig.enabled) {
        const ollamaService = new OllamaService(this.ollamaConfig.host, this.ollamaConfig.model);
        // Enviamos a imagem "fullResized" que tem mais contexto visual para a IA,
        // mas também passamos o texto que o OCR conseguiu ler para ajudar.
        ollamaResult = await ollamaService.analyzeImage(
            prep.fullResizedUrl.split(',')[1], // Base64 limpo
            heuristicResult.rawText,
            trainingData
        );
    }

    // 5. Consenso / Decisão Final
    let finalResult = heuristicResult;
    finalResult.features = prep.features;
    finalResult.processedPreview = prep.processedPreview;

    if (ollamaResult) {
        // Se Ollama identificou algo e a heurística não, usamos Ollama
        if (ollamaResult.model && !heuristicResult.model) {
            finalResult = { ...heuristicResult, ...ollamaResult };
            finalResult.confidence = 0.85; // Alta confiança na IA
        }
        // Se ambos identificaram, mas diferentes, IA ganha (geralmente mais esperta com contexto)
        else if (ollamaResult.model && heuristicResult.model && ollamaResult.model !== heuristicResult.model) {
             finalResult = { ...heuristicResult, ...ollamaResult };
             finalResult.reasoning = `IA (${this.ollamaConfig.model}) substituiu detecção heurística: ${ollamaResult.reasoning}`;
        }
        // Se heurística falhou em potência, usamos IA
        else if (!finalResult.calculatedPower && ollamaResult.calculatedPower) {
             finalResult.calculatedPower = ollamaResult.calculatedPower;
             finalResult.reasoning += ` | Potência via IA: ${ollamaResult.reasoning}`;
        }
    }

    // Se ainda assim estiver fraco, aplicamos a fusão visual antiga como último recurso
    if (finalResult.confidence < 0.8) {
        this.applyVisualFusion(finalResult, visualMatch, visualDiff);
    }

    return { ...finalResult, processedPreview: prep.processedPreview };
  }

  private applyVisualFusion(result: AnalysisResponse, match: TrainingExample | null, diff: number) {
    if (match && diff < 0.20) {
      const similarity = ((1 - diff) * 100).toFixed(0);
      if (!result.model) {
          result.model = match.model;
          result.confidence = Math.max(result.confidence, 0.75);
          result.reasoning += ` | Modelo sugerido por similaridade visual (${similarity}%).`;
      }
      if (!result.calculatedPower) {
          result.calculatedPower = match.power;
          result.reasoning += ` | Potência visual estimada.`;
      }
    }
  }
}