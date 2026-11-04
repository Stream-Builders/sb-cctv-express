// Copia o cartão de branding do CCTV Express para public/branding do sb-land e do tk-port (os dois sites mostram os
// mesmos cartões). Fonte única: cartao/ e o letreiro do splash. Rodar depois de mexer no letreiro, no fundo ou na logo.
//   node scripts/empacotar-cartao.mjs [pasta do sb-land] [pasta do tk-port]
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destinos = process.argv.slice(2).length ? process.argv.slice(2) : [join(raiz, '..', 'sb-land'), join(raiz, '..', 'tk-port')];
for (const site of destinos) {
  const b = join(site, 'public', 'branding');
  mkdirSync(join(b, 'cctv-express', 'vendor'), { recursive: true });
  copyFileSync(join(raiz, 'cartao', 'cctv-express.html'), join(b, 'cctv-express.html'));
  copyFileSync(join(raiz, 'cartao', 'cctv-express-fundo.js'), join(b, 'cctv-express', 'fundo.js'));
  copyFileSync(join(raiz, 'src', 'splash', 'letreiro.js'), join(b, 'cctv-express', 'letreiro.js'));
  copyFileSync(join(raiz, 'src', 'ui', 'marca', 'logo.svg'), join(b, 'cctv-express', 'logo.svg'));
  for (const f of ['three.module.js', 'three.core.js', 'SVGLoader.js', 'THREE-LICENSE']) copyFileSync(join(raiz, 'src', 'splash', 'vendor', f), join(b, 'cctv-express', 'vendor', f));
  console.log('cartão em', b);
}
