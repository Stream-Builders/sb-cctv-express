// Vistas salvas (o tamanho do mosaico e a câmera de cada posição, com nome) e a ronda automática entre telas.
// Ficam em vistas.json na pasta de dados: são a arrumação desta tela, deste computador.
const { app } = require('electron');
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const LAYOUTS = [1, 4, 9, 16, 25, 36];
const POSICOES = 36;
const MODOS = ['vistas', 'paginas', 'cameras'];
const PADRAO = { vistas: [], ronda: { modo: 'vistas', segundos: 15, aoAbrir: false } };

const arquivo = () => join(app.getPath('userData'), 'vistas.json');

function limpar(d) {
  const vistas = (Array.isArray(d?.vistas) ? d.vistas : []).slice(0, 60).map((v, i) => ({
    id: String(v?.id || '').slice(0, 40) || `v${Date.now().toString(36)}${i}`,
    nome: String(v?.nome || '').trim().slice(0, 60),
    mosaico: LAYOUTS.includes(Number(v?.mosaico)) ? Number(v.mosaico) : 4,
    ordem: Array.from({ length: POSICOES }, (_, k) => (typeof v?.ordem?.[k] === 'string' && v.ordem[k] ? v.ordem[k].slice(0, 120) : null)),
  }));
  const r = d?.ronda || {};
  const ronda = {
    modo: MODOS.includes(r.modo) ? r.modo : PADRAO.ronda.modo,
    segundos: Math.min(600, Math.max(3, Math.round(Number(r.segundos)) || PADRAO.ronda.segundos)),
    aoAbrir: r.aoAbrir === true,
  };
  return { vistas, ronda };
}

function ler() {
  if (!existsSync(arquivo())) return limpar(PADRAO);
  try {
    return limpar(JSON.parse(readFileSync(arquivo(), 'utf8')));
  } catch {
    return limpar(PADRAO);
  }
}

function salvar(dados) {
  const limpo = limpar(dados);
  writeFileSync(arquivo(), JSON.stringify(limpo, null, 2));
  return limpo;
}

module.exports = { ler, salvar };
