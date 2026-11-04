// Controle das câmeras (PTZ e luz), independente da marca. Xiongmai fala o protocolo próprio (DVRIP); as demais, ONVIF.
// A conexão de cada câmera fica aberta e é refeita sozinha se cair.
const cameras = require('../cameras');
const { Dvrip } = require('./dvrip');
const { Onvif } = require('./onvif');

// os modos de luz da Xiongmai (Camera.WhiteLight.WorkMode), na ordem em que aparecem na tela
const MODOS_LUZ = { inteligente: 'Intelligent', colorida: 'Auto', infravermelho: 'Close', acesa: 'KeepOpen' };
const DIRECOES = {
  cima: { dvrip: 'DirectionUp', x: 0, y: 0.5 }, baixo: { dvrip: 'DirectionDown', x: 0, y: -0.5 },
  esquerda: { dvrip: 'DirectionLeft', x: -0.5, y: 0 }, direita: { dvrip: 'DirectionRight', x: 0.5, y: 0 },
  aproximar: { dvrip: 'ZoomTile', z: 0.5 }, afastar: { dvrip: 'ZoomWide', z: -0.5 },
};

const conexoes = new Map(); // id -> Promise<{ tipo, cliente, caps }>

function camera(id) {
  const c = cameras.ler().find((x) => x.id === id);
  if (!c) throw new Error('câmera não encontrada');
  return c;
}

async function abrir(c) {
  const senha = cameras.abrir(c.senhaCifrada);
  if (c.tipo === 'xiongmai') {
    const cliente = new Dvrip({ ip: c.ip, porta: c.porta || 34567, usuario: c.usuario || 'admin', senha });
    await cliente.entrar();
    cliente.sock.on('close', () => conexoes.delete(c.id));
    const luz = await cliente.ler('Camera.WhiteLight').catch(() => null);
    const funcoes = await cliente.habilidade('SystemFunction').catch(() => null);
    const outras = funcoes?.SystemFunction?.OtherFunction || {};
    const modo = luz?.Ret === 100 ? luz['Camera.WhiteLight']?.WorkMode : null;
    // câmera de duas lentes (fixa + PTZ): cada canal tem a sua porta PTZ; a lente fixa vem com o protocolo "None"
    const titulos = await cliente.ler('ChannelTitle').catch(() => null);
    const canais = Array.isArray(titulos?.ChannelTitle) ? titulos.ChannelTitle : [];
    const uart = await cliente.ler('Uart.PTZ').catch(() => null);
    const portas = Array.isArray(uart?.['Uart.PTZ']) ? uart['Uart.PTZ'] : [];
    const porta = portas[Math.max(0, (c.canal || 1) - 1)];
    const ptzNoCanal = portas.length < 2 || !porta || porta.ProtocolName !== 'None';
    return {
      canais,
      tipo: 'xiongmai', cliente, luz: luz?.Ret === 100 ? luz['Camera.WhiteLight'] : null,
      caps: {
        ptz: !!(outras.SupportPTZDirectionControl || outras.SupportPTZTour) && ptzNoCanal,
        luz: modo ? Object.keys(MODOS_LUZ) : null,
        luzAtual: Object.keys(MODOS_LUZ).find((k) => MODOS_LUZ[k] === modo) || null,
      },
    };
  }
  if (c.tipo === 'onvif') {
    const cliente = new Onvif({ ip: c.ip, porta: c.porta || 80, usuario: c.usuario || 'admin', senha });
    const { ptz } = await cliente.preparar();
    return { tipo: 'onvif', cliente, caps: { ptz, luz: null, luzAtual: null } };
  }
  return { tipo: 'rtsp', cliente: null, caps: { ptz: false, luz: null, luzAtual: null } };
}

function conexao(id) {
  if (!conexoes.has(id)) {
    const p = abrir(camera(id)).catch((e) => { conexoes.delete(id); throw e; });
    conexoes.set(id, p);
  }
  return conexoes.get(id);
}

async function capacidades(id) {
  try {
    return (await conexao(id)).caps;
  } catch (e) {
    return { ptz: false, luz: null, luzAtual: null, erro: e.message };
  }
}

/** Começa (parar=false) ou solta (parar=true) um movimento. A tela manda começar ao apertar e soltar ao largar. */
async function ptz(id, direcao, parar) {
  const d = DIRECOES[direcao];
  if (!d) throw new Error('direção inválida');
  const con = await conexao(id);
  if (con.tipo === 'xiongmai') {
    const canal = Math.max(0, (camera(id).canal || 1) - 1);
    await con.cliente.ptz(d.dvrip, { canal, parar });
  } else if (con.tipo === 'onvif') {
    await (parar ? con.cliente.parar() : con.cliente.mover(d.x || 0, d.y || 0, d.z || 0));
  } else {
    throw new Error('esta câmera não tem PTZ');
  }
}

async function luz(id, modo) {
  const con = await conexao(id);
  if (con.tipo !== 'xiongmai' || !con.luz || !MODOS_LUZ[modo]) throw new Error('esta câmera não tem controle de luz');
  const novo = { ...con.luz, WorkMode: MODOS_LUZ[modo] };
  await con.cliente.gravar('Camera.WhiteLight', novo);
  con.luz = novo;
  con.caps.luzAtual = modo;
  return modo;
}

/** Os nomes dos canais (lentes) de uma câmera Xiongmai; uma lente só = lista de um. */
async function canais(id) {
  return (await conexao(id)).canais || [];
}

function fecharTodas() {
  for (const p of conexoes.values()) p.then((c) => c.cliente?.fechar?.()).catch(() => {});
  conexoes.clear();
}

module.exports = { capacidades, ptz, luz, canais, fecharTodas, MODOS_LUZ };
