// Monta os arquivos compartilhados do site (site/): o letreiro do splash, o three.js e a marca. Rodar antes do deploy.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(raiz, 'site');
for (const d of ['vendor', 'marca', 'tema']) mkdirSync(join(site, d), { recursive: true });
copyFileSync(join(raiz, 'src', 'splash', 'letreiro.js'), join(site, 'letreiro.js'));
for (const f of ['three.module.js', 'three.core.js', 'SVGLoader.js', 'THREE-LICENSE']) copyFileSync(join(raiz, 'src', 'splash', 'vendor', f), join(site, 'vendor', f));
for (const f of ['logo.svg', 'emblema.svg']) copyFileSync(join(raiz, 'src', 'ui', 'marca', f), join(site, 'marca', f));
copyFileSync(join(raiz, 'build', 'icon.png'), join(site, 'marca', 'icone.png'));
for (const f of ['sb-btn.css', 'tema.css']) copyFileSync(join(raiz, 'src', 'ui', 'tema', f), join(site, 'tema', f));
copyFileSync(join(raiz, 'midia', 'letreiro.mp4'), join(site, 'marca', 'letreiro.mp4'));
console.log('site montado');
