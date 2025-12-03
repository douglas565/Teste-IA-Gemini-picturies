import React from 'react';
import { DetectionResult } from '../types';

interface ResultCardProps {
  item: DetectionResult;
  onEdit: (item: DetectionResult) => void;
}

const ResultCard: React.FC<ResultCardProps> = ({ item, onEdit }) => {
  const isPending = item.status === 'pending_review';
  
  return (
    <div className={`relative bg-white rounded-xl shadow-sm border transition-all duration-200 hover:shadow-md ${isPending ? 'border-yellow-400 ring-1 ring-yellow-100' : 'border-gray-200'}`}>
      {isPending && (
        <div className="absolute top-0 right-0 -mt-2 -mr-2">
          <span className="flex h-4 w-4 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-yellow-500"></span>
          </span>
        </div>
      )}
      
      <div className="flex p-4 gap-4">
        {/* Image Thumbnail */}
        <div className="w-24 h-24 flex-shrink-0 bg-gray-100 rounded-lg overflow-hidden border border-gray-100 relative group">
          <img src={item.imageUrl} alt="Luminaire" className="w-full h-full object-cover" />
          {item.features && (
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-[8px] text-white transition-opacity">
              <span>AR: {item.features.aspectRatio.toFixed(2)}</span>
              <span>ED: {item.features.edgeDensity.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Modelo</h4>
              <p className="text-lg font-bold text-gray-900 truncate">
                {item.model || <span className="text-red-400 italic">Desconhecido</span>}
              </p>
            </div>
            <div className="text-right">
               <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wider">Potência</h4>
               <p className="text-lg font-bold text-indigo-600">
                 {item.power ? `${item.power}W` : <span className="text-red-400 italic">--</span>}
               </p>
            </div>
          </div>

          <div className="mt-3">
             <div className="flex items-center gap-2 mb-1">
               <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                 <div 
                    className={`h-full rounded-full ${item.confidence > 0.8 ? 'bg-green-500' : item.confidence > 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${item.confidence * 100}%` }}
                 />
               </div>
               <span className="text-xs text-gray-400 font-mono">{(item.confidence * 100).toFixed(0)}% Conf.</span>
             </div>
             <p className="text-xs text-gray-500 line-clamp-1 italic">
               "{item.reasoning}"
             </p>
          </div>
        </div>
      </div>

      {/* Action Footer */}
      <div className="bg-gray-50 px-4 py-3 border-t border-gray-100 flex justify-between items-center rounded-b-xl">
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
            item.status === 'confirmed' 
              ? 'bg-green-100 text-green-700' 
              : isPending 
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-blue-100 text-blue-700'
        }`}>
          {item.status === 'confirmed' ? 'Verificado' : isPending ? 'Necessita Revisão' : 'Detectado Auto'}
        </span>
        
        <button 
          onClick={() => onEdit(item)}
          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium hover:underline flex items-center gap-1"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M17.414 2.586a2 2 0 00-2.828 0L7 9.172V13h4l6.586-6.586a2 2 0 000-2.828z" />
            <path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clipRule="evenodd" />
          </svg>
          {isPending ? 'Corrigir' : 'Editar'}
        </button>
      </div>
    </div>
  );
};

export default ResultCard;