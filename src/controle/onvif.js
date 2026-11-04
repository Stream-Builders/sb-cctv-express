// Cliente ONVIF mínimo para PTZ: descobre o serviço PTZ e o perfil de mídia, e manda ContinuousMove / Stop.
// Autenticação WS-Security UsernameToken com senha em digest (o padrão ONVIF), sem dependência externa.
const http = require('node:http');
const { createHash, randomBytes } = require('node:crypto');

function cabecalhoSeguranca(usuario, senha) {
  const nonce = randomBytes(16);
  const criado = new Date().toISOString();
  const digest = createHash('sha1').update(Buffer.concat([nonce, Buffer.from(criado), Buffer.from(senha || '')])).digest('base64');
  return `<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken><Username>${esc(usuario)}</Username><Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce><Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${criado}</Created></UsernameToken></Security></s:Header>`;
}

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function soap(url, corpo, usuario, senha, ms = 5000) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl">${cabecalhoSeguranca(usuario, senha)}<s:Body>${corpo}</s:Body></s:Envelope>`;
  return new Promise((ok, falha) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'POST', timeout: ms,
      headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(xml) } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => (res.statusCode >= 400 ? falha(new Error(/NotAuthorized|Sender/.test(d) ? 'usuário ou senha incorretos' : `ONVIF ${res.statusCode}`)) : ok(d)));
    });
    req.on('timeout', () => req.destroy(new Error('a câmera não respondeu')));
    req.on('error', falha);
    req.end(xml);
  });
}

const tag = (xml, nome) => xml.match(new RegExp(`<(?:\\w+:)?${nome}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`))?.[1];

class Onvif {
  constructor({ ip, porta = 80, usuario = 'admin', senha = '' }) {
    Object.assign(this, { ip, porta, usuario, senha });
    this.dispositivo = `http://${ip}:${porta}/onvif/device_service`;
  }

  async preparar() {
    const caps = await soap(this.dispositivo, '<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>', this.usuario, this.senha);
    const xaddr = (sec) => tag(tag(caps, sec) || '', 'XAddr');
    this.urlPtz = xaddr('PTZ');
    this.urlMidia = xaddr('Media');
    if (this.urlMidia) {
      const perfis = await soap(this.urlMidia, '<trt:GetProfiles/>', this.usuario, this.senha);
      this.perfil = perfis.match(/Profiles[^>]*token="([^"]+)"/)?.[1];
    }
    return { ptz: !!(this.urlPtz && this.perfil) };
  }

  /** Movimento contínuo: x/y de -1 a 1 (pan/tilt), z de -1 a 1 (zoom). */
  mover(x, y, z = 0) {
    const pt = x || y ? `<tt:PanTilt x="${x}" y="${y}"/>` : '';
    const zm = z ? `<tt:Zoom x="${z}"/>` : '';
    return soap(this.urlPtz, `<tptz:ContinuousMove><tptz:ProfileToken>${esc(this.perfil)}</tptz:ProfileToken><tptz:Velocity>${pt}${zm}</tptz:Velocity></tptz:ContinuousMove>`, this.usuario, this.senha);
  }

  /** O endereço RTSP do perfil principal, como a câmera informa (GetStreamUri). */
  async enderecoRtsp() {
    if (!this.urlMidia) await this.preparar();
    const xml = await soap(this.urlMidia, `<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>${esc(this.perfil)}</trt:ProfileToken></trt:GetStreamUri>`, this.usuario, this.senha);
    return tag(xml, 'Uri')?.trim().replace(/&amp;/g, '&');
  }

  parar() {
    return soap(this.urlPtz, `<tptz:Stop><tptz:ProfileToken>${esc(this.perfil)}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`, this.usuario, this.senha);
  }
}

module.exports = { Onvif };
