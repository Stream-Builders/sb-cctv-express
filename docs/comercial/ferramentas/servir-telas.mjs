// Propriedade intelectual e autoria de André "Tutankhamal" Borba (Stream.Builders) - ORCID 0009-0006-1743-1554. Uso autorizado mediante acordo escrito com o autor.
//
// Servidor das telas para as capturas da apresentação comercial. Entrega a tela do CCTV Express do computador
// (src/ui) e as páginas do app Android (movel/.../assets) no Chrome, com a ponte do Electron e a do Android trocadas
// por uma ponte que lê os dados reais deste computador: o cadastro das câmeras (sem senhas), a configuração, os
// eventos de movimento e as gravações. O vídeo ao vivo vem do motor do app instalado (go2rtc em 127.0.0.1:18984).
//
// Uso: node docs/comercial/ferramentas/servir-telas.mjs   (escuta em http://127.0.0.1:18992)
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DADOS = join(process.env.APPDATA, 'CCTV Express');
const MOTOR = 'http://127.0.0.1:18984';
const PORTA = 18992;
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.mp4': 'video/mp4' };

const lerJson = (arq, padrao) => { try { return JSON.parse(readFileSync(join(DADOS, arq), 'utf8')); } catch { return padrao; } };
// só os campos que a tela mostra: a senha cifrada e o endereço com credenciais ficam de fora
const cameras = () => [].concat(lerJson('cameras.json', [])).map((c) => ({ id: c.id, nome: c.nome, ip: c.ip, porta: c.porta, canal: c.canal || 1, tipo: c.tipo, gravar: c.gravar !== false, usuario: c.usuario || 'admin' }));
const config = () => lerJson('config.json', {});

function pastaDaCamera(c) {
  const nome = String(c.nome || c.ip).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'camera';
  return join(config().pastaGravacoes, `${nome}_${c.id.slice(0, 8)}`);
}
function gravacoes(id, dia) {
  const c = cameras().find((x) => x.id === id);
  if (!c) return { arquivos: [], eventos: [] };
  const pasta = pastaDaCamera(c);
  const [a, m, d] = dia.split('-').map(Number);
  const ini = new Date(a, m - 1, d).getTime(), fim = ini + 86400000;
  const arquivos = !existsSync(pasta) ? [] : readdirSync(pasta).map((nome) => {
    const x = nome.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/);
    if (!x) return null;
    const inicio = new Date(+x[1], x[2] - 1, +x[3], +x[4], +x[5], +x[6]).getTime();
    const s = statSync(join(pasta, nome));
    return { nome, inicio, fim: Math.max(inicio + 1000, s.mtimeMs), tamanho: s.size, url: `/__video/${encodeURIComponent(relative(config().pastaGravacoes, join(pasta, nome)))}` };
  }).filter((x) => x && x.fim > ini && x.inicio < fim && x.tamanho > 64 * 1024).sort((p, q) => p.inicio - q.inicio);
  const eventos = [].concat(lerJson('eventos.json', [])).filter((e) => e.id === id && e.fim > ini && e.inicio < fim);
  return { arquivos, eventos };
}
function dias(id) {
  const c = cameras().find((x) => x.id === id);
  const pasta = c && pastaDaCamera(c);
  if (!pasta || !existsSync(pasta)) return [];
  return [...new Set(readdirSync(pasta).map((n) => n.slice(0, 10)).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)))].sort();
}

// a ponte do Electron (window.cctv), com os dados reais acima; as ações sobre a câmera respondem sem mexer nela
const PONTE_PC = `
const pegar = (u) => fetch(u).then((r) => r.json());
const ok = (v) => Promise.resolve(v);
let vistas = { vistas: [], ronda: { modo: 'vistas', segundos: 15, aoAbrir: false } };
const CAPS = window.__capacidades || {};
window.cctv = {
  listarCameras: () => pegar('/__dados/cameras'), portaMotor: () => ok(18984),
  estadosGravacao: () => pegar('/__dados/cameras').then((l) => Object.fromEntries(l.filter((c) => c.gravar).map((c) => [c.id, 'gravando']))),
  movimentoAgora: () => ok([]), aoMovimento: () => {},
  capacidades: (id) => ok(CAPS[id] || { ptz: false, luz: null }),
  ptz: () => ok(), luz: () => ok(), posicao: () => ok(), ajustar: () => ok(), mirar: () => ok(), definirGravacao: () => ok(),
  idiomaDoInstalador: () => ok(null), idiomaDoSistema: () => ok('pt-BR'),
  lerVistas: () => ok(JSON.parse(JSON.stringify(vistas))), salvarVistas: (d) => { vistas = JSON.parse(JSON.stringify(d)); return ok(JSON.parse(JSON.stringify(vistas))); },
  lerConfig: () => pegar('/__dados/config'), salvarConfig: () => ok(), escolherPasta: () => ok(null), abrirPastaGravacoes: () => ok(),
  listarGravacoes: (id, dia) => pegar('/__dados/gravacoes?id=' + encodeURIComponent(id) + '&dia=' + dia),
  diasComGravacao: (id) => pegar('/__dados/dias?id=' + encodeURIComponent(id)),
  exportarTrecho: () => ok(null), senhaDaCamera: () => ok(''), salvarCamera: () => ok({}), removerCamera: () => ok(),
  detectarCameras: () => ok([]), exportarArquivo: () => ok(null), abrirArquivo: () => ok(null), importarArquivo: () => ok(null),
  minimizarParaBandeja: () => ok(), sair: () => ok(),
};
`;

// as pontes do Android: Inicio, Camera e Assistir. Os quadros do mosaico do celular são players nativos por baixo da
// página; aqui o quadro real da câmera (do motor) vai por baixo, no lugar e no tamanho que a página pede
const PONTE_ANDROID = `
const sinc = (u) => { const x = new XMLHttpRequest(); x.open('GET', u, false); x.send(); return x.responseText; };
window.Inicio = { pularAbertura: () => !!window.__semAbertura, ultimoModo: () => 'assistir', aberturaTerminou: () => { window.escolhaPendente = true; window.mostrarEscolha?.(); }, escolher: () => {} };
window.Camera = {
  estado: () => JSON.stringify(window.__estadoCamera || { aoVivo: false, luz: false, ajuda: '', endereco: '', credenciais: '' }),
  textos: () => sinc('/__android/textos'), dataHora: () => true, acesso: () => JSON.stringify({ usuario: 'cctv', senha: '' }),
  salvarAcesso: () => true, acao: () => {},
};
const camerasCelular = () => JSON.parse(sinc('/__dados/cameras')).map((c) => ({ id: c.id, nome: c.nome, ip: c.ip, porta: c.porta, canal: c.canal, tipo: c.tipo, usuario: c.usuario }));
window.Assistir = {
  listar: () => JSON.stringify(camerasCelular()),
  posicionar: (json) => {
    const dpr = window.devicePixelRatio || 1;
    document.querySelectorAll('.__video').forEach((e) => e.remove());
    for (const p of JSON.parse(json)) {
      const img = document.createElement('img');
      img.className = '__video';
      img.src = '/__quadro/' + encodeURIComponent(p.id) + '.jpg';
      Object.assign(img.style, { position: 'fixed', left: p.x / dpr + 'px', top: p.y / dpr + 'px', width: p.w / dpr + 'px', height: p.h / dpr + 'px', objectFit: 'contain', background: '#000', zIndex: '-1' });
      document.body.append(img);
      setTimeout(() => window.estadoCamera?.(p.id, 'vivo'), 50);
    }
  },
  salvar: () => {}, remover: () => {}, detectar: () => {}, exportar: () => {}, importar: () => {}, senhaDoArquivo: () => {}, inicio: () => {},
};
`;

/** De onde vem cada arquivo das páginas do Android: as do app e as que o build copia do computador. */
function arquivoAndroid(rel) {
  const assets = join(RAIZ, 'movel', 'app', 'src', 'main', 'assets');
  const mapas = [['tema/', join(RAIZ, 'src', 'ui', 'tema')], ['i18n/', join(RAIZ, 'src', 'ui', 'i18n')], ['splash/', join(RAIZ, 'src', 'splash')], ['ui/marca/', join(RAIZ, 'src', 'ui', 'marca')]];
  const direto = join(assets, rel);
  if (existsSync(direto)) return direto;
  for (const [pre, pasta] of mapas) if (rel.startsWith(pre)) return join(pasta, rel.slice(pre.length));
  return null;
}

function textosCelular() {
  const xml = readFileSync(join(RAIZ, 'movel', 'app', 'src', 'main', 'res', 'values-pt', 'strings.xml'), 'utf8');
  const s = Object.fromEntries([...xml.matchAll(/<string name="([^"]+)">([^<]*)<\/string>/g)].map((m) => [m[1], m[2]]));
  return JSON.stringify({ ao_vivo: s.ao_vivo, parado: s.parado, iniciar: s.iniciar, parar: s.parar, trocar: s.trocar, luz: s.luz, escurecer: s.escurecer, datahora: s.datahora, inicio: s.inicio });
}

function enviarArquivo(req, res, arq, extra = '') {
  const tipo = TIPOS[extname(arq)] || 'application/octet-stream';
  if (tipo.startsWith('text/html')) {
    let html = readFileSync(arq, 'utf8');
    html = html.replace(/<head>/, `<head><script src="${extra}"></script>`);
    res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  const tamanho = statSync(arq).size;
  const faixa = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (faixa) {
    const de = faixa[1] ? Number(faixa[1]) : 0;
    const ate = faixa[2] ? Number(faixa[2]) : tamanho - 1;
    res.writeHead(206, { 'Content-Type': tipo, 'Content-Range': `bytes ${de}-${ate}/${tamanho}`, 'Accept-Ranges': 'bytes', 'Content-Length': ate - de + 1 });
    return createReadStream(arq, { start: de, end: ate }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': tamanho, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
  createReadStream(arq).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const json = (v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (p === '/__dados/cameras') return json(cameras());
  if (p === '/__dados/config') return json(config());
  if (p === '/__dados/gravacoes') return json(gravacoes(url.searchParams.get('id'), url.searchParams.get('dia')));
  if (p === '/__dados/dias') return json(dias(url.searchParams.get('id')));
  if (p === '/__android/textos') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(textosCelular()); }
  if (p === '/__ponte-pc.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(PONTE_PC); }
  if (p === '/__ponte-android.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(PONTE_ANDROID); }
  if (p.startsWith('/__quadro/')) {
    const id = p.slice('/__quadro/'.length).replace(/\.jpg$/, '');
    const r = await fetch(`${MOTOR}/api/frame.jpeg?src=${encodeURIComponent(id)}`).catch(() => null);
    if (!r?.ok) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  if (p.startsWith('/__video/')) {
    const raiz = resolve(config().pastaGravacoes);
    const abs = resolve(raiz, p.slice('/__video/'.length));
    if (!abs.startsWith(raiz + sep) || !abs.endsWith('.mp4') || !existsSync(abs)) { res.writeHead(404); return res.end(); }
    return enviarArquivo(req, res, abs);
  }
  if (p.startsWith('/android/')) {
    const arq = arquivoAndroid(normalize(p.slice('/android/'.length)).replace(/\\/g, '/'));
    if (!arq || !existsSync(arq)) { res.writeHead(404); return res.end(); }
    return enviarArquivo(req, res, arq, '/__ponte-android.js');
  }
  const ui = join(RAIZ, 'src', 'ui');
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  const arq = normalize(join(ui, rel));
  if (!arq.startsWith(ui) || !existsSync(arq)) { res.writeHead(404); return res.end(); }
  return enviarArquivo(req, res, arq, '/__ponte-pc.js');
}).listen(PORTA, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${PORTA}/\n`));
