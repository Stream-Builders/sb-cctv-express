// O letreiro 3D do splash: porte da cena do letreiro da ebooks.express (apps/site/src/letreiro/cena.ts, a técnica do
// letreiro do sb-land e do sb-vod-wl, three.js). As peças da logo (SVG) viram tubos de vidro extrudados sobre uma
// canaleta de metal; a câmera entra girando e acende sem piscar, e o nome acende em neon, palavra por palavra, com o
// envelope de ignição do neon. As cores são o fill de cada peça no próprio SVG.
import * as THREE from './vendor/three.module.js';
import { SVGLoader } from './vendor/SVGLoader.js';

const ACENTO = '#FF3333';
const TINTA = '#EFE6D0';

const TUBO = { depth: 11, bevelEnabled: true, bevelThickness: 4, bevelSize: 3.5, bevelSegments: 3, curveSegments: 8 };
const CORPO = { depth: 14, bevelEnabled: true, bevelThickness: 3, bevelSize: 2.5, bevelSegments: 2, curveSegments: 5 };
const TUBO_TXT = { depth: 9, bevelEnabled: true, bevelThickness: 3, bevelSize: 2.2, bevelSegments: 3, curveSegments: 6 };
const CORPO_TXT = { depth: 12, bevelEnabled: true, bevelThickness: 2, bevelSize: 1.6, bevelSegments: 2, curveSegments: 4 };
const CAMZ = 26;

// o tempo do splash: a câmera entra girando, acende, e o nome acende em neon logo depois
const ENTRA = 1.3, ACENDE = 0.7, ACENDER = 0.9, NOME = 1.45, ENTRE_PALAVRAS = 0.35, IGN = 1.5;

const suave = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, seed) => {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return hash(i + seed * 57.3) * (1 - u) + hash(i + 1 + seed * 57.3) * u;
};
const acenderSuave = (t, t0) => {
  const u = (t - t0) / ACENDER;
  return u <= 0 ? 0.012 : u >= 1 ? 1 : 0.012 + 0.988 * suave(u);
};
/** a ignição do neon: liga em pulsos cada vez mais firmes, dá um pico e assenta com uma vibração viva */
function neon(t, t0, seed) {
  const u = (t - t0) / IGN;
  if (u <= 0) return 0.012;
  if (u < 1) {
    const slots = 14, i = Math.floor(u * slots);
    const pOn = 0.12 + 0.88 * Math.pow(i / (slots - 1), 1.2);
    if (hash(seed * 53.7 + i * 9.17) < pOn) return 1.05 + 0.4 * Math.exp(-(u * slots - i) * 3.5) + 0.04 * Math.sin(t * 45 + seed);
    return 0.03 + 0.04 * hash(seed + i * 3.71);
  }
  const settle = 1 + 0.25 * Math.exp(-(t - t0 - IGN) * 3.2);
  let n = 0.965 + 0.045 * vnoise(t * 3.5, seed) + 0.015 * Math.sin(t * 12 + seed * 17);
  const g = vnoise(t * 0.25, seed * 4.1);
  if (g > 0.92) n *= 1 - 0.25 * (g - 0.92) * 12.5 * (0.5 + 0.5 * Math.sin(t * 32 + seed));
  return settle * n;
}

function dentroDe(pt, poli) {
  let d = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i], b = poli[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) d = !d;
  }
  return d;
}

/** Formas com a regra par-ímpar do SVG: subcaminho dentro de um número ímpar de outros é furo (a lente vazada). */
function formasParImpar(caminho) {
  const anel = caminho.subPaths.map((sp) => sp.getPoints(8)).filter((p) => p.length > 2);
  const contidoPor = anel.map((p, i) => anel.flatMap((q, j) => (i !== j && dentroDe(p[0], q) ? [j] : [])));
  const formas = new Map();
  anel.forEach((p, i) => {
    if (contidoPor[i].length % 2 !== 0) return;
    formas.set(i, new THREE.Shape(THREE.ShapeUtils.isClockWise(p) ? p.slice().reverse() : p));
  });
  anel.forEach((p, i) => {
    if (contidoPor[i].length % 2 === 0) return;
    const pai = contidoPor[i].filter((j) => formas.has(j)).sort((a, b) => contidoPor[b].length - contidoPor[a].length)[0];
    if (pai === undefined) return;
    formas.get(pai).holes.push(new THREE.Path(THREE.ShapeUtils.isClockWise(p) ? p : p.slice().reverse()));
  });
  return [...formas.values()];
}

/** O chanfro nas pontas agudas gera lascas com normal zero: viram a normal da face da frente. */
function extrudar(formas, opcoes) {
  const geo = new THREE.ExtrudeGeometry(formas, opcoes);
  const n = geo.getAttribute('normal');
  for (let i = 0; i < n.count; i++) if (!(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > 0.5)) n.setXYZ(i, 0, 0, 1);
  return geo;
}

/** As peças: o emblema e cada <g id="palavra-..."> da logo, na ordem em que acendem. */
function lerLogo(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const vb = (doc.documentElement.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const dados = new SVGLoader().parse(svg);
  const pecas = new Map();
  for (const p of dados.paths) {
    const no = p.userData?.node;
    const grupo = no?.closest('g[id]')?.id || '';
    if (grupo !== 'emblema' && !grupo.startsWith('palavra-')) continue;
    const peca = pecas.get(grupo) || { grupo, formas: [], cor: no.getAttribute('fill') };
    peca.formas.push(...formasParImpar(p));
    pecas.set(grupo, peca);
  }
  const emblema = pecas.get('emblema');
  const palavras = [...pecas.values()].filter((p) => p.grupo !== 'emblema');
  const caixaEmblema = new THREE.Box2();
  for (const f of emblema.formas) for (const v of f.getPoints()) caixaEmblema.expandByPoint(v);
  return { caixa: { x: vb[0], y: vb[1], w: vb[2], h: vb[3] }, emblema, palavras, caixaEmblema };
}

/**
 * ciclo (segundos): em laço, como nos cartões de branding: a câmera entra e acende, o nome acende em neon, fica aceso,
 * apaga (o neon piscando e morrendo, a câmera esmaecendo) e tudo recomeça. Sem ciclo (o splash), acende uma vez.
 */
export async function montar(canvas, urlLogo = '../ui/marca/logo.svg', { ciclo = 0 } = {}) {
  const svg = await (await fetch(urlLogo)).text();
  const logo = lerLogo(svg);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  const acento = new THREE.Color(ACENTO);
  const tinta = new THREE.Color(TINTA);

  // o entorno refletido, pintado em canvas: teto frio, faixa do acento e uma diagonal clara que lê como janela
  const entorno = (() => {
    const tela = document.createElement('canvas');
    tela.width = 512; tela.height = 256;
    const g = tela.getContext('2d');
    const css = (c, k = 1, a = 1) => `rgba(${Math.round(c.r * 255 * k)},${Math.round(c.g * 255 * k)},${Math.round(c.b * 255 * k)},${a})`;
    const claro = acento.clone().lerp(new THREE.Color(1, 1, 1), 0.78);
    const escuro = acento.clone().lerp(new THREE.Color(0.25, 0.3, 0.55), 0.6);
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, css(escuro, 0.12));
    grad.addColorStop(0.42, css(acento, 0.3));
    grad.addColorStop(0.58, css(acento, 0.44));
    grad.addColorStop(1, css(acento, 0.04));
    g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
    g.save(); g.translate(512 * 0.66, 128); g.rotate(-0.42);
    const faixa = g.createLinearGradient(0, -150, 0, 150);
    for (const [p, a] of [[0, 0], [0.34, 0.3], [0.5, 0.46], [0.66, 0.3], [1, 0]]) faixa.addColorStop(p, css(claro, 1, a));
    g.fillStyle = faixa; g.fillRect(-420, -150, 840, 300); g.restore();
    const tex = new THREE.CanvasTexture(tela);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromEquirectangular(tex);
    tex.dispose(); pmrem.dispose();
    return rt.texture;
  })();

  const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
  camera.position.set(0, 0.4, CAMZ);
  scene.add(new THREE.HemisphereLight(acento.clone().multiplyScalar(0.18), new THREE.Color(0.03, 0.015, 0.025), 0.3));
  const chave = new THREE.DirectionalLight(new THREE.Color(0.62, 0.69, 1), 0.35);
  chave.position.set(7, 9, 22);
  const lateralA = new THREE.PointLight(acento.clone().lerp(new THREE.Color(1, 1, 1), 0.35), 110, 0, 2);
  lateralA.position.set(-15, 6.5, 6);
  const lateralB = new THREE.PointLight(tinta, 70, 0, 2);
  lateralB.position.set(14.5, -5.5, 7);
  scene.add(chave, lateralA, lateralB);

  function paleta(hex) {
    const c = new THREE.Color(hex);
    const clara = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.5;
    const core = new THREE.MeshPhysicalMaterial({
      color: c.clone().multiplyScalar(0.16), emissive: c.clone().lerp(new THREE.Color(1, 1, 1), clara ? 0 : 0.1), emissiveIntensity: 0,
      roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.34, envMap: entorno, envMapIntensity: 1,
    });
    const rim = new THREE.MeshStandardMaterial({
      color: c.clone().multiplyScalar(0.1), emissive: c.clone().multiplyScalar(clara ? 0.9 : 0.56), emissiveIntensity: 0,
      roughness: 0.35, metalness: 0, envMap: entorno,
    });
    const body = new THREE.MeshStandardMaterial({
      color: c.clone().multiplyScalar(0.08), emissive: c.clone().multiplyScalar(clara ? 0.46 : 0.33), emissiveIntensity: 0,
      roughness: 0.38, metalness: 0.6, envMap: entorno,
    });
    const apagado = clara ? c.clone().multiplyScalar(0.3) : c.clone().multiplyScalar(0.3).lerp(new THREE.Color(0.1, 0.08, 0.12), 0.3);
    return { core, rim, body, apagado, aceso: c.clone().multiplyScalar(0.16), clara };
  }

  const raiz = new THREE.Group();
  const flip = new THREE.Group(); // o SVG tem y para baixo
  raiz.add(flip);
  scene.add(raiz);
  const partes = [];
  function montarPeca(p, texto, t0, seed) {
    const pal = paleta(p.cor);
    const tubo = new THREE.Mesh(extrudar(p.formas, texto ? TUBO_TXT : TUBO), [pal.core, pal.rim]);
    tubo.position.z = 8;
    const corpo = new THREE.Mesh(extrudar(p.formas, texto ? CORPO_TXT : CORPO), pal.body);
    corpo.position.z = -20;
    const grupo = new THREE.Group();
    grupo.add(tubo, corpo);
    flip.add(grupo);
    // sem o fogo do site por dentro, a câmera acende pela própria luz
    partes.push({ grupo, texto, t0, seed, forca: texto ? (pal.clara ? 2.8 : 1.8) : 2.6, ...pal });
  }
  montarPeca(logo.emblema, false, ACENDE, 0);
  logo.palavras.forEach((p, i) => montarPeca(p, true, NOME + i * ENTRE_PALAVRAS, 23.9 + i * 6.1));

  // a câmera gira em torno do próprio centro ao entrar (o nome fica parado, esperando acender)
  const E = logo.caixaEmblema;
  const ecx = (E.min.x + E.max.x) / 2, ecy = (E.min.y + E.max.y) / 2;
  const emblema = partes[0].grupo;
  const pivo = new THREE.Group();
  pivo.position.set(ecx, ecy, 0);
  emblema.position.set(-ecx, -ecy, 0);
  flip.remove(emblema);
  pivo.add(emblema);
  flip.add(pivo);

  const _cor = new THREE.Color();
  const APAGAR = 1.4;
  /** o neon apagando no fim do ciclo: o nome pisca e morre, a câmera esmaece */
  function apagando(t, texto, seed) {
    if (!ciclo) return 1;
    const u = (t - (ciclo - APAGAR - 0.4)) / APAGAR;
    if (u <= 0) return 1;
    if (u >= 1) return 0;
    if (!texto) return 1 - suave(u);
    const i = Math.floor(u * 10);
    return hash(seed * 31.3 + i * 7.7) < 1 - u ? 1 - 0.5 * u : 0.02;
  }
  function aplicar(tTotal) {
    const t = ciclo ? tTotal % ciclo : tTotal;
    const e0 = suave(t / ENTRA);
    pivo.rotation.y = -2.4 * (1 - e0);
    pivo.position.z = -260 * (1 - e0);
    for (const p of partes) {
      const e = (p.texto ? neon(t, p.t0, p.seed) : acenderSuave(t, p.t0)) * apagando(t, p.texto, p.seed);
      const acesa = Math.min(e, 1);
      p.core.color.copy(_cor.copy(p.apagado).lerp(p.aceso, acesa));
      p.core.envMapIntensity = 1.5 - 1.15 * acesa;
      p.core.roughness = 0.3 - 0.14 * acesa;
      p.core.emissiveIntensity = 0.32 * e * p.forca;
      p.rim.emissiveIntensity = 1.15 * e * Math.min(p.forca, 1.6);
      p.body.emissiveIntensity = 0.3 * Math.min(e, 1.2);
    }
  }

  const cx = logo.caixa.x + logo.caixa.w / 2, cy = logo.caixa.y + logo.caixa.h / 2;
  function enquadrar() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visH = 2 * CAMZ * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const S = Math.min((0.86 * visH * camera.aspect) / logo.caixa.w, (0.82 * visH) / logo.caixa.h);
    flip.scale.set(S, -S, S);
    flip.position.set(-cx * S, cy * S, 0);
  }
  enquadrar();
  // na página o tamanho muda (janela, celular girando): reenquadra
  new ResizeObserver(() => { enquadrar(); renderer.render(scene, camera); }).observe(canvas);

  const tFixo = new URLSearchParams(location.search).has('t') ? Number(new URLSearchParams(location.search).get('t')) : null;
  const inicio = performance.now();
  let anterior = null;
  function laco(agora) {
    const t = tFixo ?? (agora - inicio) / 1000;
    const dt = anterior === null ? 1 / 60 : Math.min(0.05, (agora - anterior) / 1000);
    anterior = agora;
    aplicar(t);
    const k = tFixo === null ? Math.min(1, dt * 2.5) : 1;
    raiz.rotation.y += (-0.16 + 0.08 * Math.sin(t * 0.6) - raiz.rotation.y) * k;
    raiz.rotation.x += (0.05 - raiz.rotation.x) * k;
    renderer.render(scene, camera);
    if (tFixo === null && !gravando) requestAnimationFrame(laco);
  }
  // ?gravar: o relógio fica parado e quem grava avança quadro a quadro (window.letreiroEm(t) desenha o instante t)
  const gravando = new URLSearchParams(location.search).has('gravar');
  if (gravando) {
    window.letreiroEm = (t) => {
      aplicar(t);
      raiz.rotation.y = -0.16 + 0.08 * Math.sin(t * 0.6);
      raiz.rotation.x = 0.05;
      renderer.render(scene, camera);
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    };
    window.letreiroPronto = true;
  }
  requestAnimationFrame(laco);
}
