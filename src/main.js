// CCTV Express: processo principal (janela, motor de vídeo e câmeras).
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const { join } = require('node:path');
const { mkdirSync } = require('node:fs');
const cameras = require('./cameras');
const go2rtc = require('./go2rtc');
const gravador = require('./gravador');
const config = require('./config');
const descoberta = require('./descoberta');

// uma janela só: abrir de novo traz a que já está aberta
if (!app.requestSingleInstanceLock()) app.quit();

let janela = null;

/** Splash: letreiro 3D numa janela sem borda, enquanto a principal carrega por trás. */
function criarSplash() {
  const s = new BrowserWindow({
    width: 680, height: 340, frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, center: true,
    icon: join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  s.loadFile(join(__dirname, 'splash', 'splash.html'));
  s.once('ready-to-show', () => s.show());
  if (process.env.CCTV_SPLASH_PRINT) {
    s.webContents.once('did-finish-load', () => setTimeout(async () => {
      require('node:fs').writeFileSync(process.env.CCTV_SPLASH_PRINT, (await s.webContents.capturePage()).toPNG());
    }, 2500));
  }
  return s;
}

function criarJanela() {
  const splash = criarSplash();
  const minimo = new Promise((ok) => setTimeout(ok, 2800));
  janela = new BrowserWindow({
    show: false,
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
  const pronta = new Promise((ok) => janela.once('ready-to-show', ok));
  Promise.all([pronta, minimo]).then(() => {
    janela.show();
    if (!splash.isDestroyed()) splash.close();
  });
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

/** Motor e gravador recomeçam juntos sempre que a lista de câmeras muda. */
function reiniciar() {
  go2rtc.iniciar();
  // o gravador lê do go2rtc: espera ele subir
  setTimeout(() => gravador.iniciar(), 1500);
}

ipcMain.handle('cameras:listar', () => cameras.listar());
ipcMain.handle('cameras:salvar', (_e, dados) => {
  const id = cameras.salvar(dados);
  reiniciar();
  return id;
});
ipcMain.handle('cameras:remover', (_e, id) => {
  cameras.remover(id);
  reiniciar();
});
ipcMain.handle('cameras:gravacao', (_e, id, ligar) => {
  cameras.definirGravacao(id, ligar);
  gravador.iniciar();
});
ipcMain.handle('cameras:detectar', () => descoberta.detectar());
ipcMain.handle('motor:porta', () => go2rtc.PORTA_API);
ipcMain.handle('gravacao:estados', () => gravador.estados());
ipcMain.handle('config:ler', () => config.ler());
ipcMain.handle('config:salvar', (_e, dados) => {
  const c = config.salvar(dados);
  gravador.iniciar();
  return c;
});
ipcMain.handle('config:escolher-pasta', async () => {
  const r = await dialog.showOpenDialog(janela, { properties: ['openDirectory', 'createDirectory'], defaultPath: config.ler().pastaGravacoes });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('config:abrir-pasta', () => {
  const pasta = config.ler().pastaGravacoes;
  mkdirSync(pasta, { recursive: true });
  return shell.openPath(pasta);
});
ipcMain.handle('sistema:idioma', () => app.getPreferredSystemLanguages()[0] || app.getLocale());

app.whenReady().then(() => {
  reiniciar();
  criarJanela();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  gravador.pararTodas();
  go2rtc.parar();
});
