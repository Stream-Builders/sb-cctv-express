// Insere o cartão do CCTV Express na seção Branding do sb-land (18 idiomas) e do tk-port (9 idiomas), a partir de
// cartao/copia.json. Idempotente: se o cartão já existe, não duplica.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const copia = JSON.parse(readFileSync(join(raiz, 'cartao', 'copia.json'), 'utf8'));
const land = join(raiz, '..', 'sb-land');
const port = join(raiz, '..', 'tk-port');
const q = (s) => JSON.stringify(s);

// ---------- sb-land ----------
const tipos = join(land, 'lib', 'i18n', 'branding-cards.ts');
let t = readFileSync(tipos, 'utf8');
if (!t.includes('"cctvExpress"')) t = t.replace('  | "ebooksExpress"\n', '  | "ebooksExpress"\n  | "cctvExpress"\n');
writeFileSync(tipos, t);
for (const cod of Object.keys(copia)) {
  const f = join(land, 'lib', 'i18n', 'idiomas', `${cod}.ts`);
  let s = readFileSync(f, 'utf8');
  if (s.includes('cctvExpress: {')) continue;
  const [tag, subtitle, description, ...specs] = copia[cod];
  const bloco = `  cctvExpress: {\n    tag: ${q(tag)},\n    subtitle: ${q(subtitle)},\n    description:\n      ${q(description)},\n    specs: [\n${specs.map(([l, v]) => `      { label: ${q(l)}, value: ${q(v)} },`).join('\n')}\n    ],\n  },\n`;
  if (!s.includes('  ebooksExpress: {')) throw new Error(`${cod}: não achei ebooksExpress`);
  s = s.replace('  ebooksExpress: {', bloco + '  ebooksExpress: {');
  writeFileSync(f, s);
}
const secao = join(land, 'components', 'branding-section.tsx');
let b = readFileSync(secao, 'utf8');
if (!b.includes('key: "cctvExpress"')) {
  b = b.replace('  {\n    key: "hackingToday",', `  {\n    key: "cctvExpress",\n    name: "CCTV.EXPRESS",\n    accent: "#ff3333",\n    engine: "THREE.JS WEBGL · 60 FPS",\n    scene: "cctv-express.html",\n    liveUrl: "https://cctvexpress.stream.builders",\n    technologies: ["Three.js", "SVG Extrusion", "Canvas 2D", "Neon Ignition"],\n  },\n  {\n    key: "hackingToday",`);
  writeFileSync(secao, b);
}

// ---------- tk-port ----------
const LOCAIS_PORT = ['pt', 'en', 'es', 'fr', 'ja', 'zh', 'ko', 'ru', 'ar'];
const obj = Object.fromEntries(LOCAIS_PORT.map((l) => {
  const [tag, subtitle, description, ...specs] = copia[l];
  return [l, { tag, subtitle, description, specs }];
}));
writeFileSync(join(port, 'lib', 'branding-cctv-express.ts'), `// Propriedade intelectual e autoria de André "Tutankhamal" Borba (Stream.Builders) - ORCID 0009-0006-1743-1554.
// Copy do cartão do CCTV Express (seção Branding) nos 9 idiomas do portfólio, a mesma da sb-land (que tem os 18).
// Gerado por sb-cctv-express/scripts/inserir-cartao-sites.mjs a partir de cartao/copia.json.
import type { Locale } from "@/lib/i18n";

type Copia = { tag: string; subtitle: string; description: string; specs: [string, string][] };

export const COPY_CCTV_EXPRESS: Record<Locale, Copia> = ${JSON.stringify(obj, null, 2)};
`);
const br = join(port, 'components', 'sections', 'branding.tsx');
let p = readFileSync(br, 'utf8');
if (!p.includes('COPY_CCTV_EXPRESS')) {
  p = p.replace('import { COPY_OCEANBOOKS } from "@/lib/branding-oceanbooks";', 'import { COPY_OCEANBOOKS } from "@/lib/branding-oceanbooks";\nimport { COPY_CCTV_EXPRESS } from "@/lib/branding-cctv-express";');
  const usoOcb = p.match(/\n(\s*)const ocb = ([^\n]+)\n/);
  if (!usoOcb) throw new Error('tk-port: não achei const ocb');
  p = p.replace(usoOcb[0], `${usoOcb[0]}${usoOcb[1]}const cctv = ${usoOcb[2].replaceAll('COPY_OCEANBOOKS', 'COPY_CCTV_EXPRESS')}\n`);
  p = p.replace('    {\n      id: "hacking-today",', `    {\n      id: "cctv-express",\n      tag: cctv.tag,\n      name: "CCTV.EXPRESS",\n      subtitle: cctv.subtitle,\n      description: cctv.description,\n      accentColor: "#FF3333",\n      glowColor: "rgba(255, 51, 51, 0.25)",\n      engine: "THREE.JS WEBGL · 60 FPS",\n      previewUrl: "/branding/cctv-express.html?v=2026.11.04",\n      liveUrl: "https://cctvexpress.stream.builders",\n      technologies: ["Three.js", "SVG Extrusion", "Canvas 2D", "Neon Ignition"],\n      specs: cctv.specs.map(([label, value]) => ({ label, value })),\n    },\n    {\n      id: "hacking-today",`);
  writeFileSync(br, p);
}
console.log('sb-land e tk-port atualizados');
