import Tesseract from 'tesseract.js';
import { AnalysisResponse, TrainingExample } from "../types";

// Tabela de referência modelo -> potência (Baseada no script Python)
const MODEL_POWER_REFERENCE: Record<string, number> = {
  'LUXA200': 24,
  'LUXA150': 18,
  'LUXA100': 12,
  'LUXB300': 36,
  'LUXB250': 30,
  'LUXB200': 24,
  'LUXC150': 18,
  'LUXC100': 12,
  'PHILIPS-T8': 18,
  'PHILIPS-LED': 24,
  'OSRAM-LED': 24,
  'GE-BASIC': 16,
  'INTRAL': 18,
  'LUMINUS': 24
};

// Variações de nome de modelos para normalização
const MODEL_VARIATIONS: Record<string, string> = {
  'LUX200': 'LUXA200', 'LUXA-200': 'LUXA200', 'LUX 200': 'LUXA200',
  'LUX150': 'LUXA150', 'LUXA-150': 'LUXA150', 'LUX 150': 'LUXA150',
  'PHILIPS T8': 'PHILIPS-T8', 'PHILIPST8': 'PHILIPS-T8',
  'OSRAM LED': 'OSRAM-LED', 'OSRAMLED': 'OSRAM-LED',
};

// Pré-processamento de imagem (simples, via Canvas) para melhorar OCR
const preprocessImage = async (base64Image: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64Image);
        return;
      }

      // Aumentar um pouco a resolução para ajudar OCR em textos pequenos
      const scale = 1.5;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Converter para Escala de Cinza e Binarização (Threshold)
      // Algoritmo simples para simular o preprocessamento do OpenCV
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        // Threshold simples
        const color = avg > 120 ? 255 : 0; 
        data[i] = color;     // R
        data[i + 1] = color; // G
        data[i + 2] = color; // B
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg'));
    };
    img.onerror = reject;
    img.src = `data:image/jpeg;base64,${base64Image}`;
  });
};

export const analyzeLuminaireImage = async (
  base64Image: string,
  trainingData: TrainingExample[]
): Promise<AnalysisResponse> => {
  let worker;
  try {
    // 1. Pré-processar a imagem
    const processedImage = await preprocessImage(base64Image);

    // 2. Inicializar Worker do Tesseract
    // IMPORTANTE: Usando o objeto default exportado para evitar erro de 'named export'
    worker = await Tesseract.createWorker('eng'); 
    
    // 3. Reconhecer texto
    const ret = await worker.recognize(processedImage);
    const text = ret.data.text;
    const confidence = ret.data.confidence / 100;

    await worker.terminate();

    // 4. Analisar o texto extraído
    return processExtractedText(text, confidence, trainingData);

  } catch (error) {
    console.error("OCR Failed:", error);
    if(worker) await worker.terminate();
    return {
      model: null,
      rawText: "",
      calculatedPower: null,
      confidence: 0,
      reasoning: "Falha ao processar imagem localmente."
    };
  }
};

const processExtractedText = (text: string, ocrConfidence: number, trainingData: TrainingExample[]): AnalysisResponse => {
  const cleanText = text.toUpperCase().replace(/\s+/g, ' ');
  let model: string | null = null;
  let power: number | null = null;
  let reasoningParts: string[] = [];

  // --- 1. Identificar Modelo ---
  // Primeiro, verifica "Training Data" (aprendizado do usuário)
  for (const example of trainingData) {
    if (cleanText.includes(example.model.toUpperCase())) {
      model = example.model;
      power = example.power; // Se reconhecer modelo treinado, assume a potência dele
      reasoningParts.push(`Reconhecido da base de conhecimento (Modelo: ${model})`);
      break;
    }
  }

  // Se não achou na base, tenta Regex de Modelos (do script Python)
  if (!model) {
    const modelPatterns = [
      /LUXA?\d+/, /LUXB?\d+/, /LUXC?\d+/,
      /PHILIPS[- ]?T\d+/, /PHILIPS[- ]?LED/,
      /OSRAM[- ]?LED/, /GE[- ]?BASIC/, /INTRAL/, /LUMINUS/
    ];

    for (const pattern of modelPatterns) {
      const match = cleanText.match(pattern);
      if (match) {
        let rawModel = match[0].replace(' ', '-');
        // Normalizar
        if (MODEL_VARIATIONS[rawModel]) rawModel = MODEL_VARIATIONS[rawModel];
        model = rawModel;
        reasoningParts.push(`Modelo detectado: ${model}`);
        
        // Se temos o modelo na tabela fixa, pegamos a potência
        if (MODEL_POWER_REFERENCE[model] && power === null) {
          power = MODEL_POWER_REFERENCE[model];
          reasoningParts.push(`Potência obtida da tabela de referência para ${model}`);
        }
        break;
      }
    }
  }

  // --- 2. Identificar Potência (Regra de Conversão) ---
  if (power === null) {
    // Regex Patterns
    const powerPatterns = [
      /(\d+\.?\d*)\s*KW/i,              // Ex: 1.5kW
      /(\d+\.?\d*)\s*W(ATTS?)?/i,       // Ex: 24W
      /(\d+)\s*[-/]\s*(\d+)\s*W/i,      // Ex: 18-24W
      // Padrão crítico: Número isolado (01-09 ou 10+)
      /\b(0[1-9]|[1-9]\d{0,2})\b/       // Números de 01 a 999 isolados
    ];

    // Procura explícita por Watts primeiro (mais confiável)
    let explicitWattsMatch = cleanText.match(/(\d+\.?\d*)\s*W/);
    if (explicitWattsMatch) {
       power = parseFloat(explicitWattsMatch[1]);
       reasoningParts.push(`Valor explícito encontrado: ${power}W`);
    } else {
       // Procura números isolados para aplicar a regra
       // Tokeniza o texto e procura números candidatos
       const tokens = cleanText.split(/[^0-9.]+/);
       const candidates = tokens.filter(t => t.length > 0 && !isNaN(parseFloat(t))).map(parseFloat);

       for (const val of candidates) {
          // Regra: 01 a 09 -> multiplica por 10
          // No OCR, "06" pode virar apenas "6" ou "06". 
          // Vamos assumir que se for < 10 e estivermos procurando potência, aplica-se a regra.
          
          if (val > 0 && val < 10) {
             const converted = val * 10;
             power = converted;
             reasoningParts.push(`Regra (01-09): Valor ${val} convertido para ${converted}W`);
             break; 
          } else if (val >= 10 && val <= 500) {
             // Regra: 10 em diante -> valor direto
             // Filtramos <= 500 para evitar pegar números de série ou anos (ex: 2024)
             power = val;
             reasoningParts.push(`Regra (>=10): Valor ${val} usado diretamente`);
             break;
          }
       }
    }
  }

  // Recalcular confiança baseada no sucesso da extração
  let finalConfidence = ocrConfidence;
  if (model && power) finalConfidence = Math.max(finalConfidence, 0.85);
  else if (model || power) finalConfidence = Math.max(finalConfidence, 0.5);
  else finalConfidence = Math.min(finalConfidence, 0.3);

  return {
    model: model,
    rawText: text.substring(0, 100) + "...", // Snippet
    calculatedPower: power,
    confidence: finalConfidence,
    reasoning: reasoningParts.length > 0 ? reasoningParts.join(". ") : "Texto ilegível ou sem padrões conhecidos."
  };
};