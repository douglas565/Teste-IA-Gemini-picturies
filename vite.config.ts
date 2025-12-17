
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // Importante para Electron carregar assets com caminhos relativos
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  }
});
