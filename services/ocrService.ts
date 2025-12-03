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
  // Adicionando alguns genéricos baseados nas variações para segurança
  'BRIGHTLUX': [20, 30, 40, 50, 60, 100], 
  'SANLIGHT': [20, 30, 40, 50, 60, 100]
};

// Variações de nome de modelos para normalização
// Regex do lado esquerdo (string format) -> Nome Canônico do lado direito
const MODEL_VARIATIONS: Record<string, string> = {
  'KING SUN': 'KINGSUN',
  'KINGSUN': 'KINGSUN',
  'BRIGHT LUX': 'BRIGHTLUX',
  'BRIGHTLUX': 'BRIGHTLUX',
  'SAN LIGHT': 'SANLIGHT',
  'SANLIGHT': 'SANLIGHT',
  'H B M I': 'HBMI',
  'HBMI': 'HBMI',
  'H.T.C': 'HTC',
  'HTC': 'HTC',
  'PALLAS': 'PALLAS',
  'IESNA': 'IESNA',
  'ORI': 'ORI'
};

// Pré-processamento de imagem
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
      const scale = 2.5;
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Conversão para Preto e Branco com alto contraste
      for (let i = 0; i < data.length; i += 4) {
        // Média ponderada para escala de cinza
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        
        // Binarização agressiva para destacar texto preto em fundo branco/cinza
        const finalColor = gray > 150 ? 255 : 0; 

        data[i] = finalColor;     
        data[i + 1] = finalColor; 
        data[i + 2] = finalColor; 
      }

      ctx.putImageData(imageData, 0, 0);
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

    // Cria o worker
    worker = await Tesseract.createWorker('eng');
    
    // Configura parâmetros:
    // tessedit_char_whitelist: Restringe os caracteres para evitar lixo (ex: ~ç^`)
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-. /W', 
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
  // Limpeza: Upper case e remove caracteres especiais estranhos, mantendo letras, números, pontos e hífens
  const cleanText = text.toUpperCase().replace(/[^A-Z0-9\-\. \/]/g, ' ').replace(/\s+/g, ' ').trim();
  
  let model: string | null = null;
  let power: number | null = null;
  let reasoningParts: string[] = [];

  reasoningParts.push(`Texto bruto: "${cleanText.substring(0, 40)}..."`);

  // --- 1. MEMÓRIA: Verificar Base de Treinamento (Prioridade Máxima) ---
  for (const example of trainingData) {
    if (cleanText.includes(example.model.toUpperCase())) {
      model = example.model;
      // Se achou o modelo na memória, tenta achar a potência correspondente ou usa a treinada
      // Mas a prioridade é re-validar a potência na imagem atual se possível
      const numbersInText = cleanText.match(/\b\d+\b/g);
      if (numbersInText && numbersInText.includes(example.power.toString())) {
         power = example.power;
         reasoningParts.push(`Modelo '${model}' reconhecido da memória e potência ${power}W confirmada na imagem.`);
      } else {
         power = example.power;
         reasoningParts.push(`Reconhecido por similaridade com treinamento (Modelo: ${model}, ${power}W)`);
      }
      
      return {
        model,
        rawText: cleanText,
        calculatedPower: power,
        confidence: 0.98,
        reasoning: reasoningParts.join(". ")
      };
    }
  }

  // --- 2. MODELO: Identificação via Padrões (Regex Específico do Python) ---
  if (!model) {
    // Regex para capturar as variações definidas no Python
    const modelPatterns = [
      /PALLAS/i,
      /KING\s?SUN/i,
      /BRIGHT\s?LUX/i,
      /SAN\s?LIGHT/i,
      /H\s?B\s?M\s?I/i,
      /H\.?T\.?C/i, // Pega HTC ou H.T.C
      /IESNA/i,
      /ORI\b/i // \b para evitar pegar palavras como ORIGIN
    ];

    for (const pattern of modelPatterns) {
      const match = cleanText.match(pattern);
      if (match) {
        let rawFound = match[0].replace(/[\s\.]/g, ''); // Remove espaços e pontos para normalizar
        
        // Verifica no dicionário de variações
        // Precisamos iterar chaves do MODEL_VARIATIONS porque a chave pode ter espaço "KING SUN"
        for (const [key, normalizedName] of Object.entries(MODEL_VARIATIONS)) {
           // Remove espaços da chave para comparar com o rawFound limpo
           if (key.replace(/[\s\.]/g, '') === rawFound) {
             model = normalizedName;
             break;
           }
        }
        
        // Fallback se não achou no loop (ex: PALLAS direto)
        if (!model) model = rawFound;

        reasoningParts.push(`Modelo detectado: ${model}`);
        break;
      }
    }
  }

  // --- 3. POTÊNCIA: Validação Cruzada (Modelo + Lista de Potências Válidas) ---
  if (model && MODEL_VALID_POWERS[model]) {
    const validWattages = MODEL_VALID_POWERS[model];
    
    // Procura por números no texto que estejam na lista de potências válidas desse modelo
    const numbers = cleanText.match(/\b\d+\b/g);
    
    if (numbers) {
      for (const numStr of numbers) {
        const val = parseInt(numStr, 10);
        
        // Regra de Ouro: Se o número está na lista de potências válidas do modelo detectado
        if (validWattages.includes(val)) {
          power = val;
          reasoningParts.push(`Potência ${val}W validada na lista do fabricante para ${model}`);
          break; // Encontrou match perfeito, para de procurar
        }
      }
    }
  }

  // --- 4. POTÊNCIA: Fallback (Regras Gerais 06->60, 75->75) ---
  // Se ainda não temos potência (ou porque não achamos modelo, ou porque o número não estava na lista)
  if (power === null) {
    
    // 4a. Busca Explícita por "W" (Watts)
    const explicitWattRegex = /(\d+[\.,]?\d*)\s?W\b/i;
    const wattMatch = cleanText.match(explicitWattRegex);
    
    if (wattMatch) {
      const val = parseFloat(wattMatch[1].replace(',', '.'));
      if (val > 0 && val < 1000) { 
        power = val;
        reasoningParts.push(`Valor explícito "W" encontrado: ${power}W`);
      }
    }

    // 4b. Regras de Inferência (apenas se não achou W explícito)
    if (power === null) {
      const numbers = cleanText.match(/\b\d+\b/g); 
      if (numbers) {
        for (const numStr of numbers) {
          const val = parseInt(numStr, 10);
          
          // Filtros de contexto (ignora V, HZ, Anos)
          const contextRegex = new RegExp(`${numStr}\\s?(V|HZ|K|LM|MM|VAC|ANO|YEAR)`, 'i');
          if (contextRegex.test(cleanText)) continue;

          // Regra da Etiqueta: 01-09 -> x10
          if (val >= 1 && val <= 9) {
            // Verifica se tem zero à esquerda na string original (ex: "06") ou se é apenas um dígito solto
            // A regra diz "06 = 60W". Geralmente OCR lê "06" como "6" ou "06".
            power = val * 10;
            reasoningParts.push(`Regra etiqueta (01-09): '${numStr}' conv. para ${power}W`);
            break; 
          }

          // Regra da Etiqueta: >= 10 -> Direto
          if (val >= 10 && val <= 500) {
            // Filtros de segurança extras
            if ([110, 127, 220, 230, 240, 380].includes(val)) continue; // Tensões comuns
            if (val >= 1990 && val <= 2030) continue; // Anos
            
            power = val;
            reasoningParts.push(`Regra etiqueta (>=10): '${val}' assumido como W`);
            break;
          }
        }
      }
    }
  }

  // Confiança final
  let finalConfidence = ocrConfidence;
  if (model) finalConfidence += 0.2;
  if (power) finalConfidence += 0.2;
  
  // Se achou modelo E potência válida da lista, confiança é quase total
  if (model && power && MODEL_VALID_POWERS[model]?.includes(power)) {
    finalConfidence = 0.95;
  }

  return {
    model: model,
    rawText: cleanText,
    calculatedPower: power,
    confidence: Math.min(finalConfidence, 1.0),
    reasoning: reasoningParts.join(". ") || "Não foi possível identificar dados."
  };
};
