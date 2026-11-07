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

// modo da imagem por lente (Camera.Param[canal].DayNightColor). Não verificado em câmera: os códigos seguem o SDK da Xiongmai.
const MODOS_IMAGEM = { automatica: 0, colorida: 1, pretoBranco: 2 };
// as detecções da câmera que se liga e desliga (Enable no canal)
const DETECCOES = { pessoas: 'Detect.HumanDection', seguir: 'Detect.DetectTrack' };
const MSG_ALARME = 1506; // OPNetAlarm: aciona o alarme da câmera (sirene / aviso de voz)

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
    const ch = Math.max(0, (c.canal || 1) - 1);
    // os ajustes só aparecem se a câmera devolver a configuração (cada modelo tem um subconjunto)
    const ajustes = {};
    const param = await cliente.ler('Camera.Param').catch(() => null);
    const p = param?.Ret === 100 ? [].concat(param['Camera.Param'])[ch] : null;
    if (p && p.DayNightColor != null) {
      const v = parseInt(p.DayNightColor, 16);
      ajustes.imagem = Object.keys(MODOS_IMAGEM).find((k) => MODOS_IMAGEM[k] === v) || null;
    }
    for (const [chave, nome] of Object.entries(DETECCOES)) {
      const r = await cliente.ler(nome).catch(() => null);
      const item = r?.Ret === 100 ? [].concat(r[nome])[ch] ?? r[nome] : null;
      if (item && typeof item.Enable === 'boolean') ajustes[chave] = item.Enable;
    }
    if (luz?.Ret === 100 && luz['Camera.WhiteLight']?.MoveTrigLight) {
      ajustes.luzDuracao = luz['Camera.WhiteLight'].MoveTrigLight.Duration;
      ajustes.luzBrilho = luz['Camera.WhiteLight'].Brightness;
    }
    if (outras.SupportAlarmVoiceTips || outras.SupportPCSetDoubleLight) ajustes.sirene = false;
    return {
      canais,
      tipo: 'xiongmai', cliente, luz: luz?.Ret === 100 ? luz['Camera.WhiteLight'] : null,
      caps: {
        ptz: !!(outras.SupportPTZDirectionControl || outras.SupportPTZTour) && ptzNoCanal,
        ronda: !!outras.SupportPTZTour && ptzNoCanal,
        luz: modo ? Object.keys(MODOS_LUZ) : null,
        luzAtual: Object.keys(MODOS_LUZ).find((k) => MODOS_LUZ[k] === modo) || null,
        ajustes,
        // lente fixa de um aparelho com PTZ em outro canal: dá para mirar a PTZ clicando na imagem
        mirar: portas.length > 1 && !ptzNoCanal,
      },
    };
  }
  if (c.tipo === 'onvif') {
    const cliente = new Onvif({ ip: c.ip, porta: c.porta || 80, usuario: c.usuario || 'admin', senha, canal: c.canal || 1 });
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

async function xiongmai(id) {
  const con = await conexao(id);
  if (con.tipo !== 'xiongmai') throw new Error('recurso só das câmeras Xiongmai');
  return con;
}

/** Muda um ajuste da câmera: imagem, pessoas, seguir, luzDuracao, luzBrilho ou sirene. */
async function ajustar(id, chave, valor) {
  const con = await xiongmai(id);
  const ch = Math.max(0, (camera(id).canal || 1) - 1);
  const cl = con.cliente;
  if (chave === 'imagem') {
    if (!(valor in MODOS_IMAGEM)) throw new Error('modo inválido');
    const r = await cl.ler('Camera.Param');
    const lista = [].concat(r['Camera.Param']);
    lista[ch] = { ...lista[ch], DayNightColor: `0x${MODOS_IMAGEM[valor].toString(16).padStart(8, '0').toUpperCase()}` };
    await cl.gravar(`Camera.Param.[${ch}]`, lista[ch]);
  } else if (chave in DETECCOES) {
    const nome = DETECCOES[chave];
    const r = await cl.ler(nome);
    const atual = r[nome];
    if (Array.isArray(atual)) await cl.gravar(`${nome}.[${ch}]`, { ...atual[ch], Enable: !!valor });
    else await cl.gravar(nome, { ...atual, Enable: !!valor });
  } else if (chave === 'luzDuracao' || chave === 'luzBrilho') {
    const n = Math.round(Number(valor));
    const novo = chave === 'luzBrilho'
      ? { ...con.luz, Brightness: Math.min(100, Math.max(1, n)) }
      : { ...con.luz, MoveTrigLight: { ...con.luz.MoveTrigLight, Duration: Math.min(600, Math.max(5, n)) } };
    await cl.gravar('Camera.WhiteLight', novo);
    con.luz = novo;
  } else if (chave === 'sirene') {
    // liga ou desliga o alarme da câmera; ligado, desliga sozinho depois de 30 s
    const { json } = await cl.enviar(MSG_ALARME, { Name: 'OPNetAlarm', OPNetAlarm: { Event: 0, State: !!valor }, SessionID: cl.idSessao });
    if (json.Ret !== 100) throw new Error(`a câmera recusou o alarme (${json.Ret})`);
    clearTimeout(con.sireneTimer);
    if (valor) con.sireneTimer = setTimeout(() => ajustar(id, 'sirene', false).catch(() => {}), 30000);
  } else {
    throw new Error('ajuste desconhecido');
  }
  con.caps.ajustes[chave] = valor;
  return valor;
}

/** Posições salvas da PTZ (1 a 8): ir, salvar ou apagar; e a ronda entre elas. */
async function posicao(id, acao, numero) {
  const con = await xiongmai(id);
  const canal = Math.max(0, (camera(id).canal || 1) - 1);
  const cmd = { ir: 'GotoPreset', salvar: 'SetPreset', apagar: 'ClearPreset', rondaIniciar: 'StartTour', rondaParar: 'StopTour' }[acao];
  if (!cmd) throw new Error('ação inválida');
  const n = Math.min(8, Math.max(1, Number(numero) || 1));
  await con.cliente.ptz(cmd, { canal, preset: n, tour: 0 });
}

/**
 * Mirar: um clique na lente fixa (x, y de 0 a 1) gira a lente PTZ do mesmo aparelho naquela direção, por um tempo
 * proporcional à distância do centro. Aproximado: a câmera não informa a calibração entre as lentes.
 */
async function mirar(id, x, y) {
  const fixa = camera(id);
  const alvo = cameras.ler().find((c) => c.ip === fixa.ip && c.tipo === fixa.tipo && c.id !== id);
  if (!alvo) throw new Error('sem lente PTZ neste aparelho');
  const dx = x - 0.5, dy = y - 0.5;
  const passos = [];
  if (Math.abs(dx) > 0.05) passos.push([dx > 0 ? 'direita' : 'esquerda', Math.abs(dx)]);
  if (Math.abs(dy) > 0.05) passos.push([dy > 0 ? 'baixo' : 'cima', Math.abs(dy)]);
  for (const [dir, d] of passos) {
    await ptz(alvo.id, dir, false);
    await new Promise((ok) => setTimeout(ok, Math.round(d * 2400)));
    await ptz(alvo.id, dir, true);
  }
}

/** Os nomes dos canais (lentes) de uma câmera Xiongmai; uma lente só = lista de um. */
async function canais(id) {
  return (await conexao(id)).canais || [];
}

function fecharTodas() {
  for (const p of conexoes.values()) p.then((c) => c.cliente?.fechar?.()).catch(() => {});
  conexoes.clear();
}

module.exports = { capacidades, ptz, luz, canais, ajustar, posicao, mirar, fecharTodas, MODOS_LUZ, MODOS_IMAGEM };
