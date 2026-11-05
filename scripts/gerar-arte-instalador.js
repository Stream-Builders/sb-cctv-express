// Gera as imagens do instalador (NSIS) na identidade do app: a faixa lateral das telas de boas-vindas e de conclusão
// (164x314) e o cabeçalho das demais (150x57), em BMP de 24 bits, a partir das peças de src/ui/marca.
// Uso: node scripts/gerar-arte-instalador.js  (precisa do Chrome instalado e do ffmpeg em vendor/)
const { createRequire } = require('node:module');
const { readFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const raiz = join(__dirname, '..');
const req = createRequire(process.env.PLAYWRIGHT_DE || join(raiz, 'package.json'));
const { chromium } = req('playwright-core');
const svg = (n) => `data:image/svg+xml;base64,${readFileSync(join(raiz, 'src/ui/marca', n)).toString('base64')}`;
const FUNDO = '#0b0d10', DESTAQUE = '#ff3333';

const pecas = {
  lateral: { w: 164, h: 314, html: `
    <div style="position:absolute;inset:0;background:${FUNDO}"></div>
    <div style="position:absolute;left:0;top:0;bottom:0;width:4px;background:${DESTAQUE}"></div>
    <img src="${svg('emblema.svg')}" style="position:absolute;left:32px;top:70px;width:100px">
    <img src="${svg('palavra.svg')}" style="position:absolute;left:18px;top:190px;width:128px">
    <div style="position:absolute;left:18px;right:18px;top:236px;height:1px;background:#ffffff22"></div>
    <div style="position:absolute;left:0;right:0;top:248px;text-align:center;font:600 9px/1.4 Segoe UI,sans-serif;letter-spacing:.2em;color:#ffffff88">STREAM.BUILDERS</div>` },
  cabecalho: { w: 150, h: 57, html: `
    <div style="position:absolute;inset:0;background:${FUNDO}"></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:3px;background:${DESTAQUE}"></div>
    <img src="${svg('emblema.svg')}" style="position:absolute;left:10px;top:9px;height:36px">
    <img src="${svg('palavra.svg')}" style="position:absolute;left:54px;top:17px;width:88px">` },
};

(async () => {
  const nav = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  mkdirSync(join(raiz, 'build'), { recursive: true });
  for (const [nome, p] of Object.entries(pecas)) {
    const pg = await nav.newPage({ viewport: { width: p.w, height: p.h } });
    await pg.setContent(`<body style="margin:0">${p.html}</body>`);
    await pg.waitForTimeout(300);
    const png = join(raiz, 'build', `instalador-${nome}.png`);
    await pg.screenshot({ path: png });
    execFileSync(join(raiz, 'vendor/ffmpeg.exe'), ['-y', '-loglevel', 'error', '-i', png, '-pix_fmt', 'bgr24', join(raiz, 'build', `instalador-${nome}.bmp`)]);
  }
  await nav.close();
  console.log('ok');
})();
