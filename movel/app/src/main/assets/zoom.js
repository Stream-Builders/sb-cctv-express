// Zoom digital do ao vivo: o nível (1× a 8×) e a posição (o ponto da imagem no centro da parte ampliada, de 0 a 1).
// O app (Kotlin) amplia o vídeo; esta parte cuida dos gestos (arrastar, pinça, toque duplo), dos botões e do mapa da
// posição, e guarda o zoom de cada câmera neste celular (vale também no mosaico).

export const NIVEIS = [1, 1.5, 2, 3, 4, 6, 8];
const MAX = NIVEIS[NIVEIS.length - 1];
const limita = (v, a, b) => Math.min(b, Math.max(a, v));

/** o zoom válido: nível de 1 a 8 e a posição sem sair da imagem */
export function normalizar({ z = 1, x = 0.5, y = 0.5 } = {}) {
  const n = limita(Number(z) || 1, 1, MAX);
  return { z: n, x: limita(Number(x) || 0.5, 0.5 / n, 1 - 0.5 / n), y: limita(Number(y) || 0.5, 0.5 / n, 1 - 0.5 / n) };
}

// ---------- o zoom de cada câmera, guardado neste celular ----------
let guardados = {};
try { guardados = JSON.parse(localStorage.getItem('zoom') || '{}') || {}; } catch { guardados = {}; }

export function zoomDe(id) { return normalizar(guardados[id]); }

export function guardar(id, z) {
  const n = normalizar(z);
  if (n.z <= 1.001) delete guardados[id]; else guardados[id] = n;
  try { localStorage.setItem('zoom', JSON.stringify(guardados)); } catch { /* sem armazenamento: vale até fechar */ }
  return n;
}

/** o próximo nível da lista, para cima (+1) ou para baixo (-1) */
export function proximoNivel(z, sentido) {
  if (sentido > 0) return NIVEIS.find((n) => n > z + 0.01) ?? MAX;
  return [...NIVEIS].reverse().find((n) => n < z - 0.01) ?? 1;
}

/**
 * O retângulo do vídeo dentro do quadro (o app encaixa o vídeo sem esticar, com faixas pretas).
 * proporcao = largura / altura do vídeo.
 */
export function areaDoVideo(quadro, proporcao) {
  const r = quadro.getBoundingClientRect();
  const p = proporcao || 16 / 9;
  const w = r.width / r.height > p ? r.height * p : r.width;
  const h = w / p;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
}

/**
 * Gestos no quadro em tela cheia: um dedo arrasta a imagem (com zoom), dois dedos fazem a pinça em volta do ponto entre
 * eles, toque duplo alterna entre sem zoom e 2,5× no ponto tocado.
 * obter() devolve o zoom atual; mudar(z) aplica durante o gesto; fim(z) guarda no fim.
 */
export function gestos(quadro, { obter, mudar, fim, proporcao }) {
  const dedos = new Map();
  let inicio = null;
  let ultimoToque = { t: 0, x: 0, y: 0 };
  // o ponto da imagem sob um ponto da tela, para o zoom z centrado em (x, y)
  const imagemEm = (cx, cy, z) => {
    const a = areaDoVideo(quadro, proporcao());
    return { x: z.x + ((cx - a.left) / a.width - 0.5) / z.z, y: z.y + ((cy - a.top) / a.height - 0.5) / z.z, a };
  };
  const ignorar = (e) => e.target.closest('.sb-btn, .minimapa, .quadro__barra, .zoom');

  quadro.addEventListener('pointerdown', (e) => {
    if (ignorar(e)) return;
    quadro.setPointerCapture(e.pointerId);
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    inicio = { zoom: obter(), dedos: new Map([...dedos].map(([k, v]) => [k, { ...v }])) };
  });
  quadro.addEventListener('pointermove', (e) => {
    if (!dedos.has(e.pointerId) || !inicio) return;
    dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const z0 = inicio.zoom;
    const ids = [...dedos.keys()];
    if (ids.length >= 2 && inicio.dedos.size >= 2) {
      const [a0, b0] = ids.slice(0, 2).map((k) => inicio.dedos.get(k));
      const [a1, b1] = ids.slice(0, 2).map((k) => dedos.get(k));
      if (!a0 || !b0) return;
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y) || 1;
      const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
      const novoZ = limita(z0.z * (d1 / d0), 1, MAX);
      // o ponto da imagem que estava entre os dedos no começo fica entre os dedos agora
      const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
      const m1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
      const alvo = imagemEm(m0.x, m0.y, z0);
      const u = (m1.x - alvo.a.left) / alvo.a.width - 0.5;
      const v = (m1.y - alvo.a.top) / alvo.a.height - 0.5;
      mudar(normalizar({ z: novoZ, x: alvo.x - u / novoZ, y: alvo.y - v / novoZ }));
    } else if (ids.length === 1 && z0.z > 1) {
      const d0 = inicio.dedos.get(e.pointerId);
      if (!d0) return;
      const a = areaDoVideo(quadro, proporcao());
      mudar(normalizar({ z: z0.z, x: z0.x - (e.clientX - d0.x) / (a.width * z0.z), y: z0.y - (e.clientY - d0.y) / (a.height * z0.z) }));
    }
  });
  const soltar = (e) => {
    if (!dedos.has(e.pointerId)) return;
    const d = dedos.get(e.pointerId);
    const d0 = inicio?.dedos.get(e.pointerId);
    dedos.delete(e.pointerId);
    // toque rápido sem arrastar: dois em seguida no mesmo lugar = toque duplo
    if (d0 && Math.hypot(d.x - d0.x, d.y - d0.y) < 12 && inicio.dedos.size === 1) {
      const agora = Date.now();
      if (agora - ultimoToque.t < 320 && Math.hypot(d.x - ultimoToque.x, d.y - ultimoToque.y) < 40) {
        const z = obter();
        const p = imagemEm(d.x, d.y, z);
        const novo = z.z > 1.01 ? { z: 1, x: 0.5, y: 0.5 } : { z: 2.5, x: p.x, y: p.y };
        mudar(normalizar(novo));
        ultimoToque = { t: 0, x: 0, y: 0 };
      } else ultimoToque = { t: agora, x: d.x, y: d.y };
    }
    // o gesto segue com os dedos que ficaram (de dois para um dedo, sem pulo)
    inicio = dedos.size ? { zoom: obter(), dedos: new Map([...dedos].map(([k, v]) => [k, { ...v }])) } : null;
    if (!dedos.size) fim(obter());
  };
  quadro.addEventListener('pointerup', soltar);
  quadro.addEventListener('pointercancel', soltar);
}

/**
 * O mapa da posição: a imagem inteira em miniatura e o retângulo da parte ampliada. Arrastar ou tocar no mapa move
 * o zoom para lá.
 */
export function minimapa({ obter, mudar, fim, proporcao, rotulo }) {
  const mapa = document.createElement('div');
  mapa.className = 'minimapa';
  mapa.setAttribute('role', 'slider');
  mapa.setAttribute('aria-label', rotulo);
  mapa.title = rotulo;
  const janela = document.createElement('div');
  janela.className = 'minimapa__janela';
  mapa.append(janela);
  const desenhar = () => {
    const z = obter();
    mapa.style.aspectRatio = String(proporcao() || 16 / 9);
    mapa.hidden = z.z <= 1.001;
    Object.assign(janela.style, {
      width: `${100 / z.z}%`, height: `${100 / z.z}%`,
      left: `${(z.x - 0.5 / z.z) * 100}%`, top: `${(z.y - 0.5 / z.z) * 100}%`,
    });
  };
  const mover = (e) => {
    const r = mapa.getBoundingClientRect();
    const z = obter();
    mudar(normalizar({ z: z.z, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }));
    desenhar();
  };
  let arrastando = false;
  mapa.addEventListener('pointerdown', (e) => { e.stopPropagation(); arrastando = true; mapa.setPointerCapture(e.pointerId); mover(e); });
  mapa.addEventListener('pointermove', (e) => { if (arrastando) mover(e); });
  const acabar = () => { if (arrastando) { arrastando = false; fim(obter()); } };
  mapa.addEventListener('pointerup', acabar);
  mapa.addEventListener('pointercancel', acabar);
  // pelas setas do teclado (acessibilidade): move um décimo da parte ampliada
  mapa.tabIndex = 0;
  mapa.addEventListener('keydown', (e) => {
    const z = obter();
    const passo = 0.1 / z.z;
    const d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[e.key];
    if (!d) return;
    e.preventDefault();
    const n = normalizar({ z: z.z, x: z.x + d[0], y: z.y + d[1] });
    mudar(n); fim(n); desenhar();
  });
  return { el: mapa, desenhar };
}
