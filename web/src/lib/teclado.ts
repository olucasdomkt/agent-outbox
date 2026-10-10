// Triagem sem mouse (spec, seção 5): J/K, A, E, S, D, X, Shift+A, Shift+D, Z, /, ? e Cmd+K.
import { useEffect } from 'react';
import { aprovar, cobrar, desfazer, enviarAgora, fecharPromessa, irPara, marcarVisto, naoPreciso, restaurar, voltarParaRevisao } from './acoes';
import { anunciar, avisar, dados, ehVistaLista, mensagensDaVista, ui } from './loja';
import { NOME_CANAL } from './canais';
import { devolverFoco } from './foco';
import type { ItemAcompanhar, ItemEntrada, Vista } from './tipos';

export interface Ganchos {
  focarBusca: () => void;
  itensEntrada: () => ItemEntrada[];
  responderEntrada: () => void;
  lerEntrada: () => void;
  itensAcompanhar: () => ItemAcompanhar[];
}

const ATALHO_ABA: Record<string, Vista> = { 1: 'revisar', 2: 'entrada', 3: 'fila', 4: 'enviadas', 5: 'erro', 6: 'descartadas', 7: 'relatorio', 8: 'ajustes', 9: 'licoes' };

function andar(passo: number) {
  const s = ui.get();
  if (s.vista === 'entrada') return;
  if (!ehVistaLista(s.vista)) return;
  const lista = mensagensDaVista(dados.get().msgs, s.vista, s.canal, s.busca);
  if (!lista.length) return;
  const i = lista.findIndex((m) => String(m.id) === s.sel[s.vista]);
  const alvo = lista[Math.max(0, Math.min(lista.length - 1, i < 0 ? 0 : i + passo))];
  if (!alvo) return;
  ui.set((e) => ({ sel: { ...e.sel, [s.vista]: String(alvo.id) }, comparando: null }));
  anunciar(`${alvo.destino_nome || 'Sem destino'}, ${NOME_CANAL[alvo.canal]}, ${lista.indexOf(alvo) + 1} de ${lista.length}`);
}

function andarEntrada(passo: number, itens: ItemEntrada[]) {
  if (!itens.length) return;
  const s = ui.get();
  const i = itens.findIndex((x) => x.chave === s.sel.entrada);
  const alvo = itens[Math.max(0, Math.min(itens.length - 1, i < 0 ? 0 : i + passo))];
  ui.set((e) => ({ sel: { ...e.sel, entrada: alvo.chave }, respondendo: null }));
  anunciar(`${alvo.titulo}, ${NOME_CANAL[alvo.canal]}`);
}

function andarAcompanhar(passo: number, itens: ItemAcompanhar[]) {
  if (!itens.length) return;
  const s = ui.get();
  const i = itens.findIndex((x) => x.chave === s.sel.acompanhar);
  const alvo = itens[Math.max(0, Math.min(itens.length - 1, i < 0 ? 0 : i + passo))];
  ui.set((e) => ({ sel: { ...e.sel, acompanhar: alvo.chave } }));
  anunciar(`${alvo.destino.nome}, ${alvo.tipo === 'esperando' ? 'esperando resposta' : 'promessa'}`);
}

export function useTeclado(g: Ganchos) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const s = ui.get();
      const alvo = e.target as HTMLElement | null;
      const digitando = !!alvo?.closest?.('input, textarea, select, [contenteditable="true"]');
      const cmd = e.metaKey || e.ctrlKey;

      if (cmd && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ui.set({ paleta: !s.paleta, ajuda: false });
        return;
      }
      if (s.paleta || s.ajuda || s.painel) return;
      if (e.key === 'Escape' && !digitando) {
        if (s.editando) { ui.set({ editando: null }); devolverFoco(); }
        else if (s.comparando) ui.set({ comparando: null });
        else if (s.marcadas.length) ui.set({ marcadas: [] });
        else if (s.contextoAberto) ui.set({ contextoAberto: false });
        else if (s.detalheCelular) ui.set({ detalheCelular: false });
        return;
      }
      if (digitando || s.editando || cmd || e.altKey) return;

      const k = e.key;
      const low = k.toLowerCase();
      if ((k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') && alvo?.closest?.('[role=region]')) return;
      if (k === '?') { e.preventDefault(); ui.set({ ajuda: true }); return; }
      if (k === '/') { e.preventDefault(); g.focarBusca(); return; }
      if (ATALHO_ABA[k] && !e.shiftKey) {
        // 1 a 9 trocam de aba (com o painel de descarte aberto, 0 a 5 são os motivos e nem chegam aqui)
        e.preventDefault();
        irPara(ATALHO_ABA[k]);
        return;
      }
      if (low === 'z') { e.preventDefault(); void desfazer(); return; }

      if (s.vista === 'entrada') {
        const itens = g.itensEntrada();
        const atual = itens.find((x) => x.chave === s.sel.entrada);
        if (low === 'j' || k === 'ArrowDown') { e.preventDefault(); andarEntrada(1, itens); }
        else if (low === 'k' || k === 'ArrowUp') { e.preventDefault(); andarEntrada(-1, itens); }
        else if (low === 'r' && atual) { e.preventDefault(); g.responderEntrada(); }
        else if (low === 'i' && atual) { e.preventDefault(); void marcarVisto(atual); andarEntrada(1, itens.filter((x) => x.chave !== atual.chave)); }
        else if (low === 'l' && atual) { e.preventDefault(); g.lerEntrada(); }
        return;
      }
      // Acompanhar: C cobra, I tira (Não preciso / Dispensar), F fecha a promessa (Cumpri / Recebi), L lê a conversa
      if (s.vista === 'acompanhar') {
        const itens = g.itensAcompanhar();
        const atual = itens.find((x) => x.chave === s.sel.acompanhar);
        const proximo = () => andarAcompanhar(1, itens.filter((x) => x.chave !== atual?.chave));
        if (low === 'j' || k === 'ArrowDown') { e.preventDefault(); andarAcompanhar(1, itens); }
        else if (low === 'k' || k === 'ArrowUp') { e.preventDefault(); andarAcompanhar(-1, itens); }
        else if (!atual) return;
        else if (low === 'c' && (atual.tipo === 'esperando' || atual.promessa?.sentido === 'dele')) { e.preventDefault(); void cobrar(atual); }
        else if (low === 'i') { e.preventDefault(); void (atual.tipo === 'esperando' ? naoPreciso(atual) : fecharPromessa(atual, 'dispensar')); proximo(); }
        else if (low === 'f' && atual.promessa) { e.preventDefault(); void fecharPromessa(atual, atual.promessa.sentido === 'minha' ? 'cumpri' : 'recebi'); proximo(); }
        else if (low === 'l' && atual.canal === 'whatsapp') { e.preventDefault(); ui.set({ lerConversa: s.lerConversa === atual.chave ? null : atual.chave }); }
        return;
      }
      if (!ehVistaLista(s.vista)) return;

      const lista = mensagensDaVista(dados.get().msgs, s.vista, s.canal, s.busca);
      const m = lista.find((x) => String(x.id) === s.sel[s.vista]);
      if (low === 'j' || k === 'ArrowDown') { e.preventDefault(); andar(1); return; }
      if (low === 'k' || k === 'ArrowUp') { e.preventDefault(); andar(-1); return; }
      if (k === 'Home') { e.preventDefault(); andar(-1e6); return; }
      if (k === 'End') { e.preventDefault(); andar(1e6); return; }
      if (low === 'i') { e.preventDefault(); ui.set({ contextoAberto: !s.contextoAberto }); return; }
      if (k === 'Enter' && m) { ui.set({ detalheCelular: true }); return; }

      if (e.shiftKey && low === 'a') {
        e.preventDefault();
        const ids = s.marcadas.length ? s.marcadas : m ? [m.id] : [];
        if (ids.length) void aprovar(ids);
        return;
      }
      if (e.shiftKey && low === 'd') {
        e.preventDefault();
        const ids = s.marcadas.length ? s.marcadas : m ? [m.id] : [];
        if (ids.length) ui.set({ painel: { tipo: 'descartar', ids } });
        return;
      }
      if (!m) return;
      if (low === 'x') {
        e.preventDefault();
        const marcada = s.marcadas.includes(m.id);
        ui.set({ marcadas: marcada ? s.marcadas.filter((x) => x !== m.id) : [...s.marcadas, m.id] });
        anunciar(marcada ? `#${m.id} desmarcada` : `#${m.id} marcada. ${s.marcadas.length + 1} no lote.`);
        return;
      }
      const editavel = m.status === 'pendente' || m.status === 'erro' || m.status === 'aprovada';
      if ((low === 'a' || low === 't') && (m.status === 'pendente' || m.status === 'erro')) { e.preventDefault(); void aprovar([m.id]); return; }
      if (low === 'e' && editavel) { e.preventDefault(); ui.set({ editando: m.id, painel: null }); return; }
      if (low === 's' && (m.status === 'pendente' || m.status === 'aprovada')) {
        e.preventDefault();
        if (m.lint?.bloqueios?.length) { avisar(`A #${m.id} está bloqueada: ${m.lint.bloqueios[0].msg}`, 'erro'); return; }
        ui.set({ painel: { tipo: 'agendar', ids: [m.id] } });
        return;
      }
      if (low === 'd' && editavel) { e.preventDefault(); ui.set({ painel: { tipo: 'descartar', ids: [m.id] } }); return; }
      if (low === 'u' && m.status === 'aprovada') { e.preventDefault(); void voltarParaRevisao(m.id); return; }
      if (low === 'n' && m.status === 'aprovada') { e.preventDefault(); void enviarAgora(m.id); return; }
      if (low === 'r' && m.status === 'descartada') { e.preventDefault(); void restaurar(m.id); return; }
      if (low === 'c' && m.status === 'enviada') {
        e.preventDefault();
        navigator.clipboard?.writeText(m.corpo).then(() => avisar('Texto copiado.', 'ok'), () => avisar('Não deu para copiar.', 'erro'));
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [g]);
}
