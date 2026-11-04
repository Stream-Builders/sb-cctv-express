// Copia o three.js (MIT) para src/splash/vendor: a tela do splash é HTML puro, sem empacotador, e a CSP não aceita
// importmap em linha. O SVGLoader importa 'three' pelo nome; aqui ele passa a apontar para o arquivo copiado.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const three = join(raiz, 'node_modules', 'three');
const destino = join(raiz, 'src', 'splash', 'vendor');
mkdirSync(destino, { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) copyFileSync(join(three, 'build', f), join(destino, f));
copyFileSync(join(three, 'LICENSE'), join(destino, 'THREE-LICENSE'));
const svg = readFileSync(join(three, 'examples', 'jsm', 'loaders', 'SVGLoader.js'), 'utf8').replace("from 'three'", "from './three.module.js'");
writeFileSync(join(destino, 'SVGLoader.js'), svg);
console.log('three.js copiado para src/splash/vendor');
