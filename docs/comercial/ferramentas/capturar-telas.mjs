// Propriedade intelectual e autoria de André "Tutankhamal" Borba (Stream.Builders) - ORCID 0009-0006-1743-1554. Uso autorizado mediante acordo escrito com o autor.
//
// As telas da apresentação comercial, capturadas no Chrome com janela (a GPU decodifica o vídeo H.265 das câmeras):
// a tela do computador com as câmeras ao vivo do motor instalado, e as páginas do app Android em tamanho de celular.
// Precisa do servidor de telas no ar (servir-telas.mjs) e do CCTV Express instalado rodando (o motor de vídeo).
//
// Uso: node docs/comercial/ferramentas/capturar-telas.mjs <caminho do playwright>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const { chromium } = createRequire(resolve(process.argv[2] || '.', 'x.js'))('playwright');
const BASE = 'http://127.0.0.1:18992';
const PRINTS = join(RAIZ, 'docs', 'comercial', 'prints');
mkdirSync(PRINTS, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// as câmeras do cadastro real; os recursos de cada uma como as câmeras informam (lente fixa e lente PTZ da Xiongmai
// de duas lentes, o celular com a luz do flash)
const ID = { onvif: '6dfcd24d-f7e0-4faf-b847-d91ca1db2cc1', celular: 'e16e60a8-4b5d-447d-9f45-cebc984d2822', fixa: 'caac0e21-2431-476b-a991-1687612827d4', ptz: '5115effe-1b54-4599-bafb-f65a336a48c7' };
const LUZ = ['inteligente', 'colorida', 'infravermelho', 'acesa'];
const CAPS = {
  [ID.onvif]: { ptz: false, luz: null },
  [ID.celular]: { ptz: false, luz: ['acesa', 'apagada'], luzAtual: 'apagada' },
  [ID.fixa]: { ptz: false, mirar: true, luz: LUZ, luzAtual: 'inteligente', ajustes: { imagem: 'automatica', pessoas: true, seguir: false, luzDuracao: 30, luzBrilho: 80, sirene: false } },
  [ID.ptz]: { ptz: true, ronda: true, luz: LUZ, luzAtual: 'inteligente', ajustes: { imagem: 'automatica', pessoas: true, seguir: true, luzDuracao: 30, luzBrilho: 80, sirene: false } },
};

const nav = await chromium.launch({ channel: 'chrome', headless: false, args: ['--autoplay-policy=no-user-gesture-required', '--window-position=0,0'] });
const foto = (pagina, nome, opcoes = {}) => pagina.screenshot({ path: join(PRINTS, `${nome}.jpg`), type: 'jpeg', quality: 86, ...opcoes }).then(() => process.stdout.write(`${nome}\n`));

// ---------- computador ----------
const pc = await nav.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
await pc.addInitScript(({ caps, celular }) => {
  window.__capacidades = caps;
  if (!sessionStorage.getItem('preparado')) {
    localStorage.clear();
    localStorage.setItem('mosaico', '4');
    localStorage.setItem('idioma', 'pt-BR');
    localStorage.setItem(`som:${celular}`, JSON.stringify({ mudo: false, volume: 0.8, filtro: 'voz' }));
    sessionStorage.setItem('preparado', '1');
  }
}, { caps: CAPS, celular: ID.celular });
const p = await pc.newPage();
await p.goto(BASE);
await espera(10000);
// o cursor de verdade do Windows por cima da janela abre o volume ao passar no botão de som
await p.mouse.move(5, 450);
await p.evaluate(() => document.querySelectorAll('.painel-quadro').forEach((x) => x.remove()));
await espera(400);
await foto(p, 'pc-mosaico');

const quadro = (id) => p.locator(`.quadro[data-id="${id}"]`);
const fecharPainel = () => p.evaluate(() => document.querySelectorAll('.painel-quadro').forEach((x) => x.remove()));

await quadro(ID.ptz).click({ position: { x: 200, y: 200 } });
await quadro(ID.ptz).locator(`button[aria-label="Controle PTZ"]`).click();
await espera(600);
await foto(p, 'pc-ptz');
await fecharPainel();
await quadro(ID.ptz).locator(`button[aria-label="Modo de luz"]`).click();
await espera(600);
await foto(p, 'pc-luz');
await fecharPainel();
await quadro(ID.fixa).click({ position: { x: 200, y: 200 } });
await quadro(ID.fixa).locator('.quadro__barra button').nth(5).click(); // ajustes (entra antes da tela cheia)
await espera(600);
await foto(p, 'pc-ajustes');
await fecharPainel();
await quadro(ID.celular).click({ position: { x: 200, y: 200 } });
await quadro(ID.celular).locator('[data-papel="som"]').hover();
await espera(800);
await foto(p, 'pc-som');
await p.mouse.move(5, 450);
await espera(600);
await fecharPainel();

// vistas e ronda: duas vistas salvas pela própria tela
await p.click('#abrir-vistas');
await p.fill('#vistas-nome', 'Todas as câmeras');
await p.click('#vistas-salvar');
await p.click('[data-fechar]:visible');
await p.click('[data-mosaico="1"]');
await espera(800);
await p.click('#abrir-vistas');
await p.fill('#vistas-nome', 'Só a lente PTZ');
await p.click('#vistas-salvar');
await p.selectOption('#ronda-modo', 'vistas');
await espera(500);
await foto(p, 'pc-vistas');
await p.click('#ronda-alternar');
await p.evaluate(() => { const d = document.getElementById('dialogo-vistas'); if (d.open) d.close(); });
await espera(2500);
await foto(p, 'pc-ronda');
await p.keyboard.press('Escape');
await p.click('[data-mosaico="4"]');
await espera(3000);

// reprodução: a linha do tempo do dia com as gravações e os movimentos de verdade
await p.click('#abrir-reproducao');
await espera(1500);
await p.selectOption('#rep-camera', ID.ptz).catch(() => {});
await espera(2000);
const faixa = p.locator('.linha-tempo__faixa');
const caixa = await faixa.boundingBox();
if (caixa) await p.mouse.click(caixa.x + caixa.width * 0.86, caixa.y + caixa.height / 2);
await espera(4000);
await foto(p, 'pc-reproducao');
await p.keyboard.press('Escape');

await p.click('#abrir-config');
await espera(1200);
await foto(p, 'pc-configuracoes');
await p.keyboard.press('Escape');
await p.click('#adicionar');
await espera(800);
await foto(p, 'pc-adicionar');
await p.keyboard.press('Escape');
await p.click('#fechar-app');
await espera(600);
await foto(p, 'pc-fechar');
await p.keyboard.press('Escape');

// janela estreita, nove quadros e a lista recolhida: o topo e os selos se ajustam
await p.setViewportSize({ width: 1180, height: 760 });
await p.click('[data-mosaico="9"]');
await p.click('#alternar-lateral');
await espera(2500);
await foto(p, 'pc-janela-estreita');
await p.click('#alternar-lateral');
await pc.close();

// ---------- celular ----------
const celular = await nav.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'pt-BR' });
const a = await celular.newPage();
await a.goto(`${BASE}/android/inicio.html`);
await espera(4200);
await foto(a, 'android-abertura');
await a.evaluate(() => { window.__semAbertura = true; });
await a.addInitScript(() => { window.__semAbertura = true; });
await a.goto(`${BASE}/android/inicio.html`);
await espera(1500);
await foto(a, 'android-inicio');

await a.addInitScript(() => {
  window.__estadoCamera = { aoVivo: true, luz: false, ajuda: 'Adicione este endereço no CCTV Express como câmera RTSP:', endereco: 'rtsp://192.168.18.115:8554/', credenciais: 'Usuário: cctv · Senha: ••••••' };
});
await a.goto(`${BASE}/android/painel.html`);
await a.addStyleTag({ content: `html { background: #000 url(/__quadro/${ID.celular}.jpg) center / cover no-repeat; }` });
await espera(2500);
await foto(a, 'android-camera');
await a.locator('#acoes button').nth(5).click();
await espera(500);
await foto(a, 'android-acesso');

await a.goto(`${BASE}/android/assistir.html`);
await espera(4000);
await foto(a, 'android-assistir');
await a.locator('#mosaico .quadro').nth(1).click();
await espera(3000);
await foto(a, 'android-tela-cheia');
await a.evaluate(() => window.voltar());
await espera(800);
await a.locator('#acoes button').nth(0).click();
await espera(600);
await foto(a, 'android-adicionar');
await a.evaluate(() => window.voltar());
await a.locator('#acoes button').nth(3).click();
await espera(600);
await foto(a, 'android-arquivo');
await celular.close();
await nav.close();
