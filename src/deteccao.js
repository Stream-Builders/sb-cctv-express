// Detecção de movimento: um ffmpeg por câmera lê o RTSP local do go2rtc em baixa taxa (2 quadros por segundo,
// 320 px de largura) e mede o quanto a cena mudou entre quadros (filtro "scene"). Acima do limiar da sensibilidade, é
// movimento: vira evento (guardado em eventos.json, que marca a linha do tempo) e, se ligado, alerta na tela e no Windows.
// Eventos seguidos na mesma câmera se juntam enquanto o movimento continuar (com 10 s de folga).
const { app, Notification } = require('electron');
const { spawn } = require('node:child_process');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const cameras = require('./cameras');
const config = require('./config');
const gravador = require('./gravador');

const PORTA_RTSP = 18554;
const FOLGA = 10000;
const processos = new Map();
const abertos = new Map(); // id -> evento em andamento
let aoEvento = () => {};

const arquivo = () => join(app.getPath('userData'), 'eventos.json');
function lerEventos() {
  if (!existsSync(arquivo())) return [];
  try { return JSON.parse(readFileSync(arquivo(), 'utf8')); } catch { return []; }
}
function gravarEventos(lista) {
  // guarda só os dias que ainda têm gravação (a mesma retenção dos vídeos)
  const limite = Date.now() - config.ler().diasRetencao * 86400000;
  writeFileSync(arquivo(), JSON.stringify(lista.filter((e) => e.fim > limite)));
}

/** Sensibilidade 1 (pouca) a 10 (muita) vira o limiar de mudança de cena do ffmpeg. */
const limiar = (s) => 0.06 - (Math.min(10, Math.max(1, s)) - 1) * 0.0058;

function registrar(c, agora) {
  const aberto = abertos.get(c.id);
  if (aberto && agora - aberto.fim < FOLGA) {
    aberto.fim = agora;
    return;
  }
  const evento = { id: c.id, nome: c.nome, inicio: agora, fim: agora };
  abertos.set(c.id, evento);
  const lista = lerEventos();
  lista.push(evento);
  gravarEventos(lista);
  aoEvento(evento);
  const cfg = config.ler();
  // CCTV_SEM_AVISO: testes de desenvolvimento sem notificação do Windows
  if (cfg.notificar && !process.env.CCTV_SEM_AVISO && Notification.isSupported()) {
    new Notification({ title: 'CCTV Express', body: `${c.nome}: movimento`, silent: false }).show();
  }
}

/** Fecha no arquivo o fim dos eventos em andamento (chamado de tempos em tempos). */
function salvarAbertos() {
  if (!abertos.size) return;
  const lista = lerEventos();
  for (const e of abertos.values()) {
    const x = lista.find((y) => y.id === e.id && y.inicio === e.inicio);
    if (x) x.fim = e.fim;
    if (Date.now() - e.fim > FOLGA) abertos.delete(e.id);
  }
  gravarEventos(lista);
}

function iniciarCamera(c, cfg) {
  const args = ['-hide_banner', '-nostdin', '-rtsp_transport', 'tcp', '-timeout', '10000000',
    '-i', `rtsp://127.0.0.1:${PORTA_RTSP}/${c.id}`, '-an',
    '-vf', `fps=2,scale=320:-2,select='gt(scene\\,${limiar(cfg.sensibilidade).toFixed(4)})',metadata=print:file=-`,
    '-f', 'null', '-'];
  const estado = { parado: false, proc: null };
  const subir = () => {
    if (estado.parado) return;
    estado.proc = spawn(gravador.binarioFfmpeg(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    estado.proc.stdout.on('data', (d) => { if (String(d).includes('scene_score')) registrar(c, Date.now()); });
    estado.proc.on('exit', () => { if (!estado.parado) setTimeout(subir, 5000); });
  };
  subir();
  processos.set(c.id, estado);
}

function pararTodas() {
  for (const e of processos.values()) {
    e.parado = true;
    if (e.proc && !e.proc.killed) e.proc.kill();
  }
  processos.clear();
}

let relogio = null;
function iniciar(callback) {
  if (callback) aoEvento = callback;
  pararTodas();
  const cfg = config.ler();
  if (!cfg.deteccao) return;
  for (const c of cameras.ler()) if (c.detectar !== false) iniciarCamera(c, cfg);
  if (!relogio) relogio = setInterval(salvarAbertos, 5000);
}

/** Eventos de uma câmera no dia (AAAA-MM-DD, hora local). */
function eventosDoDia(id, dia) {
  const [a, m, d] = dia.split('-').map(Number);
  const ini = new Date(a, m - 1, d).getTime(), fim = ini + 86400000;
  const abertosAgora = [...abertos.values()];
  return lerEventos()
    .map((e) => abertosAgora.find((x) => x.id === e.id && x.inicio === e.inicio) || e)
    .filter((e) => e.id === id && e.fim > ini && e.inicio < fim);
}

/** Câmeras com movimento agora (para o selo na tela). */
function emMovimento() {
  return [...abertos.values()].filter((e) => Date.now() - e.fim < FOLGA).map((e) => e.id);
}

module.exports = { iniciar, pararTodas, eventosDoDia, emMovimento };
