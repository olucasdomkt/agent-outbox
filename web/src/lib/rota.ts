// Endereço com # para cada aba e a mensagem aberta: #revisar/329, #entrada/<chave>.
import { ui } from './loja';
import type { Vista } from './tipos';

const APELIDOS: Record<string, Vista> = {
  revisar: 'revisar', pendente: 'revisar', pendentes: 'revisar',
  entrada: 'entrada', acompanhar: 'acompanhar', promessas: 'acompanhar',
  fila: 'fila', aprovada: 'fila', aprovadas: 'fila', enviando: 'fila',
  enviadas: 'enviadas', enviada: 'enviadas', entregues: 'enviadas',
  erro: 'erro', erros: 'erro',
  descartadas: 'descartadas', descartada: 'descartadas',
  relatorio: 'relatorio', ajustes: 'ajustes', licoes: 'licoes', licao: 'licoes',
};

export function lerHash() {
  const [bruto, ...resto] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
  const vista = APELIDOS[bruto] || 'revisar';
  const sel = resto.join('/') || undefined;
  return { vista, sel };
}

let ultimo = '';
function escrever(vista: Vista, sel?: string) {
  const alvo = `#${vista}${sel ? `/${encodeURIComponent(sel)}` : ''}`;
  if (alvo === ultimo) return;
  const trocouVista = !ultimo.startsWith(`#${vista}`) || ultimo.split('/')[0] !== `#${vista}`;
  ultimo = alvo;
  // trocar de aba entra no histórico (voltar funciona); andar com J/K não
  if (trocouVista) history.pushState(null, '', alvo);
  else history.replaceState(null, '', alvo);
}

export function ligarRota() {
  const aplicar = () => {
    const { vista, sel } = lerHash();
    ultimo = location.hash;
    ui.set((e) => ({ vista, sel: sel ? { ...e.sel, [vista]: sel } : e.sel, editando: null, painel: null, comparando: null }));
  };
  aplicar();
  window.addEventListener('popstate', aplicar);
  window.addEventListener('hashchange', aplicar);
  let antes = ui.get();
  ui.assinar(() => {
    const agora = ui.get();
    if (agora.vista !== antes.vista || agora.sel[agora.vista] !== antes.sel[antes.vista]) escrever(agora.vista, agora.sel[agora.vista]);
    antes = agora;
  });
}
