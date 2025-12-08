
import React, { useState, useRef, useEffect } from 'react';

interface ImageZoomModalProps {
  isOpen: boolean;
  imageUrl: string | null;
  onClose: () => void;
}

const ImageZoomModal: React.FC<ImageZoomModalProps> = ({ isOpen, imageUrl, onClose }) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Resetar estado ao abrir nova imagem
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen, imageUrl]);

  if (!isOpen || !imageUrl) return null;

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation(); // Impede scroll da página
    const delta = e.deltaY * -0.002;
    const newScale = Math.min(Math.max(1, scale + delta), 5); // Zoom min 1x, max 5x
    setScale(newScale);
    
    // Se voltar para 1x, reseta posição
    if (newScale === 1) setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      e.preventDefault();
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const zoomIn = () => setScale(s => Math.min(s + 0.5, 5));
  const zoomOut = () => {
    setScale(s => {
      const newS = Math.max(1, s - 0.5);
      if (newS === 1) setPosition({ x: 0, y: 0 });
      return newS;
    });
  };

  return (
    <div 
      className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center overflow-hidden"
      onClick={onClose}
    >
      {/* Controles de Zoom */}
      <div className="absolute top-4 right-4 flex gap-2 z-50" onClick={e => e.stopPropagation()}>
        <button 
          onClick={zoomOut}
          className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full backdrop-blur-md transition-colors"
          title="Diminuir Zoom"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </button>
        <div className="bg-black/50 text-white px-3 py-2 rounded-full font-mono text-sm flex items-center">
          {Math.round(scale * 100)}%
        </div>
        <button 
          onClick={zoomIn}
          className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full backdrop-blur-md transition-colors"
          title="Aumentar Zoom"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button 
          onClick={onClose}
          className="bg-red-500/80 hover:bg-red-600 text-white p-2 rounded-full ml-4 transition-colors"
          title="Fechar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/50 text-sm pointer-events-none bg-black/30 px-3 py-1 rounded-full">
        Use o scroll do mouse para zoom • Arraste para mover
      </div>

      {/* Container da Imagem */}
      <div 
        ref={containerRef}
        className="w-full h-full flex items-center justify-center cursor-move"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={e => e.stopPropagation()} // Impede fechar ao clicar na imagem
      >
        <img 
          src={imageUrl} 
          alt="Zoom Preview" 
          className="max-w-[95vw] max-h-[95vh] object-contain transition-transform duration-75 ease-out select-none"
          style={{ 
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
          }}
          draggable={false}
        />
      </div>
    </div>
  );
};

export default ImageZoomModal;
