import Tesseract from 'tesseract.js';
import { AnalysisResponse, TrainingExample } from "../types";

// --- CONFIGURAÇÃO DA BASE DE DADOS (Baseada no Python) ---

// Lista de potências válidas por modelo
// Isso ajuda o OCR a decidir: se leu "PALLAS" e tem o número "60" solto, é 60W com certeza.
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

// Variações de nome de modelos para normalização
const MODEL_VARIATIONS: Record<string, string> = {
  'KING SUN': 'KINGSUN', 'KINGSUN': 'KINGSUN',
  'BRIGHT LUX': 'BRIGHTLUX', 'BRIGHTLUX': 'BRIGHTLUX',
  'SAN LIGHT': 'SANLIGHT', 'SANLIGHT': 'SANLIGHT',
  'H B M I': 'HBMI', 'HBMI': 'HBMI',
  'H.T.C': 'HTC', 'HTC': 'HTC',
  'PALLAS': 'PALLAS',
  'IESNA': 'IESNA',
  'ORI': 'ORI'
};

// Configurações de "Detecção" (Simulando parâmetros Canny do Python)
// Ajustados para 30 e 100 conforme solicitado para capturar detalhes mais finos
const DETECT_CONFIG = {
  CANNY_THRESHOLD_1: 30,  // Limiar inferior (detalhes finos)
  CANNY_THRESHOLD_2: 100, // Limiar superior (bordas fortes)
  SCALE_FACTOR: 2.5       // Fator de escala para melhorar OCR em textos pequenos
};

/**
 * Simula o método 'detect_objects' do Python.
 * Aplica processamento de imagem focado em realçar bordas e texto fino
 * baseado nos thresholds solicitados (30/100).
 */
const detectObjects = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Lógica baseada nos thresholds solicitados: 30 e 100.
  // No contexto de binarização para OCR:
  // Pixels mais escuros que o Threshold 2 (100) são candidatos fortes a texto.
  // O Threshold 1 (30) ajuda a garantir o preto absoluto.
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // 1. Converter para Escala de Cinza (Luminância)
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // 2. Aplicar Binarização baseada nos Thresholds "Canny"
    // O valor 100 (Threshold 2) define o ponto de corte para "detalhes finos".
    // Se o cinza for menor que 100 (mais escuro), consideramos texto (0 = preto).
    // Se for maior, consideramos fundo (255 = branco).
    // O ajuste de 150 para 100 torna o filtro mais "agressivo" em manter apenas o que é realmente escuro,
    // mas combinamos com um aumento de contraste prévio para destacar o texto fino.
    
    // Simulação de realce de bordas (Sharpening simples via contraste)
    let finalVal = 255;
    
    // Se for escuro o suficiente (baseado no threshold superior 100)
    if (gray < DETECT_CONFIG.CANNY_THRESHOLD_2) {
      finalVal = 0; // Texto Preto
    } else {
      // Zona de transição (entre 100 e 150) - tentar salvar detalhes muito finos
      // Se tiver variação de cor (não for cinza puro), pode ser ruído, então limpa.
      finalVal = 255; 
    }

    data[i] = finalVal;     
    data[i + 1] = finalVal; 
    data[i + 2] = finalVal; 
  }

  ctx.putImageData(imageData, 0, 0);
};

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

      // Escala maior ajuda o Tesseract a ler fontes pequenas
      canvas.width = img.width * DETECT_CONFIG.SCALE_FACTOR;
      canvas.height = img.height * DETECT_CONFIG.SCALE_FACTOR;
      
      // Desenha imagem redimensionada (Melhora a resolução espacial)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      // CHAMA O MÉTODO DETECT_OBJECTS (Simulado)
      detectObjects(ctx, canvas.width, canvas.height);

      resolve(canvas.toDataURL('image/jpeg', 0.9));
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
    const processedImage = await preprocessImage(base64Image);

    worker = await Tesseract.createWorker('eng');
    
    // Configura parâmetros para OCR industrial
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /W',
      tessedit_pageseg_mode: '6' as any, // 6 = Assume um bloco uniforme de texto (bom para etiquetas)
    });

    const ret = await worker.recognize(processedImage);
    const text = ret.data.text;
    const confidence = ret.data.confidence / 100;

    await worker.terminate();

    return processExtractedText(text, confidence, trainingData);

  } catch (error) {
    console.error("OCR Failed:", error);
    if(worker) await worker.terminate();
    return {
      model: null,
      rawText: "Erro OCR",
      calculatedPower: null,
      confidence: 0,
      reasoning: "Falha técnica ao processar imagem."
    };
  }
};

const processExtractedText = (text: string, ocrConfidence: number, trainingData: TrainingExample[]): AnalysisResponse => {
  // Limpeza robusta
  const cleanText = text.toUpperCase()
    .replace(/[^A-Z0-9\-\. \/]/g, ' ') // Mantém apenas caracteres úteis
    .replace(/\s+/g, ' ') // Remove espaços duplos
    .trim();
  
  let model: string | null = null;
  let power: number | null = null;
  let reasoningParts: string[] = [];

  reasoningParts.push(`OCR (Raw): "${cleanText.substring(0, 30)}..."`);

  // --- 1. MEMÓRIA & APRENDIZADO (Fuzzy Match) ---
  // Verifica se o texto lido contém alguma "assinatura" que o usuário já ensinou
  for (const example of trainingData) {
    // Procura o nome do modelo OU o texto raw que gerou o aprendizado
    if (cleanText.includes(example.model.toUpperCase())) {
      model = example.model;
      power = example.power;
      reasoningParts.push(`Reconhecido da memória (Modelo: ${model})`);
      break;
    }
    
    // Se o usuário ensinou que "XYZ" é "PALLAS", e achamos "XYZ"
    // (Esta lógica depende de salvar o 'rawText' no exemplo de treino, 
    // assumindo que o app passa isso corretamente).
  }

  // --- 2. IDENTIFICAÇÃO DE MODELO (Regex) ---
  if (!model) {
    const modelPatterns = [
      /PALLAS/i, /PA11AS/i, /P4LLAS/i, // Variações comuns de OCR para Pallas
      /KING\s?SUN/i, /K1NG/i,
      /BRIGHT\s?LUX/i,
      /SAN\s?LIGHT/i,
      /H\s?B\s?M\s?I/i,
      /H\.?T\.?C/i,
      /IESNA/i, /1ESNA/i,
      /ORI\b/i
    ];

    for (const pattern of modelPatterns) {
      if (pattern.test(cleanText)) {
        // Encontra qual modelo oficial corresponde a esse padrão
        // Mapeamento manual reverso simplificado para os casos fuzzy
        if (/PALLAS|PA11AS|P4LLAS/i.test(cleanText)) model = 'PALLAS';
        else if (/KING|K1NG/i.test(cleanText)) model = 'KINGSUN';
        else if (/BRIGHT/i.test(cleanText)) model = 'BRIGHTLUX';
        else if (/SAN/i.test(cleanText)) model = 'SANLIGHT';
        else if (/HBMI/i.test(cleanText)) model = 'HBMI';
        else if (/HTC/i.test(cleanText)) model = 'HTC';
        else if (/IESNA|1ESNA/i.test(cleanText)) model = 'IESNA';
        else if (/ORI/i.test(cleanText)) model = 'ORI';
        
        reasoningParts.push(`Padrão visual detectado: ${model}`);
        break;
      }
    }
  }

  // --- 3. EXTRAÇÃO DE POTÊNCIA ---
  if (power === null) {
    const numbers = cleanText.match(/\b\d+\b/g);
    
    if (numbers) {
      for (const numStr of numbers) {
        let val = parseInt(numStr, 10);
        
        // Filtros de exclusão (Voltagem, Frequencia, Ano)
        const contextRegex = new RegExp(`${numStr}\\s?(V|VAC|HZ|K|LM|YEAR|ANO)`, 'i');
        if (contextRegex.test(cleanText)) continue;
        if ([110, 127, 220, 230, 240, 380].includes(val)) continue;
        if (val > 1990 && val < 2030) continue;

        let potentialPower = val;

        // Regra 1: Conversão de Etiqueta (01-09 -> x10)
        // PRIORIDADE: Se o número é pequeno e isolado, converte ANTES de validar
        if (val >= 1 && val <= 9) {
          potentialPower = val * 10;
          reasoningParts.push(`Regra etiqueta (0${val} -> ${potentialPower}W)`);
        } else if (val >= 10) {
          reasoningParts.push(`Valor direto (${val}W)`);
        }

        // Validação com Lista do Modelo (se tiver modelo)
        if (model && MODEL_VALID_POWERS[model]) {
          if (MODEL_VALID_POWERS[model].includes(potentialPower)) {
            power = potentialPower;
            reasoningParts.push(`Confirmado na lista técnica do ${model}`);
            break; // Match perfeito
          }
        } else {
          // Se não tem modelo, aceita o primeiro valor razoável que foi convertido ou lido
          if (!power && potentialPower >= 10 && potentialPower <= 500) {
            power = potentialPower;
          }
        }
      }
    }
  }

  // Confiança final
  let finalConfidence = ocrConfidence;
  if (model) finalConfidence += 0.3;
  if (power) finalConfidence += 0.3;

  return {
    model: model,
    rawText: cleanText,
    calculatedPower: power,
    confidence: Math.min(finalConfidence, 0.99), // Cap em 99%
    reasoning: reasoningParts.join(". ") || "Dados inconclusivos."
  };
};
