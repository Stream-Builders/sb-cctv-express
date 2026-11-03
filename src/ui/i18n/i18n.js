// Os textos da tela, um arquivo por idioma (os mesmos 18 do ebooks.express). O idioma inicial vem do Windows; a escolha
// feita nas configurações fica guardada neste computador. Falta de tradução cai no inglês e depois no português.
export const IDIOMAS = {
  'pt-BR': 'Português (Brasil)', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch', it: 'Italiano',
  nl: 'Nederlands', pl: 'Polski', ru: 'Русский', sv: 'Svenska', tr: 'Türkçe', vi: 'Tiếng Việt', 'zh-Hans': '简体中文',
  ko: '한국어', ja: '日本語', id: 'Bahasa Indonesia', hi: 'हिन्दी', ar: 'العربية',
};

let textos = {};
let reserva = {};
let base = {};
export let idioma = 'pt-BR';

/** Escolhe o idioma da lista mais próximo de um código do sistema (pt-PT -> pt-BR, zh-CN -> zh-Hans, en-US -> en). */
export function maisProximo(codigo) {
  if (!codigo) return 'en';
  if (IDIOMAS[codigo]) return codigo;
  const [lingua] = codigo.split('-');
  if (lingua === 'pt') return 'pt-BR';
  if (lingua === 'zh') return 'zh-Hans';
  return IDIOMAS[lingua] ? lingua : 'en';
}

export async function carregar(codigo) {
  idioma = IDIOMAS[codigo] ? codigo : 'en';
  base = (await import('./pt-BR.js')).default;
  reserva = (await import('./en.js')).default;
  textos = (await import(`./${idioma}.js`)).default;
  document.documentElement.lang = idioma;
  document.documentElement.dir = idioma === 'ar' ? 'rtl' : 'ltr';
  traduzirPagina();
}

/** Texto pela chave, com {variáveis}. */
export function t(chave, vars = {}) {
  const s = textos[chave] ?? reserva[chave] ?? base[chave] ?? chave;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function traduzirPagina() {
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-t-title]')) {
    el.title = t(el.dataset.tTitle);
    el.setAttribute('aria-label', el.title);
  }
  for (const el of document.querySelectorAll('[data-t-placeholder]')) el.placeholder = t(el.dataset.tPlaceholder);
}
