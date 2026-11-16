// Propriedade intelectual e autoria de André "Tutankhamal" Borba (Stream.Builders) - ORCID 0009-0006-1743-1554. Uso autorizado mediante acordo escrito com o autor.
//
// Desliga o menu do botão direito e os atalhos das ferramentas do desenvolvedor (o mesmo padrão do ebooks.express,
// packages/web-base/src/bloqueio.ts). É atrito, não segurança. Campos editáveis mantêm o menu (colar, corretor).
// Quem usa o clique direito como recurso continua recebendo o evento: aqui só se impede o menu do navegador.
(function () {
  function editavel(alvo) {
    return !!(alvo && alvo.closest && alvo.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
  }
  // F12; Ctrl+Shift+I/J/C/K; Ctrl+U; e no macOS Cmd+Opt+I/J/C/K e Cmd+U (o Option troca o caractere: vale e.code)
  function atalho(e) {
    if (e.key === 'F12' || e.code === 'F12') return true;
    var tecla = ((e.code && e.code.indexOf('Key') === 0) ? e.code.slice(3) : (e.key || '')).toUpperCase();
    if (!(e.ctrlKey || e.metaKey)) return false;
    if ((e.shiftKey || e.altKey) && 'IJCK'.indexOf(tecla) >= 0 && tecla.length === 1) return true;
    return tecla === 'U';
  }
  addEventListener('contextmenu', function (e) { if (!editavel(e.target)) e.preventDefault(); }, { capture: true });
  addEventListener('keydown', function (e) { if (atalho(e)) { e.preventDefault(); e.stopPropagation(); } }, { capture: true });
})();
