import React, { useState, useRef, useEffect } from 'react';
import { analyzeLuminaireImage } from './services/ocrService';
import { DetectionResult, TrainingExample } from './types';
import ResultCard from './components/ResultCard';
import CorrectionModal from './components/CorrectionModal';

const App: React.FC = () => {
  const [history, setHistory] = useState<DetectionResult[]>([]);
  const [trainingData, setTrainingData] = useState<TrainingExample[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Correction Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<DetectionResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const CONFIDENCE_THRESHOLD = 0.60;

  // --- PERSISTÊNCIA: Carregar dados ao iniciar ---
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

  // --- PERSISTÊNCIA: Salvar dados quando atualizados ---
  useEffect(() => {
    if (trainingData.length > 0) {
      localStorage.setItem('lumiscan_training_data', JSON.stringify(trainingData));
    }
  }, [trainingData]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = reader.result as string;
        const base64Data = base64String.split(',')[1];

        const analysisResponse = await analyzeLuminaireImage(base64Data, trainingData);

        const isLowConfidence = analysisResponse.confidence < CONFIDENCE_THRESHOLD;
        const isMissingData = !analysisResponse.calculatedPower; // Se faltar potência, é crítico

        const newResult: DetectionResult = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          imageUrl: base64String,
          model: analysisResponse.model,
          power: analysisResponse.calculatedPower,
          confidence: analysisResponse.confidence,
          reasoning: analysisResponse.reasoning,
          status: (isLowConfidence || isMissingData) ? 'pending_review' : 'auto_detected'
        };

        setHistory(prev => [newResult, ...prev]);

        // Abre modal automaticamente se falhar em detectar algo útil
        if (isLowConfidence || isMissingData) {
          setItemToEdit(newResult);
          setIsModalOpen(true);
        }

        setIsAnalyzing(false);
      };
    } catch (error) {
      console.error("Error processing image", error);
      setIsAnalyzing(false);
      alert("Falha ao processar imagem.");
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleManualEdit = (item: DetectionResult) => {
    setItemToEdit(item);
    setIsModalOpen(true);
  };

  const saveCorrection = (id: string, correctedModel: string, correctedPower: number) => {
    // 1. Atualizar histórico visual
    setHistory(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          model: correctedModel,
          power: correctedPower,
          status: 'confirmed',
          confidence: 1.0,
          reasoning: "Validado e aprendido pelo usuário."
        };
      }
      return item;
    }));

    // 2. Adicionar ao Treinamento Persistente
    const newExample: TrainingExample = {
      model: correctedModel.toUpperCase(), // Salva em Upper para facilitar busca
      power: correctedPower
    };
    
    setTrainingData(prev => {
       // Remove duplicatas do mesmo modelo para manter a base limpa e atualizada
       const cleanPrev = prev.filter(p => p.model !== newExample.model);
       return [...cleanPrev, newExample];
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-slate-900 text-white p-6 flex flex-col md:fixed md:h-full z-10">
        <div className="flex items-center gap-3 mb-8">
           <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/30">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
             </svg>
           </div>
           <div>
             <h1 className="text-xl font-bold tracking-tight leading-none">LumiScan</h1>
             <span className="text-[10px] text-green-400 font-mono">V2.0 OFFLINE</span>
           </div>
        </div>

        <div className="space-y-6 flex-1">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Memória Local</h3>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 relative overflow-hidden">
               <div className="text-3xl font-bold text-white mb-1 relative z-10">{trainingData.length}</div>
               <p className="text-xs text-slate-400 relative z-10">Modelos Aprendidos</p>
               <div className="absolute -right-2 -bottom-4 text-slate-700 opacity-20">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/></svg>
               </div>
            </div>
            {trainingData.length > 0 && (
              <button 
                onClick={clearMemory}
                className="mt-2 text-[10px] text-red-400 hover:text-red-300 underline"
              >
                Limpar Memória
              </button>
            )}
          </div>

          <div>
             <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Regras Ativas</h3>
             <ul className="text-xs text-slate-300 space-y-2 font-mono bg-slate-800/50 p-3 rounded border border-slate-700/50">
               <li className="flex items-center gap-2">
                 <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>
                 01-09 &rarr; x10 (06=60W)
               </li>
               <li className="flex items-center gap-2">
                 <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                 10+ &rarr; Direto (75=75W)
               </li>
               <li className="flex items-center gap-2">
                 <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
                 Ignora: 220V, 60Hz
               </li>
             </ul>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 overflow-y-auto">
        
        {/* Header Action Area */}
        <div className="max-w-5xl mx-auto mb-8">
           <div className="bg-white rounded-2xl shadow-lg border border-indigo-50 p-6 md:p-8 text-center relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/50 to-white pointer-events-none"></div>
              
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2 relative z-10">Scanner de Etiqueta</h2>
              <p className="text-slate-500 mb-8 max-w-xl mx-auto relative z-10 text-sm md:text-base">
                O sistema usa OCR para ler números isolados. Se errar, use o botão <b>Corrigir</b> para ensinar o sistema.
              </p>

              <div className="flex justify-center relative z-10">
                <input 
                  type="file" 
                  ref={fileInputRef}
                  accept="image/*" 
                  onChange={handleFileUpload}
                  className="hidden" 
                  id="imageUpload"
                />
                <label 
                  htmlFor="imageUpload"
                  className={`relative flex items-center gap-3 px-8 py-4 bg-slate-900 text-white rounded-full cursor-pointer hover:bg-indigo-600 hover:scale-105 transition-all duration-300 shadow-xl shadow-indigo-900/20 ${isAnalyzing ? 'opacity-75 pointer-events-none' : ''}`}
                >
                  {isAnalyzing ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Processando (OCR)...</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="font-semibold text-lg">Tirar Foto / Upload</span>
                    </>
                  )}
                </label>
              </div>
           </div>
        </div>

        {/* Results Grid */}
        <div className="max-w-5xl mx-auto">
          {history.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                Histórico
                <span className="text-xs font-normal text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full">{history.length}</span>
              </h3>
              <button onClick={() => setHistory([])} className="text-xs text-red-500 hover:underline">Limpar Lista</button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {history.map(item => (
               <ResultCard 
                 key={item.id} 
                 item={item} 
                 onEdit={handleManualEdit}
               />
             ))}
          </div>

          {history.length === 0 && !isAnalyzing && (
            <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
               <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                 <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                 </svg>
               </div>
               <h3 className="text-slate-900 font-medium mb-1">Nenhuma etiqueta processada</h3>
               <p className="text-slate-500 text-sm max-w-xs mx-auto">Faça upload de uma foto da etiqueta da luminária para começar o reconhecimento.</p>
            </div>
          )}
        </div>
      </main>

      {/* Modal */}
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