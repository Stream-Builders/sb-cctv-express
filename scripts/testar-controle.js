// Ferramenta de desenvolvimento: testa o controle (capacidades, luz e um PTZ curto de ida e volta) numa câmera cadastrada.
//   electron scripts/testar-controle.js <ip> [canal]
const { app } = require('electron');
const { join } = require('node:path');
app.setName('CCTV Express');
app.setPath('userData', join(app.getPath('appData'), 'CCTV Express'));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const cameras = require('../src/cameras');
  const controle = require('../src/controle');
  const ip = process.argv.find((a) => /^[0-9.]+$/.test(a) && a.split('.').length === 4);
  const c = cameras.ler().find((x) => x.ip === ip);
  try {
    const caps = await controle.capacidades(c.id);
    console.log('capacidades', JSON.stringify(caps));
    if (caps.luzAtual) console.log('luz (mesmo modo)', await controle.luz(c.id, caps.luzAtual));
    if (caps.ptz) {
      await controle.ptz(c.id, 'direita', false); await espera(800); await controle.ptz(c.id, 'direita', true);
      await espera(500);
      await controle.ptz(c.id, 'esquerda', false); await espera(800); await controle.ptz(c.id, 'esquerda', true);
      console.log('ptz ida e volta ok');
    }
  } catch (e) { console.log('erro', e.message); }
  controle.fecharTodas();
  app.quit();
});
