// Ferramenta de desenvolvimento: lê (sem alterar nada) o que uma câmera Xiongmai cadastrada no app informa sobre luz e
// PTZ. Roda dentro do Electron para abrir a senha cifrada pelo app:
//   electron scripts/sondar-camera.js <ip>
const { app } = require('electron');
const { join } = require('node:path');

app.setName('CCTV Express');
app.setPath('userData', join(app.getPath('appData'), 'CCTV Express'));

app.whenReady().then(async () => {
  const cameras = require('../src/cameras');
  const { Dvrip } = require('../src/controle/dvrip');
  const ip = process.argv.at(-1);
  const c = cameras.ler().find((x) => x.ip === ip && x.tipo === 'xiongmai');
  if (!c) { console.log('câmera não encontrada'); return app.quit(); }
  const d = new Dvrip({ ip: c.ip, porta: 34567, usuario: c.usuario || 'admin', senha: cameras.abrir(c.senhaCifrada) });
  try {
    const info = await d.entrar();
    console.log('login ok', info.DeviceType || '', info.ChannelNum ?? '');
    for (const nome of ['SystemInfo', 'Camera.WhiteLight', 'Camera.Param.[0]', 'Camera.ParamEx.[0]', 'Uart.PTZ', 'SystemFunction']) {
      const r = nome === 'SystemFunction' ? await d.habilidade(nome) : await d.ler(nome);
      const v = r[nome] ?? r;
      console.log(`== ${nome} (Ret ${r.Ret})`, JSON.stringify(nome === 'SystemFunction' ? { OtherFunction: v.OtherFunction, CommFunction: v.CommFunction } : v).slice(0, 900));
    }
  } catch (e) {
    console.log('erro', e.message);
  }
  d.fechar();
  app.quit();
});
