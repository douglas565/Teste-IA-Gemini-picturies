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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-indigo-600 p-4">
          <h3 className="text-white text-lg font-semibold flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Treinar Reconhecimento
          </h3>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-orange-50 border-l-4 border-orange-400 p-3 mb-4">
             <p className="text-xs text-orange-800 font-mono mb-1">OCR LEU:</p>
             <p className="text-sm font-bold text-gray-800 break-words">"{data.rawText}"</p>
             <p className="text-[10px] text-orange-600 mt-1">O sistema aprenderá que esse texto acima significa o modelo abaixo.</p>
          </div>

          <div className="flex justify-center mb-2 bg-gray-100 rounded-lg p-2">
             <img src={data.imageUrl} alt="Preview" className="h-24 object-contain rounded" />
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