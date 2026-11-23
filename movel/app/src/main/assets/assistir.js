// Assistir câmeras: a lógica da tela. O app (Kotlin) é a ponte "Assistir": guarda as câmeras, fala com elas (ONVIF,
// sonda RTSP, busca na rede) e toca o vídeo; esta tela desenha o mosaico e manda onde fica cada quadro.
import { carregar, maisProximo, t, traduzirPagina } from './i18n/i18n.js';
import { textosDoCelular } from './textos.js';
import { gestos, guardar, minimapa, normalizar, proximoNivel, zoomDe } from './zoom.js';

const $ = (id) => document.getElementById(id);
const idioma = maisProximo(navigator.language);
await carregar(idioma).catch(() => {});
const C = textosDoCelular(idioma);
traduzirPagina();

const ICONES = {
  adicionar: '<path d="M12 5v14M5 12h14"/>',
  detectar: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  arquivo: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  inicio: '<path d="M3 11l9-7 9 7M5 10v10h14V10"/>',
  voltar: '<path d="M15 6l-6 6 6 6"/>',
  avancar: '<path d="M9 6l6 6-6 6"/>',
  som: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  mudo: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  remover: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  cancelar: '<path d="M6 6l12 12M18 6L6 18"/>',
  salvar: '<path d="M5 12l5 5L20 7"/>',
  olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  exportar: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  importar: '<path d="M12 15V4M7 9l5-5 5 5M5 20h14"/>',
  procurar: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  cheia: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  zoomMais: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  zoomMenos: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  lupa: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
};

function botao(icone, rotulo, { ativo = false, classes = '', soIcone = false } = {}, aoClicar) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `sb-btn ${ativo ? 'sb-btn--ativo' : ''} ${soIcone ? 'sb-btn--square' : ''} ${classes}`;
  b.innerHTML = `<span class="sb-btn__ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icone}</svg></span>${soIcone ? '' : '<span class="sb-btn__body"><span class="sb-btn__label"></span></span>'}<span class="sb-btn__gloss" aria-hidden="true"></span>`;
  if (!soIcone) b.querySelector('.sb-btn__label').textContent = rotulo;
  b.title = rotulo;
  b.setAttribute('aria-label', rotulo);
  b.addEventListener('click', aoClicar);
  return b;
}

const ROTULO = () => ({ vivo: t('estado.vivo'), conectando: t('estado.conectando'), semSinal: t('estado.semSinal') });
let cameras = [];
const estados = new Map();
let cheia = null; // id da câmera em tela cheia
const som = new Set(); // câmeras com som ligado (só na tela cheia)
const proporcoes = new Map(); // largura / altura do vídeo de cada câmera (o app avisa)
let zoomAtual = null; // o zoom da câmera em tela cheia, durante os gestos: { id, z, x, y, desenhar }
const nivelTexto = (z) => `${Number.isInteger(z) ? z : z.toFixed(1).replace(/\.0$/, '')}×`;
let pagina = 0;
const POR_PAGINA = 9;

// ---------- topo ----------
$('acoes').append(
  botao(ICONES.adicionar, t('lateral.adicionar'), {}, () => abrirFormulario(null)),
  botao(ICONES.detectar, t('lateral.detectar'), {}, abrirDetectar),
  botao(ICONES.lista, t('lateral.cameras'), {}, abrirLista),
  botao(ICONES.arquivo, t('arquivo.titulo'), {}, abrirArquivo),
  botao(ICONES.inicio, C.inicio, {}, () => Assistir.inicio()),
);
$('vazio-texto').textContent = t('mosaico.vazio');
$('vazio-acoes').append(
  botao(ICONES.adicionar, t('lateral.adicionar'), { ativo: true }, () => abrirFormulario(null)),
  botao(ICONES.detectar, t('lateral.detectar'), {}, abrirDetectar),
  botao(ICONES.importar, t('arquivo.importar'), {}, () => { abrirArquivo(); }),
);

function desenharResumo() {
  const vivos = cameras.filter((c) => estados.get(c.id) === 'vivo').length;
  const sem = cameras.filter((c) => estados.get(c.id) === 'semSinal').length;
  const partes = [cameras.length === 1 ? t('mosaico.um') : t('mosaico.titulo', { n: cameras.length })];
  if (cameras.length) partes.push(t('resumo.vivos', { n: vivos }));
  if (sem) partes.push(t('resumo.semSinal', { n: sem }));
  $('resumo').textContent = partes.join(' · ');
}

// ---------- mosaico ----------
/** colunas e linhas que deixam o vídeo 16:9 maior, para n quadros na área w x h */
function grade(n, w, h) {
  let melhor = { c: 1, r: n, area: 0 };
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const tw = w / c, th = h / r;
    const vw = Math.min(tw, th * 16 / 9);
    const area = vw * (vw * 9 / 16);
    if (area > melhor.area + 1) melhor = { c, r, area };
  }
  return melhor;
}

function selo(estado) {
  const s = document.createElement('span');
  s.className = `selo selo--${estado}`;
  s.textContent = ROTULO()[estado];
  return s;
}

function desenharMosaico() {
  zoomAtual = null;
  const area = $('mosaico');
  area.replaceChildren();
  area.classList.toggle('cheia', !!cheia);
  $('vazio').hidden = cameras.length > 0;
  const paginas = Math.max(1, Math.ceil(cameras.length / POR_PAGINA));
  pagina = Math.min(pagina, paginas - 1);
  const visiveis = cheia ? cameras.filter((c) => c.id === cheia) : cameras.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const W = area.clientWidth, H = area.clientHeight;
  const { c: cols, r: linhas } = grade(Math.max(1, visiveis.length), W, H);
  const tw = Math.floor(W / cols), th = Math.floor(H / linhas);
  visiveis.forEach((cam, i) => {
    const q = document.createElement('div');
    q.className = 'quadro';
    q.dataset.id = cam.id;
    Object.assign(q.style, { left: `${(i % cols) * tw}px`, top: `${Math.floor(i / cols) * th}px`, width: `${tw}px`, height: `${th}px` });
    const topo = document.createElement('div');
    topo.className = 'quadro__topo';
    const nome = document.createElement('span');
    nome.className = 'quadro__nome';
    nome.textContent = cam.nome;
    const s = selo(estados.get(cam.id) || 'conectando');
    s.dataset.papel = 'estado';
    topo.append(s, nome);
    const zq = zoomDe(cam.id);
    if (!cheia && zq.z > 1.001) {
      const zs = document.createElement('span');
      zs.className = 'selo selo--zoom';
      zs.textContent = nivelTexto(zq.z);
      zs.title = t('zoom.digital');
      topo.append(zs);
    }
    q.append(topo);
    if (cheia) {
      const barra = document.createElement('div');
      barra.className = 'quadro__barra';
      const comSom = som.has(cam.id);
      barra.append(
        botao(comSom ? ICONES.som : ICONES.mudo, comSom ? t('quadro.mudo') : t('quadro.ligarSom'), { ativo: comSom, soIcone: true }, (e) => {
          e.stopPropagation();
          if (som.has(cam.id)) som.delete(cam.id); else som.add(cam.id);
          desenharMosaico();
        }),
        botao(ICONES.editar, t('lateral.editar'), {}, (e) => { e.stopPropagation(); abrirFormulario(cam); }),
        botao(ICONES.voltar, C.voltar, { ativo: true }, (e) => { e.stopPropagation(); sairDaTelaCheia(); }),
      );
      q.append(barra);
      controlesDeZoom(q, cam);
    } else {
      // um toque abre a câmera em tela cheia (vídeo principal, com som se a pessoa ligar)
      q.addEventListener('click', () => { cheia = cam.id; desenharMosaico(); });
    }
    area.append(q);
  });
  // páginas (mais de 9 câmeras): o celular não decodifica dezenas de vídeos ao mesmo tempo
  const pg = $('paginas');
  pg.hidden = !!cheia || paginas <= 1;
  if (!pg.hidden) {
    const txt = document.createElement('span');
    txt.textContent = `${pagina + 1} / ${paginas}`;
    pg.replaceChildren(
      botao(ICONES.voltar, C.voltar, { soIcone: true }, () => { pagina = (pagina - 1 + paginas) % paginas; desenharMosaico(); }),
      txt,
      botao(ICONES.avancar, '›', { soIcone: true }, () => { pagina = (pagina + 1) % paginas; desenharMosaico(); }),
    );
  }
  posicionar();
  desenharResumo();
}

// ---------- zoom digital (na tela cheia: botões, gestos e o mapa da posição; o mosaico mostra o zoom guardado) ----------
function controlesDeZoom(q, cam) {
  const id = cam.id;
  const estado = { id, ...zoomDe(id) };
  zoomAtual = estado;
  const proporcao = () => proporcoes.get(id) || 16 / 9;
  const obter = () => normalizar(estado);
  let quadroPedido = 0;
  // durante o gesto: aplica no app a cada quadro da tela (sem redesenhar o mosaico)
  const mudar = (z) => {
    Object.assign(estado, normalizar(z));
    if (quadroPedido) return;
    quadroPedido = requestAnimationFrame(() => {
      quadroPedido = 0;
      Assistir.zoom(id, estado.z, estado.x, estado.y);
      desenhar();
    });
  };
  const fim = (z) => { Object.assign(estado, guardar(id, z)); desenhar(); };
  const grupo = document.createElement('div');
  grupo.className = 'zoom';
  grupo.setAttribute('role', 'group');
  grupo.setAttribute('aria-label', t('zoom.digital'));
  const menos = botao(ICONES.zoomMenos, t('zoom.menos'), { soIcone: true }, (e) => { e.stopPropagation(); const n = normalizar({ ...estado, z: proximoNivel(estado.z, -1) }); mudar(n); fim(n); });
  const nivel = botao(ICONES.lupa, '1×', {}, (e) => { e.stopPropagation(); const n = { z: 1, x: 0.5, y: 0.5 }; mudar(n); fim(n); });
  nivel.classList.add('zoom__nivel');
  const mais = botao(ICONES.zoomMais, t('zoom.mais'), { soIcone: true }, (e) => { e.stopPropagation(); const n = normalizar({ ...estado, z: proximoNivel(estado.z, 1) }); mudar(n); fim(n); });
  grupo.append(menos, nivel, mais);
  const mapa = minimapa({ obter, mudar, fim, proporcao, rotulo: t('zoom.posicao') });
  function desenhar() {
    const z = obter();
    nivel.querySelector('.sb-btn__label').textContent = nivelTexto(z.z);
    nivel.title = z.z > 1.001 ? t('zoom.normal') : t('zoom.dica');
    nivel.setAttribute('aria-label', `${t('zoom.digital')}: ${nivelTexto(z.z)}. ${nivel.title}`);
    nivel.classList.toggle('sb-btn--ativo', z.z > 1.001);
    menos.disabled = z.z <= 1.001;
    mais.disabled = z.z >= 8;
    mapa.desenhar();
  }
  estado.desenhar = desenhar;
  q.querySelector('.quadro__barra').prepend(grupo);
  q.append(mapa.el);
  gestos(q, { obter, mudar, fim, proporcao });
  desenhar();
}

// chamado pelo app quando sabe o tamanho do vídeo de uma câmera (o mapa da posição e os gestos usam a proporção)
window.proporcaoCamera = (id, p) => {
  if (!(p > 0)) return;
  proporcoes.set(id, p);
  if (zoomAtual?.id === id) zoomAtual.desenhar?.();
};

/** manda ao app onde fica cada quadro, em pixels da tela, e qual vídeo tocar (o leve no mosaico, o principal na cheia) */
function posicionar() {
  const dpr = window.devicePixelRatio || 1;
  const pedidos = [...document.querySelectorAll('#mosaico .quadro')].map((q) => {
    const r = q.getBoundingClientRect();
    return { id: q.dataset.id, x: Math.round(r.left * dpr), y: Math.round(r.top * dpr), w: Math.round(r.width * dpr), h: Math.round(r.height * dpr),
      principal: !!cheia, som: !!cheia && som.has(q.dataset.id), zoom: zoomDe(q.dataset.id) };
  });
  Assistir.posicionar(JSON.stringify(pedidos));
}

function sairDaTelaCheia() {
  if (cheia) som.delete(cheia);
  cheia = null;
  desenharMosaico();
}

// chamado pelo app quando o vídeo de uma câmera muda de estado
window.estadoCamera = (id, estado) => {
  if (estados.get(id) === estado) return;
  estados.set(id, estado);
  const s = document.querySelector(`#mosaico .quadro[data-id="${CSS.escape(id)}"] [data-papel="estado"]`);
  if (s) { s.className = `selo selo--${estado}`; s.textContent = ROTULO()[estado]; }
  desenharResumo();
};

function recarregar() {
  cameras = JSON.parse(Assistir.listar());
  if (cheia && !cameras.some((c) => c.id === cheia)) cheia = null;
  desenharMosaico();
}
window.recarregar = recarregar;
let espera = 0;
window.addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(desenharMosaico, 120); });

// ---------- caixas (formulário, busca, lista, arquivo) ----------
const caixas = ['caixa-form', 'caixa-detectar', 'caixa-lista', 'caixa-arquivo'];
const abrirCaixa = (id) => { for (const c of caixas) $(c).hidden = c !== id; };
const fecharCaixa = (id) => { $(id).hidden = true; };

/** o botão voltar do Android: fecha a caixa aberta ou sai da tela cheia; sem nada aberto, o app volta ao início */
window.voltar = () => {
  const aberta = caixas.find((c) => !$(c).hidden);
  if (aberta) { fecharCaixa(aberta); return true; }
  if (cheia) { sairDaTelaCheia(); return true; }
  return false;
};

function olho(input) {
  const b = botao(ICONES.olho, t('form.verSenha'), { soIcone: true }, () => {
    const ver = input.type === 'password';
    input.type = ver ? 'text' : 'password';
    b.classList.toggle('sb-btn--ativo', ver);
  });
  return b;
}

// formulário: os mesmos campos do computador (sem a gravação, que é do computador)
const form = $('form');
$('campo-senha').append(olho(form.senha));
$('nota-xiongmai').textContent = C.xiongmaiNota;
function atualizarTipo() {
  const tipo = form.tipo.value;
  document.querySelector('.so-rtsp').hidden = tipo !== 'rtsp';
  $('nota-xiongmai').hidden = tipo !== 'xiongmai';
}
form.tipo.addEventListener('change', atualizarTipo);
const btnRemover = botao(ICONES.remover, t('form.remover'), { classes: 'sb-btn--danger' }, () => {
  Assistir.remover(form.id.value);
  fecharCaixa('caixa-form');
  if (cheia === form.id.value) cheia = null;
  recarregar();
});
const btnSalvar = botao(ICONES.salvar, t('form.salvar'), { ativo: true }, () => salvar());
const espacador = document.createElement('span');
espacador.className = 'espaco';
$('form-botoes').append(btnRemover, espacador, botao(ICONES.cancelar, t('form.cancelar'), {}, () => fecharCaixa('caixa-form')), btnSalvar);
form.addEventListener('submit', (e) => { e.preventDefault(); salvar(); });

function abrirFormulario(cam, sugestao) {
  form.reset();
  form.id.value = cam?.id || '';
  $('form-titulo').textContent = t(cam ? 'form.editar' : 'form.adicionar');
  const dados = cam || sugestao;
  if (dados) for (const k of ['nome', 'tipo', 'ip', 'porta', 'canal', 'usuario', 'url']) if (form[k] && dados[k] != null && dados[k] !== '') form[k].value = dados[k];
  form.senha.placeholder = cam?.temSenha ? t('form.senhaManter') : '';
  form.senha.type = 'password';
  btnRemover.hidden = !cam;
  $('form-aviso').textContent = '';
  $('form-aviso').className = 'aviso';
  btnSalvar.disabled = false;
  atualizarTipo();
  abrirCaixa('caixa-form');
}

function salvar() {
  const dados = Object.fromEntries(new FormData(form));
  if (!dados.ip.trim() && !(dados.tipo === 'rtsp' && dados.url.trim())) { $('form-aviso').textContent = C.erroIp; return; }
  $('form-aviso').className = 'aviso ok';
  $('form-aviso').textContent = C.salvando;
  btnSalvar.disabled = true;
  Assistir.salvar(JSON.stringify(dados));
}
// resposta do app depois de falar com a câmera
window.salvo = (r) => {
  btnSalvar.disabled = false;
  if (r.erro) {
    $('form-aviso').className = 'aviso';
    $('form-aviso').textContent = { senha: C.erroSenha, onvif: C.erroOnvif, ip: C.erroIp }[r.erro] || C.erroCaminho;
    return;
  }
  fecharCaixa('caixa-form');
  recarregar();
};

// busca na rede
const btnProcurar = botao(ICONES.procurar, t('detectar.procurarDeNovo'), {}, detectar);
const esp2 = document.createElement('span');
esp2.className = 'espaco';
$('detectar-botoes').append(btnProcurar, esp2, botao(ICONES.cancelar, t('config.fechar'), {}, () => fecharCaixa('caixa-detectar')));
function abrirDetectar() { abrirCaixa('caixa-detectar'); detectar(); }
function detectar() {
  $('detectar-lista').replaceChildren();
  $('detectar-estado').textContent = t('detectar.procurando');
  btnProcurar.disabled = true;
  Assistir.detectar();
}
window.detectado = (achados) => {
  btnProcurar.disabled = false;
  $('detectar-estado').textContent = achados.length ? '' : `${t('detectar.nenhuma')} ${C.semWifi}`;
  const tipos = { xiongmai: 'Xiongmai / iCSee', onvif: 'ONVIF', rtsp: 'RTSP' };
  $('detectar-lista').replaceChildren(...achados.map((a) => {
    const li = document.createElement('li');
    const texto = document.createElement('div');
    texto.textContent = `${a.ip} · ${a.marca === 'celular' ? 'CCTV Express' : tipos[a.tipo]}`;
    const det = document.createElement('small');
    det.textContent = t('detectar.portas', { p: a.portas.join(', ') });
    texto.append(det);
    li.append(texto);
    if (a.jaAdicionada) {
      const s = document.createElement('small');
      s.textContent = t('detectar.jaAdicionada');
      li.append(s);
    } else {
      li.append(botao(ICONES.adicionar, t('detectar.adicionar'), { ativo: true }, () => {
        abrirFormulario(null, { tipo: a.tipo, ip: a.ip, porta: a.tipo === 'xiongmai' ? '' : a.porta, url: a.url || '', nome: a.ip });
      }));
    }
    return li;
  }));
};

// lista das câmeras (editar)
$('lista-botoes').append(botao(ICONES.cancelar, t('config.fechar'), {}, () => fecharCaixa('caixa-lista')));
function abrirLista() {
  $('lista').replaceChildren(...(cameras.length ? cameras.map((c) => {
    const li = document.createElement('li');
    const texto = document.createElement('div');
    texto.textContent = c.nome;
    const det = document.createElement('small');
    det.textContent = `${c.ip}${(c.canal || 1) > 1 ? ` · ${t('lateral.canal', { n: c.canal })}` : ''} · ${ROTULO()[estados.get(c.id) || 'conectando']}`;
    texto.append(det);
    li.append(texto,
      botao(ICONES.cheia, t('quadro.telaCheia'), { soIcone: true }, () => { fecharCaixa('caixa-lista'); cheia = c.id; desenharMosaico(); }),
      botao(ICONES.editar, t('lateral.editar'), {}, () => abrirFormulario(c)));
    return li;
  }) : [Object.assign(document.createElement('li'), { textContent: t('lateral.vazia') })]));
  abrirCaixa('caixa-lista');
}

// arquivo de configuração rápida (.cctvx), o mesmo do computador
const senhaArquivo = $('arquivo-senha');
$('campo-arquivo').append(olho(senhaArquivo));
const avisoArquivo = (texto, ok = false) => { $('arquivo-aviso').textContent = texto; $('arquivo-aviso').className = ok ? 'aviso ok' : 'aviso'; };
let esperandoSenha = false;
const btnContinuar = botao(ICONES.salvar, t('arquivo.continuar'), { ativo: true }, () => { esperandoSenha = false; btnContinuar.hidden = true; Assistir.senhaDoArquivo(senhaArquivo.value); });
btnContinuar.hidden = true;
const esp3 = document.createElement('span');
esp3.className = 'espaco';
$('arquivo-botoes').append(
  botao(ICONES.exportar, t('arquivo.exportar'), {}, () => { avisoArquivo(''); Assistir.exportar(senhaArquivo.value); }),
  botao(ICONES.importar, t('arquivo.importar'), {}, () => { avisoArquivo(''); btnContinuar.hidden = true; Assistir.importar(); }),
  esp3, btnContinuar,
  botao(ICONES.cancelar, t('config.fechar'), {}, () => fecharCaixa('caixa-arquivo')),
);
$('form-arquivo').addEventListener('submit', (e) => { e.preventDefault(); if (esperandoSenha) btnContinuar.click(); });
function abrirArquivo() { avisoArquivo(''); btnContinuar.hidden = true; abrirCaixa('caixa-arquivo'); }
window.exportado = (ok) => { if (ok) avisoArquivo(t('arquivo.exportado'), true); };
window.pedirSenhaArquivo = () => {
  // arquivo protegido: com a senha já digitada segue direto; sem ela, pede e espera o Continuar
  if (senhaArquivo.value) { Assistir.senhaDoArquivo(senhaArquivo.value); return; }
  esperandoSenha = true;
  avisoArquivo(t('arquivo.pedirSenha'));
  btnContinuar.hidden = false;
  senhaArquivo.focus();
};
window.importado = (r) => {
  if (r.erro === 'senha') { esperandoSenha = true; btnContinuar.hidden = false; avisoArquivo(t('arquivo.senhaErrada')); return; }
  if (r.erro) { avisoArquivo(t('arquivo.invalido')); return; }
  avisoArquivo(t('arquivo.importadas', { n: r.novas }), true);
  recarregar();
};

recarregar();
