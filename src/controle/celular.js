// O celular com o CCTV Express Câmera (app Android): o canal de controle dele, na porta 8555 da rede local, com o
// mesmo usuário e senha do vídeo. Por ele o computador lê o estado e acende ou apaga a luz (a lanterna) do celular.
const PORTA = 8555;

class Celular {
  constructor({ ip, usuario, senha }) {
    this.base = `http://${ip}:${PORTA}`;
    this.auth = `Basic ${Buffer.from(`${usuario}:${senha || ''}`).toString('base64')}`;
    this.luz = false;
  }

  async pedir(metodo, caminho) {
    const r = await fetch(`${this.base}${caminho}`, { method: metodo, headers: { Authorization: this.auth }, signal: AbortSignal.timeout(2500) });
    if (r.status === 401) throw new Error('usuário ou senha incorretos');
    if (!r.ok) throw new Error(`celular ${r.status}`);
    return r.json();
  }

  /** Só devolve o cliente se do outro lado estiver mesmo o CCTV Express Câmera. */
  static async abrir(dados) {
    const c = new Celular(dados);
    const e = await c.pedir('GET', '/estado');
    if (e.app !== 'cctv-express-camera') throw new Error('não é o CCTV Express Câmera');
    c.luz = !!e.luz;
    return c;
  }

  async definirLuz(acesa) {
    const r = await this.pedir('POST', `/luz?acesa=${acesa ? 1 : 0}`);
    this.luz = !!r.luz;
    return this.luz;
  }
}

module.exports = { Celular };
