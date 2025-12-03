import React, { useState, useRef, useEffect } from 'react';
import { analyzeLuminaireImage } from './services/ocrService';
import { DetectionResult, TrainingExample } from './types';
import ResultCard from './components/ResultCard';
import CorrectionModal from './components/CorrectionModal';

// --- DADOS DO CATÁLOGO DE REFERÊNCIA (PDF) ---
const CATALOG_DATA = [
  // VIÁRIAS
  { 
    model: 'SCHRÉDER VOLTANA', 
    powers: [39, 56, 60, 75, 80, 110, 145, 212], 
    color: 'bg-blue-800',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">SCH</div>
  },
  { 
    model: 'SCHRÉDER AKILA', 
    powers: [155, 236], 
    color: 'bg-blue-800',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">AKL</div>
  },
  { 
    model: 'BRIGHTLUX URBJET', 
    powers: [40, 65, 130, 150, 213, 230], 
    color: 'bg-cyan-700',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">BRT</div>
  },
  { 
    model: 'ALPER IP BR', 
    powers: [40, 130, 200, 210], 
    color: 'bg-slate-700',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">ALP</div>
  },
  { 
    model: 'REEME LD-3P', 
    powers: [51, 65, 82, 130, 290], 
    color: 'bg-gray-600',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">REE</div>
  },
  { 
    model: 'LEDSTAR SL VITTA', 
    powers: [58, 120, 200, 215], 
    color: 'bg-indigo-600',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">LED</div>
  },
  { 
    model: 'PHILIPS BRP372', 
    powers: [127], 
    color: 'bg-blue-900',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">PHI</div>
  },
  { 
    model: 'IBILUX ÉVORA', 
    powers: [120], 
    color: 'bg-emerald-700',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">IBI</div>
  },
  { 
    model: 'ILUMATIC ARES', 
    powers: [60, 100], 
    color: 'bg-red-800',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">ILU</div>
  },
  { 
    model: 'ORION CRONOS/NENA', 
    powers: [57, 100], 
    color: 'bg-orange-700',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">ORI</div>
  },
  { 
    model: 'ALUDAX AL10LM', 
    powers: [60], 
    color: 'bg-teal-700',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">ALU</div>
  },
  { 
    model: 'GOLDEN SQUARE', 
    powers: [75, 80], 
    color: 'bg-yellow-600',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">GLD</div>
  },
  { 
    model: 'ARGOS AR7', 
    powers: [30, 62, 120], 
    color: 'bg-purple-700',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">ARG</div>
  },
  { 
    model: 'ARCOBRAS ECOLED', 
    powers: [66, 120], 
    color: 'bg-green-800',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">ARC</div>
  },
  { 
    model: 'UNILUMIN LEDOLPHIN', 
    powers: [120], 
    color: 'bg-sky-600',
    category: 'VIÁRIA',
    icon: <div className="text-white font-bold text-xs">UNI</div>
  },
  // PROJETORES
  { 
    model: 'EMPALUX RL', 
    powers: [100, 150], 
    color: 'bg-zinc-800',
    category: 'PROJETOR',
    icon: <div className="text-white font-bold text-xs">EMP</div>
  },
  { 
    model: 'ALPER LIPBR', 
    powers: [90, 130, 200], 
    color: 'bg-slate-700',
    category: 'PROJETOR',
    icon: <div className="text-white font-bold text-xs">ALP</div>
  },
  // DECORATIVAS
  { 
    model: 'TECNOWATT BORA/MERAK', 
    powers: [54, 60], 
    color: 'bg-pink-800',
    category: 'DECORATIVA',
    icon: <div className="text-white font-bold text-xs">TEC</div>
  },
  { 
    model: 'SCHRÉDER ISLA', 
    powers: [36, 51], 
    color: 'bg-blue-800',
    category: 'DECORATIVA',
    icon: <div className="text-white font-bold text-xs">SCH</div>
  },
  { 
    model: 'ORION VEGA', 
    powers: [40, 55, 60], 
    color: 'bg-orange-700',
    category: 'DECORATIVA',
    icon: <div className="text-white font-bold text-xs">ORI</div>
  },
  { 
    model: 'SONERES FOSTERI', 
    powers: [54], 
    color: 'bg-lime-700',
    category: 'DECORATIVA',
    icon: <div className="text-white font-bold text-xs">SON</div>
  },
];

const App: React.FC = () => {
  const [history, setHistory] = useState<DetectionResult[]>([]);
  const [trainingData, setTrainingData] = useState<TrainingExample[]>([]);
  
  // Fila de Processamento
  const [queue, setQueue] = useState<File[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  
  // Correction Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<DetectionResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const CONFIDENCE_THRESHOLD = 0.85;

  // --- PERSISTÊNCIA ---
  useEffect(() => {
    const savedTraining = localStorage.getItem('lumiscan_training_data');
    if (savedTraining) {
      try {
        setTrainingData(JSON.parse(savedTraining));
      } catch (e) {
        console.error("Erro ao carregar dados salvos", e);
      }
    }
  }, []);

  useEffect(() => {
    if (trainingData.length > 0) {
      localStorage.setItem('lumiscan_training_data', JSON.stringify(trainingData));
    }
  }, [trainingData]);

  // --- PROCESSAMENTO DE FILA (LOTE) ---
  useEffect(() => {
    const processNext = async () => {
      if (queue.length === 0 || isProcessingQueue) return;

      setIsProcessingQueue(true);
      const file = queue[0];
      
      try {
        await processFile(file);
      } catch (error) {
        console.error("Erro ao processar arquivo da fila:", file.name, error);
      } finally {
        setQueue(prev => prev.slice(1));
        setProcessedCount(prev => prev + 1);
        setIsProcessingQueue(false);
      }
    };

    if (queue.length > 0) {
      processNext();
    }
  }, [queue, isProcessingQueue]);

  const processFile = (file: File): Promise<void> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = reader.result as string;
        const base64Data = base64String.split(',')[1];

        // O analyzeLuminaireImage agora cruza memória visual com OCR
        const analysisResponse = await analyzeLuminaireImage(base64Data, trainingData);

        const isLowConfidence = analysisResponse.confidence < CONFIDENCE_THRESHOLD;
        const isMissingData = !analysisResponse.calculatedPower || !analysisResponse.model;

        const newResult: DetectionResult = {
          id: Date.now().toString() + Math.random().toString().slice(2, 6),
          timestamp: Date.now(),
          imageUrl: base64String,
          model: analysisResponse.model,
          power: analysisResponse.calculatedPower,
          confidence: analysisResponse.confidence,
          reasoning: analysisResponse.reasoning,
          rawText: analysisResponse.rawText,
          features: analysisResponse.features, // Guarda features para aprendizado futuro
          status: (isLowConfidence || isMissingData) ? 'pending_review' : 'auto_detected'
        };

        setHistory(prev => [newResult, ...prev]);
        resolve();
      };
      reader.onerror = () => resolve();
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const newFiles = Array.from(files);
    setQueue(prev => [...prev, ...newFiles]);
    if (queue.length === 0) setProcessedCount(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleManualEdit = (item: DetectionResult) => {
    setItemToEdit(item);
    setIsModalOpen(true);
  };

  const saveCorrection = (id: string, correctedModel: string, correctedPower: number) => {
    const originalItem = history.find(h => h.id === id);
    const errorSignature = originalItem?.rawText || "";
    // CRUCIAL: Captura as features visuais (incluindo cor e brilho)
    const visualFeatures = originalItem?.features; 

    // 1. Atualizar histórico visual
    setHistory(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          model: correctedModel.toUpperCase(),
          power: correctedPower,
          status: 'confirmed',
          confidence: 1.0,
          reasoning: "Validado e aprendido pelo usuário."
        };
      }
      return item;
    }));

    // 2. APRENDIZADO INTELIGENTE (Visual + Texto)
    const newExample: TrainingExample = {
      model: correctedModel.toUpperCase(),
      power: correctedPower,
      ocrSignature: errorSignature,
      features: visualFeatures // Salva a "cara" da luminária para reconhecimento visual futuro
    };
    
    setTrainingData(prev => {
       // Mantemos a base crescendo para melhorar a precisão
       return [...prev, newExample];
    });

    setIsModalOpen(false);
    setItemToEdit(null);
  };

  const clearMemory = () => {
    if(confirm("Tem certeza que deseja apagar todo o aprendizado?")) {
      setTrainingData([]);
      localStorage.removeItem('lumiscan_training_data');
    }
  };

  // --- EXPORTAR / IMPORTAR MEMÓRIA ---
  const exportMemory = () => {
    if (trainingData.length === 0) {
      alert("Não há dados de treinamento para exportar.");
      return;
    }
    const dataStr = JSON.stringify(trainingData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lumiscan_memoria_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const triggerImport = () => {
    if (jsonInputRef.current) jsonInputRef.current.click();
  };

  const handleImportMemory = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (Array.isArray(json)) {
          // Merge com dados existentes, evitando duplicatas exatas se possível, 
          // mas por segurança apenas concatenamos e o usuário gerencia.
          setTrainingData(prev => [...prev, ...json]);
          alert(`${json.length} registros de memória importados com sucesso!`);
        } else {
          alert("Arquivo JSON inválido. Formato esperado: Array de exemplos.");
        }
      } catch (err) {
        console.error(err);
        alert("Erro ao ler arquivo JSON.");
      }
    };
    reader.readAsText(file);
    if (jsonInputRef.current) jsonInputRef.current.value = '';
  };

  const isWorking = queue.length > 0 || isProcessingQueue;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-slate-900 text-white p-6 flex flex-col md:fixed md:h-full z-10">
        <div className="flex items-center gap-3 mb-8">
           <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/30">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
             </svg>
           </div>
           <div>
             <h1 className="text-xl font-bold tracking-tight leading-none">LumiScan</h1>
             <span className="text-[10px] text-green-400 font-mono">AUTO LEARNING</span>
           </div>
        </div>

        <div className="space-y-6 flex-1 overflow-y-auto">
          {isWorking && (
            <div className="bg-indigo-900/50 p-4 rounded-lg border border-indigo-500/30 animate-pulse">
              <h3 className="text-xs uppercase text-indigo-300 font-bold mb-1">Processando Lote</h3>
              <div className="text-2xl font-bold text-white">{processedCount} / {processedCount + queue.length}</div>
              <p className="text-xs text-indigo-400">Imagens na fila...</p>
            </div>
          )}

          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Memória Neural</h3>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 relative overflow-hidden">
               <div className="text-3xl font-bold text-white mb-1 relative z-10">{trainingData.length}</div>
               <p className="text-xs text-slate-400 relative z-10">Padrões Aprendidos</p>
            </div>
            
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button 
                onClick={exportMemory}
                className="bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded flex items-center justify-center gap-1 transition-colors"
                title="Salvar memória em arquivo JSON"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Exportar
              </button>
              <button 
                onClick={triggerImport}
                className="bg-slate-700 hover:bg-slate-600 text-xs py-2 px-2 rounded flex items-center justify-center gap-1 transition-colors"
                title="Carregar memória de arquivo JSON"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Importar
              </button>
              <input 
                type="file" 
                ref={jsonInputRef} 
                onChange={handleImportMemory} 
                className="hidden" 
                accept=".json"
              />
            </div>

            {trainingData.length > 0 && (
              <button 
                onClick={clearMemory}
                className="mt-4 w-full text-center text-[10px] text-red-400 hover:text-red-300 underline"
              >
                Limpar Memória
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 md:ml-64 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto mb-8">
           <div className="bg-white rounded-2xl shadow-lg border border-indigo-50 p-6 md:p-8 text-center relative overflow-hidden">
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2 relative z-10">Reconhecimento em Massa</h2>
              <p className="text-slate-500 mb-8 max-w-xl mx-auto relative z-10 text-sm md:text-base">
                O sistema prioriza a etiqueta, mas usa a memória visual quando a etiqueta falha.
              </p>

              <div className="flex justify-center relative z-10">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  accept="image/*"
                  multiple 
                  onChange={handleFileUpload}
                  className="hidden" 
                  id="imageUpload"
                />
                <label 
                  htmlFor="imageUpload"
                  className={`relative flex items-center gap-3 px-8 py-4 bg-slate-900 text-white rounded-full cursor-pointer hover:bg-indigo-600 hover:scale-105 transition-all duration-300 shadow-xl shadow-indigo-900/20 ${isWorking ? 'opacity-75 pointer-events-none' : ''}`}
                >
                  {isWorking ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Analisando...</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      <span className="font-semibold text-lg">Carregar Pasta / Imagens</span>
                    </>
                  )}
                </label>
              </div>
           </div>
        </div>

        <div className="max-w-6xl mx-auto">
          {history.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                Resultados
                <span className="text-xs font-normal text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">{history.length}</span>
              </h3>
              <button onClick={() => setHistory([])} className="text-xs text-red-500 hover:underline">Limpar Tudo</button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
             {history.map(item => (
               <ResultCard 
                 key={item.id} 
                 item={item} 
                 onEdit={handleManualEdit}
               />
             ))}
          </div>

          {/* CATÁLOGO E ESTADO VAZIO */}
          {history.length === 0 && !isWorking && (
            <div className="space-y-12">
               {/* Empty State */}
               <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="text-slate-900 font-medium mb-1">Aguardando Imagens</h3>
                  <p className="text-slate-500 text-sm max-w-xs mx-auto">Carregue centenas de imagens. O sistema aprende padrões automaticamente.</p>
               </div>

               {/* Catálogo */}
               <div>
                  <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2 pl-2 border-l-4 border-indigo-500">
                    Catálogo de Referência (PDF)
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {CATALOG_DATA.map((item, idx) => (
                      <div key={idx} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
                         <div className={`h-24 ${item.color} bg-opacity-90 flex items-center justify-center relative`}>
                            <div className="transform group-hover:scale-110 transition-transform duration-300 bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                               {item.icon}
                            </div>
                            <span className="absolute bottom-2 right-2 text-[10px] text-white/80 font-mono uppercase">{item.category}</span>
                         </div>
                         <div className="p-4">
                            <h4 className="font-bold text-slate-900 text-sm md:text-base leading-tight mb-2">{item.model}</h4>
                            <div className="flex flex-wrap gap-1">
                              {item.powers.map(p => (
                                <span key={p} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono border border-slate-200">{p}W</span>
                              ))}
                            </div>
                         </div>
                      </div>
                    ))}
                  </div>
               </div>
            </div>
          )}
        </div>
      </main>

      <CorrectionModal 
        isOpen={isModalOpen}
        data={itemToEdit}
        onSave={saveCorrection}
        onCancel={() => {
          setIsModalOpen(false);
          setItemToEdit(null);
        }}
      />
    </div>
  );
};

export default App;