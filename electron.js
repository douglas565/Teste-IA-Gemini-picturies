
const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

// Desabilitar aceleração de hardware se necessário para compatibilidade OCR
// app.disableHardwareAcceleration();

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const mainWindow = new BrowserWindow({
    width: Math.min(1280, width),
    height: Math.min(800, height),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Simplificação para acesso direto se necessário
      webSecurity: false // Permite carregar imagens locais (file://)
    },
    icon: path.join(__dirname, 'public/icon.ico')
  });

  mainWindow.setMenuBarVisibility(false); // Esconde menu padrão feio do Windows

  // Em desenvolvimento, carrega url do Vite. Em produção, carrega o index.html buildado.
  const isDev = !app.isPackaged;
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
