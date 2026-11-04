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
// endereços RTSP que as câmeras ONVIF informam (preenchido por resolverOnvif antes de subir o motor)
const rtspOnvif = new Map();
let processo = null;

function binario() {
  const empacotado = join(process.resourcesPath || '', 'go2rtc.exe');
  if (app.isPackaged && existsSync(empacotado)) return empacotado;
  return join(__dirname, '..', 'vendor', 'go2rtc.exe');
}

const enc = (s) => encodeURIComponent(s);

// só o vídeo das câmeras RTSP: o app não usa áudio (a gravação descarta), e alguns áudios (PCMU a 16 kHz, por exemplo)
// derrubam o player do navegador
const SO_VIDEO = '#media=video';

/**
 * O go2rtc monta a linha de comando do ffmpeg separando por espaços: com o app instalado em "C:\Program Files", ele
 * tentava rodar "C:\Program" e a reconversão (modo de compatibilidade) nunca subia. No Windows, o caminho curto (8.3)
 * não tem espaço.
 */
function caminhoSemEspaco(caminho) {
  if (process.platform !== 'win32' || !caminho.includes(' ')) return caminho;
  try {
    const { execFileSync } = require('node:child_process');
    const curto = execFileSync('cmd.exe', ['/d', '/c', `for %I in ("${caminho}") do @echo %~sI`], { encoding: 'utf8', windowsVerbatimArguments: true, windowsHide: true }).trim();
    return curto && !curto.includes(' ') ? curto : caminho;
  } catch {
    return caminho;
  }
}

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
      // com o endereço que a própria câmera informou, o motor lê o RTSP direto (a descoberta ONVIF do go2rtc falha
      // em algumas câmeras); sem ele, fica a descoberta do go2rtc
      if (rtspOnvif.has(c.id)) return `${rtspOnvif.get(c.id).replace(/^rtsp:\/\//, `rtsp://${cred}@`)}${SO_VIDEO}`;
      return `onvif://${cred}@${c.ip}:${c.porta || 80}`;
    default:
      if (c.url) {
        // RTSP com usuário e senha colocados pelo app (o endereço salvo não guarda a senha)
        return `${c.url.replace(/^rtsp:\/\//, `rtsp://${cred}@`)}${SO_VIDEO}`;
      }
      return `rtsp://${cred}@${c.ip}:${c.porta || 554}/${SO_VIDEO}`;
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
    // o ffmpeg que vem com o app (quadros JPEG e conversões do go2rtc)
    'ffmpeg:',
    `  bin: ${JSON.stringify(caminhoSemEspaco(require('./gravador').binarioFfmpeg()))}`,
    'log:',
    '  level: warn',
    'streams:',
  ];
  cameras.ler().forEach((c, i) => {
    linhas.push(`  "${c.id}":`, `    - ${JSON.stringify(fonte(c, i, env))}`);
    // compatibilidade: o mesmo vídeo reconvertido em H264 comum (com a placa de vídeo, se houver), para câmeras cujo
    // perfil H264 o navegador recusa. O ffmpeg só roda enquanto alguém assiste a este stream.
    linhas.push(`  "${c.id}_compat":`, `    - ${JSON.stringify(`ffmpeg:${c.id}#video=h264#width=1920#hardware`)}`);
  });
  const arq = join(app.getPath('userData'), 'go2rtc.yaml');
  writeFileSync(arq, `${linhas.join('\n')}\n`);
  return { arq, env };
}

/** Pergunta às câmeras ONVIF o endereço RTSP do vídeo (GetStreamUri). */
async function resolverOnvif() {
  const { Onvif } = require('./controle/onvif');
  await Promise.all(cameras.ler().filter((c) => c.tipo === 'onvif').map(async (c) => {
    try {
      const o = new Onvif({ ip: c.ip, porta: c.porta || 80, usuario: c.usuario || 'admin', senha: cameras.abrir(c.senhaCifrada) });
      const uri = await o.enderecoRtsp();
      if (uri && uri.startsWith('rtsp://')) rtspOnvif.set(c.id, uri.replace(/^rtsp:\/\/[^@/]*@/, 'rtsp://'));
    } catch { /* câmera fora do ar agora: fica a descoberta do go2rtc */ }
  }));
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

module.exports = { resolverOnvif, iniciar, parar, PORTA_API, PORTA_RTSP };
