
import Tesseract from 'tesseract.js';
import { AnalysisResponse, TrainingExample, VisualFeatures, DetectionResult } from "../types";

// --- INTERFACES INTERNAS ---
interface PreprocessResult {
  normalUrl: string;
  invertedUrl: string;
  fullResizedUrl: string;
  features: VisualFeatures;
  processedPreview: string;
  validation: {
    isValid: boolean;
    reason: string;
  };
}

// =============================================================================
// CLASSE 1: VISION PROCESSOR
// Responsável por visão computacional, filtros e manipulação de pixels
// =============================================================================
class VisionProcessor {
  private static readonly DETECT_CONFIG = {
    MAX_WIDTH: 2000,
    // Aumentado drasticamente: O objeto deve ocupar pelo menos 4% da imagem para ser considerado um "Close-up" válido.
    // Isso evita pegar postes inteiros, ruas ou casas.
    MIN_BLOB_PERCENT: 0.04, 
    // Luminárias geralmente são horizontais. Se for muito vertical (> 2.5), é provável que seja um poste.
    MAX_VERTICAL_ASPECT: 2.5 
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
        
        // 1. Detecção Inteligente de Objeto (Filtra Céu e Chão)
        const detection = this.detectObjectBounds(fullImageData.data, width, height);
        
        // 2. Validação de "Cena Ampla" vs "Luminária"
        if (detection.isFallback || detection.isSceneNoise) {
            resolve({
                normalUrl: base64Image,
                invertedUrl: base64Image,
                fullResizedUrl: fullResizedUrl,
                features: { aspectRatio: 1, edgeDensity: 0, hue: 0, saturation: 0, brightness: 0 },
                processedPreview: fullResizedUrl,
                validation: { isValid: false, reason: detection.reason || "Objeto não identificado" }
            });
            return;
        }

        const features = this.extractVisualFeatures(ctx, width, height, detection);
        
        // 3. Validação de Formato (Evitar Postes Verticais)
        if (detection.h > detection.w * VisionProcessor.DETECT_CONFIG.MAX_VERTICAL_ASPECT) {
             resolve({
                normalUrl: base64Image,
                invertedUrl: base64Image,
                fullResizedUrl: fullResizedUrl,
                features,
                processedPreview: fullResizedUrl,
                validation: { isValid: false, reason: "Formato Inválido (Provável Poste/Vertical)" }
            });
            return;
        }

        const { normalUrl, invertedUrl, finalWidth } = this.cropAndUpscale(ctx, detection, width, height);

        // 4. Validação de Resolução Final (Distância)
        // Se após o crop a largura for muito pequena, não há pixels suficientes para ler texto.
        if (finalWidth < 250) {
             resolve({
                normalUrl,
                invertedUrl,
                fullResizedUrl,
                features,
                processedPreview: normalUrl,
                validation: { isValid: false, reason: "Muito Distante (Resolução Insuficiente)" }
            });
            return;
        }

        resolve({
          normalUrl,
          invertedUrl,
          fullResizedUrl,
          features,
          processedPreview: normalUrl,
          validation: { isValid: true, reason: "OK" }
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
          
          if(bounds.isFallback || bounds.isSceneNoise) {
            resolve(0); // Descarta imagens de cena ampla
            return;
          }

          const objectAreaRatio = (bounds.w * bounds.h) / (width * height);
          const features = this.extractVisualFeatures(ctx, width, height, bounds);
          
          // Pontua melhor: Imagens próximas (AreaRatio alto) e com bom contraste (EdgeDensity)
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
    
    // O objeto precisa ser significativo na imagem para não ser considerado "fundo"
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
          const maxLoop = 150000; // Limite de segurança

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

    // Filtros de Qualidade do BLOB
    const validBlobs = blobs.filter(b => {
      // 1. Filtro de Tamanho (Distância)
      if (b.area < (minPixelCount / (scanStep * scanStep))) return false;
      
      // 2. Filtro de Chão/Rua
      // Se o objeto toca a parte de baixo da imagem (últimos 5%), provavelmente é a rua ou o poste continuando.
      if (b.maxY > height * 0.98) return false;

      return true;
    });

    if (validBlobs.length === 0) {
      // Se não achou nada válido, ou tudo era céu, ou tudo era rua (tocando embaixo)
      // Ou tudo era muito pequeno (distante)
      return { 
          x: 0, y: 0, w: 0, h: 0,
          isFallback: true, 
          isSceneNoise: true,
          reason: "Cena Ampla / Apenas Fundo Detectado"
      };
    }

    // Ordena pelo maior objeto
    validBlobs.sort((a, b) => b.area - a.area);
    
    // Pega o maior objeto (assumimos que o usuário tentou centralizar a luminária)
    const best = validBlobs[0];
    
    // Padding para garantir que pegamos a etiqueta se estiver na borda do contraste
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

        if (Math.abs(lum - lumRight) > 20 || Math.abs(lum - lumDown) > 20) {
          edges++;
        }
        count++;
      }
    }

    const edgeDensity = count > 0 ? edges / count : 0;
    const aspectRatio = bounds.h > 0 ? bounds.w / bounds.h : 1;

    // Amostragem central
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
    
    // Lógica de Upscale baseada no tamanho relativo
    // Se for muito pequeno, aumentamos mais para tentar ajudar o OCR (embora milagres não ocorram)
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

    // Sharpening agressivo para letras
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

    // Binarization Adaptativa
    for (let i = 0; i < output.length; i += 4) {
      const gray = output[i] * 0.299 + output[i + 1] * 0.587 + output[i + 2] * 0.114;
      // Threshold ajustado para 160 para pegar letras desbotadas em fundo branco
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
    // Azul céu ou Branco estourado (nuvem/sol)
    const isBlueHue = (h > 170 && h < 270);
    
    // Céu azul
    if (isBlueHue && s > 0.15 && l > 0.3) return true;
    
    // Céu branco/cinza (muito claro e sem saturação)
    // Cuidado para não remover etiquetas brancas. Etiquetas geralmente tem texto (bordas)
    // Céu é liso. Mas aqui verificamos pixel a pixel.
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
    console.log(`[OCRDispatcher] Iniciando Pool com ${this.MAX_WORKERS} threads...`);
    
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
    'ORI': [50], 
    'IESNA': [20, 40, 65, 85],
    'HTC': [22, 30, 40, 50, 60, 70, 80, 100, 120],
    'SANLIGHT': [20, 30, 40, 50, 60, 100],
    'SCHREDER': [36, 38, 39, 51, 56, 60, 75, 80, 110, 125, 145, 155, 212, 236],
    'VOLTANA': [39, 56, 60, 75, 80, 110, 145, 212],
    'AKILA': [155, 236],
    'ISLA': [36, 51],
    'STYLAGE': [38],
    'RUBI': [60],
    'GL2': [125],
    'BRIGHTLUX': [40, 50, 65, 130, 150, 213, 230],
    'URBJET': [40, 65, 130, 150, 213, 230],
    'ORI-0504': [50],
    'ALPER': [35, 40, 60, 90, 100, 130, 200, 210],
    'IP BR': [40, 130, 200, 210],
    'LIPBR': [90, 130, 200],
    'ALP': [60],
    'LPT': [60],
    'BR II': [130],
    'REEME': [51, 65, 82, 130, 290],
    'LD-3P': [51, 65, 82, 130, 290],
    'LD-7P': [65],
    'LEDSTAR': [58, 61, 120, 200, 215],
    'UNICOBA': [58, 61, 120, 200, 215],
    'SL VITTA': [58, 120, 200, 215],
    'FLEX': [61],
    'PHILIPS': [58, 127],
    'BRP372': [127],
    'MICENAS': [58],
    'IBILUX': [120],
    'EVORA': [120],
    'ILUMATIC': [60, 100],
    'ARES': [60, 100],
    'ORION': [40, 55, 57, 58, 60, 100, 148, 150],
    'VEGA': [40, 55, 60],
    'CRONOS': [100],
    'NENA': [57],
    'ALUDAX': [60],
    'GOLDEN': [65, 75, 80],
    'SQUARE': [75, 80],
    'ARGOS': [30, 62, 120],
    'UNILUMIN': [35, 120],
    'LEDOLPHIN': [120],
    'OPERA': [35],
    'ARCOBRAS': [66, 120],
    'ECOLED': [120],
    'ECO-STB': [66],
    'EMPALUX': [100, 150],
    'TECNOWATT': [54, 60],
    'MERAK': [54],
    'BORA': [60],
    'FO5': [60],
    'SONERES': [54],
    'FOSTERI': [54],
    'BULBO': [35]
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
      if (rule.ocrSignature && item.rawText && item.rawText.includes(rule.ocrSignature)) {
          return true;
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

    // Detecção de Modelo
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

    // --- NOVA LÓGICA: Detecção Conjunta (Modelo + Potência) ---
    // Procura padrões como "URBJET 150W" ou "VOLTANA 80"
    if (model) {
        // Regex que busca o Modelo seguido de algo, seguido de número
        // Ex: "URBJET LED 150"
        const combinedRegex = new RegExp(`${model}[^0-9]{0,10}(\\d{2,3})`, 'i');
        const combinedMatch = cleanText.match(combinedRegex);
        
        if (combinedMatch && combinedMatch[1]) {
            const rawVal = parseInt(combinedMatch[1], 10);
            if (this.isValidPower(rawVal)) {
                // Valida na tabela
                const validSet = this.MODEL_VALID_POWERS[model];
                if (!validSet || validSet.includes(rawVal)) {
                    power = rawVal;
                    reasoningParts.push(`Padrão "Modelo + Valor" (${model} ${power})`);
                }
            }
        }
    }

    // Backup por Assinatura de Erro
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

    // Detecção de Potência Isolada (Se a conjunta falhou)
    if (!power) {
        // Busca explicita "150W", "80 WATTS"
        const explicitPowerRegex = /\b(\d{2,3})\s?(W|WATTS)\b/g;
        const explicitMatches = [...cleanText.matchAll(explicitPowerRegex)];
        const explicitPowers = explicitMatches.map(m => parseInt(m[1], 10));

        if (explicitPowers.length > 0) {
            const validExplicit = explicitPowers.filter(p => this.isValidPower(p));
            if (validExplicit.length > 0) {
                power = Math.max(...validExplicit);
                reasoningParts.push(`Potência Explícita: ${power}W`);
            }
        }
    }

    if (!power) {
        const looseNumberRegex = /\b(\d{2,3})\b/g;
        const looseMatches = [...cleanText.matchAll(looseNumberRegex)];
        const potentialPowers = looseMatches.map(m => parseInt(m[1], 10))
           .filter(p => this.isValidPower(p));

        if (model && this.MODEL_VALID_POWERS[model]) {
            const validSet = this.MODEL_VALID_POWERS[model];
            const validMatch = potentialPowers.find(p => validSet.includes(p));
            if (validMatch) {
                power = validMatch;
                reasoningParts.push(`Potência Tabela (${model}): ${power}W`);
            }
        } else if (potentialPowers.length > 0) {
             const commmonStreetLights = [30, 40, 50, 58, 60, 70, 80, 90, 100, 120, 150, 180, 200, 250];
             const bestGuess = potentialPowers.find(p => commmonStreetLights.includes(p));
             if (bestGuess) {
                power = bestGuess;
                reasoningParts.push(`Potência Comum: ${power}W (Incerto)`);
             }
        }
    }
    
    // Regra dos dígitos pequenos (06 -> 60W)
    if (!power) {
        const smallNumRegex = /\b0([1-9])\b/g;
        const smallMatch = smallNumRegex.exec(cleanText);
        if (smallMatch) {
            power = parseInt(smallMatch[1], 10) * 10;
            reasoningParts.push(`Regra Código (0${smallMatch[1]} -> ${power}W)`);
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
      reasoning: reasoningParts.length > 0 ? reasoningParts.join(". ") : "Dados insuficientes"
    };
  }

  private isValidPower(p: number): boolean {
    // Filtra valores que parecem voltagem ou anos
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

  constructor() {
    this.vision = new VisionProcessor();
    this.ocrDispatcher = OCRDispatcher.getInstance();
    this.knowledge = new KnowledgeRepository();
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

  public async analyze(base64Image: string, trainingData: TrainingExample[]): Promise<AnalysisResponse & { processedPreview?: string }> {
    // 1. Visão Computacional (Pré-processamento e Validação)
    const prep = await this.vision.preprocess(base64Image);

    // CRITICAL: Se a visão computacional rejeitar (cena ampla ou muito longe), retorna erro imediatamente.
    if (!prep.validation.isValid) {
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

    // 2. Busca na Memória Visual (Match Imediato)
    const { match: visualMatch, diff: visualDiff } = this.knowledge.findVisualMatch(prep.features, trainingData);
    const isExactDuplicate = visualMatch && visualDiff < 0.05;

    if (isExactDuplicate && visualMatch) {
        return {
            model: visualMatch.model,
            rawText: "Duplicata Exata",
            calculatedPower: visualMatch.power,
            confidence: 1.0,
            reasoning: "Reconhecido na Memória Visual (Duplicata Exata).",
            features: prep.features,
            processedPreview: prep.processedPreview
        };
    }

    // 3. OCR via Pool de Threads
    let combinedText = "";
    let localResult: AnalysisResponse;

    try {
      const scheduler = await this.ocrDispatcher.getScheduler();
      
      const p1 = scheduler.addJob('recognize', prep.normalUrl)
          .then((res: any) => { combinedText += ` ${res.data.text}`; });
      
      const p2 = scheduler.addJob('recognize', prep.invertedUrl)
          .then((res: any) => { combinedText += ` ${res.data.text}`; });

      await Promise.all([p1, p2]);

      // Fallback para imagem completa apenas se o texto for curto (mas não se for cena ampla)
      if (combinedText.length < 10 || !combinedText.match(/\d/)) {
          const resFull = await scheduler.addJob('recognize', prep.fullResizedUrl);
          combinedText += ` \n ${(resFull as any).data.text}`;
      }

      // 4. Interpretação via Knowledge Base
      localResult = this.knowledge.interpretText(combinedText, trainingData);
      localResult.features = prep.features;
      localResult.reasoning = "OCR: " + localResult.reasoning;

      // 5. Fusão Lógica (OCR + Visual Similar)
      this.applyVisualFusion(localResult, visualMatch, visualDiff);

    } catch (error) {
      console.error("OCR Falhou", error);
      localResult = {
        model: null, rawText: "Erro OCR", calculatedPower: null, confidence: 0, reasoning: "Falha processamento"
      };
      if (visualMatch && visualDiff < 0.20) {
          localResult.model = visualMatch.model;
          localResult.calculatedPower = visualMatch.power;
          localResult.confidence = 0.5;
          localResult.reasoning = "OCR Falhou. Sugestão visual.";
      }
    }

    return { ...localResult, processedPreview: prep.processedPreview };
  }

  private applyVisualFusion(result: AnalysisResponse, match: TrainingExample | null, diff: number) {
    if (match && diff < 0.20) {
      const similarity = ((1 - diff) * 100).toFixed(0);
      
      if (result.model && result.calculatedPower) {
          if (result.model === match.model) {
              result.confidence = Math.max(result.confidence, 0.98);
              result.reasoning += ` | Confirmado visualmente (${similarity}%).`;
          }
      }
      
      if (!result.model) {
          result.model = match.model;
          result.confidence = Math.max(result.confidence, 0.75);
          result.reasoning += ` | Modelo sugerido por similaridade visual (${similarity}%).`;
      }

      if (result.model && !result.calculatedPower) {
          if (result.model === match.model || !result.model) {
              result.calculatedPower = match.power;
              result.confidence = Math.max(result.confidence, 0.85);
              result.reasoning += ` | Potência estimada por padrão visual similar (${similarity}%).`;
          }
      }

      if (!result.model && !result.calculatedPower) {
          result.model = match.model;
          result.calculatedPower = match.power;
          result.confidence = 0.65; 
          result.reasoning = `Estimativa baseada puramente em similaridade visual (${similarity}%). Verificar etiqueta.`;
      }
    }
  }
}
