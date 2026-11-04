// CCTV Express: a tela. O vídeo de cada câmera vem do go2rtc local pelo componente <video-stream> (MSE/WebRTC).
import './video-stream.js';
import { IDIOMAS, carregar as carregarIdioma, maisProximo, t, traduzirPagina, idioma } from './i18n/i18n.js';

const porta = await window.cctv.portaMotor();
const motor = `127.0.0.1:${porta}`;

const $ = (id) => document.getElementById(id);
const mosaicoEl = $('mosaico');
const listaEl = $('lista');
const resumoEl = $('resumo');
const dialogo = $('dialogo');
const form = $('formulario');
const dialogoConfig = $('dialogo-config');
const formConfig = $('form-config');
const dialogoDetectar = $('dialogo-detectar');

let cameras = [];
let mosaico = Number(localStorage.getItem('mosaico')) || 4;
let selecionado = 0;
let telaCheia = null;
const estados = new Map(); // id -> 'conectando' | 'vivo' | 'semSinal'
let gravacao = {};
let movimento = new Set(); // id -> 'gravando' | 'iniciando' | 'desligada' | 'parada'

// ---------- peças ----------
const ICONES = {
  gravar: '<circle cx="12" cy="12" r="6"/>',
  luz: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  ptz: '<circle cx="12" cy="12" r="3"/><path d="M12 2l3 3H9zM12 22l-3-3h6zM2 12l3-3v6zM22 12l-3 3V9z"/>',
  telaCheia: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
};

function botao({ icone, rotulo, titulo, classes = '', quadrado = false }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `sb-btn sb-btn--sm ${quadrado ? 'sb-btn--square' : ''} ${classes}`;
  b.innerHTML = `<span class="sb-btn__ico" aria-hidden="true"><svg viewBox="0 0 24 24">${icone}</svg></span>${rotulo ? '<span class="sb-btn__body"><span class="sb-btn__label"></span></span>' : ''}<span class="sb-btn__gloss" aria-hidden="true"></span>`;
  if (rotulo) b.querySelector('.sb-btn__label').textContent = rotulo;
  if (titulo) { b.title = titulo; b.setAttribute('aria-label', titulo); }
  return b;
}

/** Selo de estado em paralelogramo: o texto vai num span que desfaz a inclinação. */
function selo(classe, texto) {
  const s = document.createElement('span');
  s.className = `selo selo--${classe}`;
  const i = document.createElement('span');
  i.className = 'selo__texto';
  i.textContent = texto;
  s.append(i);
  return s;
}

function trocarSelo(s, classe, texto) {
  s.className = `selo selo--${classe}`;
  s.firstChild.textContent = texto;
}

const ROTULO_ESTADO = () => ({ vivo: t('estado.vivo'), conectando: t('estado.conectando'), semSinal: t('estado.semSinal') });
function seloGravacao(id) {
  const g = gravacao[id];
  if (g === 'gravando') return ['gravando', t('gravacao.gravando')];
  if (g === 'iniciando') return ['iniciando', t('gravacao.iniciando')];
  if (g === 'parada') return ['nao-grava', t('gravacao.parada')];
  return ['nao-grava', t('gravacao.naoGrava')];
}

// ---------- mosaico ----------
const LAYOUTS = [1, 4, 9, 16, 25, 36];
function desenharBotoesMosaico() {
  const nav = $('mosaicos');
  nav.replaceChildren();
  for (const n of LAYOUTS) {
    const lado = Math.sqrt(n);
    const passo = 16 / lado;
    let d = 'M4 4h16v16H4z';
    for (let k = 1; k < lado; k++) d += `M${4 + k * passo} 4v16M4 ${4 + k * passo}h16`;
    const b = botao({ icone: `<path d="${d}"/>`, rotulo: String(n), titulo: n === 1 ? t('mosaico.um') : t('mosaico.titulo', { n }) });
    b.dataset.mosaico = n;
    b.addEventListener('click', () => {
      mosaico = n;
      telaCheia = null;
      localStorage.setItem('mosaico', String(n));
      desenharMosaico();
    });
    nav.append(b);
  }
}

function barraDoQuadro(cam) {
  const barra = document.createElement('div');
  barra.className = 'quadro__barra';
  const ligada = cam.gravar !== false;
  const gravar = botao({ icone: ICONES.gravar, quadrado: true, titulo: ligada ? t('quadro.pararGravacao') : t('quadro.gravar'), classes: ligada ? 'sb-btn--danger' : '' });
  gravar.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.cctv.definirGravacao(cam.id, !ligada);
    await carregar();
  });
  // luz e PTZ: ficam ativos só se a câmera informar o recurso (as capacidades chegam da própria câmera)
  const luz = botao({ icone: ICONES.luz, quadrado: true, titulo: t('quadro.luz') });
  const ptz = botao({ icone: ICONES.ptz, quadrado: true, titulo: t('quadro.ptz') });
  luz.disabled = true;
  ptz.disabled = true;
  window.cctv.capacidades(cam.id).then((caps) => {
    if (caps.luz) {
      luz.disabled = false;
      luz.addEventListener('click', (e) => { e.stopPropagation(); alternarPainel(barra, 'luz', () => painelLuz(cam, caps)); });
    } else luz.title = t('quadro.semRecurso', { nome: t('quadro.luz') });
    if (caps.ptz) {
      ptz.disabled = false;
      ptz.addEventListener('click', (e) => { e.stopPropagation(); alternarPainel(barra, 'ptz', () => painelPtz(cam)); });
    } else ptz.title = t('quadro.semRecurso', { nome: t('quadro.ptz') });
  });
  const cheia = botao({ icone: ICONES.telaCheia, quadrado: true, titulo: t('quadro.telaCheia') });
  cheia.addEventListener('click', (e) => {
    e.stopPropagation();
    telaCheia = telaCheia ? null : cam.id;
    desenharMosaico();
  });
  barra.append(gravar, luz, ptz, cheia);
  return barra;
}

/** Abre o painel pedido sobre o quadro (ou fecha, se for o mesmo que já está aberto). */
function alternarPainel(barra, tipo, criar) {
  const quadro = barra.closest('.quadro');
  const aberto = quadro.querySelector('.painel-quadro');
  if (aberto) aberto.remove();
  if (aberto?.dataset.tipo === tipo) return;
  const p = criar();
  p.dataset.tipo = tipo;
  p.addEventListener('click', (e) => e.stopPropagation());
  p.addEventListener('dblclick', (e) => e.stopPropagation());
  quadro.append(p);
}

const SETA = {
  cima: '<path d="M12 5l-7 8h14z"/>', baixo: '<path d="M12 19l-7-8h14z"/>',
  esquerda: '<path d="M5 12l8-7v14z"/>', direita: '<path d="M19 12l-8-7v14z"/>',
  aproximar: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/>',
  afastar: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8 11h6"/>',
};

/** PTZ: segurar o botão move a câmera; soltar (ou sair do botão) para. */
function painelPtz(cam) {
  const p = document.createElement('div');
  p.className = 'painel-quadro painel-ptz';
  for (const dir of ['cima', 'esquerda', 'direita', 'baixo', 'aproximar', 'afastar']) {
    const b = botao({ icone: SETA[dir], quadrado: true, titulo: t(`ptz.${dir}`) });
    b.dataset.dir = dir;
    let movendo = false;
    const parar = () => { if (movendo) { movendo = false; b.classList.remove('sb-btn--ativo'); window.cctv.ptz(cam.id, dir, true).catch(() => {}); } };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      movendo = true;
      b.classList.add('sb-btn--ativo');
      window.cctv.ptz(cam.id, dir, false).catch(() => parar());
    });
    b.addEventListener('pointerup', parar);
    b.addEventListener('pointercancel', parar);
    b.addEventListener('lostpointercapture', parar);
    p.append(b);
  }
  return p;
}

/** Luz: os modos que a câmera tem, com o atual marcado. */
function painelLuz(cam, caps) {
  const p = document.createElement('div');
  p.className = 'painel-quadro painel-luz';
  for (const modo of caps.luz) {
    const b = botao({ icone: ICONES.luz, rotulo: t(`luz.${modo}`), classes: caps.luzAtual === modo ? 'sb-btn--ativo' : '' });
    b.addEventListener('click', async () => {
      try {
        await window.cctv.luz(cam.id, modo);
        caps.luzAtual = modo;
        for (const x of p.children) x.classList.toggle('sb-btn--ativo', x === b);
      } catch { /* a câmera recusou: o modo marcado continua o anterior */ }
    });
    p.append(b);
  }
  return p;
}

function quadroDaCamera(cam) {
  const q = document.createElement('div');
  q.className = 'quadro';
  q.dataset.id = cam.id;
  const video = document.createElement('video-stream');
  video.background = true;
  video.mode = 'mse,hls,mjpeg';
  video.src = `ws://${motor}/api/ws?src=${encodeURIComponent(cam.id)}`;
  q.append(video);
  const topo = document.createElement('div');
  topo.className = 'quadro__topo';
  const nome = document.createElement('span');
  nome.className = 'quadro__nome';
  nome.textContent = cam.nome;
  const est = estados.get(cam.id) || 'conectando';
  const estado = selo(est, ROTULO_ESTADO()[est]);
  estado.dataset.papel = 'estado';
  const grav = selo(...seloGravacao(cam.id));
  grav.dataset.papel = 'gravacao';
  const mov = selo('movimento', t('deteccao.movimento'));
  mov.dataset.papel = 'movimento';
  topo.append(estado, grav, mov, nome);
  q.append(topo, barraDoQuadro(cam));
  vigiar(cam.id, q, video);
  return q;
}

/** Estado pelo vídeo de verdade: o tempo do vídeo avançando é "ao vivo"; parado por 15 s vira "sem sinal". */
function vigiar(id, quadro, componente) {
  let ultimoTempo = -1;
  let paradoDesde = Date.now();
  if (!estados.has(id)) estados.set(id, 'conectando');
  const tm = setInterval(() => {
    if (!quadro.isConnected) return clearInterval(tm);
    const v = componente.querySelector('video');
    // câmera ao vivo não tem play, tempo nem barra de progresso: o player do go2rtc liga os controles por padrão
    if (v && v.controls) v.controls = false;
    // o navegador recusou o vídeo (perfil H264 que ele não decodifica): passa para o stream reconvertido, uma vez só
    if (v && v.error && !quadro.dataset.compat) {
      quadro.dataset.compat = '1';
      componente.src = `ws://${motor}/api/ws?src=${encodeURIComponent(`${id}_compat`)}`;
      paradoDesde = Date.now();
    }
    const agora = v ? v.currentTime : 0;
    let novo;
    if (v && agora !== ultimoTempo && !v.paused) {
      novo = 'vivo';
      paradoDesde = Date.now();
    } else {
      // tolerância: câmera de poucos quadros por segundo (ou vídeo reconvertido) chega em rajadas; o selo só sai de
      // "ao vivo" depois de 4 s sem imagem nova, e vira "sem sinal" aos 15 s
      const parado = Date.now() - paradoDesde;
      novo = parado > 15000 ? 'semSinal' : parado > 4000 || estados.get(id) !== 'vivo' ? 'conectando' : 'vivo';
    }
    ultimoTempo = agora;
    if (novo !== estados.get(id)) {
      estados.set(id, novo);
      trocarSelo(quadro.querySelector('[data-papel="estado"]'), novo, ROTULO_ESTADO()[novo]);
      desenharLista();
      desenharResumo();
    }
  }, 1000);
}

function desenharMosaico() {
  mosaicoEl.replaceChildren();
  const lado = Math.sqrt(mosaico);
  const n = telaCheia ? 1 : mosaico;
  const colunas = telaCheia ? 1 : lado;
  mosaicoEl.style.gridTemplateColumns = `repeat(${colunas}, 1fr)`;
  mosaicoEl.style.gridTemplateRows = `repeat(${colunas}, 1fr)`;
  const visiveis = telaCheia ? cameras.filter((c) => c.id === telaCheia) : cameras.slice(0, n);
  for (let i = 0; i < n; i++) {
    const cam = visiveis[i];
    let q;
    if (cam) {
      q = quadroDaCamera(cam);
    } else {
      q = document.createElement('div');
      q.className = 'quadro';
      const v = document.createElement('span');
      v.className = 'quadro__vazio';
      v.textContent = cameras.length ? '' : t('mosaico.vazio');
      q.append(v);
    }
    if (i === selecionado && !telaCheia) q.classList.add('quadro--selecionado');
    q.addEventListener('click', () => {
      selecionado = i;
      document.querySelectorAll('.quadro').forEach((x, k) => x.classList.toggle('quadro--selecionado', k === i));
    });
    q.addEventListener('dblclick', () => {
      if (!cam) return;
      telaCheia = telaCheia ? null : cam.id;
      desenharMosaico();
    });
    mosaicoEl.append(q);
  }
  document.querySelectorAll('[data-mosaico]').forEach((b) => {
    const ativo = Number(b.dataset.mosaico) === mosaico && !telaCheia;
    b.classList.toggle('sb-btn--ativo', ativo);
    b.setAttribute('aria-pressed', String(ativo));
  });
}

// ---------- lateral e resumo ----------
function desenharLista() {
  listaEl.replaceChildren();
  if (!cameras.length) {
    const li = document.createElement('li');
    li.className = 'lista__vazia';
    li.textContent = t('lateral.vazia');
    listaEl.append(li);
    return;
  }
  for (const cam of cameras) {
    const li = document.createElement('li');
    const ponto = document.createElement('span');
    ponto.className = `ponto ponto--${estados.get(cam.id) || 'parado'}`;
    const texto = document.createElement('div');
    texto.textContent = cam.nome;
    const info = document.createElement('small');
    const est = ROTULO_ESTADO()[estados.get(cam.id)] || t('estado.foraDoMosaico');
    info.textContent = `${cam.ip}${cam.tipo === 'xiongmai' ? ` · ${t('lateral.canal', { n: cam.canal })}` : ''} · ${est} · ${seloGravacao(cam.id)[1]}`;
    texto.append(info);
    const editar = document.createElement('button');
    editar.className = 'editar';
    editar.textContent = t('lateral.editar');
    editar.addEventListener('click', (e) => { e.stopPropagation(); abrirFormulario(cam); });
    li.append(ponto, texto, editar);
    li.addEventListener('dblclick', () => { telaCheia = cam.id; desenharMosaico(); });
    listaEl.append(li);
  }
}

function desenharResumo() {
  resumoEl.replaceChildren();
  const vivos = cameras.filter((c) => estados.get(c.id) === 'vivo').length;
  const semSinal = cameras.filter((c) => estados.get(c.id) === 'semSinal').length;
  const gravando = cameras.filter((c) => gravacao[c.id] === 'gravando').length;
  resumoEl.append(selo('vivo', t('resumo.vivos', { n: vivos })));
  if (semSinal) resumoEl.append(selo('semSinal', t('resumo.semSinal', { n: semSinal })));
  if (cameras.length) resumoEl.append(selo(gravando ? 'gravando' : 'nao-grava', t('resumo.gravando', { n: gravando, total: cameras.length })));
}

/** O estado de gravação vem do disco (o arquivo do bloco crescendo), conferido a cada 3 s. */
async function atualizarGravacao() {
  gravacao = await window.cctv.estadosGravacao();
  movimento = new Set(await window.cctv.movimentoAgora());
  for (const q of document.querySelectorAll('.quadro[data-id]')) q.classList.toggle('quadro--movimento', movimento.has(q.dataset.id));
  for (const q of document.querySelectorAll('.quadro[data-id]')) {
    const s = q.querySelector('[data-papel="gravacao"]');
    if (s) trocarSelo(s, ...seloGravacao(q.dataset.id));
  }
  desenharResumo();
  desenharLista();
}

// ---------- formulário da câmera ----------
function atualizarCamposTipo() {
  form.querySelector('.so-rtsp').hidden = form.tipo.value !== 'rtsp';
}

function abrirFormulario(cam, sugestao) {
  form.reset();
  form.id.value = cam?.id || '';
  $('formulario-titulo').textContent = cam ? t('form.editar') : t('form.adicionar');
  $('remover').hidden = !cam;
  $('formulario-aviso').textContent = '';
  form.senha.placeholder = t('form.senhaCifrada');
  const dados = cam || sugestao;
  if (dados) for (const k of ['nome', 'tipo', 'ip', 'porta', 'canal', 'usuario', 'url']) if (form[k] && dados[k] != null) form[k].value = dados[k];
  if (cam) {
    form.gravar.checked = cam.gravar !== false;
    if (cam.temSenha) form.senha.placeholder = t('form.senhaManter');
  }
  atualizarCamposTipo();
  dialogo.showModal();
}

async function carregar() {
  cameras = await window.cctv.listarCameras();
  if (telaCheia && !cameras.some((c) => c.id === telaCheia)) telaCheia = null;
  desenharMosaico();
  desenharLista();
  desenharResumo();
}

$('adicionar').addEventListener('click', () => abrirFormulario(null));
for (const b of document.querySelectorAll('[data-fechar]')) b.addEventListener('click', () => b.closest('dialog').close());
form.tipo.addEventListener('change', atualizarCamposTipo);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(form));
  dados.gravar = form.gravar.checked;
  try {
    await window.cctv.salvarCamera(dados);
    dialogo.close();
    // o motor reinicia com a câmera nova: dá um instante para ele subir
    setTimeout(carregar, 800);
  } catch (err) {
    $('formulario-aviso').textContent = String(err.message || err);
  }
});
$('remover').addEventListener('click', async () => {
  if (!form.id.value) return;
  await window.cctv.removerCamera(form.id.value);
  dialogo.close();
  setTimeout(carregar, 800);
});

// ---------- configurações ----------
const seletorIdioma = $('idioma');
for (const [codigo, nome] of Object.entries(IDIOMAS)) {
  const o = document.createElement('option');
  o.value = codigo;
  o.textContent = nome;
  seletorIdioma.append(o);
}

$('abrir-config').addEventListener('click', async () => {
  const c = await window.cctv.lerConfig();
  for (const k of ['pastaGravacoes', 'minutosPorBloco', 'diasRetencao', 'espacoMinimoGB', 'sensibilidade']) formConfig[k].value = c[k];
  formConfig.deteccao.checked = c.deteccao;
  formConfig.notificar.checked = c.notificar;
  seletorIdioma.value = idioma;
  dialogoConfig.showModal();
});
$('escolher-pasta').addEventListener('click', async () => {
  const p = await window.cctv.escolherPasta();
  if (p) formConfig.pastaGravacoes.value = p;
});
$('abrir-pasta').addEventListener('click', () => window.cctv.abrirPastaGravacoes());
formConfig.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(formConfig));
  dados.deteccao = formConfig.deteccao.checked;
  dados.notificar = formConfig.notificar.checked;
  const novoIdioma = dados.idioma;
  delete dados.idioma;
  await window.cctv.salvarConfig(dados);
  if (novoIdioma !== idioma) {
    localStorage.setItem('idioma', novoIdioma);
    await aplicarIdioma(novoIdioma);
  }
  dialogoConfig.close();
});

// ---------- detectar na rede ----------
async function detectar() {
  const lista = $('detectar-lista');
  const estado = $('detectar-estado');
  lista.replaceChildren();
  estado.textContent = t('detectar.procurando');
  $('detectar-de-novo').disabled = true;
  const achados = await window.cctv.detectarCameras();
  $('detectar-de-novo').disabled = false;
  estado.textContent = achados.length ? '' : t('detectar.nenhuma');
  const tipos = { xiongmai: 'Xiongmai', onvif: 'ONVIF', rtsp: 'RTSP' };
  for (const a of achados) {
    const li = document.createElement('li');
    const texto = document.createElement('div');
    texto.textContent = `${a.ip} · ${tipos[a.tipo]}`;
    const info = document.createElement('small');
    info.textContent = t('detectar.portas', { p: a.portas.join(', ') || a.porta });
    texto.append(info);
    li.append(document.createElement('span'), texto);
    if (cameras.some((c) => c.ip === a.ip)) {
      const j = document.createElement('small');
      j.textContent = t('detectar.jaAdicionada');
      li.append(j);
    } else {
      const b = botao({ icone: '<path d="M12 5v14M5 12h14"/>', rotulo: t('detectar.adicionar') });
      b.addEventListener('click', () => {
        dialogoDetectar.close();
        abrirFormulario(null, { ip: a.ip, tipo: a.tipo, porta: a.tipo === 'xiongmai' ? '' : a.porta, nome: a.ip });
      });
      li.append(b);
    }
    lista.append(li);
  }
}
$('detectar').addEventListener('click', () => { dialogoDetectar.showModal(); detectar(); });
$('detectar-de-novo').addEventListener('click', detectar);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && telaCheia && !document.querySelector('dialog[open]')) { telaCheia = null; desenharMosaico(); }
});

// ---------- reprodução ----------
// A linha do tempo do dia: faixas das gravações e marcas de movimento; clicar toca daquele ponto. Marcar início e fim
// seleciona o trecho para exportar (MP4 sem recomprimir).
const dialogoRep = $('dialogo-reproducao');
const repVideo = $('rep-video');
const repFaixa = $('rep-faixa');
let rep = { arquivos: [], eventos: [], dia0: 0, atual: null, de: null, ate: null };
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hora = (ms) => new Date(ms).toLocaleTimeString(idioma, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const pos = (ms) => `${((ms - rep.dia0) / 864000).toFixed(4)}%`;

function desenharHoras() {
  const h = $('rep-horas');
  h.replaceChildren();
  for (let i = 0; i <= 24; i += 3) {
    const s = document.createElement('span');
    s.style.insetInlineStart = `${(i / 24) * 100}%`;
    s.textContent = `${String(i).padStart(2, '0')}h`;
    h.append(s);
  }
}

function desenharLinha() {
  repFaixa.replaceChildren();
  for (const a of rep.arquivos) {
    const b = document.createElement('span');
    b.className = 'linha-tempo__gravacao';
    b.style.insetInlineStart = pos(Math.max(a.inicio, rep.dia0));
    b.style.width = `${((Math.min(a.fim, rep.dia0 + 86400000) - Math.max(a.inicio, rep.dia0)) / 864000).toFixed(4)}%`;
    repFaixa.append(b);
  }
  for (const e of rep.eventos) {
    const m = document.createElement('span');
    m.className = 'linha-tempo__evento';
    m.style.insetInlineStart = pos(e.inicio);
    m.style.width = `max(2px, ${((e.fim - e.inicio) / 864000).toFixed(4)}%)`;
    m.title = `${t('deteccao.movimento')} ${hora(e.inicio)}`;
    repFaixa.append(m);
  }
  if (rep.de !== null && rep.ate !== null) {
    const s = document.createElement('span');
    s.className = 'linha-tempo__trecho';
    s.style.insetInlineStart = pos(Math.min(rep.de, rep.ate));
    s.style.width = `${(Math.abs(rep.ate - rep.de) / 864000).toFixed(4)}%`;
    repFaixa.append(s);
  }
  const cursor = document.createElement('span');
  cursor.className = 'linha-tempo__cursor';
  cursor.id = 'rep-cursor';
  repFaixa.append(cursor);
  atualizarTrecho();
}

function atualizarTrecho() {
  const ok = rep.de !== null && rep.ate !== null && rep.ate > rep.de;
  $('rep-trecho').textContent = rep.de !== null || rep.ate !== null
    ? `${rep.de !== null ? hora(rep.de) : '--:--:--'} → ${rep.ate !== null ? hora(rep.ate) : '--:--:--'}` : '';
  $('rep-exportar').disabled = !ok;
}

/** Toca o instante pedido (ms), abrindo o arquivo que o contém. */
function tocar(ms) {
  const a = rep.arquivos.find((x) => ms >= x.inicio && ms < x.fim) || rep.arquivos.find((x) => x.inicio > ms);
  if (!a) return;
  const alvo = Math.max(0, (Math.max(ms, a.inicio) - a.inicio) / 1000);
  if (rep.atual !== a) {
    rep.atual = a;
    repVideo.src = a.url;
    repVideo.addEventListener('loadedmetadata', () => { repVideo.currentTime = alvo; repVideo.play().catch(() => {}); }, { once: true });
  } else {
    repVideo.currentTime = alvo;
    repVideo.play().catch(() => {});
  }
}

const instanteAtual = () => (rep.atual ? rep.atual.inicio + repVideo.currentTime * 1000 : null);

repVideo.addEventListener('timeupdate', () => {
  const ms = instanteAtual();
  if (ms === null) return;
  $('rep-hora').textContent = hora(ms);
  const c = $('rep-cursor');
  if (c) c.style.insetInlineStart = pos(ms);
});
// ao acabar um arquivo, segue para o próximo
repVideo.addEventListener('ended', () => {
  const i = rep.arquivos.indexOf(rep.atual);
  if (rep.arquivos[i + 1]) tocar(rep.arquivos[i + 1].inicio);
});

repFaixa.addEventListener('click', (e) => {
  const r = repFaixa.getBoundingClientRect();
  const frac = (document.documentElement.dir === 'rtl' ? r.right - e.clientX : e.clientX - r.left) / r.width;
  tocar(rep.dia0 + Math.min(1, Math.max(0, frac)) * 86400000);
});

async function carregarReproducao() {
  const id = $('rep-camera').value;
  const dia = $('rep-dia').value || hoje();
  const [a, m, d] = dia.split('-').map(Number);
  rep = { ...(await window.cctv.listarGravacoes(id, dia)), dia0: new Date(a, m - 1, d).getTime(), atual: null, de: null, ate: null };
  repVideo.removeAttribute('src');
  repVideo.load();
  $('rep-vazio').textContent = rep.arquivos.length ? '' : t('reproducao.semGravacao');
  $('rep-hora').textContent = '--:--:--';
  desenharLinha();
  // abre no movimento mais recente, ou no começo da última gravação
  // (o bloco em gravação agora ainda está crescendo: abre no anterior a ele, se houver)
  const emGravacao = rep.arquivos.at(-1) && Date.now() - rep.arquivos.at(-1).fim < 30000;
  const base = rep.arquivos.at(emGravacao && rep.arquivos.length > 1 ? -2 : -1);
  const ultimo = rep.eventos.at(-1)?.inicio ?? base?.inicio;
  if (ultimo) tocar(ultimo);
}

$('abrir-reproducao').addEventListener('click', () => {
  const sel = $('rep-camera');
  sel.replaceChildren(...cameras.map((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.nome; return o; }));
  const visivel = document.querySelector('.quadro--selecionado[data-id]')?.dataset.id;
  if (visivel) sel.value = visivel;
  $('rep-dia').value = hoje();
  $('rep-dia').max = hoje();
  desenharHoras();
  dialogoRep.showModal();
  if (cameras.length) carregarReproducao();
});
$('rep-camera').addEventListener('change', carregarReproducao);
$('rep-dia').addEventListener('change', carregarReproducao);
dialogoRep.addEventListener('close', () => { repVideo.pause(); repVideo.removeAttribute('src'); repVideo.load(); });
$('rep-marcar-inicio').addEventListener('click', () => { rep.de = instanteAtual(); desenharLinha(); });
$('rep-marcar-fim').addEventListener('click', () => { rep.ate = instanteAtual(); desenharLinha(); });
$('rep-exportar').addEventListener('click', async () => {
  const b = $('rep-exportar');
  b.disabled = true;
  try {
    const destino = await window.cctv.exportarTrecho($('rep-camera').value, rep.de, rep.ate);
    if (destino) $('rep-trecho').textContent = t('reproducao.exportado');
  } catch (err) {
    $('rep-trecho').textContent = String(err.message || err);
  }
  b.disabled = false;
});

// movimento ao vivo: o selo acende na hora, sem esperar a próxima conferência
window.cctv.aoMovimento((ev) => {
  movimento.add(ev.id);
  document.querySelector(`.quadro[data-id="${ev.id}"]`)?.classList.add('quadro--movimento');
});

// ---------- idioma ----------
async function aplicarIdioma(codigo) {
  await carregarIdioma(codigo);
  desenharBotoesMosaico();
  if (cameras.length || mosaicoEl.childElementCount) {
    desenharMosaico();
    desenharLista();
    desenharResumo();
  }
}

let escolhido = null;
try { escolhido = localStorage.getItem('idioma'); } catch { /* sem armazenamento: segue o Windows */ }
await aplicarIdioma(escolhido || maisProximo(await window.cctv.idiomaDoSistema()));
traduzirPagina();
await carregar();
setInterval(atualizarGravacao, 3000);
atualizarGravacao();
