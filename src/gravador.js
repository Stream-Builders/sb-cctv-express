// Gravação contínua: um ffmpeg por câmera lê o vídeo do go2rtc local (RTSP em 127.0.0.1) e grava em blocos sem
// recomprimir. MP4 fragmentado: se a energia cair, o que já foi gravado no bloco continua abrindo. O ffmpeg que cai
// volta sozinho. "Gravando" só vale quando o arquivo do bloco está crescendo de verdade.
const { app } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync, readdirSync, statSync, statfsSync, unlinkSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const cameras = require('./cameras');
const config = require('./config');

const PORTA_RTSP = 18554; // o mesmo do go2rtc.js (RTSP local)
const processos = new Map(); // id -> { proc, pasta, parar }
let limpeza = null;

function binario() {
  const empacotado = join(process.resourcesPath || '', 'ffmpeg.exe');
  if (app.isPackaged && existsSync(empacotado)) return empacotado;
  return join(__dirname, '..', 'vendor', 'ffmpeg.exe');
}

/** Nome de pasta seguro a partir do nome da câmera (o id garante que duas câmeras de mesmo nome não se misturem). */
function pastaDaCamera(raiz, c) {
  const nome = String(c.nome || c.ip).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'camera';
  return join(raiz, `${nome}_${c.id.slice(0, 8)}`);
}

function iniciarCamera(c, cfg) {
  const pasta = pastaDaCamera(cfg.pastaGravacoes, c);
  mkdirSync(pasta, { recursive: true });
  const segundos = Math.round(cfg.minutosPorBloco * 60);
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-rtsp_transport', 'tcp', '-timeout', '10000000',
    '-i', `rtsp://127.0.0.1:${PORTA_RTSP}/${c.id}`,
    // o vídeo copiado (sem recomprimir) e o áudio, se a câmera tiver, convertido para AAC (o G.711 das câmeras não
    // cabe em MP4); o volume da tela não mexe aqui: a gravação sempre leva o áudio inteiro
    '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k',
    '-f', 'segment', '-segment_time', String(segundos), '-segment_atclocktime', '1', '-reset_timestamps', '1',
    // grava no disco a cada fragmento (sem esperar o buffer de 256 KB): câmera leve, como a do celular, não parece parada
    '-flush_packets', '1',
    '-strftime', '1', '-segment_format', 'mp4',
    '-segment_format_options', 'movflags=+frag_keyframe+empty_moov+default_base_moof',
    join(pasta, '%Y-%m-%d_%H-%M-%S.mp4'),
  ];
  const estado = { proc: null, pasta, parado: false };
  const subir = () => {
    if (estado.parado) return;
    estado.proc = spawn(binario(), args, { windowsHide: true, stdio: 'ignore' });
    estado.proc.on('exit', () => {
      if (!estado.parado) setTimeout(subir, 5000);
    });
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

function iniciar() {
  pararTodas();
  const cfg = config.ler();
  try {
    mkdirSync(cfg.pastaGravacoes, { recursive: true });
  } catch {
    return; // pasta inválida: a tela mostra que não está gravando
  }
  for (const c of cameras.ler()) if (c.gravar !== false) iniciarCamera(c, cfg);
  if (!limpeza) limpeza = setInterval(limpar, 10 * 60 * 1000);
  setTimeout(limpar, 30 * 1000);
}

/** Arquivos .mp4 de uma pasta, do mais antigo para o mais novo. */
function arquivos(pasta) {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta)
    .filter((f) => f.endsWith('.mp4'))
    .map((f) => {
      const caminho = join(pasta, f);
      const s = statSync(caminho);
      return { caminho, tamanho: s.size, alterado: s.mtimeMs };
    })
    .sort((a, b) => a.alterado - b.alterado);
}

/** Retenção: apaga o que passou dos dias configurados e, se o disco estiver cheio, o mais antigo primeiro. */
function limpar() {
  const cfg = config.ler();
  if (!existsSync(cfg.pastaGravacoes)) return;
  const limite = Date.now() - cfg.diasRetencao * 86400000;
  let todos = [];
  for (const d of readdirSync(cfg.pastaGravacoes, { withFileTypes: true })) {
    if (d.isDirectory()) todos = todos.concat(arquivos(join(cfg.pastaGravacoes, d.name)));
  }
  todos.sort((a, b) => a.alterado - b.alterado);
  // o bloco mais novo de cada câmera está sendo gravado: nunca é apagado
  const emGravacao = new Set([...processos.values()].map((e) => arquivos(e.pasta).at(-1)?.caminho).filter(Boolean));
  const livre = () => {
    const s = statfsSync(cfg.pastaGravacoes);
    return (s.bavail * s.bsize) / 1024 ** 3;
  };
  for (const a of todos) {
    if (emGravacao.has(a.caminho)) continue;
    if (a.alterado < limite || livre() < cfg.espacoMinimoGB) {
      try { unlinkSync(a.caminho); } catch { /* arquivo em uso: fica para a próxima */ }
    } else {
      break;
    }
  }
}

const crescimento = new Map(); // id -> { caminho, tamanho, quando }

/** Estado de gravação de cada câmera: gravando só se o bloco atual cresceu nos últimos 20 s. */
function estados() {
  const r = {};
  for (const c of cameras.ler()) {
    const e = processos.get(c.id);
    if (!e) {
      r[c.id] = c.gravar === false ? 'desligada' : 'parada';
      continue;
    }
    const atual = arquivos(e.pasta).at(-1);
    const antes = crescimento.get(c.id);
    const agora = Date.now();
    let cresceu = false;
    if (atual) {
      if (!antes || antes.caminho !== atual.caminho || atual.tamanho > antes.tamanho) {
        crescimento.set(c.id, { caminho: atual.caminho, tamanho: atual.tamanho, quando: agora });
        cresceu = !!antes;
      }
      const ultimo = crescimento.get(c.id);
      cresceu = cresceu || agora - ultimo.quando < 60000;
    }
    r[c.id] = cresceu ? 'gravando' : 'iniciando';
  }
  return r;
}

module.exports = { binarioFfmpeg: binario, iniciar, pararTodas, estados, limpar, pastaDaCamera };
