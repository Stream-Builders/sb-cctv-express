// Detecta câmeras na rede local de dois jeitos, ao mesmo tempo:
// 1. ONVIF WS-Discovery: pergunta por multicast (239.255.255.250:3702) e as câmeras ONVIF respondem sozinhas.
// 2. Varredura das portas típicas de câmera (34567 Xiongmai/XMEye/iCSee, 554/8554/10554 RTSP, 80/8899 ONVIF, 37777 Dahua
//    e Intelbras, 8000 Hikvision) em cada sub-rede /24 das placas
//    de rede deste computador. Só abre e fecha a conexão TCP: não envia senha nem dado nenhum.
const os = require('node:os');
const net = require('node:net');
const dgram = require('node:dgram');
const { randomUUID } = require('node:crypto');

const PORTAS = [34567, 554, 8554, 10554, 80, 8899, 37777, 8000];

function subredes() {
  const r = new Set();
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (i.address.startsWith('169.254.')) continue; // sem DHCP: não é rede de verdade
      r.add(i.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...r];
}

function portaAberta(ip, porta, ms = 500) {
  return new Promise((ok) => {
    const s = net.connect({ host: ip, port: porta });
    const fim = (v) => { s.destroy(); ok(v); };
    s.setTimeout(ms, () => fim(false));
    s.once('connect', () => fim(true));
    s.once('error', () => fim(false));
  });
}

async function varrer() {
  const alvos = [];
  for (const base of subredes()) for (let h = 1; h < 255; h++) for (const p of PORTAS) alvos.push([`${base}.${h}`, p]);
  const achados = new Map();
  let i = 0;
  const trabalhador = async () => {
    while (i < alvos.length) {
      const [ip, p] = alvos[i++];
      if (await portaAberta(ip, p)) {
        if (!achados.has(ip)) achados.set(ip, new Set());
        achados.get(ip).add(p);
      }
    }
  };
  await Promise.all(Array.from({ length: 256 }, trabalhador));
  return achados;
}

function onvif(ms = 3000) {
  return new Promise((ok) => {
    const achados = new Map();
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const sonda = `<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:${randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>`;
    s.on('message', (msg, rinfo) => {
      const texto = msg.toString();
      const porta = texto.match(/XAddrs>\s*https?:\/\/[^/:\s]+:(\d+)/)?.[1];
      achados.set(rinfo.address, Number(porta) || 80);
    });
    s.on('error', () => { try { s.close(); } catch { /* já fechado */ } ok(achados); });
    s.bind(() => {
      // a sonda sai por cada placa de rede (no Windows o multicast só sai pela placa padrão) e duas vezes (UDP perde)
      const enderecos = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')).map((i) => i.address);
      const enviar = () => {
        for (const ip of enderecos.length ? enderecos : [null]) {
          try { if (ip) s.setMulticastInterface(ip); s.send(sonda, 3702, '239.255.255.250'); } catch { /* placa sem multicast */ }
        }
      };
      enviar();
      setTimeout(enviar, 600);
      setTimeout(() => { try { s.close(); } catch { /* já fechado */ } ok(achados); }, ms);
    });
  });
}

/** Lista de aparelhos achados, com o tipo sugerido para o cadastro. */
async function detectar() {
  const [portas, viaOnvif] = await Promise.all([varrer(), onvif()]);
  const ips = new Set([...portas.keys(), ...viaOnvif.keys()]);
  const r = [];
  for (const ip of ips) {
    const p = portas.get(ip) || new Set();
    let tipo = 'rtsp';
    let porta = p.has(554) ? 554 : p.has(8554) ? 8554 : p.has(10554) ? 10554 : null;
    if (p.has(34567)) { tipo = 'xiongmai'; porta = 34567; }
    else if (viaOnvif.has(ip)) { tipo = 'onvif'; porta = viaOnvif.get(ip); }
    // ONVIF que não respondeu ao multicast (Wi-Fi que filtra multicast): a porta 8899 é a ONVIF das Xiongmai/iCSee
    else if (p.has(8899)) { tipo = 'onvif'; porta = 8899; }
    // Dahua/Intelbras (37777) e Hikvision (8000) com RTSP: a sonda RTSP acha o caminho ao salvar
    const marca = p.has(34567) ? 'xiongmai' : p.has(37777) ? 'dahua' : p.has(8000) && porta ? 'hikvision' : null;
    // só porta 80 aberta e sem resposta ONVIF: é roteador, impressora etc., não câmera
    if (tipo === 'rtsp' && !porta) continue;
    r.push({ ip, tipo, porta, marca, portas: [...p].sort((a, b) => a - b), onvif: viaOnvif.has(ip) });
  }
  return r.sort((a, b) => a.ip.split('.').map(Number)[3] - b.ip.split('.').map(Number)[3]);
}

module.exports = { detectar };
