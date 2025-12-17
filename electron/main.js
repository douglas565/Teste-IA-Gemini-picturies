import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// Correção para __dirname no modo ES Module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "LumiScan Offline",
    icon: path.join(__dirname, '../public/icon.png'), // Opcional: Se tiver icone
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Remove o menu padrão (Arquivo, Editar...) para parecer um app nativo
  win.setMenuBarVisibility(false);

  // Carrega o arquivo index.html gerado pelo Vite na pasta dist
  win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});