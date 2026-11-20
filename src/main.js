// CCTV Express: processo principal (janela, motor de vídeo e câmeras).
const { app, BrowserWindow, ipcMain, Menu, dialog, shell, powerSaveBlocker } = require('electron');
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
const bandeja = require('./bandeja');

// aberto pelo Windows ao entrar na conta (--oculto): grava sem mostrar a janela; o ícone da bandeja abre
const OCULTO = process.argv.includes('--oculto');
let saindo = false;

gravacoes.registrarEsquema();

// uma janela só: abrir de novo traz a que já está aberta
if (!app.requestSingleInstanceLock()) app.quit();
// Mosaico ao vivo: no Windows, o Chromium mostra cada vídeo por DirectComposition, e com várias câmeras ao mesmo tempo o
// Present da tela segurava a thread da GPU onde o decodificador de vídeo também roda. O decodificador ficava sem vez,
// a câmera de 30 quadros (o celular) travava e o player pulava para o ao vivo a cada 2 a 5 s, cortando imagem e som.
// Medido em 20/11 (RTX 3060, 4 câmeras): com DirectComposition, a tela a 30 fps e o celular a 3-10 fps com até 66% dos
// quadros descartados; sem ela, a tela a 51 fps e o celular a 29 fps, sem pulos.
if (process.platform === 'win32') app.commandLine.appendSwitch('disable-direct-composition');

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
  const splash = OCULTO ? { isDestroyed: () => true, close() {} } : criarSplash();
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
    if (!OCULTO) janela.show();
    if (!splash.isDestroyed()) splash.close();
  });
  // fechar a janela só esconde: a gravação continua (como num NVR); para encerrar, "Sair" no ícone da bandeja
  janela.on('close', (e) => {
    if (saindo) return;
    e.preventDefault();
    janela.hide();
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

function mostrar() {
  if (janela && !janela.isDestroyed()) {
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
  }
}

app.on('second-instance', () => {
  if (janela) {
    janela.show();
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  }
});

/** Motor e gravador recomeçam juntos sempre que a lista de câmeras muda. */
/** Depois de salvar ou remover uma câmera: troca só o que mudou no motor, sem fazer as outras câmeras piscarem. */
async function aplicarCadastro() {
  controle.fecharTodas();
  await go2rtc.resolverOnvif();
  await go2rtc.atualizar();
  setTimeout(() => {
    gravador.iniciar();
    deteccao.iniciar((evento) => { if (janela && !janela.isDestroyed()) janela.webContents.send('deteccao:evento', evento); });
  }, 1500);
}

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

/** A porta DVRIP da Xiongmai (34567) responde neste IP? */
function dvripAberta(ip) {
  return new Promise((ok) => {
    const sock = require('node:net').connect({ host: ip, port: 34567 });
    const fim = (v) => { sock.destroy(); ok(v); };
    sock.setTimeout(1500, () => fim(false));
    sock.once('connect', () => fim(true));
    sock.once('error', () => fim(false));
  });
}

/** Os nomes das lentes pela DVRIP: pela conexão de controle (tipo Xiongmai) ou por uma conexão só para perguntar. */
async function titulosDasLentes(c) {
  if (c.tipo === 'xiongmai') return controle.canais(c.id);
  const { Dvrip } = require('./controle/dvrip');
  const d = new Dvrip({ ip: c.ip, porta: 34567, usuario: c.usuario || 'admin', senha: cameras.abrir(c.senhaCifrada) });
  try {
    await d.entrar();
    const r = await d.ler('ChannelTitle');
    return Array.isArray(r?.ChannelTitle) ? r.ChannelTitle : [];
  } finally {
    try { d.sock?.destroy(); } catch { /* já fechada */ }
  }
}

/**
 * Câmeras Xiongmai (XMEye, iCSee) ainda não verificadas, cadastradas como Xiongmai ou como RTSP (caminho Xiongmai ou
 * porta 34567 aberta): pergunta quantas lentes têm e cadastra as que faltam (até 6 s).
 */
async function completarLentes() {
  const candidatas = cameras.ler().filter((c) => (c.canal || 1) === 1 && !c.lentesVerificadas && ['xiongmai', 'rtsp'].includes(c.tipo));
  await Promise.all(candidatas.map(async (c) => {
    try {
      if (c.tipo === 'rtsp' && !/[?&/_]user=.*channel=/i.test(c.url || '') && !(await dvripAberta(c.ip))) return;
      const titulos = await Promise.race([titulosDasLentes(c), new Promise((_, n) => setTimeout(() => n(new Error('tempo')), 6000))]);
      if (titulos.length) cameras.completarLentes(c.id, titulos);
    } catch { /* câmera fora do ar: tenta de novo na próxima abertura */ }
  }));
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

// a senha salva, só para mostrar na tela de edição quando a pessoa pede (botão do olho)
ipcMain.handle('cameras:senha', (_e, id) => {
  const c = cameras.ler().find((x) => x.id === id);
  return c?.senhaCifrada ? cameras.abrir(c.senhaCifrada) : '';
});
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
  // RTSP sem o caminho do vídeo (só o IP): testa os caminhos das marcas e fica com o que responde
  if (dados.tipo === 'rtsp' && dados.ip) {
    let caminho = '';
    try { caminho = new URL(String(dados.url || '').replace(/^(rstp|rtps):/i, 'rtsp:')).pathname; } catch { /* sem URL */ }
    if (!dados.url || caminho === '/' || caminho === '') {
      const senha = dados.senha || (dados.id ? cameras.senhaDe(dados.id) : '');
      const achado = await require('./controle/rtsp').descobrir({ ip: dados.ip, porta: dados.porta, usuario: dados.usuario || 'admin', senha, canal: dados.canal || 1 });
      if (achado.url) dados = { ...dados, url: achado.url };
    }
  }
  const id = cameras.salvar(dados);
  await completarLentes();
  await aplicarCadastro();
  return id;
});
// arquivo de configuração rápida (.cctvx): o mesmo do app do celular, nos dois sentidos
const arquivo = require('./arquivo');
let arquivoAberto = null;
ipcMain.handle('arquivo:exportar', async (_e, senha) => {
  const hoje = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(janela, { defaultPath: `cctv-express-${hoje}.cctvx`, filters: [{ name: 'CCTV Express', extensions: ['cctvx'] }] });
  if (r.canceled || !r.filePath) return false;
  require('node:fs').writeFileSync(r.filePath, arquivo.montar(String(senha || '')));
  return true;
});
ipcMain.handle('arquivo:abrir', async () => {
  const r = await dialog.showOpenDialog(janela, { properties: ['openFile'], filters: [{ name: 'CCTV Express', extensions: ['cctvx', 'json'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  try { arquivoAberto = require('node:fs').readFileSync(r.filePaths[0], 'utf8'); } catch { return { erro: 'invalido' }; }
  return { cifrado: arquivo.cifrado(arquivoAberto) };
});
ipcMain.handle('arquivo:importar', async (_e, senha) => {
  if (arquivoAberto === null) return { erro: 'invalido' };
  try {
    const novas = arquivo.importar(arquivo.ler(arquivoAberto, String(senha || '')));
    arquivoAberto = null;
    await aplicarCadastro();
    gravador.iniciar();
    deteccao.iniciar();
    return { novas };
  } catch (e) {
    return { erro: e instanceof arquivo.SenhaErrada ? 'senha' : 'invalido' };
  }
});
ipcMain.handle('cameras:remover', async (_e, id) => {
  cameras.remover(id);
  await aplicarCadastro();
});
ipcMain.handle('cameras:gravacao', (_e, id, ligar) => {
  cameras.definirGravacao(id, ligar);
  gravador.iniciar();
});
ipcMain.handle('controle:capacidades', (_e, id) => controle.capacidades(id));
ipcMain.handle('controle:ptz', (_e, id, direcao, parar) => controle.ptz(id, direcao, parar));
ipcMain.handle('controle:luz', (_e, id, modo) => controle.luz(id, modo));
ipcMain.handle('controle:ajustar', (_e, id, chave, valor) => controle.ajustar(id, chave, valor));
ipcMain.handle('controle:posicao', (_e, id, acao, n) => controle.posicao(id, acao, n));
ipcMain.handle('controle:mirar', (_e, id, x, y) => controle.mirar(id, x, y));
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
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: c.iniciarComWindows !== false, args: ['--oculto'] });
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
// idioma escolhido no instalador (código de idioma do Windows gravado pelo NSIS) -> código do app
const LCID = { 1033: 'en', 1046: 'pt-BR', 1034: 'es', 3082: 'es', 1036: 'fr', 1031: 'de', 1040: 'it', 1043: 'nl', 1045: 'pl', 1049: 'ru',
  1053: 'sv', 1055: 'tr', 1066: 'vi', 2052: 'zh-Hans', 1042: 'ko', 1041: 'ja', 1057: 'id', 1081: 'hi', 1025: 'ar' };
ipcMain.handle('sistema:idioma-instalador', () => {
  try {
    const saida = require('node:child_process').execFileSync('reg', ['query', 'HKCU\\Software\\CCTV Express', '/v', 'IdiomaInstalador'], { encoding: 'utf8', windowsHide: true });
    const n = Number((saida.match(/REG_SZ\s+(\d+)/) || [])[1]);
    return LCID[n] || null;
  } catch {
    return null;
  }
});
ipcMain.handle('sistema:idioma', () => app.getPreferredSystemLanguages()[0] || app.getLocale());

app.whenReady().then(() => {
  // o app só recebe áudio das câmeras: microfone, webcam e tela do computador ficam sempre negados
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_w, p, ok) => ok(p !== 'media' && p !== 'display-capture' ? true : false));
  session.defaultSession.setPermissionCheckHandler((_w, p) => p !== 'media');
  gravacoes.servir();
  motorPronto = completarLentes().then(() => reiniciar());
  criarJanela();
  bandeja.criar({ abrir: mostrar, sair: () => { saindo = true; app.quit(); } });
  // o Windows não suspende o app (a gravação para se o processo for suspenso); a tela pode desligar
  powerSaveBlocker.start('prevent-app-suspension');
  // abre com o Windows, escondido na bandeja, para voltar a gravar sozinho depois de reiniciar o computador
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.ler().iniciarComWindows !== false, args: ['--oculto'] });
});

// a janela escondida não fecha o app: só o "Sair" da bandeja (ou o desligamento do Windows) encerra
app.on('window-all-closed', () => { if (saindo) app.quit(); });
app.on('before-quit', () => { saindo = true; });
app.on('before-quit', () => {
  gravador.pararTodas();
  controle.fecharTodas();
  go2rtc.parar();
});
