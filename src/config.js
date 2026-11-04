// Configurações gerais do app (config.json na pasta de dados), com padrões que funcionam sem mexer em nada.
const { app } = require('electron');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const PADRAO = {
  // pasta dedicada na raiz do C:, uma subpasta por câmera
  pastaGravacoes: 'C:\\cctv_express\\records',
  // duração de cada arquivo de gravação, em minutos
  minutosPorBloco: 120,
  // apaga o que for mais antigo que isso
  diasRetencao: 30,
  // se o disco ficar com menos que isso livre, apaga primeiro o mais antigo
  espacoMinimoGB: 10,
  // detecção de movimento: ligada, sensibilidade de 1 a 10 e aviso do Windows a cada movimento novo
  deteccao: true,
  sensibilidade: 5,
  notificar: true,
};

const arquivo = () => join(app.getPath('userData'), 'config.json');

function ler() {
  if (!existsSync(arquivo())) return { ...PADRAO };
  try {
    return { ...PADRAO, ...JSON.parse(readFileSync(arquivo(), 'utf8')) };
  } catch {
    return { ...PADRAO };
  }
}

function salvar(dados) {
  const atual = ler();
  const limpo = {
    pastaGravacoes: String(dados.pastaGravacoes ?? atual.pastaGravacoes).trim() || PADRAO.pastaGravacoes,
    minutosPorBloco: Math.min(1440, Math.max(1, Number(dados.minutosPorBloco ?? atual.minutosPorBloco) || PADRAO.minutosPorBloco)),
    diasRetencao: Math.min(3650, Math.max(1, Number(dados.diasRetencao ?? atual.diasRetencao) || PADRAO.diasRetencao)),
    espacoMinimoGB: Math.min(10000, Math.max(1, Number(dados.espacoMinimoGB ?? atual.espacoMinimoGB) || PADRAO.espacoMinimoGB)),
    deteccao: dados.deteccao === undefined ? atual.deteccao : dados.deteccao === true || dados.deteccao === 'on',
    sensibilidade: Math.min(10, Math.max(1, Number(dados.sensibilidade ?? atual.sensibilidade) || PADRAO.sensibilidade)),
    notificar: dados.notificar === undefined ? atual.notificar : dados.notificar === true || dados.notificar === 'on',
  };
  writeFileSync(arquivo(), JSON.stringify(limpo, null, 2));
  return limpo;
}

module.exports = { ler, salvar, PADRAO };
