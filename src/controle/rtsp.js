// Sonda RTSP: descobre o caminho do vídeo de uma câmera quando a pessoa só sabe o IP. Manda DESCRIBE (com Basic ou
// Digest, o que a câmera pedir) nos caminhos que as marcas usam e fica com o primeiro que devolve 200 com vídeo. Não
// grava nada nem abre o vídeo: só lê a descrição da sessão (SDP).
const net = require('node:net');
const { createHash, randomBytes } = require('node:crypto');

// caminhos de fábrica mais comuns, do mais usado para o menos usado; {u}/{s} = usuário e senha, {c} = canal
const CAMINHOS = [
  '/user={u}&password={s}&channel={c}&stream=0.sdp?', // Xiongmai (XMEye, iCSee, NetSurveillance)
  '/cam/realmonitor?channel={c}&subtype=0', // Dahua, Intelbras, Imou, Amcrest
  '/Streaming/Channels/{c}01', // Hikvision, HiLook, EZVIZ
  '/h264Preview_0{c}_main', // Reolink
  '/stream1', // TP-Link Tapo e VIGI
  '/unicast/c{c}/s0/live', // Uniview
  '/media/video{c}', // Uniview (firmware antigo)
  '/onvif1', // Yoosee
  '/ch0_0.264', // V380
  '/live/ch00_0', // câmeras genéricas (HiSilicon)
  '/11', // câmeras genéricas
  '/live', // celular (apps de câmera) e genéricas
  '/',
];

function autorizacao(desafio, usuario, senha, url) {
  if (/^basic/i.test(desafio)) return `Basic ${Buffer.from(`${usuario}:${senha}`).toString('base64')}`;
  const p = Object.fromEntries([...desafio.matchAll(/(\w+)="?([^",]+)"?/g)].map(([, k, v]) => [k.toLowerCase(), v]));
  // SHA-256 (RFC 7616) quando a câmera oferece; MD5 só quando é o único que ela fala
  const sha256 = /^SHA-256$/i.test(p.algorithm || '');
  const h = (s) => createHash(sha256 ? 'sha256' : 'md5').update(s).digest('hex');
  const resposta = h(`${h(`${usuario}:${p.realm}:${senha}`)}:${p.nonce}:${h(`DESCRIBE:${url}`)}`);
  return `Digest username="${usuario}", realm="${p.realm}", nonce="${p.nonce}", uri="${url}", response="${resposta}"${sha256 ? ', algorithm=SHA-256' : ''}`;
}

/** Uma requisição DESCRIBE; devolve { status, desafio, sdp }. */
function describe(ip, porta, url, auth, ms = 4000) {
  return new Promise((ok) => {
    const s = net.connect({ host: ip, port: porta });
    let d = '';
    const fim = (v) => { s.destroy(); ok(v); };
    s.setTimeout(ms, () => fim({ status: 0 }));
    s.on('error', () => fim({ status: 0 }));
    s.on('connect', () => s.write(`DESCRIBE ${url} RTSP/1.0\r\nCSeq: 2\r\nAccept: application/sdp\r\nUser-Agent: CCTV Express\r\n${auth ? `Authorization: ${auth}\r\n` : ''}\r\n`));
    s.on('data', (c) => {
      d += c;
      const fimCab = d.indexOf('\r\n\r\n');
      if (fimCab < 0) return;
      const status = Number(d.match(/^RTSP\/1\.0 (\d+)/)?.[1] || 0);
      const tam = Number(d.match(/Content-Length:\s*(\d+)/i)?.[1] || 0);
      if (status === 200 && d.length < fimCab + 4 + tam) return;
      const desafios = [...d.slice(0, fimCab).matchAll(/WWW-Authenticate:\s*(.+)/gi)].map((m) => m[1].trim());
      fim({ status, desafio: desafios.find((x) => /^digest/i.test(x) && /algorithm="?SHA-256/i.test(x)) || desafios.find((x) => /^digest/i.test(x)) || desafios[0] || '', sdp: d.slice(fimCab + 4) });
    });
  });
}

/** DESCRIBE autenticado: devolve true se o caminho tem vídeo. */
async function temVideo(ip, porta, caminho, usuario, senha) {
  const url = `rtsp://${ip}:${porta}${caminho}`;
  let r = await describe(ip, porta, url);
  if (r.status === 401 && r.desafio) r = await describe(ip, porta, url, autorizacao(r.desafio, usuario, senha, url));
  return { ok: r.status === 200 && /m=video/i.test(r.sdp || ''), status: r.status };
}

/**
 * Acha o endereço RTSP da câmera: devolve { url } (sem a senha) ou { erro } quando nada responde ou a senha está
 * errada em todos. Para no primeiro que funciona.
 */
async function descobrir({ ip, porta = 554, usuario = 'admin', senha = '', canal = 1 }) {
  const portas = [...new Set([Number(porta) || 554, 554, 8554, 10554])];
  let negado = false;
  for (const p of portas) {
    // porta fechada: nem tenta os caminhos
    const aberta = await describe(ip, p, `rtsp://${ip}:${p}/`, null, 2500);
    if (aberta.status === 0) continue;
    for (const molde of CAMINHOS) {
      const caminho = molde.replace('{u}', encodeURIComponent(usuario)).replace('{s}', encodeURIComponent(senha)).replace(/\{c\}/g, String(canal));
      const r = await temVideo(ip, p, caminho, usuario, senha);
      if (r.ok) {
        // o caminho Xiongmai leva a senha na própria URL: guarda sem ela (o app põe na hora de conectar)
        const salvo = molde.includes('{s}') ? molde.replace('{u}', encodeURIComponent(usuario)).replace('{s}', '').replace(/\{c\}/g, String(canal)) : caminho;
        return { url: `rtsp://${ip}:${p}${salvo}` };
      }
      if (r.status === 401) negado = true;
    }
  }
  return { erro: negado ? 'usuário ou senha incorretos' : 'nenhum caminho de vídeo respondeu' };
}

module.exports = { descobrir, temVideo, CAMINHOS };
