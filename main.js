const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 650,
    title: 'Mercadinho - Sistema de Caixa',
    icon: path.join(__dirname, 'resources', 'mercado-delao.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    show: false,
    backgroundColor: '#f3f4f6',
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Confirmação ao fechar — sem bloquear o fechamento
  mainWindow.on('close', (e) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Fechar Programa', 'Cancelar'],
      defaultId: 0,
      cancelId: 1,
      title: 'Mercadinho',
      message: 'Deseja fechar o programa?',
      detail: 'Se o caixa estiver aberto, o estado será preservado e você poderá continuar na próxima abertura.',
    });
    if (choice === 1) e.preventDefault();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
