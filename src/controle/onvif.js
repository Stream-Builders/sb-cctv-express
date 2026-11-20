// Cliente ONVIF mínimo para PTZ: descobre o serviço PTZ e o perfil de mídia, e manda ContinuousMove / Stop.
// Autenticação WS-Security UsernameToken com senha em digest (o padrão ONVIF), sem dependência externa.
const http = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

// Hora da câmera menos a deste computador, em ms. O digest do WS-Security leva o horário (Created) e muita câmera recusa
// a senha quando o relógio dela está longe do nosso: a hora vem de GetSystemDateAndTime, que não pede senha.
function cabecalhoSeguranca(usuario, senha, desvioMs = 0) {
  const nonce = randomBytes(16);
  const criado = new Date(Date.now() + desvioMs).toISOString().replace(/\.\d+Z$/, 'Z');
  const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(criado), Buffer.from(senha || '')])).digest('base64');
  return `<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken><Username>${esc(usuario)}</Username><Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce><Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${criado}</Created></UsernameToken></Security></s:Header>`;
}

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const md5 = (s) => createHash('md5').update(s).digest('hex');

/** Cabeçalho Authorization do HTTP Digest (RFC 7616, MD5, qop=auth), que o ONVIF Profile S também aceita. */
function digestHttp(desafio, usuario, senha, metodo, caminho) {
  const p = Object.fromEntries([...desafio.matchAll(/(\w+)="?([^",]+)"?/g)].map(([, k, v]) => [k.toLowerCase(), v]));
  const cnonce = randomBytes(8).toString('hex');
  const nc = '00000001';
  const ha1 = md5(`${usuario}:${p.realm}:${senha || ''}`);
  const ha2 = md5(`${metodo}:${caminho}`);
  const qop = /auth/.test(p.qop || '') ? 'auth' : '';
  const resposta = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  return `Digest username="${usuario}", realm="${p.realm}", nonce="${p.nonce}", uri="${caminho}", response="${resposta}"${p.opaque ? `, opaque="${p.opaque}"` : ''}${qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : ''}`;
}

function post(url, xml, ms, autorizacao) {
  return new Promise((ok, falha) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'POST', timeout: ms,
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(xml), ...(autorizacao ? { Authorization: autorizacao } : {}) } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => ok({ status: res.statusCode, corpo: d, desafio: res.headers['www-authenticate'] || '' }));
    });
    req.on('timeout', () => req.destroy(new Error('a câmera não respondeu')));
    req.on('error', falha);
    req.end(xml);
  });
}

/**
 * Chamada SOAP com WS-Security; se a câmera responder 401 pedindo HTTP Digest, repete com ele (há câmeras que só
 * aceitam um dos dois).
 */
async function soap(url, corpo, usuario, senha, ms = 5000, desvioMs = 0) {
  const envelope = (cab) => `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl">${cab}<s:Body>${corpo}</s:Body></s:Envelope>`;
  let r = await post(url, envelope(cabecalhoSeguranca(usuario, senha, desvioMs)), ms);
  if (r.status === 401 && /digest/i.test(r.desafio)) {
    const u = new URL(url);
    r = await post(url, envelope(''), ms, digestHttp(r.desafio, usuario, senha, 'POST', u.pathname + u.search));
  }
  if (r.status >= 400) throw new Error(r.status === 401 || /NotAuthorized|Sender/.test(r.corpo) ? 'usuário ou senha incorretos' : `ONVIF ${r.status}`);
  return r.corpo;
}

/** Desvio do relógio da câmera (GetSystemDateAndTime não pede senha); 0 se ela não informar. */
async function desvioDoRelogio(url) {
  try {
    const r = await post(url, '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>', 4000);
    const utc = r.corpo.match(/UTCDateTime>([\s\S]*?)<\/(?:\w+:)?UTCDateTime/)?.[1];
    if (!utc) return 0;
    const n = (campo) => Number(utc.match(new RegExp(`<(?:\\w+:)?${campo}>(\\d+)<`))?.[1]);
    const t = Date.UTC(n('Year'), n('Month') - 1, n('Day'), n('Hour'), n('Minute'), n('Second'));
    return Number.isFinite(t) ? t - Date.now() : 0;
  } catch {
    return 0;
  }
}

/**
 * Muita câmera informa nos endereços de serviço (XAddr) e de vídeo um IP que não é o dela (o de fábrica, ou de outra
 * placa): vale sempre o IP cadastrado, com a porta que a câmera informou.
 */
function noIpDaCamera(endereco, ip) {
  if (!endereco) return endereco;
  try {
    const u = new URL(endereco);
    u.hostname = ip;
    return u.toString();
  } catch {
    return endereco;
  }
}

const tag = (xml, nome) => xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`))?.[1];

class Onvif {
  constructor({ ip, porta = 80, usuario = 'admin', senha = '', canal = 1 }) {
    Object.assign(this, { ip, porta, usuario, senha, canal: Math.max(1, Number(canal) || 1) });
    this.dispositivo = `http://${ip}:${porta}/onvif/device_service`;
  }

  /** Chamada à câmera com a senha e o desvio do relógio dela. */
  chamar(url, corpo) {
    return soap(url, corpo, this.usuario, this.senha, 5000, this.desvio || 0);
  }

  async preparar() {
    this.desvio = await desvioDoRelogio(this.dispositivo);
    const caps = await this.chamar(this.dispositivo, '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>');
    const xaddr = (sec) => noIpDaCamera(tag(tag(caps, sec) || '', 'XAddr')?.trim(), this.ip);
    this.urlPtz = xaddr('PTZ');
    this.urlMidia = xaddr('Media');
    if (this.urlMidia) {
      const perfis = await this.chamar(this.urlMidia, '<trt:GetProfiles/>');
      // câmera de várias lentes: cada lente é uma fonte de vídeo (VideoSourceConfiguration/SourceToken) com os seus
      // perfis; o canal N é o primeiro perfil (o principal) da N-ésima fonte, na ordem em que a câmera lista
      const lista = [...perfis.matchAll(/<(?:\w+:)?Profiles\b[^>]*token="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?Profiles>/g)]
        .map(([, token, corpo]) => ({ token, fonte: tag(corpo, 'SourceToken')?.trim() || token }));
      const fontes = [...new Set(lista.map((p) => p.fonte))];
      const alvo = fontes[this.canal - 1];
      this.perfil = (alvo && lista.find((p) => p.fonte === alvo)?.token) || lista[0]?.token
        || perfis.match(/Profiles[^>]*token="([^"]+)"/)?.[1];
    }
    return { ptz: !!(this.urlPtz && this.perfil) };
  }

  /** Movimento contínuo: x/y de -1 a 1 (pan/tilt), z de -1 a 1 (zoom). */
  mover(x, y, z = 0) {
    const pt = x || y ? `<tt:PanTilt x="${x}" y="${y}"/>` : '';
    const zm = z ? `<tt:Zoom x="${z}"/>` : '';
    return this.chamar(this.urlPtz, `<tptz:ContinuousMove><tptz:ProfileToken>${esc(this.perfil)}</tptz:ProfileToken><tptz:Velocity>${pt}${zm}</tptz:Velocity></tptz:ContinuousMove>`);
  }

  /** O endereço RTSP do perfil principal, como a câmera informa (GetStreamUri). */
  async enderecoRtsp() {
    if (!this.urlMidia) await this.preparar();
    const xml = await this.chamar(this.urlMidia, `<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>${esc(this.perfil)}</trt:ProfileToken></trt:GetStreamUri>`);
    return noIpDaCamera(tag(xml, 'Uri')?.trim().replace(/&amp;/g, '&'), this.ip);
  }

  parar() {
    return this.chamar(this.urlPtz, `<tptz:Stop><tptz:ProfileToken>${esc(this.perfil)}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`);
  }
}

module.exports = { Onvif };
