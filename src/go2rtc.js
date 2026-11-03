// O motor de vídeo: o go2rtc roda escondido, escutando só neste computador (127.0.0.1). Ele conecta nas câmeras,
// reconecta sozinho quando caem e entrega o vídeo ao vivo para a tela por WebSocket (MSE/WebRTC), sem recomprimir.
// As senhas não entram no arquivo de configuração: vão por variável de ambiente só para o processo do go2rtc.
const { app } = require('electron');
const { spawn } = require('node:child_process');
const { writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const cameras = require('./cameras');

const PORTA_API = 18984;
const PORTA_RTSP = 18554;
let processo = null;

function binario() {
  const empacotado = join(process.resourcesPath || '', 'go2rtc.exe');
  if (app.isPackaged && existsSync(empacotado)) return empacotado;
  return join(__dirname, '..', 'vendor', 'go2rtc.exe');
}

const enc = (s) => encodeURIComponent(s);

/** O endereço que o go2rtc usa para buscar o vídeo de cada câmera. */
function fonte(c, i, env) {
  const usuario = enc(c.usuario || 'admin');
  const senha = cameras.abrir(c.senhaCifrada);
  const variavel = `CCTV_SENHA_${i}`;
  env[variavel] = enc(senha);
  const cred = `${usuario}:\${${variavel}}`;
  switch (c.tipo) {
    case 'xiongmai':
      // protocolo próprio da Xiongmai (porta 34567): canal começa em 0 no protocolo
      return `dvrip://${cred}@${c.ip}:${c.porta || 34567}?channel=${(c.canal || 1) - 1}&subtype=0`;
    case 'onvif':
      return `onvif://${cred}@${c.ip}:${c.porta || 80}`;
    default:
      if (c.url) {
        // RTSP com usuário e senha colocados pelo app (o endereço salvo não guarda a senha)
        return c.url.replace(/^rtsp:\/\//, `rtsp://${cred}@`);
      }
      return `rtsp://${cred}@${c.ip}:${c.porta || 554}/`;
  }
}

function configurar() {
  const env = { ...process.env };
  const linhas = [
    'api:',
    `  listen: "127.0.0.1:${PORTA_API}"`,
    '  origin: "*"',
    // RTSP só neste computador: é por ele que o gravador (ffmpeg) lê o vídeo, sem abrir outra conexão na câmera
    'rtsp:',
    `  listen: "127.0.0.1:${PORTA_RTSP}"`,
    'webrtc:',
    '  listen: ""',
    'log:',
    '  level: warn',
    'streams:',
  ];
  cameras.ler().forEach((c, i) => {
    linhas.push(`  "${c.id}":`, `    - ${JSON.stringify(fonte(c, i, env))}`);
  });
  const arq = join(app.getPath('userData'), 'go2rtc.yaml');
  writeFileSync(arq, `${linhas.join('\n')}\n`);
  return { arq, env };
}

function iniciar() {
  parar();
  const { arq, env } = configurar();
  processo = spawn(binario(), ['-config', arq], { env, windowsHide: true, stdio: 'ignore' });
  // se o motor cair, volta sozinho em 2 s
  processo.on('exit', (codigo) => {
    if (processo && codigo !== null) setTimeout(() => { if (processo) iniciar(); }, 2000);
  });
}

function parar() {
  const p = processo;
  processo = null;
  if (p && !p.killed) p.kill();
}

module.exports = { iniciar, parar, PORTA_API, PORTA_RTSP };
