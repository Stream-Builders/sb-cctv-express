// CCTV Express: a tela. O vídeo de cada câmera vem do go2rtc local pelo componente <video-stream> (MSE/WebRTC).
import './video-stream.js';

const porta = await window.cctv.portaMotor();
const motor = `127.0.0.1:${porta}`;

const mosaicoEl = document.getElementById('mosaico');
const listaEl = document.getElementById('lista');
const resumoEl = document.getElementById('resumo');
const dialogo = document.getElementById('dialogo');
const form = document.getElementById('formulario');

let cameras = [];
let mosaico = Number(localStorage.getItem('mosaico')) || 4;
let selecionado = 0;
let telaCheia = null;
const estados = new Map(); // id -> 'conectando' | 'vivo' | 'sem-sinal'

const ROTULO = { vivo: 'Ao vivo', conectando: 'Conectando', 'sem-sinal': 'Sem sinal' };

function selo(classe, texto) {
  const s = document.createElement('span');
  s.className = `selo selo--${classe}`;
  s.textContent = texto;
  return s;
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
  const estado = selo('conectando', ROTULO.conectando);
  estado.dataset.papel = 'estado';
  // a gravação chega na etapa 2: até lá o quadro diz claramente que não está gravando
  topo.append(estado, selo('nao-grava', 'Não grava'), nome);
  q.append(topo);
  vigiar(cam.id, q, video);
  return q;
}

/** Estado pelo vídeo de verdade: o tempo do vídeo avançando é "ao vivo"; parado por 15 s vira "sem sinal". */
function vigiar(id, quadro, componente) {
  let ultimoTempo = -1;
  let paradoDesde = Date.now();
  estados.set(id, 'conectando');
  const t = setInterval(() => {
    if (!quadro.isConnected) return clearInterval(t);
    const v = componente.querySelector('video');
    const agora = v ? v.currentTime : 0;
    let novo;
    if (v && agora !== ultimoTempo && !v.paused) {
      novo = 'vivo';
      paradoDesde = Date.now();
    } else {
      novo = Date.now() - paradoDesde > 15000 ? 'sem-sinal' : 'conectando';
    }
    ultimoTempo = agora;
    if (novo !== estados.get(id)) {
      estados.set(id, novo);
      const s = quadro.querySelector('[data-papel="estado"]');
      s.className = `selo selo--${novo}`;
      s.textContent = ROTULO[novo];
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
      v.textContent = cameras.length ? '' : 'Adicione uma câmera para começar';
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

function desenharLista() {
  listaEl.replaceChildren();
  if (!cameras.length) {
    const li = document.createElement('li');
    li.className = 'lista__vazia';
    li.textContent = 'Nenhuma câmera ainda.';
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
    info.textContent = `${cam.ip}${cam.tipo === 'xiongmai' ? ` · canal ${cam.canal}` : ''} · ${ROTULO[estados.get(cam.id)] || 'Fora do mosaico'}`;
    texto.append(info);
    const editar = document.createElement('button');
    editar.className = 'editar';
    editar.textContent = 'Editar';
    editar.addEventListener('click', (e) => { e.stopPropagation(); abrirFormulario(cam); });
    li.append(ponto, texto, editar);
    li.addEventListener('dblclick', () => { telaCheia = cam.id; desenharMosaico(); });
    listaEl.append(li);
  }
}

function desenharResumo() {
  resumoEl.replaceChildren();
  const vivos = cameras.filter((c) => estados.get(c.id) === 'vivo').length;
  const semSinal = cameras.filter((c) => estados.get(c.id) === 'sem-sinal').length;
  resumoEl.append(selo('vivo', `${vivos} ao vivo`));
  if (semSinal) resumoEl.append(selo('sem-sinal', `${semSinal} sem sinal`));
  resumoEl.append(selo('nao-grava', 'Gravação: não configurada'));
}

function atualizarCamposTipo() {
  form.querySelector('.so-rtsp').hidden = form.tipo.value !== 'rtsp';
}

function abrirFormulario(cam) {
  form.reset();
  form.id.value = cam?.id || '';
  document.getElementById('formulario-titulo').textContent = cam ? 'Editar câmera' : 'Adicionar câmera';
  document.getElementById('remover').hidden = !cam;
  document.getElementById('formulario-aviso').textContent = '';
  if (cam) {
    for (const k of ['nome', 'tipo', 'ip', 'porta', 'canal', 'usuario', 'url']) if (form[k] && cam[k] != null) form[k].value = cam[k];
    form.senha.placeholder = cam.temSenha ? 'deixe em branco para manter' : 'guardada cifrada';
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

document.querySelectorAll('[data-mosaico]').forEach((b) => b.addEventListener('click', () => {
  mosaico = Number(b.dataset.mosaico);
  telaCheia = null;
  localStorage.setItem('mosaico', String(mosaico));
  desenharMosaico();
}));
document.getElementById('adicionar').addEventListener('click', () => abrirFormulario(null));
document.getElementById('cancelar').addEventListener('click', () => dialogo.close());
form.tipo.addEventListener('change', atualizarCamposTipo);
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dados = Object.fromEntries(new FormData(form));
  try {
    await window.cctv.salvarCamera(dados);
    dialogo.close();
    // o motor reinicia com a câmera nova: dá um instante para ele subir
    setTimeout(carregar, 800);
  } catch (err) {
    document.getElementById('formulario-aviso').textContent = String(err.message || err);
  }
});
document.getElementById('remover').addEventListener('click', async () => {
  if (!form.id.value) return;
  await window.cctv.removerCamera(form.id.value);
  dialogo.close();
  setTimeout(carregar, 800);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && telaCheia && !dialogo.open) { telaCheia = null; desenharMosaico(); }
});

carregar();
