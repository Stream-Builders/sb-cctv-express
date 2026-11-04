// Gera midia/banner.svg: o banner do README na linguagem do perfil da Stream.Builders (moldura com cantos, grade,
// partículas, etiquetas técnicas), com o emblema da câmera e animações de vigilância (REC piscando, varredura e caixa
// de detecção). SVG puro com animação SMIL/CSS: anima no GitHub e em qualquer navegador.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const emblema = readFileSync(join(raiz, 'scripts', 'marca', 'emblema-firefly.svg'), 'utf8').match(/ d="([^"]+)"/)[1];
const W = 1200, H = 360, R = '#FF3333', TINTA = '#EFE6D0';
const MONO = "ui-monospace, 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

// partículas fixas (posições sorteadas com semente: o arquivo sai igual a cada geração)
let s = 7;
const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
const particulas = Array.from({ length: 46 }, () => {
  const x = (rnd() * (W - 60) + 30).toFixed(0), y = (rnd() * (H - 60) + 30).toFixed(0);
  const r = (0.8 + rnd() * 1.8).toFixed(1), d = (2.5 + rnd() * 4).toFixed(1), a = (0.25 + rnd() * 0.6).toFixed(2);
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${R}" opacity="${a}"><animate attributeName="opacity" values="${a};0.05;${a}" dur="${d}s" repeatCount="indefinite"/></circle>`;
}).join('');

const grade = [];
for (let x = 30; x < W; x += 40) grade.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
for (let y = 30; y < H; y += 40) grade.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);

const tags = ['LIVE MOSAIC', 'CONTINUOUS REC', 'PLAYBACK', 'PTZ / LIGHT', 'MOTION ALERTS', 'ONVIF · RTSP'];
let tx = 455;
const etiquetas = tags.map((t) => {
  const w = t.length * 7.1 + 18;
  const g = `<g transform="translate(${tx.toFixed(0)},236)"><rect width="${w.toFixed(0)}" height="24" fill="none" stroke="${R}" stroke-opacity="0.75"/><text x="${(w / 2).toFixed(0)}" y="16" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="${TINTA}" letter-spacing="0.6">${t}</text></g>`;
  tx += w + 8;
  return g;
}).join('');

const canto = (x, y, sx, sy) => `<path d="M${x} ${y + sy * 26} V${y} H${x + sx * 26}" fill="none" stroke="${R}" stroke-width="3"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="CCTV Express - Stream.Builders">
  <title>CCTV Express - Stream.Builders</title>
  <defs>
    <radialGradient id="vinheta" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#14171c"/><stop offset="1" stop-color="#07080a"/></radialGradient>
    <linearGradient id="varre" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${R}" stop-opacity="0"/><stop offset="1" stop-color="${R}" stop-opacity="0.14"/></linearGradient>
    <clipPath id="quadro"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#vinheta)"/>
  <g stroke="#2a2f38" stroke-opacity="0.55" stroke-width="1">${grade.join('')}</g>
  <g>${particulas}</g>
  <g clip-path="url(#quadro)">
    <rect x="0" y="-80" width="${W}" height="80" fill="url(#varre)"><animate attributeName="y" values="-80;${H}" dur="5s" repeatCount="indefinite"/></rect>
  </g>
  <line x1="0" y1="2" x2="${W}" y2="2" stroke="${R}" stroke-width="3"/>
  <line x1="0" y1="${H - 2}" x2="${W}" y2="${H - 2}" stroke="${R}" stroke-width="3"/>
  <line x1="0" y1="62" x2="${W}" y2="62" stroke="${R}" stroke-opacity="0.35"/>
  <line x1="0" y1="${H - 52}" x2="${W}" y2="${H - 52}" stroke="${R}" stroke-opacity="0.35"/>
  ${canto(16, 16, 1, 1)}${canto(W - 16, 16, -1, 1)}${canto(16, H - 16, 1, -1)}${canto(W - 16, H - 16, -1, -1)}
  <g font-family="${MONO}" font-size="12" fill="#a3abb8" letter-spacing="1.5">
    <circle cx="${W / 2 - 236}" cy="37" r="5" fill="${R}"><animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite"/></circle>
    <text x="${W / 2}" y="41" text-anchor="middle">REC // STREAM.BUILDERS // CCTV EXPRESS // OPEN SOURCE</text>
    <text x="${W / 2}" y="${H - 22}" text-anchor="middle">© 2026 STREAM.BUILDERS · CCTVEXPRESS.STREAM.BUILDERS · MIT LICENSE</text>
  </g>
  <g transform="translate(70,82) scale(0.31)">
    <path fill="${R}" fill-rule="evenodd" transform="translate(-245,-144)" d="${emblema}"/>
  </g>
  <g fill="none" stroke="#f59e0b" stroke-width="2.5">
    <path d="M62 84 v16 M62 84 h16 M276 84 h-16 M276 84 v16 M62 288 v-16 M62 288 h16 M276 288 h-16 M276 288 v-16">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.75;1" dur="3.2s" repeatCount="indefinite"/>
    </path>
  </g>
  <text x="455" y="164" font-family="${MONO}" font-size="58" font-weight="700" fill="${TINTA}" letter-spacing="1"><tspan fill="${R}">cctv</tspan>.express</text>
  <text x="458" y="206" font-family="${MONO}" font-size="16" font-weight="700" fill="${TINTA}" letter-spacing="2">OPEN SOURCE VMS // IP CAMERA MONITORING THAT WORKS</text>
  ${etiquetas}
</svg>
`;
writeFileSync(join(raiz, 'midia', 'banner.svg'), svg);
console.log('midia/banner.svg', svg.length, 'bytes');
