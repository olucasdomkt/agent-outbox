// Formatação no campo de texto: envolve a seleção com o marcador do canal ou prefixa as linhas (lista, citação).
// Usa execCommand para o Cmd+Z do próprio campo continuar funcionando.
import type { Formatacao } from './canais';

export function inserir(el: HTMLTextAreaElement, texto: string, selIni: number, selFim: number) {
  el.focus();
  el.setSelectionRange(selIni, selFim);
  const ok = document.execCommand?.('insertText', false, texto);
  if (!ok) {
    el.setRangeText(texto, selIni, selFim, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function envolver(el: HTMLTextAreaElement, marca: string) {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const sel = value.slice(a, b);
  const antes = value.slice(Math.max(0, a - marca.length), a);
  const depois = value.slice(b, b + marca.length);
  if (antes === marca && depois === marca) {
    inserir(el, sel, a - marca.length, b + marca.length);
    el.setSelectionRange(a - marca.length, b - marca.length);
    return;
  }
  if (sel.startsWith(marca) && sel.endsWith(marca) && sel.length >= marca.length * 2) {
    inserir(el, sel.slice(marca.length, sel.length - marca.length), a, b);
    el.setSelectionRange(a, b - marca.length * 2);
    return;
  }
  // marcador não pode encostar em espaço: tira os espaços das pontas da seleção
  const ini = sel.length - sel.trimStart().length;
  const fim = sel.length - sel.trimEnd().length;
  const miolo = sel.trim();
  inserir(el, `${sel.slice(0, ini)}${marca}${miolo}${marca}${sel.slice(sel.length - fim)}`, a, b);
  if (!miolo) el.setSelectionRange(a + marca.length, a + marca.length);
  else el.setSelectionRange(a + ini + marca.length, a + ini + marca.length + miolo.length);
}

export function prefixar(el: HTMLTextAreaElement, tipo: 'ul' | 'ol' | 'cit') {
  const { selectionStart: a, selectionEnd: b, value } = el;
  const ini = value.lastIndexOf('\n', a - 1) + 1;
  const fimLinha = value.indexOf('\n', b);
  const fim = fimLinha === -1 ? value.length : fimLinha;
  const linhas = value.slice(ini, fim).split('\n');
  const re = tipo === 'ul' ? /^[-*]\s/ : tipo === 'ol' ? /^\d+\.\s/ : /^>\s/;
  const todas = linhas.every((l) => re.test(l));
  const novas = linhas.map((l, i) => (todas ? l.replace(re, '') : `${tipo === 'ul' ? '- ' : tipo === 'ol' ? `${i + 1}. ` : '> '}${l.replace(/^([-*]|\d+\.|>)\s/, '')}`));
  inserir(el, novas.join('\n'), ini, fim);
}


// atalhos do editor: Cmd+B, Cmd+I, Cmd+Shift+X, Cmd+E, Cmd+Shift+8 e Cmd+Shift+7
export function atalhoDeFormato(e: KeyboardEvent | React.KeyboardEvent, el: HTMLTextAreaElement, fmt: Formatacao) {
  if (!(e.metaKey || e.ctrlKey)) return false;
  const k = e.key.toLowerCase();
  if (k === 'b' && fmt.negrito) envolver(el, fmt.negrito);
  else if (k === 'i' && fmt.italico) envolver(el, fmt.italico);
  else if (k === 'x' && e.shiftKey && fmt.tachado) envolver(el, fmt.tachado);
  else if (k === 'e' && fmt.codigo) envolver(el, fmt.codigo);
  else if ((k === '8' || k === '*') && e.shiftKey && fmt.lista) prefixar(el, 'ul');
  else if ((k === '7' || k === '&') && e.shiftKey && fmt.lista) prefixar(el, 'ol');
  else return false;
  e.preventDefault();
  return true;
}
