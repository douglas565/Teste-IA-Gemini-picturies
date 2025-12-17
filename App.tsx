
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { LuminaireService } from './services/ocrService';
import { DetectionResult, TrainingExample, OllamaConfig } from './types';
import ResultCard from './components/ResultCard';
import CorrectionModal from './components/CorrectionModal';
import ImageZoomModal from './components/ImageZoomModal';
import { OllamaService } from './services/ollamaService';

// --- DADOS DO CATÁLOGO DE REFERÊNCIA (PDF) ---
const CATALOG_DATA = [
  // VIÁRIAS
  { model: 'SCHRÉDER VOLTANA', powers: [39, 56, 60, 75, 80, 110, 145, 212], color: 'bg-blue-800', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">SCH</div> },
  { model: 'SCHRÉDER AKILA', powers: [155, 236], color: 'bg-blue-800', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">AKL</div> },
  { model: 'BRIGHTLUX URBJET', powers: [40, 65, 130, 150, 213, 230], color: 'bg-cyan-700', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">BRT</div> },
  { model: 'ALPER IP BR', powers: [40, 130, 200, 210], color: 'bg-slate-700', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">ALP</div> },
  { model: 'REEME LD-3P', powers: [51, 65, 82, 130, 290], color: 'bg-gray-600', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">REE</div> },
  { model: 'LEDSTAR SL VITTA', powers: [58, 120, 200, 215], color: 'bg-indigo-600', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">LED</div> },
  { model: 'PHILIPS BRP372', powers: [127], color: 'bg-blue-900', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">PHI</div> },
  { model: 'IBILUX ÉVORA', powers: [120], color: 'bg-emerald-700', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">IBI</div> },
  { model: 'ILUMATIC ARES', powers: [60, 100], color: 'bg-red-800', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">ILU</div> },
  { model: 'ORION CRONOS/NENA', powers: [57, 100], color: 'bg-orange-700', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">ORI</div> },
  { model: 'ALUDAX AL10LM', powers: [60], color: 'bg-teal-700', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">ALU</div> },
  { model: 'GOLDEN SQUARE', powers: [75, 80], color: 'bg-yellow-600', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">GLD</div> },
  { model: 'ARGOS AR7', powers: [30, 62, 120], color: 'bg-purple-700', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">ARG</div> },
  { model: 'ARCOBRAS ECOLED', powers: [66, 120], color: 'bg-green-800', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">ARC</div> },
  { model: 'UNILUMIN LEDOLPHIN', powers: [120], color: 'bg-sky-600', category: 'VIÁRIA', icon: <div className="text-white font-bold text-xs">UNI</div> },
  { model: 'EMPALUX RL', powers: [100, 150], color: 'bg-zinc-800', category: 'PROJETOR', icon: <div className="text-white font-bold text-xs">EMP</div> },
  { model: 'ALPER LIPBR', powers: [90, 130, 200], color: 'bg-slate-700', category: 'PROJETOR', icon: <div className="text-white font-bold text-xs">ALP</div> },
  { model: 'TECNOWATT BORA/MERAK', powers: [54, 60], color: 'bg-pink-800', category: 'DECORATIVA', icon: <div className="text-white font-bold text-xs">TEC</div> },
  { model: 'SCHRÉDER ISLA', powers: [36, 51], color: 'bg-blue-800', category: 'DECORATIVA', icon: <div className="text-white font-bold text-xs">SCH</div> },
  { model: 'ORION VEGA', powers: [40, 55, 60], color: 'bg-orange-700', category: 'DECORATIVA', icon: <div className="text-white font-bold text-xs">ORI</div> },
  { model: 'SONERES FOSTERI', powers: [54], color: 'bg-lime-700', category: 'DECORATIVA', icon: <div className="text-white font-bold text-xs">SON</div> },
];

interface ProcessingJob {
  id: string; // Ponto ID (Nome da Pasta)
  files: File[];
}

const App: React.FC = () => {
  const [history, setHistory] = useState<DetectionResult[]>([]);
  const luminaireService = useMemo(() => new LuminaireService(), []);

  // Ollama Config State
  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>({
    enabled: false,
    model: 'llava', // Default vision model
    host: 'http://localhost:11434'
  });
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  // Load Saved Data
  const [trainingData, setTrainingData] = useState<TrainingExample[]>(() => {
    try {
      const saved = localStorage.getItem('lumiscan_training_data');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });
  
  const [queue, setQueue] = useState<ProcessingJob[]>([]);
  const [activeJobsCount, setActiveJobsCount] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalEnqueued, setTotalEnqueued] = useState(0);
  
  const MAX_CONCURRENT_JOBS = 1; // Reduzido para 1 se estiver usando IA para não travar o PC

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<DetectionResult | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // --- OLLAMA CHECK ---
  useEffect(() => {
    const checkOllama = async () => {
      setOllamaStatus('checking');
      const service = new OllamaService(ollamaConfig.host, ollamaConfig.model);
      const isOnline = await service.isAvailable();
      setOllamaStatus(isOnline ? 'online' : 'offline');
    };
    checkOllama();
    const interval = setInterval(checkOllama, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, [ollamaConfig.host]);

  // Sync config with Service
  useEffect(() => {
    luminaireService.setOllamaConfig(ollamaConfig);
  }, [ollamaConfig, luminaireService]);

  useEffect(() => {
    localStorage.setItem('lumiscan_training_data', JSON.stringify(trainingData));
  }, [trainingData]);

  // --- JOB QUEUE ---
  useEffect(() => {
    const launchJobs = async () => {
      if (queue.length === 0 || activeJobsCount >= MAX_CONCURRENT_JOBS) return;

      const slotsAvailable = MAX_CONCURRENT_JOBS - activeJobsCount;
      const jobsToStart = queue.slice(0, slotsAvailable);
      
      setQueue(prev => prev.slice(jobsToStart.length));
      setActiveJobsCount(prev => prev + jobsToStart.length);

      jobsToStart.forEach(job => {
          processJob(job).finally(() => {
             setActiveJobsCount(prev => prev - 1);
             setProcessedCount(prev => prev + 1);
          });
      });
    };
    launchJobs();
  }, [queue, activeJobsCount, luminaireService]);

  const processJob = async (job: ProcessingJob) => {
    try {
      const bestFile = await luminaireService.selectBestImage(job.files);

      await new Promise<void>((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(bestFile);
        reader.onload = async () => {
          const base64String = reader.result as string;
          const base64Data = base64String.split(',')[1];
          const analysisResponse = await luminaireService.analyze(base64Data, trainingData);

          const isLowConfidence = analysisResponse.confidence < 0.85;
          const isMissingData = !analysisResponse.calculatedPower || !analysisResponse.model;

          const newResult: DetectionResult = {
            id: Date.now().toString() + Math.random().toString().slice(2, 6),
            pointId: job.id,
            fileName: bestFile.name, 
            timestamp: Date.now(),
            imageUrl: base64String,
            model: analysisResponse.model,
            power: analysisResponse.calculatedPower,
            confidence: analysisResponse.confidence,
            reasoning: analysisResponse.reasoning,
            rawText: analysisResponse.rawText,
            features: analysisResponse.features,
            aiProvider: analysisResponse.aiProvider as any,
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
      const path = (file as any).webkitRelativePath || "";
      const parts = path.split('/');
      let groupId = (path && parts.length > 1) ? parts[parts.length - 2] : file.name;
      if (!groups[groupId]) groups[groupId] = [];
      groups[groupId].push(file);
    });
    const newJobs: ProcessingJob[] = Object.keys(groups).map(id => ({ id, files: groups[id] }));
    if (queue.length === 0 && activeJobsCount === 0) {
        setProcessedCount(0);
        setTotalEnqueued(newJobs.length);
    } else {
        setTotalEnqueued(prev => prev + newJobs.length);
    }
    setQueue(prev => [...prev, ...newJobs]);
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleManualEdit = (item: DetectionResult) => { setItemToEdit(item); setIsModalOpen(true); };
  const handleImageZoom = (imageUrl: string) => { setZoomedImage(imageUrl); };

  const saveCorrection = (id: string, correctedModel: string, correctedPower: number) => {
    const originalItem = history.find(h => h.id === id);
    const newExample: TrainingExample = {
      model: correctedModel.toUpperCase(),
      power: correctedPower,
      ocrSignature: originalItem?.rawText || "",
      features: originalItem?.features 
    };

    setHistory(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          model: correctedModel.toUpperCase(),
          power: correctedPower,
          status: 'confirmed',
          confidence: 1.0,
          reasoning: "Validado e aprendido pelo usuário.",
          aiProvider: 'user_corrected'
        };
      }
      if (item.status !== 'confirmed' && luminaireService.checkRetrospectiveMatch(item, newExample)) {
          return {
              ...item,
              model: correctedModel.toUpperCase(),
              power: correctedPower,
              status: 'confirmed',
              confidence: 1.0,
              reasoning: "Atualizado automaticamente por similaridade.",
              aiProvider: 'user_corrected'
          };
      }
      return item;
    }));
    setTrainingData(prev => [...prev, newExample]);
    setIsModalOpen(false);
    setItemToEdit(null);
  };

  const clearMemory = () => { if(confirm("Apagar tudo?")) setTrainingData([]); };
  const exportMemory = () => { /* Mesma lógica anterior */ };
  const triggerImport = () => { if (jsonInputRef.current) jsonInputRef.current.click(); };
  const handleImportMemory = (event: React.ChangeEvent<HTMLInputElement>) => { /* Mesma lógica anterior */ };
  const exportToExcel = () => { /* Mesma lógica anterior */ };

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
             <span className="text-[10px] text-green-400 font-mono">OFFLINE AI</span>
           </div>
        </div>

        <div className="space-y-6 flex-1 overflow-y-auto">
          {/* AI CONFIG SECTION */}
          <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
             <h3 className="text-xs uppercase text-slate-400 font-bold mb-3 flex justify-between items-center">
                AI Local (Ollama)
                <span className={`w-2 h-2 rounded-full ${ollamaStatus === 'online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}></span>
             </h3>
             
             <div className="space-y-3">
               <label className="flex items-center gap-2 cursor-pointer">
                 <input 
                   type="checkbox" 
                   checked={ollamaConfig.enabled}
                   onChange={e => setOllamaConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                   className="rounded bg-slate-700 border-slate-600 text-indigo-500 focus:ring-offset-slate-800"
                 />
                 <span className="text-sm">Ativar Visão IA</span>
               </label>
               
               {ollamaConfig.enabled && (
                 <div>
                   <label className="text-[10px] text-slate-500 block mb-1">Modelo (Vision obrigatório)</label>
                   <input 
                     type="text" 
                     value={ollamaConfig.model}
                     onChange={e => setOllamaConfig(prev => ({ ...prev, model: e.target.value }))}
                     className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white placeholder-slate-600"
                     placeholder="ex: llava"
                   />
                   {ollamaStatus === 'offline' && (
                     <p className="text-[10px] text-red-400 mt-1">Ollama não detectado em {ollamaConfig.host}</p>
                   )}
                   {ollamaStatus === 'online' && (
                     <p className="text-[10px] text-green-400 mt-1">Conectado ao Ollama</p>
                   )}
                 </div>
               )}
             </div>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Memória Neural</h3>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 relative overflow-hidden">
               <div className="text-3xl font-bold text-white mb-1 relative z-10">{trainingData.length}</div>
               <p className="text-xs text-slate-400 relative z-10">Padrões Aprendidos</p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 md:ml-64 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto mb-8">
           <div className="bg-white rounded-2xl shadow-lg border border-indigo-50 p-6 md:p-8 text-center relative overflow-hidden">
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2 relative z-10">
                 {ollamaConfig.enabled && ollamaStatus === 'online' ? 'Reconhecimento Híbrido (AI + OCR)' : 'Reconhecimento Padrão'}
              </h2>
              <p className="text-slate-500 mb-8 max-w-xl mx-auto relative z-10 text-sm md:text-base">
                {ollamaConfig.enabled && ollamaStatus === 'online' 
                  ? 'Utilizando Rede Neural Vision (Ollama) para detectar padrões complexos.'
                  : 'Para melhorar a detecção, instale o Ollama e ative a Visão IA no menu lateral.'}
              </p>

              <div className="flex flex-col md:flex-row gap-4 justify-center relative z-10 w-full px-4">
                <input type="file" ref={folderInputRef} 
                  // @ts-ignore
                  webkitdirectory="" directory="" multiple onChange={handleFileUpload} className="hidden" />
                <button onClick={() => folderInputRef.current?.click()} className="flex-1 max-w-sm flex items-center justify-center gap-3 px-6 py-4 bg-slate-900 text-white rounded-xl hover:bg-indigo-600 shadow-xl shadow-indigo-900/20">
                    <span className="font-bold text-sm">Selecionar Pasta</span>
                </button>

                <input type="file" ref={fileInputRef} multiple accept="image/*" onChange={handleFileUpload} className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} className="flex-1 max-w-sm flex items-center justify-center gap-3 px-6 py-4 bg-white text-slate-900 border border-slate-200 rounded-xl hover:bg-slate-50 shadow-sm">
                    <span className="font-bold text-sm">Selecionar Fotos</span>
                </button>
              </div>
           </div>
        </div>

        <div className="max-w-6xl mx-auto">
          {history.length > 0 && (
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                Resultados
              </h3>
              <button onClick={() => setHistory([])} className="text-xs text-red-500 hover:underline">Limpar Tudo</button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
             {history.map(item => (
               <ResultCard key={item.id} item={item} onEdit={handleManualEdit} onImageClick={handleImageZoom} />
             ))}
          </div>
        </div>
      </main>

      <CorrectionModal isOpen={isModalOpen} data={itemToEdit} onSave={saveCorrection} onCancel={() => { setIsModalOpen(false); setItemToEdit(null); }} />
      <ImageZoomModal isOpen={!!zoomedImage} imageUrl={zoomedImage} onClose={() => setZoomedImage(null)} />
    </div>
  );
};

export default App;
