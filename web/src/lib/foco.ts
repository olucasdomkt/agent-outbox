// Quando uma camada fecha (editor, painel, ajuda, paleta), o foco volta para a lista.
// Largado no <body>, o leitor de tela usa as letras (K, E, D, X) para navegar e os atalhos param de funcionar para ele.
export function devolverFoco() {
  requestAnimationFrame(() => {
    const ativo = document.activeElement;
    if (ativo && ativo !== document.body) return;
    document.querySelector<HTMLElement>('[role=listbox]')?.focus({ preventScroll: true });
  });
}
