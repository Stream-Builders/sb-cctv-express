// Propriedade intelectual e autoria de André "Tutankhamal" Borba (Stream.Builders) - ORCID 0009-0006-1743-1554. Uso autorizado mediante acordo escrito com o autor.
//
// As marcas dos documentos do CCTV Express para o gerador de documentos da Stream.Builders (--marcas): Stream.Builders e
// cctv.express, lado a lado na capa, no cabeçalho de toda página e na marca d'água. Na folha branca da impressão, o
// creme da palavra "express" vira tinta escura e o vermelho escurece (o #FF3333 sobre branco não dá 4,5:1).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = fileURLToPath(new URL('.', import.meta.url));
const UI = join(AQUI, '..', '..', 'src', 'ui', 'marca');
const ler = (...c) => readFileSync(join(...c), 'utf8');

export default ({ dado }) => {
  const svg = (texto) => dado('image/svg+xml', Buffer.from(texto));
  const naFolha = (texto, t) => (t === 'digital' ? texto : texto.replaceAll('#EFE6D0', '#1C1C1C').replaceAll('#FF3333', '#C4161C'));
  const SB = svg(ler(AQUI, 'marca', 'stream-builders.svg'));
  const emblema = (t) => svg(naFolha(ler(UI, 'emblema.svg'), t));
  const palavra = (t) => svg(naFolha(ler(UI, 'palavra.svg'), t));
  const NOME_SB = '<span class="stream">Stream.</span><span class="builders">Builders</span>';
  return {
    rodape: 'Stream.Builders · cctv.express',
    marcas: [
      { cab: () => `<span class="m-sb"><img src="${SB}" alt=""><span class="nome">${NOME_SB}</span></span>`,
        rosto: () => `<div class="marca"><img class="simbolo" src="${SB}" alt=""><span class="nome-sb">${NOME_SB}</span></div>` },
      { cab: (t, alt) => `<span class="m-cc"><img src="${emblema(t)}" alt=""><img class="palavra" src="${palavra(t)}" alt="${alt('cctv.express')}"></span>`,
        rosto: (t) => `<div class="marca"><img class="simbolo" src="${emblema(t)}" alt=""><img class="nome-img" src="${palavra(t)}" alt="cctv.express"></div>` },
    ],
    css: () => `
.marcas .m-cc { display: flex; align-items: center; justify-content: space-between; width: calc(var(--m) * 5.78); }
.marcas .m-cc img { height: calc(var(--m) * 1.05); }
.marcas .m-cc img.palavra { height: calc(var(--m) * .78); width: auto; }
.rosto { max-width: 150mm; margin-inline: auto; }
.rosto .nome-img { inline-size: 80%; }
figure.tela.media { inline-size: 84%; margin-inline: auto; }
figure.tela.estreita { inline-size: 68%; margin-inline: auto; }
.telas.celulares { padding-inline: 30mm; }
.telas.celulares.baixos { grid-template-columns: repeat(4, 1fr); padding-inline: 34mm; }
.chamada { padding: 4mm 6mm; margin: 3mm 0 0; }
.chamada h3 { font-size: 13pt; margin-block-end: 1.5mm; }
.chamada p { margin-block-end: 1mm; }
`,
  };
};
