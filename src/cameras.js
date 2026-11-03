// As câmeras do usuário, guardadas em cameras.json na pasta de dados do app. A senha nunca fica em texto: vai cifrada
// pelo Windows (safeStorage, DPAPI da conta do usuário) e só é aberta na memória para passar ao go2rtc.
const { app, safeStorage } = require('electron');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

const arquivo = () => join(app.getPath('userData'), 'cameras.json');

function ler() {
  if (!existsSync(arquivo())) return [];
  try {
    return JSON.parse(readFileSync(arquivo(), 'utf8'));
  } catch {
    return [];
  }
}

function gravar(lista) {
  writeFileSync(arquivo(), JSON.stringify(lista, null, 2));
}

function cifrar(senha) {
  if (!senha) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('O Windows não liberou a cifragem de senhas para este usuário.');
  return safeStorage.encryptString(senha).toString('base64');
}

function abrir(senhaCifrada) {
  if (!senhaCifrada) return '';
  return safeStorage.decryptString(Buffer.from(senhaCifrada, 'base64'));
}

/** Lista para a tela: sem a senha. */
function listar() {
  return ler().map(({ senhaCifrada, ...c }) => ({ ...c, temSenha: !!senhaCifrada }));
}

function salvar(dados) {
  const lista = ler();
  const i = dados.id ? lista.findIndex((c) => c.id === dados.id) : -1;
  const atual = i >= 0 ? lista[i] : { id: randomUUID() };
  const camera = {
    ...atual,
    nome: String(dados.nome || '').trim() || `${dados.ip}`,
    tipo: ['xiongmai', 'onvif', 'rtsp'].includes(dados.tipo) ? dados.tipo : 'rtsp',
    ip: String(dados.ip || '').trim(),
    porta: Number(dados.porta) || null,
    canal: Number(dados.canal) || 1,
    usuario: String(dados.usuario || '').trim(),
    url: String(dados.url || '').trim(),
  };
  // senha em branco na edição = manter a que já existe
  if (dados.senha) camera.senhaCifrada = cifrar(dados.senha);
  if (i >= 0) lista[i] = camera;
  else lista.push(camera);
  gravar(lista);
  return camera.id;
}

function remover(id) {
  gravar(ler().filter((c) => c.id !== id));
}

module.exports = { ler, listar, salvar, remover, abrir };
