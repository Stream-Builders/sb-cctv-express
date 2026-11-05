// Cliente mínimo do protocolo DVRIP (Xiongmai / iCSee / XMeye, porta TCP 34567): login, leitura e gravação de
// configuração e comando de PTZ. Cabeçalho de 20 bytes (little-endian) seguido de JSON terminado em "\n\0".
const net = require('node:net');
const { createHash } = require('node:crypto');

const MSG = { LOGIN: 1000, CONFIG_SET: 1040, CONFIG_GET: 1042, ABILITY_GET: 1360, PTZ: 1400 };

/** O "hash Sofia" da senha que a Xiongmai usa no login: MD5 dobrado em 8 caracteres alfanuméricos. */
function hashSofia(senha) {
  const md5 = createHash('md5').update(senha || '').digest();
  const alfabeto = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let r = '';
  for (let i = 0; i < 8; i++) r += alfabeto[(md5[2 * i] + md5[2 * i + 1]) % 62];
  return r;
}

class Dvrip {
  constructor({ ip, porta = 34567, usuario = 'admin', senha = '' }) {
    Object.assign(this, { ip, porta, usuario, senha });
    this.sessao = 0;
    this.seq = 0;
    this.buffer = Buffer.alloc(0);
    this.esperando = [];
  }

  conectar(ms = 5000) {
    return new Promise((ok, falha) => {
      this.sock = net.connect({ host: this.ip, port: this.porta });
      this.sock.setTimeout(ms, () => { this.sock.destroy(); falha(new Error('a câmera não respondeu')); });
      this.sock.once('connect', () => { this.sock.setTimeout(0); ok(); });
      this.sock.once('error', falha);
      this.sock.on('data', (d) => this.receber(d));
      this.sock.on('close', () => { for (const e of this.esperando.splice(0)) e.falha(new Error('conexão fechada')); });
    });
  }

  receber(d) {
    this.buffer = Buffer.concat([this.buffer, d]);
    while (this.buffer.length >= 20) {
      const tam = this.buffer.readUInt32LE(16);
      if (this.buffer.length < 20 + tam) return;
      const corpo = this.buffer.subarray(20, 20 + tam).toString('utf8').replace(/[\0\n\r]+$/g, '');
      const sessao = this.buffer.readUInt32LE(4);
      this.buffer = this.buffer.subarray(20 + tam);
      let json = {};
      try { json = corpo ? JSON.parse(corpo) : {}; } catch { json = { bruto: corpo }; }
      const e = this.esperando.shift();
      if (e) e.ok({ sessao, json });
    }
  }

  enviar(msg, dados, ms = 5000) {
    const corpo = Buffer.from(`${JSON.stringify(dados)}\n\0`, 'utf8');
    const cab = Buffer.alloc(20);
    cab.writeUInt8(0xff, 0);
    cab.writeUInt8(0x01, 1);
    cab.writeUInt32LE(this.sessao, 4);
    cab.writeUInt32LE(this.seq++, 8);
    cab.writeUInt16LE(msg, 14);
    cab.writeUInt32LE(corpo.length, 16);
    return new Promise((ok, falha) => {
      const t = setTimeout(() => falha(new Error('sem resposta da câmera')), ms);
      this.esperando.push({ ok: (r) => { clearTimeout(t); ok(r); }, falha: (e) => { clearTimeout(t); falha(e); } });
      this.sock.write(Buffer.concat([cab, corpo]));
    });
  }

  get idSessao() {
    return `0x${this.sessao.toString(16).padStart(8, '0').toUpperCase()}`;
  }

  async entrar() {
    await this.conectar();
    const { sessao, json } = await this.enviar(MSG.LOGIN, {
      EncryptType: 'MD5', LoginType: 'DVRIP-Web', PassWord: hashSofia(this.senha), UserName: this.usuario,
    });
    if (json.Ret !== 100) throw new Error(json.Ret === 203 ? 'usuário ou senha incorretos' : `login recusado (${json.Ret})`);
    this.sessao = sessao || parseInt(json.SessionID, 16) || 0;
    this.info = json;
    return json;
  }

  async ler(nome) {
    const { json } = await this.enviar(MSG.CONFIG_GET, { Name: nome, SessionID: this.idSessao });
    return json;
  }

  async gravar(nome, valor) {
    const { json } = await this.enviar(MSG.CONFIG_SET, { Name: nome, [nome]: valor, SessionID: this.idSessao });
    if (json.Ret !== 100) throw new Error(`a câmera recusou ${nome} (${json.Ret})`);
    return json;
  }

  async habilidade(nome) {
    const { json } = await this.enviar(MSG.ABILITY_GET, { Name: nome, SessionID: this.idSessao });
    return json;
  }

  /** Comando de PTZ. comando: DirectionUp/Down/Left/Right, ZoomTile (aproximar), ZoomWide (afastar). parar=true solta. */
  async ptz(comando, { canal = 0, velocidade = 5, parar = false, preset = null, tour = 0 } = {}) {
    const { json } = await this.enviar(MSG.PTZ, {
      Name: 'OPPTZControl',
      OPPTZControl: {
        Command: comando,
        Parameter: {
          AUX: { Number: 0, Status: 'On' }, Channel: canal, MenuOpts: 'Enter',
          POINT: { bottom: 0, left: 0, right: 0, top: 0 }, Pattern: 'SetBegin',
          Preset: preset ?? (parar ? -1 : 65535), Step: parar ? 0 : velocidade, Tour: tour,
        },
      },
      SessionID: this.idSessao,
    });
    return json;
  }

  fechar() {
    if (this.sock) this.sock.destroy();
  }
}

module.exports = { Dvrip, hashSofia };
