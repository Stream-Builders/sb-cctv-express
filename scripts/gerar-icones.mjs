// Ícones do README (midia/icones/*.svg): traço da marca em #FF3333, sem emoji. Um quadrado preto chanfrado de fundo,
// como os selos do perfil da Stream.Builders, e o desenho por cima.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'midia', 'icones');
mkdirSync(pasta, { recursive: true });
const R = '#FF3333';
const DESENHOS = {
  camera: '<path d="M4 9.5l11.5-3.6 1.4 4.3-11.5 3.6z"/><path d="M15 8l3-1v4l-3 1"/><path d="M9 13.4l1.6 3.6H6.5M10.6 17h5"/><circle cx="7.3" cy="10.6" r="0.6" fill="#FF3333"/>',
  baixar: '<path d="M12 4v10M7.5 9.5L12 14l4.5-4.5M5 19h14"/>',
  site: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.3 3.6 5 3.6 8s-1.1 5.7-3.6 8c-2.5-2.3-3.6-5-3.6-8S9.5 6.3 12 4z"/>',
  recursos: '<path d="M4 6h4v4H4zM4 14h4v4H4zM11 8h9M11 16h9"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.3M12 18.2v2.3M3.5 12h2.3M18.2 12h2.3M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"/>',
  terminal: '<path d="M4 5h16v14H4z"/><path d="M7.5 10l2.5 2-2.5 2M12 15h4.5"/>',
  etapas: '<path d="M5 18V6M5 6l4 3-4 3M10 18h9M10 13h6"/>',
  licenca: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6"/>',
};
for (const [nome, d] of Object.entries(DESENHOS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M2 0h20l2 2v20l-2 2H2l-2-2V2z" fill="#000"/><g fill="none" stroke="${R}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</g></svg>\n`;
  writeFileSync(join(pasta, `${nome}.svg`), svg);
}
console.log(Object.keys(DESENHOS).length, 'ícones');
