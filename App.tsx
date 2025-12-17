
import React, { useState, useRef, useEffect } from 'react';
import { analyzeLuminaireImage, checkRetrospectiveMatch, selectBestImageFromBatch } from './services/ocrService';
import { DetectionResult, TrainingExample } from './types';
import ResultCard from './components/ResultCard';
import CorrectionModal from './components/CorrectionModal';
import ImageZoomModal from './components/ImageZoomModal';

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

interface ProcessingJob {
  id: string; // Ponto ID (Nome da Pasta)
  files: File[];
}

const App: React.FC = () => {
  const [history, setHistory] = useState<DetectionResult[]>([]);
  
  // Inicialização Preguiçosa para garantir carregamento síncrono do localStorage
  const [trainingData, setTrainingData] = useState<TrainingExample[]>(() => {
    try {
      const saved = localStorage.getItem('lumiscan_training_data');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.error("Erro ao carregar dados salvos", e);
      return [];
    }
  });
  
  // Fila de Processamento por JOB (Pasta)
  const [queue, setQueue] = useState<ProcessingJob[]>([]);
  // Controle de concorrência
  const [activeJobsCount, setActiveJobsCount] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalEnqueued, setTotalEnqueued] = useState(0);
  
  const MAX_CONCURRENT_JOBS = 2; // Processa 2 pastas ao mesmo tempo (cada uma usa X threads de OCR)

  // Correction Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<DetectionResult | null>(null);

  // Zoom Modal State
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  // Separate refs for Folder vs File upload
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const CONFIDENCE_THRESHOLD = 0.85;

  // --- PERSISTÊNCIA ROBUSTA ---
  useEffect(() => {
    localStorage.setItem('lumiscan_training_data', JSON.stringify(trainingData));
  }, [trainingData]);

  // --- PROCESSAMENTO DE FILA CONCORRENTE ---
  useEffect(() => {
    const launchJobs = async () => {
      // Se não há nada na fila ou já estamos no máximo de capacidade, sai
      if (queue.length === 0 || activeJobsCount >= MAX_CONCURRENT_JOBS) return;

      // Pega os próximos N jobs que cabem no "slot" de processamento
      const slotsAvailable = MAX_CONCURRENT_JOBS - activeJobsCount;
      const jobsToStart = queue.slice(0, slotsAvailable);
      
      // Remove da fila imediatamente para não serem pegos novamente
      setQueue(prev => prev.slice(jobsToStart.length));
      setActiveJobsCount(prev => prev + jobsToStart.length);

      // Inicia cada job sem esperar um pelo outro (fire and forget no loop, await no worker)
      jobsToStart.forEach(job => {
          processJob(job).finally(() => {
             setActiveJobsCount(prev => prev - 1);
             setProcessedCount(prev => prev + 1);
          });
      });
    };

    launchJobs();
  }, [queue, activeJobsCount]);

  const processJob = async (job: ProcessingJob) => {
    try {
      // 1. Seleciona a melhor imagem do lote
      const bestFile = await selectBestImageFromBatch(job.files);

      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(bestFile);
        reader.onload = async () => {
          const base64String = reader.result as string;
          const base64Data = base64String.split(',')[1];

          // O analyzeLuminaireImage usa o Scheduler (Pool de Threads)
          const analysisResponse = await analyzeLuminaireImage(base64Data, trainingData);

          const isLowConfidence = analysisResponse.confidence < CONFIDENCE_THRESHOLD;
          const isMissingData = !analysisResponse.calculatedPower || !analysisResponse.model;

          const newResult: DetectionResult = {
            id: Date.now().toString() + Math.random().toString().slice(2, 6),
            pointId: job.id, // Nome da pasta ou Nome do Arquivo (se unitário)
            fileName: bestFile.name, 
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
    } catch (error) {
       console.error("Erro fatal no job", job.id, error);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const groups: Record<string, File[]> = {};
    
    Array.from(files).forEach((file: File) => {
      // webkitRelativePath formato: "PastaPai/Arquivo.jpg"
      const path = (file as any).webkitRelativePath || "";
      const parts = path.split('/');
      
      let groupId;
      
      if (path && parts.length > 1) {
        // MODO PASTA: Agrupa pelo nome da pasta pai (ex: PONTO_01)
        groupId = parts[parts.length - 2];
      } else {
        // MODO ARQUIVO UNITÁRIO: Cada arquivo é um job independente.
        groupId = file.name;
      }
      
      if (!groups[groupId]) {
        groups[groupId] = [];
      }
      groups[groupId].push(file);
    });

    const newJobs: ProcessingJob[] = Object.keys(groups).map(id => ({
      id,
      files: groups[id]
    }));

    if (queue.length === 0 && activeJobsCount === 0) {
        setProcessedCount(0);
        setTotalEnqueued(newJobs.length);
    } else {
        setTotalEnqueued(prev => prev + newJobs.length);
    }

    setQueue(prev => [...prev, ...newJobs]);
    
    // Limpar inputs
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleManualEdit = (item: DetectionResult) => {
    setItemToEdit(item);
    setIsModalOpen(true);
  };

  const handleImageZoom = (imageUrl: string) => {
    setZoomedImage(imageUrl);
  };

  const saveCorrection = (id: string, correctedModel: string, correctedPower: number) => {
    const originalItem = history.find(h => h.id === id);
    const errorSignature = originalItem?.rawText || "";
    const visualFeatures = originalItem?.features; 

    // 1. Criar novo exemplo de treinamento
    const newExample: TrainingExample = {
      model: correctedModel.toUpperCase(),
      power: correctedPower,
      ocrSignature: errorSignature,
      features: visualFeatures 
    };

    // 2. Atualizar histórico (Item Atual + RECHECAGEM RETROATIVA)
    setHistory(prev => prev.map(item => {
      // Atualiza o item que está sendo editado
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
      
      // Rechecagem inteligente
      if (item.status !== 'confirmed' && checkRetrospectiveMatch(item, newExample)) {
          return {
              ...item,
              model: correctedModel.toUpperCase(),
              power: correctedPower,
              status: 'confirmed',
              confidence: 1.0,
              reasoning: "Atualizado automaticamente por similaridade com correção recente."
          };
      }

      return item;
    }));

    // 3. Salvar no banco de treinamento
    setTrainingData(prev => {
       return [...prev, newExample];
    });

    setIsModalOpen(false);
    setItemToEdit(null);
  };

  const clearMemory = () => {
    if(confirm("Tem certeza que deseja apagar todo o aprendizado?")) {
      setTrainingData([]);
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

  // --- EXPORTAR RELATÓRIO EXCEL (CSV) ---
  const exportToExcel = () => {
    if (history.length === 0) {
      alert("Não há resultados para exportar.");
      return;
    }

    const headers = ["PONTO", "ARQUIVO", "MODELO", "POTENCIA (W)", "CONFIABILIDADE"];
    const rows = history.map(item => [
      item.pointId || "N/A",
      item.fileName || item.id,
      item.model || "DESCONHECIDO",
      item.power || 0,
      (item.confidence * 100).toFixed(0) + "%"
    ]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(e => e.join(";"))].join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio_luminarias_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isWorking = queue.length > 0 || activeJobsCount > 0;

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
             <span className="text-[10px] text-green-400 font-mono">MULTI-CORE ENGINE</span>
           </div>
        </div>

        <div className="space-y-6 flex-1 overflow-y-auto">
          {isWorking && (
            <div className="bg-indigo-900/50 p-4 rounded-lg border border-indigo-500/30 animate-pulse">
              <h3 className="text-xs uppercase text-indigo-300 font-bold mb-1">Processando Lote</h3>
              <div className="text-2xl font-bold text-white">{processedCount} / {totalEnqueued}</div>
              <p className="text-xs text-indigo-400">Utilizando Múltiplos Núcleos...</p>
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
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2 relative z-10">Reconhecimento Otimizado</h2>
              <p className="text-slate-500 mb-8 max-w-xl mx-auto relative z-10 text-sm md:text-base">
                Motor de OCR paralelizado ativo. O sistema utilizará todos os núcleos disponíveis para processar imagens simultaneamente.
              </p>

              <div className="flex flex-col md:flex-row gap-4 justify-center relative z-10 w-full px-4">
                {/* INPUT PASTA */}
                <input 
                  type="file" 
                  ref={folderInputRef}
                  // @ts-ignore
                  webkitdirectory="" 
                  directory=""
                  multiple
                  onChange={handleFileUpload}
                  className="hidden" 
                />
                <button 
                  onClick={() => folderInputRef.current?.click()}
                  className={`flex-1 max-w-sm flex items-center justify-center gap-3 px-6 py-4 bg-slate-900 text-white rounded-xl cursor-pointer hover:bg-indigo-600 hover:scale-[1.02] transition-all duration-300 shadow-xl shadow-indigo-900/20 ${isWorking ? 'opacity-50 pointer-events-none' : ''}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <div className="text-left">
                        <span className="block font-bold text-sm">Selecionar Pasta</span>
                        <span className="block text-[10px] text-slate-300">Modo Lote (Agrupado)</span>
                    </div>
                </button>

                {/* INPUT ARQUIVOS */}
                <input 
                  type="file" 
                  ref={fileInputRef}
                  multiple
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden" 
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex-1 max-w-sm flex items-center justify-center gap-3 px-6 py-4 bg-white text-slate-900 border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 hover:border-indigo-300 hover:scale-[1.02] transition-all duration-300 shadow-sm ${isWorking ? 'opacity-50 pointer-events-none' : ''}`}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <div className="text-left">
                        <span className="block font-bold text-sm">Selecionar Fotos</span>
                        <span className="block text-[10px] text-slate-400">Modo Unitário</span>
                    </div>
                </button>
              </div>
           </div>
        </div>

        <div className="max-w-6xl mx-auto">
          {history.length > 0 && (
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                Resultados
                <span className="text-xs font-normal text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">{history.length}</span>
              </h3>
              <div className="flex gap-3">
                <button 
                    onClick={exportToExcel} 
                    className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-md flex items-center gap-1 transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Baixar Excel (CSV)
                </button>
                <button onClick={() => setHistory([])} className="text-xs text-red-500 hover:underline">Limpar Tudo</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
             {history.map(item => (
               <ResultCard 
                 key={item.id} 
                 item={item} 
                 onEdit={handleManualEdit}
                 onImageClick={handleImageZoom}
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
                  <p className="text-slate-500 text-sm max-w-xs mx-auto">Carregue pastas de imagens. O sistema utiliza aceleração multi-core para processamento rápido.</p>
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

      <ImageZoomModal 
        isOpen={!!zoomedImage}
        imageUrl={zoomedImage}
        onClose={() => setZoomedImage(null)}
      />
    </div>
  );
};

export default App;
