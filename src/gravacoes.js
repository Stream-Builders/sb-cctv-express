// As gravações já feitas: lista por câmera e dia (pelo nome do arquivo, que é a hora de início), serve os arquivos para
// o player por um protocolo próprio (gravacao://, com suporte a Range) e exporta trechos sem recomprimir.
const { app, protocol, net } = require('electron');
const { spawn } = require('node:child_process');
const { readdirSync, statSync, existsSync, writeFileSync, unlinkSync } = require('node:fs');
const { join, resolve, relative, sep } = require('node:path');
const { pathToFileURL } = require('node:url');
const config = require('./config');
const cameras = require('./cameras');
const gravador = require('./gravador');

const ESQUEMA = 'gravacao';

/** Precisa rodar antes do app ficar pronto. */
function registrarEsquema() {
  protocol.registerSchemesAsPrivileged([{ scheme: ESQUEMA, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);
}

function inicioDoNome(nome) {
  const m = nome.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}

/** Arquivos de uma câmera que tocam o dia pedido (AAAA-MM-DD, hora local), com início e fim em milissegundos. */
function listar(id, dia) {
  const c = cameras.ler().find((x) => x.id === id);
  if (!c) return [];
  const raiz = config.ler().pastaGravacoes;
  const pasta = gravador.pastaDaCamera(raiz, c);
  if (!existsSync(pasta)) return [];
  const [a, m, d] = dia.split('-').map(Number);
  const ini = new Date(a, m - 1, d).getTime(), fim = ini + 86400000;
  return readdirSync(pasta)
    .map((nome) => ({ nome, inicio: inicioDoNome(nome) }))
    .filter((x) => x.inicio !== null)
    .map((x) => {
      const s = statSync(join(pasta, x.nome));
      return { ...x, fim: Math.max(x.inicio + 1000, s.mtimeMs), tamanho: s.size, url: `${ESQUEMA}://arquivo/${encodeURIComponent(relative(raiz, join(pasta, x.nome)))}` };
    })
    // arquivo quase vazio (gravação que caiu logo ao começar) não tem vídeo para tocar
    .filter((x) => x.fim > ini && x.inicio < fim && x.tamanho > 64 * 1024)
    .sort((x, y) => x.inicio - y.inicio);
}

/** Dias que têm gravação (para o calendário marcar). */
function dias(id) {
  const c = cameras.ler().find((x) => x.id === id);
  if (!c) return [];
  const pasta = gravador.pastaDaCamera(config.ler().pastaGravacoes, c);
  if (!existsSync(pasta)) return [];
  return [...new Set(readdirSync(pasta).map((n) => n.slice(0, 10)).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)))].sort();
}

/** O protocolo gravacao://arquivo/<caminho relativo>: só serve arquivos de dentro da pasta de gravações. */
function servir() {
  protocol.handle(ESQUEMA, (req) => {
    const raiz = resolve(config.ler().pastaGravacoes);
    const rel = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''));
    const abs = resolve(raiz, rel);
    if (!abs.startsWith(raiz + sep) || !abs.endsWith('.mp4') || !existsSync(abs)) return new Response('não encontrado', { status: 404 });
    return net.fetch(pathToFileURL(abs).href, { headers: req.headers });
  });
}

/** Exporta o trecho [de, ate] (ms) de uma câmera para um MP4, juntando os arquivos necessários sem recomprimir. */
function exportar(id, de, ate, destino) {
  const dia = new Date(de);
  const chave = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;
  const raiz = config.ler().pastaGravacoes;
  const arquivos = listar(id, chave).filter((x) => x.fim > de && x.inicio < ate);
  if (!arquivos.length) return Promise.reject(new Error('não há gravação nesse trecho'));
  const lista = join(app.getPath('temp'), `cctv-export-${Date.now()}.txt`);
  writeFileSync(lista, arquivos.map((x) => `file '${join(raiz, decodeURIComponent(x.url.split('/arquivo/')[1])).replace(/'/g, "'\\''")}'`).join('\n'));
  const deslocamento = Math.max(0, (de - arquivos[0].inicio) / 1000);
  const duracao = (ate - de) / 1000;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lista,
    '-ss', deslocamento.toFixed(2), '-t', duracao.toFixed(2), '-c', 'copy', '-tag:v', 'hvc1', '-movflags', '+faststart', destino];
  return new Promise((ok, falha) => {
    const p = spawn(gravador.binarioFfmpeg(), args, { windowsHide: true });
    let erro = '';
    p.stderr.on('data', (d) => { erro += d; });
    p.on('exit', (codigo) => {
      try { unlinkSync(lista); } catch { /* já apagado */ }
      codigo === 0 ? ok(destino) : falha(new Error(erro.trim().split('\n').pop() || 'a exportação falhou'));
    });
  });
}

module.exports = { registrarEsquema, servir, listar, dias, exportar };
