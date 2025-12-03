import React, { useState, useRef } from 'react';
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

  // Constants
  const CONFIDENCE_THRESHOLD = 0.60; // Slightly lower threshold for OCR compared to Vision AI

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);

    try {
      // Convert to Base64
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64String = reader.result as string;
        // Strip prefix (e.g., "data:image/jpeg;base64,") for API processing
        const base64Data = base64String.split(',')[1];

        const analysisResponse = await analyzeLuminaireImage(base64Data, trainingData);

        const isLowConfidence = analysisResponse.confidence < CONFIDENCE_THRESHOLD;
        const isMissingData = !analysisResponse.model && !analysisResponse.calculatedPower;

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

        // Auto-open modal if low confidence or missing data to confirm
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

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleManualEdit = (item: DetectionResult) => {
    setItemToEdit(item);
    setIsModalOpen(true);
  };

  const saveCorrection = (id: string, correctedModel: string, correctedPower: number) => {
    // 1. Update the specific item in history
    setHistory(prev => prev.map(item => {
      if (item.id === id) {
        return {
          ...item,
          model: correctedModel,
          power: correctedPower,
          status: 'confirmed',
          confidence: 1.0, // User verified
          reasoning: "Validado manualmente pelo usuário."
        };
      }
      return item;
    }));

    // 2. Add to "Training Data" (In-Context Learning for next requests)
    const newExample: TrainingExample = {
      model: correctedModel,
      power: correctedPower
    };
    
    // Simple deduplication based on model name
    setTrainingData(prev => {
       const exists = prev.find(p => p.model === correctedModel);
       if(exists) return prev; 
       return [...prev, newExample];
    });

    setIsModalOpen(false);
    setItemToEdit(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar / Stats */}
      <aside className="w-full md:w-64 bg-slate-900 text-white p-6 flex flex-col md:fixed md:h-full z-10">
        <div className="flex items-center gap-3 mb-8">
           <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/30">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
             </svg>
           </div>
           <h1 className="text-xl font-bold tracking-tight">LumiScan <span className="text-green-400">OFFLINE</span></h1>
        </div>

        <div className="space-y-6 flex-1">
          <div>
            <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Base Local</h3>
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
               <div className="text-3xl font-bold text-white mb-1">{trainingData.length}</div>
               <p className="text-xs text-slate-400">Modelos Aprendidos</p>
            </div>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              O sistema aprende localmente cada vez que você corrige uma detecção.
            </p>
          </div>

          <div>
             <h3 className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2">Regras de Conversão</h3>
             <ul className="text-xs text-slate-300 space-y-2 font-mono bg-slate-800/50 p-3 rounded">
               <li>01-09 &rarr; x10 (06=60W)</li>
               <li>10+ &rarr; Valor Real (75=75W)</li>
             </ul>
          </div>
        </div>

        <div className="mt-auto pt-6 border-t border-slate-800">
          <p className="text-xs text-slate-500">Desenvolvido com Tesseract JS</p>
          <p className="text-[10px] text-slate-600 mt-1">100% Gratuito & Rodando no Navegador</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 overflow-y-auto">
        
        {/* Header Action Area */}
        <div className="max-w-5xl mx-auto mb-8">
           <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-6 md:p-8 text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-green-500 to-teal-500"></div>
              
              <h2 className="text-2xl md:text-3xl font-bold text-slate-900 mb-2">Scanner de Luminárias Offline</h2>
              <p className="text-slate-500 mb-8 max-w-xl mx-auto">
                Faça upload da etiqueta. O sistema usa OCR local para ler o texto e aplicar as regras de conversão (x10 ou direto) sem custo.
              </p>

              <div className="flex justify-center">
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
                  className={`group relative flex items-center gap-3 px-8 py-4 bg-slate-900 text-white rounded-full cursor-pointer hover:bg-slate-800 hover:scale-105 transition-all duration-300 shadow-xl shadow-indigo-500/20 ${isAnalyzing ? 'opacity-75 pointer-events-none' : ''}`}
                >
                  {isAnalyzing ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Lendo Texto (OCR)...</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 group-hover:-translate-y-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="font-semibold text-lg">Escanear Etiqueta</span>
                    </>
                  )}
                </label>
              </div>
           </div>
        </div>

        {/* Results Grid */}
        <div className="max-w-5xl mx-auto">
          {history.length > 0 && (
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              Histórico Local 
              <span className="text-sm font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{history.length}</span>
            </h3>
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
            <div className="text-center py-20 opacity-50">
               <svg className="w-16 h-16 mx-auto mb-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
               </svg>
               <p className="text-slate-400">Nenhuma etiqueta processada ainda.</p>
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