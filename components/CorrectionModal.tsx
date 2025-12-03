import React, { useState, useEffect } from 'react';
import { DetectionResult } from '../types';

interface CorrectionModalProps {
  isOpen: boolean;
  data: DetectionResult | null;
  onSave: (id: string, model: string, power: number) => void;
  onCancel: () => void;
}

const CorrectionModal: React.FC<CorrectionModalProps> = ({ isOpen, data, onSave, onCancel }) => {
  const [model, setModel] = useState('');
  const [power, setPower] = useState<string>('');
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    if (data) {
      setModel(data.model || '');
      setPower(data.power?.toString() || '');
    }
  }, [data]);

  if (!isOpen || !data) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(data.id, model, parseFloat(power));
  };

  // Type assertion for the preview property if it exists on the data object dynamically
  // or via the analyze response. For now we assume DetectionResult might carry it implicitly or via reasoning.
  const processedPreview = (data as any).processedPreview;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-indigo-600 p-4 shrink-0">
          <h3 className="text-white text-lg font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Treinar Reconhecimento
          </h3>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          <div className="bg-orange-50 border-l-4 border-orange-400 p-3 mb-2">
             <p className="text-xs text-orange-800 font-mono mb-1">OCR LEU:</p>
             <p className="text-sm font-bold text-gray-800 break-words line-clamp-3">"{data.rawText}"</p>
          </div>

          <div className="flex flex-col gap-2 justify-center mb-2 bg-gray-100 rounded-lg p-2">
             <div className="flex justify-between items-center px-1">
                <span className="text-xs text-gray-500 font-bold">Original</span>
                {processedPreview && (
                  <button 
                    type="button" 
                    onClick={() => setShowDebug(!showDebug)} 
                    className="text-[10px] text-indigo-600 underline"
                  >
                    {showDebug ? 'Ocultar Visão Robô' : 'Ver Visão Robô'}
                  </button>
                )}
             </div>
             <img src={data.imageUrl} alt="Original" className="h-32 object-contain rounded bg-white" />
             
             {showDebug && processedPreview && (
               <>
                 <span className="text-xs text-gray-500 font-bold mt-2">O Que o Robô Viu (Filtro)</span>
                 <img src={processedPreview} alt="Processed" className="h-32 object-contain rounded bg-black border border-gray-400" />
                 <p className="text-[10px] text-gray-400 text-center">Filtros: Nitidez + Binarização + Negativo</p>
               </>
             )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Modelo Correto</label>
            <input
              type="text"
              required
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
              placeholder="Ex: PALLAS"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Potência (Watts)</label>
            <input
              type="number"
              required
              value={power}
              onChange={(e) => setPower(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Ex: 60"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md shadow-sm transition-colors"
            >
              Aprender Padrão
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CorrectionModal;