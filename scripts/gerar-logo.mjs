// Gera a logo do CCTV Express na família visual da ebooks.express (mesmo vermelho, mesmas peças angulares e a mesma
// linguagem de peças chapadas). Emblema: câmera de segurança de parede, arte do Adobe Firefly vetorizada.
// Palavra: ".express" é o vetor da logo da ebooks.express (mesma fonte); "cctv" é desenhado na mesma métrica
// (linha de base 1330, altura de x 1162, traço 41).
// Uso: node scripts/gerar-logo.mjs <caminho do ebooks-express-logo.svg>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const origem = readFileSync(process.argv[2], 'utf8');
const VERMELHO = '#FF3333';
const TINTA = '#EFE6D0';

// Emblema: arte gerada no Adobe Firefly (Image 5) e vetorizada com potrace (scripts/marca/emblema-firefly.svg, em
// coordenadas da imagem 1152x896); aqui só ganha o vermelho exato do tema. Caixa do desenho: x 245, y 144, 631 x 608.
const EMBLEMA = readFileSync(join(raiz, 'scripts', 'marca', 'emblema-firefly.svg'), 'utf8').match(/ d="([^"]+)"/)[1];
const CAIXA = { x: 245, y: 144, w: 631, h: 608 };

function emblema(transform) {
  return `<g id="emblema" transform="${transform}"><path fill="${VERMELHO}" fill-rule="evenodd" d="${EMBLEMA}"/></g>`;
}

// "cctv" na métrica da fonte da logo-mãe
const C = 'M125,1294 L66,1294 C54,1294 41,1287 41,1276 L41,1216 C41,1206 52,1199 62,1199 L125,1199 L125,1163 L52,1163 C24,1163 0,1185 0,1211 L0,1285 C0,1310 23,1330 52,1330 L125,1330 Z';
const T = 'M20,1110 L61,1110 L61,1163 L102,1163 L102,1199 L61,1199 L61,1278 C61,1288 67,1294 77,1294 L102,1294 L102,1330 L70,1330 C42,1330 20,1311 20,1285 L20,1199 L0,1199 L0,1163 L20,1163 Z';
const V = 'M0,1163 L43,1163 L66,1282 L89,1163 L132,1163 L92,1330 L40,1330 Z';
const letra = (d, x) => `<path fill="${VERMELHO}" fill-rule="evenodd" transform="translate(${x},0)" d="${d}"/>`;
const cctv = `<g id="palavra-cctv">${letra(C, 45)}${letra(C, 198)}${letra(T, 351)}${letra(V, 479)}</g>`;

// ".express" da logo-mãe, deslocado para depois do "cctv"
const DESLOCA = 639 - 997;
const express = [...origem.matchAll(/<path id="express-\d"[^>]*d="([^"]+)"[^>]*\/>/g)]
  .map((m) => `<path fill="${TINTA}" fill-rule="evenodd" transform="translate(${DESLOCA},0)" d="${m[1]}"/>`)
  .join('');
if (!express) throw new Error('não achei o .express na logo de origem');

const ESC = 1.27; // o emblema fica com ~800 de largura sobre a palavra
const CENTRO = (45 + 2003 + DESLOCA) / 2;
const cabecalho = '<!-- CCTV Express (Stream.Builders): gerado por scripts/gerar-logo.mjs. Mesma família da logo da ebooks.express. -->';

mkdirSync(join(raiz, 'src', 'ui', 'marca'), { recursive: true });
writeFileSync(join(raiz, 'src', 'ui', 'marca', 'logo.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 ${1040 - CAIXA.h * ESC - 40} ${2003 + DESLOCA + 5} ${CAIXA.h * ESC + 40 + 350}">${cabecalho}<title>cctv.express</title>${emblema(`translate(${CENTRO - (CAIXA.x + CAIXA.w / 2) * ESC},${1040 - (CAIXA.y + CAIXA.h) * ESC}) scale(${ESC})`)}${cctv}<g id="palavra-express">${express}</g></svg>\n`);
writeFileSync(join(raiz, 'src', 'ui', 'marca', 'emblema.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CAIXA.x - 12} ${CAIXA.y - 12} ${CAIXA.w + 24} ${CAIXA.h + 24}" width="512" height="${Math.round(512 * (CAIXA.h + 24) / (CAIXA.w + 24))}">${cabecalho}<title>CCTV Express</title>${emblema('')}</svg>\n`);
writeFileSync(join(raiz, 'src', 'ui', 'marca', 'palavra.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="30 1090 ${2003 + DESLOCA - 10} 300">${cabecalho}<title>cctv.express</title>${cctv}<g id="palavra-express">${express}</g></svg>\n`);
console.log('logo gerada; centro', CENTRO);
