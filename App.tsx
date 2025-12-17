
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { LuminaireService } from './services/ocrService';
import { DetectionResult, TrainingExample, OllamaConfig } from './types';
import ResultCard from './components/ResultCard';
import CorrectionModal from './components/CorrectionModal';
import ImageZoomModal from './components/ImageZoomModal';
import { OllamaService } from './services/ollamaService';

const App: React.FC = () => {
  const [history, setHistory] = useState<DetectionResult[]>([]);
  const luminaireService = useMemo(() => new LuminaireService(), []);

  // Ollama Config State - Habilitado por padrão para App Local
  const [ollamaConfig, setOllamaConfig] = useState<OllamaConfig>({
    enabled: true,
    model: 'llava', 
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
  
  const [queue, setQueue] = useState<{id: string, files: File[]}[]>([]);
  const [activeJobsCount, setActiveJobsCount] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalEnqueued, setTotalEnqueued] = useState(0);
  
  // Limita concorrência para não travar PC do usuário rodando LLM Local
  const MAX_CONCURRENT_JOBS = 1; 

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<DetectionResult | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- OLLAMA CHECK ---
  useEffect(() => {
    const checkOllama = async () => {
      setOllamaStatus('checking');
      const service = new OllamaService(ollamaConfig.host, ollamaConfig.model);
      const isOnline = await service.isAvailable();
      setOllamaStatus(isOnline ? 'online' : 'offline');
    };
    checkOllama();
    const interval = setInterval(checkOllama, 30000); // Check a cada 30s
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

  const processJob = async (job: {id: string, files: File[]}) => {
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
            status: (isLowConfidence || isMissingData) ? 'pending_review' : 'auto_detected',
            processedPreview: analysisResponse.processedPreview
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
    const newJobs = Object.keys(groups).map(id => ({ id, files: groups[id] }));
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-slate-900 text-white p-6 flex flex-col md:fixed md:h-full z-10 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
           <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/50 ring-1 ring-white/10">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
             </svg>
           </div>
           <div>
             <h1 className="text-xl font-bold tracking-tight leading-none text-white">LumiScan</h1>
             <span className="text-[10px] text-green-400 font-mono tracking-widest uppercase">App Desktop</span>
           </div>
        </div>

        <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
          {/* AI CONFIG SECTION */}
          <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 backdrop-blur-sm">
             <div className="flex justify-between items-center mb-3">
               <h3 className="text-xs uppercase text-slate-400 font-bold tracking-wider">
                  IA Local (Ollama)
               </h3>
               <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                 ollamaStatus === 'online' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 
                 ollamaStatus === 'checking' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'
               }`}>
                 <span className={`w-1.5 h-1.5 rounded-full ${ollamaStatus === 'online' ? 'bg-green-500 animate-pulse' : ollamaStatus === 'checking' ? 'bg-yellow-500' : 'bg-red-500'}`}></span>
                 {ollamaStatus === 'online' ? 'ONLINE' : ollamaStatus === 'checking' ? 'BUSCANDO...' : 'OFFLINE'}
               </div>
             </div>
             
             <div className="space-y-3">
               <label className="flex items-center gap-3 cursor-pointer group">
                 <div className="relative">
                   <input 
                     type="checkbox" 
                     checked={ollamaConfig.enabled}
                     onChange={e => setOllamaConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                     className="sr-only peer"
                   />
                   <div className="w-9 h-5 bg-slate-700 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                 </div>
                 <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">Ativar Visão IA</span>
               </label>
               
               {ollamaConfig.enabled && (
                 <div className="animate-fadeIn">
                   <label className="text-[10px] text-slate-500 block mb-1 uppercase font-semibold">Modelo Vision</label>
                   <input 
                     type="text" 
                     value={ollamaConfig.model}
                     onChange={e => setOllamaConfig(prev => ({ ...prev, model: e.target.value }))}
                     className="w-full bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                     placeholder="ex: llava"
                   />
                   {ollamaStatus === 'offline' && (
                     <div className="mt-2 p-2 bg-red-900/20 border border-red-900/30 rounded text-[10px] text-red-300 leading-tight">
                       Certifique-se que o Ollama está rodando (ollama run llava)
                     </div>
                   )}
                 </div>
               )}
             </div>
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z" />
              </svg>
              Base de Conhecimento
            </h3>
            <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 relative overflow-hidden group hover:border-indigo-500/50 transition-colors">
               <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-indigo-500" viewBox="0 0 20 20" fill="currentColor">
                   <path d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                 </svg>
               </div>
               <div className="text-3xl font-bold text-white mb-1 relative z-10">{trainingData.length}</div>
               <p className="text-xs text-slate-400 relative z-10">Modelos Aprendidos</p>
               {trainingData.length > 0 && (
                 <button onClick={() => {if(confirm('Limpar memória?')) setTrainingData([])}} className="mt-3 text-[10px] text-red-400 hover:text-red-300 underline relative z-10">
                   Resetar Memória
                 </button>
               )}
            </div>
          </div>
        </div>
        
        <div className="pt-4 border-t border-slate-800 text-[10px] text-slate-500 text-center">
          LumiScan v1.0 • Offline App
        </div>
      </aside>

      <main className="flex-1 md:ml-64 p-4 md:p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto mb-8">
           <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-6 md:p-8 text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
              
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2 relative z-10">
                 Painel de Processamento
              </h2>
              <p className="text-slate-500 mb-8 max-w-xl mx-auto relative z-10 text-sm md:text-base">
                {ollamaStatus === 'online' && ollamaConfig.enabled
                  ? 'IA Local Conectada. O sistema verificará automaticamente cada imagem contra sua base de conhecimento.'
                  : 'Modo Básico. Ative o Ollama no menu lateral para habilitar verificação inteligente e correção automática.'}
              </p>

              <div className="flex flex-col md:flex-row gap-4 justify-center relative z-10 w-full px-4 max-w-2xl mx-auto">
                <input type="file" ref={folderInputRef} 
                  // @ts-ignore
                  webkitdirectory="" directory="" multiple onChange={handleFileUpload} className="hidden" />
                <button 
                  onClick={() => folderInputRef.current?.click()} 
                  className="group flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-slate-900 text-white rounded-xl hover:bg-indigo-600 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-slate-900/20"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-400 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <div className="text-left">
                      <span className="block font-bold text-sm">Selecionar Pasta</span>
                      <span className="block text-[10px] text-slate-400 group-hover:text-indigo-200">Processar lote completo</span>
                    </div>
                </button>

                <input type="file" ref={fileInputRef} multiple accept="image/*" onChange={handleFileUpload} className="hidden" />
                <button 
                  onClick={() => fileInputRef.current?.click()} 
                  className="group flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-white text-slate-900 border border-slate-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 hover:text-indigo-700 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-sm"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-400 group-hover:text-indigo-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <div className="text-left">
                      <span className="block font-bold text-sm">Selecionar Arquivos</span>
                      <span className="block text-[10px] text-slate-400 group-hover:text-indigo-500">Imagens individuais</span>
                    </div>
                </button>
              </div>
           </div>
           
           {/* Progress Bar se houver jobs */}
           {totalEnqueued > 0 && processedCount < totalEnqueued && (
             <div className="mt-4 bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex items-center gap-4">
                <div className="flex-1">
                   <div className="flex justify-between mb-1">
                     <span className="text-xs font-bold text-slate-700">Processando...</span>
                     <span className="text-xs text-slate-500">{processedCount} / {totalEnqueued}</span>
                   </div>
                   <div className="w-full bg-slate-100 rounded-full h-2">
                      <div className="bg-indigo-500 h-2 rounded-full transition-all duration-300" style={{ width: `${(processedCount / totalEnqueued) * 100}%` }}></div>
                   </div>
                </div>
                {activeJobsCount > 0 && (
                   <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                     <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                     <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                   </svg>
                )}
             </div>
           )}
        </div>

        <div className="max-w-6xl mx-auto">
          {history.length > 0 && (
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                Resultados Recentes
              </h3>
              <button onClick={() => setHistory([])} className="text-xs font-medium text-slate-500 hover:text-red-500 px-3 py-1 bg-white border border-slate-200 rounded-md hover:bg-red-50 transition-colors">
                Limpar Lista
              </button>
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
