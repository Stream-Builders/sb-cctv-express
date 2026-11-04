// CCTV Express: processo principal (janela, motor de vídeo e câmeras).
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const { join } = require('node:path');
const { mkdirSync } = require('node:fs');
const cameras = require('./cameras');
const go2rtc = require('./go2rtc');
const gravador = require('./gravador');
const config = require('./config');
const descoberta = require('./descoberta');
const controle = require('./controle');
const gravacoes = require('./gravacoes');
const deteccao = require('./deteccao');

gravacoes.registrarEsquema();

// uma janela só: abrir de novo traz a que já está aberta
if (!app.requestSingleInstanceLock()) app.quit();

let janela = null;
let motorPronto = Promise.resolve();

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
    }, 3400));
  }
  return s;
}

function criarJanela() {
  const splash = criarSplash();
  const minimo = new Promise((ok) => setTimeout(ok, 3800));
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
    // o som das câmeras toca sem precisar de clique antes (o volume e o mudo ficam por câmera na tela)
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  Menu.setApplicationMenu(null);
  // a tela só carrega com o motor no ar (ele espera as câmeras ONVIF informarem o endereço do vídeo): o splash cobre
  const motorNoAr = motorPronto.catch(() => {}).then(() => new Promise((ok) => setTimeout(ok, 800)));
  motorNoAr.then(() => janela.loadFile(join(__dirname, 'ui', 'index.html')));
  const pronta = new Promise((ok) => janela.once('ready-to-show', ok));
  Promise.all([pronta, minimo]).then(() => {
    janela.show();
    if (!splash.isDestroyed()) splash.close();
  });
  // conferência visual: com CCTV_PRINT=<arquivo.png>, salva uma imagem da janela 6 s depois de abrir
  if (process.env.CCTV_PRINT) {
    janela.webContents.once('did-finish-load', () => setTimeout(async () => {
      // CCTV_ABRIR=<id do botão>: abre uma tela antes da captura (ex.: abrir-reproducao)
      if (process.env.CCTV_ABRIR) {
        await janela.webContents.executeJavaScript(`document.getElementById(${JSON.stringify(process.env.CCTV_ABRIR)})?.click()`);
        await new Promise((r) => setTimeout(r, 4000));
        if (process.env.CCTV_DEPURAR) console.log('DEPURAR', await janela.webContents.executeJavaScript(process.env.CCTV_DEPURAR));
      }
      const img = await janela.webContents.capturePage();
      require('node:fs').writeFileSync(process.env.CCTV_PRINT, img.toPNG());
    }, Number(process.env.CCTV_PRINT_MS) || 6000));
  }
}

app.on('second-instance', () => {
  if (janela) {
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  }
});

/** Motor e gravador recomeçam juntos sempre que a lista de câmeras muda. */
async function reiniciar() {
  controle.fecharTodas();
  await go2rtc.resolverOnvif();
  go2rtc.iniciar();
  // o gravador lê do go2rtc: espera ele subir
  setTimeout(() => {
    gravador.iniciar();
    deteccao.iniciar((evento) => { if (janela && !janela.isDestroyed()) janela.webContents.send('deteccao:evento', evento); });
  }, 1500);
}

ipcMain.handle('cameras:listar', () => cameras.listar());
/** A porta informada responde ONVIF? (muita gente põe a porta ONVIF do VMS antigo achando que é a do vídeo) */
async function portaOnvif(ip, porta) {
  if (!ip || !porta) return false;
  try {
    const r = await fetch(`http://${ip}:${porta}/onvif/device_service`, {
      method: 'POST', signal: AbortSignal.timeout(3000), headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
      body: '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>',
    });
    return /Envelope/i.test(await r.text());
  } catch {
    return false;
  }
}

ipcMain.handle('cameras:salvar', async (_e, dados) => {
  // RTSP numa porta que é ONVIF: vira ONVIF, e o endereço do vídeo vem da própria câmera
  if (dados.tipo === 'rtsp') {
    const url = String(dados.url || '').replace(/^(rstp|rtps):/i, 'rtsp:');
    let ip = dados.ip, porta = Number(dados.porta) || null;
    try { const u = new URL(url); ip = u.hostname || ip; porta = Number(u.port) || porta; } catch { /* sem endereço completo */ }
    if (porta && porta !== 554 && (await portaOnvif(ip, porta))) {
      dados = { ...dados, tipo: 'onvif', ip, porta, url: '' };
    }
  }
  const id = cameras.salvar(dados);
  await reiniciar();
  return id;
});
ipcMain.handle('cameras:remover', async (_e, id) => {
  cameras.remover(id);
  await reiniciar();
});
ipcMain.handle('cameras:gravacao', (_e, id, ligar) => {
  cameras.definirGravacao(id, ligar);
  gravador.iniciar();
});
ipcMain.handle('controle:capacidades', (_e, id) => controle.capacidades(id));
ipcMain.handle('controle:ptz', (_e, id, direcao, parar) => controle.ptz(id, direcao, parar));
ipcMain.handle('controle:luz', (_e, id, modo) => controle.luz(id, modo));
ipcMain.handle('gravacoes:listar', (_e, id, dia) => ({ arquivos: gravacoes.listar(id, dia), eventos: deteccao.eventosDoDia(id, dia) }));
ipcMain.handle('gravacoes:dias', (_e, id) => gravacoes.dias(id));
ipcMain.handle('gravacoes:exportar', async (_e, id, de, ate) => {
  const c = cameras.ler().find((x) => x.id === id);
  const d = new Date(de);
  const nome = `${(c?.nome || 'camera').replace(/[^w.-]+/g, '_')}_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}.mp4`;
  const r = await dialog.showSaveDialog(janela, { defaultPath: join(app.getPath('videos'), nome), filters: [{ name: 'MP4', extensions: ['mp4'] }] });
  if (r.canceled || !r.filePath) return null;
  await gravacoes.exportar(id, de, ate, r.filePath);
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
ipcMain.handle('deteccao:agora', () => deteccao.emMovimento());
ipcMain.handle('cameras:detectar', () => descoberta.detectar());
ipcMain.handle('motor:porta', () => go2rtc.PORTA_API);
ipcMain.handle('gravacao:estados', () => gravador.estados());
ipcMain.handle('config:ler', () => config.ler());
ipcMain.handle('config:salvar', (_e, dados) => {
  const c = config.salvar(dados);
  gravador.iniciar();
  deteccao.iniciar();
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
  gravacoes.servir();
  motorPronto = reiniciar();
  criarJanela();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  gravador.pararTodas();
  controle.fecharTodas();
  go2rtc.parar();
});
