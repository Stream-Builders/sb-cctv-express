// Gravação contínua: um ffmpeg por câmera lê o vídeo do go2rtc local (RTSP em 127.0.0.1) e grava em blocos sem
// recomprimir. MP4 fragmentado: se a energia cair, o que já foi gravado no bloco continua abrindo. "Gravando" só vale
// quando o arquivo do bloco está crescendo de verdade.
//
// Para não parar e sempre voltar (o padrão dos NVR e do Frigate):
// - o ffmpeg que cai volta sozinho, com espera crescente (5 s até 60 s) e zerada quando grava de novo;
// - um supervisor a cada 20 s confere cada câmera: se a pasta ou o disco sumiram (disco externo, unidade de rede),
//   espera voltar e retoma; se o ffmpeg está vivo mas o arquivo parou de crescer por 45 s, ele é derrubado e sobe de novo;
// - mudar uma câmera ou a configuração só reinicia o ffmpeg do que mudou (as outras câmeras seguem gravando);
// - timestamps das câmeras baratas são corrigidos (+genpts, discardcorrupt, avoid_negative_ts) e o áudio é reamostrado;
// - o erro de cada ffmpeg vai para logs/<câmera>.log, para saber por que uma câmera parou.
const { app } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync, readdirSync, statSync, statfsSync, unlinkSync, existsSync, appendFileSync, renameSync } = require('node:fs');
const { join } = require('node:path');
const cameras = require('./cameras');
const config = require('./config');

const PORTA_RTSP = 18554; // o mesmo do go2rtc.js (RTSP local)
const PARADO_MS = 45 * 1000; // arquivo sem crescer por mais que isso com o ffmpeg vivo: travado
const processos = new Map(); // id -> estado
let supervisor = null;
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

function pastaLogs() {
  const p = join(app.getPath('userData'), 'logs');
  mkdirSync(p, { recursive: true });
  return p;
}

/** Acrescenta ao log da câmera, girando em 1 MB (fica o atual e o anterior). */
function registrar(id, texto) {
  try {
    const arq = join(pastaLogs(), `gravacao-${id.slice(0, 8)}.log`);
    let tamanho = 0;
    try { tamanho = statSync(arq).size; } catch { /* ainda não existe */ }
    if (tamanho > 1024 * 1024) renameSync(arq, `${arq}.1`);
    appendFileSync(arq, `${new Date().toISOString()} ${texto}\n`);
  } catch { /* log é ajuda, nunca motivo para parar a gravação */ }
}

const dois = (n) => String(n).padStart(2, '0');

/** Nome do bloco pela hora local de início (o mesmo formato de sempre: 2026-11-21_02-27-00.mp4). */
function nomeDoBloco(d) {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}_${dois(d.getHours())}-${dois(d.getMinutes())}-${dois(d.getSeconds())}.mp4`;
}

/**
 * Segundos até a próxima virada de bloco no relógio local (blocos de 2 h viram às 0h, 2h, 4h...). Sobra menor que
 * 10 s entra no bloco seguinte, para não abrir um arquivo de poucos segundos.
 */
function segundosAteVirar(d, segundos) {
  const desdeMeiaNoite = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  const resto = segundos - (desdeMeiaNoite % segundos);
  return resto < 10 ? resto + segundos : resto;
}

// Um ffmpeg por bloco, gravando direto em MP4 fragmentado. O muxer de blocos do ffmpeg (segment) segurava até 256 KB
// antes de escrever no disco: câmera de pouco movimento à noite, ou que quase não manda quadro-chave (a .114 passa
// mais de 75 s sem nenhum), ficava mais de 45 s sem o arquivo crescer, e o supervisor achava que tinha travado. Aqui
// o fragmento fecha a cada 2 s, com ou sem quadro-chave, e vai para o disco na hora.
function argumentos(c, arquivo, duracao) {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    // entrada: TCP, 10 s sem dado derruba (e o supervisor sobe de novo); pacote corrompido é descartado e o pts que
    // falta é gerado, em vez de o ffmpeg morrer com "non monotonous DTS"
    '-rtsp_transport', 'tcp', '-timeout', '10000000',
    '-fflags', '+genpts+discardcorrupt',
    '-i', `rtsp://127.0.0.1:${PORTA_RTSP}/${c.id}`,
    // o vídeo copiado (sem recomprimir) e o áudio, se a câmera tiver, convertido para AAC (o G.711 das câmeras não
    // cabe em MP4) e reamostrado para não acumular atraso; o volume da tela não mexe aqui
    '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-af', 'aresample=async=1',
    '-avoid_negative_ts', 'make_zero',
    '-t', String(duracao),
    // fragmento a cada quadro-chave ou a cada 2 s, o que vier antes, escrito no disco na hora: se a energia cair, o
    // bloco abre até os últimos 2 s, e câmera leve (celular, cena parada) não parece parada
    '-flush_packets', '1', '-frag_duration', '2000000',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4', arquivo,
  ];
}

/** O que, mudando, exige reiniciar o ffmpeg da câmera. */
function chave(c, cfg) {
  return JSON.stringify([pastaDaCamera(cfg.pastaGravacoes, c), Math.round(cfg.minutosPorBloco * 60)]);
}

function iniciarCamera(c, cfg) {
  const pasta = pastaDaCamera(cfg.pastaGravacoes, c);
  const estado = { proc: null, pasta, chave: chave(c, cfg), parado: false, espera: 5000, timer: null, subiuEm: 0, id: c.id };
  const subir = () => {
    estado.timer = null;
    if (estado.parado) return;
    try {
      mkdirSync(pasta, { recursive: true });
    } catch (e) {
      // disco ou unidade de rede fora: o supervisor tenta de novo
      registrar(c.id, `pasta indisponível (${e.code || e.message}); tenta de novo`);
      estado.timer = setTimeout(subir, 20000);
      return;
    }
    const inicio = new Date();
    const duracao = segundosAteVirar(inicio, Math.max(60, Math.round(cfg.minutosPorBloco * 60)));
    const proc = spawn(binario(), argumentos(c, join(pasta, nomeDoBloco(inicio)), duracao), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    estado.proc = proc;
    estado.subiuEm = inicio.getTime();
    const fimDoBloco = inicio.getTime() + duracao * 1000;
    let erro = '';
    proc.stderr.on('data', (d) => {
      erro = (erro + d).slice(-2000);
      // a câmera reiniciou a transmissão (o celular volta com a numeração RTP do zero): o ffmpeg fica vivo sem gravar
      // nada até o supervisor notar; reinicia já, para a gravação perder só uns segundos
      if (/bad cseq/i.test(String(d)) && Date.now() - estado.subiuEm > 10000 && !proc.killed) {
        registrar(c.id, 'a câmera reiniciou a transmissão: reconectando a gravação');
        estado.espera = 1000;
        proc.kill();
      }
    });
    proc.on('error', (e) => registrar(c.id, `não abriu o ffmpeg: ${e.message}`));
    proc.on('exit', (codigo) => {
      if (estado.proc === proc) estado.proc = null;
      if (estado.parado) return;
      // o bloco chegou ao fim (o -t): o próximo começa já, sem espera nem registro
      if (codigo === 0 && Date.now() >= fimDoBloco - 3000) {
        estado.espera = 5000;
        estado.timer = setTimeout(subir, 0);
        return;
      }
      // gravou por mais de 2 min: a queda é nova, volta rápido; senão, espera crescente até 60 s
      if (Date.now() - estado.subiuEm > 120000) estado.espera = 5000;
      registrar(c.id, `ffmpeg saiu (código ${codigo}); volta em ${estado.espera / 1000} s${erro ? `: ${erro.trim().split('\n').slice(-3).join(' | ')}` : ''}`);
      estado.timer = setTimeout(subir, estado.espera);
      estado.espera = Math.min(60000, estado.espera * 2);
    });
  };
  subir();
  processos.set(c.id, estado);
}

function pararCamera(id) {
  const e = processos.get(id);
  if (!e) return;
  e.parado = true;
  if (e.timer) clearTimeout(e.timer);
  if (e.proc && !e.proc.killed) e.proc.kill();
  processos.delete(id);
}

function pararTodas() {
  for (const id of [...processos.keys()]) pararCamera(id);
  if (supervisor) { clearInterval(supervisor); supervisor = null; }
}

/**
 * Põe a gravação em dia com o cadastro e a configuração: sobe o que falta, para o que saiu ou foi desligado e
 * reinicia só a câmera cuja pasta ou tamanho de bloco mudou. Chamado a cada mudança e pelo supervisor.
 */
function sincronizar() {
  const cfg = config.ler();
  try {
    mkdirSync(cfg.pastaGravacoes, { recursive: true });
  } catch {
    return; // pasta ou disco fora: a tela mostra parada e o supervisor tenta de novo em 20 s
  }
  const lista = cameras.ler().filter((c) => c.gravar !== false);
  const ids = new Set(lista.map((c) => c.id));
  for (const id of [...processos.keys()]) if (!ids.has(id)) pararCamera(id);
  for (const c of lista) {
    const e = processos.get(c.id);
    if (e && e.chave !== chave(c, cfg)) pararCamera(c.id);
    if (!processos.has(c.id)) iniciarCamera(c, cfg);
  }
}

/** Derruba o ffmpeg vivo que parou de gravar (conexão meio aberta, câmera congelada): a saída faz ele subir de novo. */
function vigiar() {
  sincronizar();
  const agora = Date.now();
  for (const e of processos.values()) {
    if (!e.proc || agora - e.subiuEm < PARADO_MS) continue;
    const atual = arquivos(e.pasta).at(-1);
    const mexeu = atual ? Math.max(atual.alterado, e.subiuEm) : e.subiuEm;
    if (agora - mexeu > PARADO_MS) {
      registrar(e.id, `arquivo parado há ${Math.round((agora - mexeu) / 1000)} s com o ffmpeg vivo: reiniciando`);
      e.proc.kill();
    }
  }
}

function iniciar() {
  sincronizar();
  if (!supervisor) supervisor = setInterval(vigiar, 20 * 1000);
  if (!limpeza) limpeza = setInterval(limpar, 2 * 60 * 1000);
  setTimeout(limpar, 30 * 1000);
}

/** Arquivos .mp4 de uma pasta, do mais antigo para o mais novo. */
function arquivos(pasta) {
  if (!existsSync(pasta)) return [];
  try {
    return readdirSync(pasta)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => {
        const caminho = join(pasta, f);
        const s = statSync(caminho);
        return { caminho, tamanho: s.size, alterado: s.mtimeMs };
      })
      .sort((a, b) => a.alterado - b.alterado);
  } catch {
    return [];
  }
}

/**
 * Retenção: apaga o que passou dos dias configurados e, se o disco estiver cheio, o mais antigo primeiro. Também tira
 * os arquivos vazios (só o cabeçalho, menos de 1 KB) que sobram quando a câmera cai logo ao abrir.
 */
function limpar() {
  const cfg = config.ler();
  if (!existsSync(cfg.pastaGravacoes)) return;
  const limite = Date.now() - cfg.diasRetencao * 86400000;
  let todos = [];
  try {
    for (const d of readdirSync(cfg.pastaGravacoes, { withFileTypes: true })) {
      if (d.isDirectory()) todos = todos.concat(arquivos(join(cfg.pastaGravacoes, d.name)));
    }
  } catch {
    return;
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
    if (a.tamanho < 1024 && Date.now() - a.alterado > 60000) {
      try { unlinkSync(a.caminho); } catch { /* em uso */ }
    }
  }
  for (const a of todos) {
    if (emGravacao.has(a.caminho) || !existsSync(a.caminho)) continue;
    if (a.alterado < limite || livre() < cfg.espacoMinimoGB) {
      try { unlinkSync(a.caminho); } catch { /* arquivo em uso: fica para a próxima */ }
    } else {
      break;
    }
  }
}

const crescimento = new Map(); // id -> { caminho, tamanho, quando }

/** Estado de gravação de cada câmera: gravando só se o bloco atual cresceu no último minuto. */
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
