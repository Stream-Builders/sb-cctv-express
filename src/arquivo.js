// O arquivo de configuração rápida (.cctvx): leva as câmeras (e as configurações) do computador para o celular e do
// celular para o computador. O mesmo formato do app do celular (movel/.../Arquivo.kt):
//   aberto:  {"formato":"cctv-express","versao":1,"cifrado":false,"cameras":[...],"config":{...}}   (sem as senhas)
//   cifrado: {"formato":"cctv-express","versao":1,"cifrado":true,"kdf":"pbkdf2-sha256","voltas":210000,
//             "sal":"<b64>","iv":"<b64>","dados":"<b64 do texto cifrado + etiqueta GCM>"}       (com as senhas)
const { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const cameras = require('./cameras');
const config = require('./config');

const FORMATO = 'cctv-express';
const VOLTAS = 210000;

class SenhaErrada extends Error {}
class Invalido extends Error {}

const chave = (senha, sal, voltas) => pbkdf2Sync(Buffer.from(senha, 'utf8'), sal, voltas, 32, 'sha256');

/** As câmeras no formato de troca; a senha de cada uma só vai quando o arquivo é cifrado. */
function camerasParaExportar(comSenha) {
  return cameras.ler().map((c) => ({
    nome: c.nome, tipo: c.tipo, ip: c.ip, porta: c.porta ?? null, canal: c.canal || 1, usuario: c.usuario || '',
    url: c.url || '', gravar: c.gravar !== false,
    ...(comSenha ? { senha: c.senhaCifrada ? cameras.abrir(c.senhaCifrada) : '' } : {}),
  }));
}

function montar(senha) {
  // a pasta das gravações é deste computador: não viaja
  const { pastaGravacoes, ...cfg } = config.ler();
  const conteudo = { origem: 'pc', criado: new Date().toISOString(), cameras: camerasParaExportar(!!senha), config: cfg };
  if (!senha) return JSON.stringify({ formato: FORMATO, versao: 1, cifrado: false, ...conteudo }, null, 2);
  const sal = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(senha, sal, VOLTAS), iv);
  const dados = Buffer.concat([c.update(JSON.stringify(conteudo), 'utf8'), c.final(), c.getAuthTag()]);
  return JSON.stringify({ formato: FORMATO, versao: 1, cifrado: true, kdf: 'pbkdf2-sha256', voltas: VOLTAS,
    sal: sal.toString('base64'), iv: iv.toString('base64'), dados: dados.toString('base64') }, null, 2);
}

function cifrado(texto) {
  try { return JSON.parse(texto).cifrado === true; } catch { return false; }
}

function ler(texto, senha) {
  let j;
  try { j = JSON.parse(texto); } catch { throw new Invalido(); }
  if (j?.formato !== FORMATO) throw new Invalido();
  if (!j.cifrado) return j;
  let bruto;
  try {
    bruto = Buffer.from(j.dados, 'base64');
    const d = createDecipheriv('aes-256-gcm', chave(senha || '', Buffer.from(j.sal, 'base64'), Number(j.voltas) || VOLTAS), Buffer.from(j.iv, 'base64'));
    d.setAuthTag(bruto.subarray(bruto.length - 16));
    return JSON.parse(Buffer.concat([d.update(bruto.subarray(0, bruto.length - 16)), d.final()]).toString('utf8'));
  } catch (e) {
    if (bruto && /auth|unable to authenticate/i.test(e.message)) throw new SenhaErrada();
    throw new Invalido();
  }
}

/**
 * Acrescenta as câmeras do arquivo (a que já existe, com o mesmo tipo, IP, canal e endereço, não é duplicada) e, se o
 * arquivo veio de um computador, as configurações (menos a pasta das gravações). Devolve quantas câmeras entraram.
 */
function importar(conteudo) {
  const atuais = cameras.ler();
  const chaveDe = (c) => `${c.tipo}|${c.ip}|${c.canal || 1}|${c.url || ''}`;
  const existentes = new Set(atuais.map(chaveDe));
  let novas = 0;
  for (const e of Array.isArray(conteudo.cameras) ? conteudo.cameras : []) {
    if (!['xiongmai', 'onvif', 'rtsp'].includes(e?.tipo)) continue;
    // a câmera vinda do celular pode ter só o endereço resolvido (ONVIF ou sonda): ele vira o endereço RTSP aqui
    const url = e.url || (e.tipo === 'rtsp' ? e.video || '' : '');
    const k = chaveDe({ ...e, url });
    if (existentes.has(k)) continue;
    existentes.add(k);
    cameras.salvar({ nome: e.nome, tipo: e.tipo, ip: e.ip, porta: e.porta, canal: e.canal, usuario: e.usuario, url,
      senha: e.senha || '', gravar: e.gravar === undefined ? true : e.gravar === true });
    novas++;
  }
  if (conteudo.config && typeof conteudo.config === 'object') {
    const { pastaGravacoes, ...cfg } = conteudo.config;
    config.salvar(cfg);
  }
  return novas;
}

module.exports = { montar, ler, cifrado, importar, SenhaErrada, Invalido };
