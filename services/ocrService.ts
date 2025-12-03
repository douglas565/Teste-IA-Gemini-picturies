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

const DETECT_CONFIG = {
  CANNY_THRESHOLD_1: 30,
  CANNY_THRESHOLD_2: 100,
  SCALE_FACTOR: 2.0 
};

/**
 * Processamento de imagem focado em preservar o texto
 * Usa ajuste de histograma simulado em vez de binarização destrutiva
 */
const enhanceImage = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Ajuste de contraste linear
  const contrast = 50; // Aumenta contraste
  const factor = (255 + contrast) / (255 * (255 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    // 1. Grayscale
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

    // 2. Contraste
    let newValue = factor * (gray - 128) + 128;
    
    // 3. Threshold suave (preserva bordas finas)
    // Valores muito claros viram branco puro para limpar fundo
    // Valores escuros são preservados
    if (newValue > 180) newValue = 255;
    else if (newValue < 80) newValue = 0; // Texto preto forte
    // Entre 80 e 180 mantém o tom de cinza para antialiasing do texto

    data[i] = newValue;
    data[i + 1] = newValue;
    data[i + 2] = newValue;
  }

  ctx.putImageData(imageData, 0, 0);
};

const preprocessImage = async (base64Image: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(base64Image); return; }

      canvas.width = img.width * DETECT_CONFIG.SCALE_FACTOR;
      canvas.height = img.height * DETECT_CONFIG.SCALE_FACTOR;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      enhanceImage(ctx, canvas.width, canvas.height);

      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => resolve(base64Image);
    img.src = `data:image/jpeg;base64,${base64Image}`;
  });
};

export const analyzeLuminaireImage = async (
  base64Image: string,
  trainingData: TrainingExample[]
): Promise<AnalysisResponse> => {
  let worker;
  try {
    const processedImage = await preprocessImage(base64Image);

    worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /',
      tessedit_pageseg_mode: '6' as any, // 6 = Bloco de texto uniforme
    });

    const ret = await worker.recognize(processedImage);
    const text = ret.data.text;
    const confidence = ret.data.confidence / 100;
    await worker.terminate();

    return processExtractedText(text, confidence, trainingData);

  } catch (error) {
    return {
      model: null,
      rawText: "Erro de Leitura",
      calculatedPower: null,
      confidence: 0,
      reasoning: "Falha OCR"
    };
  }
};

const processExtractedText = (text: string, ocrConfidence: number, trainingData: TrainingExample[]): AnalysisResponse => {
  const cleanText = text.toUpperCase()
    .replace(/[^A-Z0-9\-\. \/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  let model: string | null = null;
  let power: number | null = null;
  let reasoningParts: string[] = [`Leitura: "${cleanText}"`];

  // --- 1. APRENDIZADO POR ASSINATURA (Inteligente) ---
  // Verifica se esse exato texto "errado" já foi corrigido antes
  for (const example of trainingData) {
    if (example.ocrSignature && cleanText.includes(example.ocrSignature)) {
      model = example.model;
      power = example.power;
      reasoningParts.push(`Identificado por memória de aprendizado (Assinatura: ${example.ocrSignature})`);
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

  // --- 3. EXTRAÇÃO DE POTÊNCIA (Com regra 06->60 PRIORITÁRIA) ---
  const numbers = cleanText.match(/\b\d+\b/g);
  
  if (numbers) {
    // Filtra números irrelevantes primeiro
    const validNumbers = numbers.filter(n => {
      const val = parseInt(n, 10);
      // Ignora voltagens e anos comuns
      if ([110, 127, 220, 230, 240, 380, 2023, 2024, 2025].includes(val)) return false;
      return true;
    });

    for (const numStr of validNumbers) {
      const val = parseInt(numStr, 10);
      let potentialPower = val;
      
      // REGRA DE CONVERSÃO OBRIGATÓRIA (01-09 -> x10)
      let converted = false;
      if (val >= 1 && val <= 9) {
        potentialPower = val * 10;
        converted = true;
      }

      // Se temos um modelo, VALIDAR ESTRITAMENTE
      if (model && MODEL_VALID_POWERS[model]) {
        if (MODEL_VALID_POWERS[model].includes(potentialPower)) {
          power = potentialPower;
          reasoningParts.push(`Potência ${power}W confirmada na tabela ${model} ${converted ? '(convertida de '+val+')' : ''}`);
          break;
        }
      } 
      // Se não temos modelo, ou o número não bateu com a tabela, 
      // mas parece muito ser uma potência (ex: 60, 100), guardamos como backup
      else if (!power && potentialPower >= 10 && potentialPower <= 500) {
        power = potentialPower; 
      }
    }
  }

  // Fallback: Se achou modelo Pallas mas não achou potência, tenta achar "06" ou "08" de novo
  if (model === 'PALLAS' && !power) {
     if (cleanText.includes(' 06 ') || cleanText.endsWith(' 06')) power = 60;
     if (cleanText.includes(' 08 ') || cleanText.endsWith(' 08')) power = 80;
  }

  return {
    model: model,
    rawText: cleanText,
    calculatedPower: power,
    confidence: (model && power) ? 0.9 : (model ? 0.6 : 0.3),
    reasoning: reasoningParts.join(". ") || "Não identificado."
  };
};