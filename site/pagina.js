// A landing: o letreiro 3D na hero, o fundo em canvas e o texto em inglês para quem não lê português.
import { montar } from './letreiro.js';

// ---------- letreiro ----------
montar(document.getElementById('letreiro'), 'marca/logo.svg').catch(() => {
  const img = document.createElement('img');
  img.src = 'marca/logo.svg';
  img.alt = 'cctv.express';
  img.style.width = 'min(560px, 80vw)';
  document.getElementById('letreiro').replaceWith(img);
});

// ---------- fundo: um mosaico de câmeras vigiando ----------
// A mensagem do projeto em imagem: uma parede de câmeras ao fundo, cada quadro com o seu selo de estado (o REC
// vermelho piscando), caixas de detecção que aparecem onde há "movimento" e uma linha de varredura que passa. Discreto,
// para não brigar com o texto; parado para quem pediu menos movimento.
const tela = document.getElementById('fundo');
const g = tela.getContext('2d');
const parado = matchMedia('(prefers-reduced-motion: reduce)').matches;
let W = 0, H = 0, celula = 0, cols = 0, linhas = 0, quadros = [], caixas = [];

function dimensionar() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  W = innerWidth; H = innerHeight;
  tela.width = W * dpr; tela.height = H * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  celula = Math.max(150, Math.min(240, W / 6));
  cols = Math.ceil(W / celula) + 1;
  linhas = Math.ceil(H / (celula * 0.5625)) + 1;
  quadros = Array.from({ length: cols * linhas }, () => ({ fase: Math.random() * 6.28, grava: Math.random() < 0.75, ruido: Math.random() }));
}

function novaCaixa() {
  const ch = celula * 0.5625;
  const c = Math.floor(Math.random() * cols), l = Math.floor(Math.random() * linhas);
  const w = celula * (0.18 + Math.random() * 0.25), h = ch * (0.25 + Math.random() * 0.35);
  caixas.push({ x: c * celula + Math.random() * (celula - w), y: l * ch + Math.random() * (ch - h), w, h, vida: 0, dura: 1.8 + Math.random() * 2.2, dx: (Math.random() - 0.5) * 14, dy: (Math.random() - 0.5) * 6 });
}

function cantos(x, y, w, h, t) {
  g.beginPath();
  g.moveTo(x, y + t); g.lineTo(x, y); g.lineTo(x + t, y);
  g.moveTo(x + w - t, y); g.lineTo(x + w, y); g.lineTo(x + w, y + t);
  g.moveTo(x + w, y + h - t); g.lineTo(x + w, y + h); g.lineTo(x + w - t, y + h);
  g.moveTo(x + t, y + h); g.lineTo(x, y + h); g.lineTo(x, y + h - t);
  g.stroke();
}

let anterior = performance.now(), acumulado = 0;
function desenhar(agora) {
  const dt = Math.min(0.05, (agora - anterior) / 1000);
  anterior = agora;
  const t = agora / 1000;
  const ch = celula * 0.5625;
  g.clearRect(0, 0, W, H);
  // a parede de quadros
  for (let l = 0; l < linhas; l++) for (let c = 0; c < cols; c++) {
    const q = quadros[l * cols + c];
    const x = c * celula, y = l * ch;
    g.fillStyle = `rgba(22, 26, 32, ${0.35 + 0.15 * q.ruido})`;
    g.fillRect(x + 3, y + 3, celula - 6, ch - 6);
    g.strokeStyle = 'rgba(70, 78, 92, 0.5)';
    g.lineWidth = 1;
    g.strokeRect(x + 3.5, y + 3.5, celula - 7, ch - 7);
    if (q.grava) {
      const a = parado ? 0.7 : 0.35 + 0.35 * (Math.sin(t * 2.4 + q.fase) > 0 ? 1 : 0.2);
      g.fillStyle = `rgba(255, 51, 51, ${a})`;
      g.beginPath(); g.arc(x + 16, y + 16, 3.5, 0, 6.29); g.fill();
    } else {
      g.fillStyle = 'rgba(34, 197, 94, 0.45)';
      g.beginPath(); g.arc(x + 16, y + 16, 3, 0, 6.29); g.fill();
    }
  }
  // as caixas de detecção de movimento
  if (!parado) {
    acumulado += dt;
    if (acumulado > 0.7) { acumulado = 0; if (caixas.length < 7) novaCaixa(); }
  } else if (!caixas.length) for (let i = 0; i < 5; i++) novaCaixa();
  g.lineWidth = 1.5;
  for (let i = caixas.length - 1; i >= 0; i--) {
    const b = caixas[i];
    if (!parado) { b.vida += dt; b.x += b.dx * dt; b.y += b.dy * dt; }
    const u = parado ? 0.5 : b.vida / b.dura;
    if (u >= 1) { caixas.splice(i, 1); continue; }
    const a = Math.sin(Math.PI * u) * 0.95;
    g.strokeStyle = `rgba(245, 158, 11, ${a})`;
    cantos(b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.28);
  }
  // a linha de varredura
  if (!parado) {
    const y = ((t * 60) % (H + 200)) - 100;
    const grad = g.createLinearGradient(0, y - 60, 0, y + 2);
    grad.addColorStop(0, 'rgba(255, 51, 51, 0)');
    grad.addColorStop(1, 'rgba(255, 51, 51, 0.07)');
    g.fillStyle = grad;
    g.fillRect(0, y - 60, W, 62);
  }
  // vinheta: o centro (onde está o texto) fica mais escuro e calmo
  const v = g.createRadialGradient(W / 2, H * 0.42, Math.min(W, H) * 0.15, W / 2, H * 0.5, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(7, 8, 10, 0.8)');
  v.addColorStop(1, 'rgba(7, 8, 10, 0.15)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  if (!parado) requestAnimationFrame(desenhar);
}
dimensionar();
addEventListener('resize', () => { dimensionar(); if (parado) desenhar(performance.now()); });
requestAnimationFrame(desenhar);

// ---------- inglês para quem não lê português ----------
const EN = {
  frase: 'IP camera monitoring that works. You always know what is live and what is recording.',
  baixar: 'Download for Windows', codigo: 'Code on GitHub', nota: 'Free and open source (MIT) · Windows 10 and 11 · 18 languages',
  estadoTitulo: 'Every camera’s status, front and center',
  estadoTexto: 'No tiny white icons on a blue background. Each camera shows large, colored badges: live, really recording (the badge only lights up while the file is growing on disk) and motion.',
  seloVivo: 'Live', seloGravando: 'Recording', seloMovimento: 'Motion', seloSemSinal: 'No signal',
  r1t: 'Live mosaic', r1: '1, 4, 9, 16, 25 or 36 cameras, automatic reconnection and double-click full screen, without re-encoding.',
  r2t: 'Continuous recording', r2: 'In C:\\cctv_express\\records, 120-minute blocks (adjustable), retention by days and free space, oldest first.',
  r3t: 'Playback and export', r3: 'Day timeline with motion marks; set start and end and export the clip as MP4.',
  r4t: 'PTZ and light', r4: 'Pan, tilt and zoom by holding the button; switch between smart, full color, infrared or always-on light.',
  r5t: 'Motion detection', r5: 'Adjustable sensitivity, on-screen badge, timeline mark and Windows notification.',
  r6t: 'Finds your cameras', r6: 'Discovers ONVIF, RTSP and Xiongmai/iCSee/XMeye cameras on your network. Passwords encrypted by Windows.',
  abertoTitulo: 'Open source, no cloud, no subscription',
  abertoTexto: 'Everything runs on your computer: video goes from the camera to your disk, through nobody’s server. The code is open, under the MIT license.',
  verCodigo: 'View the code',
};
if (!(navigator.language || 'pt').toLowerCase().startsWith('pt')) {
  document.documentElement.lang = 'en';
  document.title = 'CCTV Express: IP camera monitoring that works';
  for (const el of document.querySelectorAll('[data-t]')) if (EN[el.dataset.t]) el.textContent = EN[el.dataset.t];
}
