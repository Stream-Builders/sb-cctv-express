// CCTV Express: processo principal (janela, motor de vídeo e câmeras).
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { join } = require('node:path');
const cameras = require('./cameras');
const go2rtc = require('./go2rtc');

// uma janela só: abrir de novo traz a que já está aberta
if (!app.requestSingleInstanceLock()) app.quit();

let janela = null;

function criarJanela() {
  janela = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0d10',
    icon: join(__dirname, '..', 'build', 'icon.png'),
    title: 'CCTV Express',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  janela.loadFile(join(__dirname, 'ui', 'index.html'));
  // conferência visual: com CCTV_PRINT=<arquivo.png>, salva uma imagem da janela 6 s depois de abrir
  if (process.env.CCTV_PRINT) {
    janela.webContents.once('did-finish-load', () => setTimeout(async () => {
      const img = await janela.webContents.capturePage();
      require('node:fs').writeFileSync(process.env.CCTV_PRINT, img.toPNG());
    }, 6000));
  }
}

app.on('second-instance', () => {
  if (janela) {
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  }
});

ipcMain.handle('cameras:listar', () => cameras.listar());
ipcMain.handle('cameras:salvar', (_e, dados) => {
  const id = cameras.salvar(dados);
  go2rtc.iniciar();
  return id;
});
ipcMain.handle('cameras:remover', (_e, id) => {
  cameras.remover(id);
  go2rtc.iniciar();
});
ipcMain.handle('motor:porta', () => go2rtc.PORTA_API);

app.whenReady().then(() => {
  go2rtc.iniciar();
  criarJanela();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => go2rtc.parar());
