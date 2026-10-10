// Estado da tela em duas lojas pequenas (dados do servidor e estado da interface).
// Sem biblioteca: useSyncExternalStore com seletores que devolvem referências estáveis.
import { useSyncExternalStore } from 'react';
import type {
  Canal, Config, ContagemAcompanhar, Mensagem, Pessoa, RespostaAcompanhar, RespostaEntrada, Resumo, Saude, Status, Vista, VistaLista,
} from './tipos';
import { normCliente } from './clientes';
import { semAcento } from './formato';

export interface Loja<T> {
  get: () => T;
  set: (p: Partial<T> | ((e: T) => Partial<T>)) => void;
  assinar: (f: () => void) => () => void;
}
function criarLoja<T extends object>(inicial: T): Loja<T> {
  let estado = inicial;
  const ouvintes = new Set<() => void>();
  return {
    get: () => estado,
    set: (p) => {
      const parcial = typeof p === 'function' ? p(estado) : p;
      estado = { ...estado, ...parcial };
      ouvintes.forEach((f) => f());
    },
    assinar: (f) => {
      ouvintes.add(f);
      return () => ouvintes.delete(f);
    },
  };
}
export function useSel<T, S>(loja: Loja<T>, sel: (e: T) => S): S {
  return useSyncExternalStore(loja.assinar, () => sel(loja.get()), () => sel(loja.get()));
}

// ---------------------------------------------------------------- dados

// faixa "Sai em 10 s · Desfazer (Z)": a última ação que ainda dá para voltar
export interface Saida {
  chave: string;
  tipo: 'aprovar' | 'descartar' | 'agendar';
  ids: number[];
  ate: number;
  rotulo: string;
  detalhe?: string;
  agendada?: number | null;
  // aprovada que espera outra mensagem: "Depois da #485" no lugar de "Sai em 10 s"
  espera?: string | null;
}
export interface Aviso {
  id: number;
  texto: string;
  tipo: 'info' | 'erro' | 'ok';
  acao?: { rotulo: string; fazer: () => void };
  // ms na tela; o relógio para enquanto o mouse ou o foco estão no aviso (Faixas.tsx)
  duracao: number;
}
export interface Dados {
  resumo: Resumo | null;
  saude: Saude | null;
  config: Config | null;
  pessoas: Pessoa[];
  msgs: Record<number, Mensagem>;
  estadoVista: Partial<Record<VistaLista, 'carregando' | 'ok' | 'erro'>>;
  entrada: RespostaEntrada | null;
  entradaEstado: 'carregando' | 'ok' | 'erro' | null;
  entradaContagem: { precisa: number; total: number } | null;
  acompanhar: RespostaAcompanhar | null;
  acompanharEstado: 'carregando' | 'ok' | 'erro' | null;
  acompanharContagem: ContagemAcompanhar | null;
  conexao: 'conectando' | 'ao-vivo' | 'reconectando';
  saindo: Saida[];
  avisos: Aviso[];
  fala: string;
}
export const dados = criarLoja<Dados>({
  resumo: null, saude: null, config: null, pessoas: [], msgs: {}, estadoVista: {},
  entrada: null, entradaEstado: null, entradaContagem: null, acompanhar: null, acompanharEstado: null, acompanharContagem: null,
  conexao: 'conectando', saindo: [], avisos: [], fala: '',
});

// ids com ação otimista em andamento: o SSE não pode trazer de volta a linha de antes
export const emVoo = new Map<number, number>();

export function gravarMensagens(lista: Mensagem[]) {
  if (!lista.length) return;
  dados.set((e) => {
    const msgs = { ...e.msgs };
    for (const m of lista) {
      if (!m || typeof m.id !== 'number') continue;
      const atual = msgs[m.id];
      const antes = emVoo.get(m.id);
      if (antes !== undefined && (m.atualizado_em ?? 0) <= antes) continue;
      // a linha mais nova vence (SSE e resposta de ação podem chegar fora de ordem)
      if (!atual || (m.atualizado_em ?? 0) >= (atual.atualizado_em ?? 0)) msgs[m.id] = m;
    }
    return { msgs };
  });
}

// leitor de tela: mesma frase duas vezes seguidas também é lida
let alterna = false;
export function anunciar(texto: string) {
  alterna = !alterna;
  dados.set({ fala: alterna ? texto : `${texto}​` });
}

let proximoAviso = 1;
export function avisar(texto: string, tipo: Aviso['tipo'] = 'info', acao?: Aviso['acao'], duracao = tipo === 'erro' ? 9000 : 5000) {
  const id = proximoAviso++;
  dados.set((e) => ({ avisos: [...e.avisos.slice(-3), { id, texto, tipo, acao, duracao }] }));
  // erro já nasce com role="alert" (lido na hora); o resto vai pela região polite, que existe desde o início
  if (tipo !== 'erro') anunciar(texto);
  return id;
}
export function fecharAviso(id: number) {
  dados.set((e) => ({ avisos: e.avisos.filter((a) => a.id !== id) }));
}
export function remendar(id: number, campos: Partial<Mensagem>) {
  dados.set((e) => (e.msgs[id] ? { msgs: { ...e.msgs, [id]: { ...e.msgs[id], ...campos } } } : {}));
}

// ---------------------------------------------------------------- interface

export interface Ui {
  vista: Vista;
  sel: Partial<Record<Vista, string>>;
  marcadas: number[];
  canal: Canal | '';
  busca: string;
  editando: number | null;
  painel: null | { tipo: 'descartar' | 'agendar'; ids: number[] };
  paleta: boolean;
  ajuda: boolean;
  verTudo: boolean;
  respondendo: string | null;
  contextoAberto: boolean;
  detalheCelular: boolean;
  navAberta: boolean;
  comparando: null | { id: number; contra: 'original' | number };
  lerConversa: string | null;
}

const lerLocal = (k: string) => { try { return localStorage.getItem(`central:${k}`); } catch { return null; } };
export const gravarLocal = (k: string, v: string) => { try { localStorage.setItem(`central:${k}`, v); } catch { /* sem storage */ } };

export const ui = criarLoja<Ui>({
  vista: 'revisar', sel: {}, marcadas: [], canal: (lerLocal('canal') as Canal) || '', busca: '', editando: null, painel: null,
  paleta: false, ajuda: false, verTudo: lerLocal('verTudo') === '1', respondendo: null, contextoAberto: false,
  detalheCelular: false, navAberta: false, comparando: null, lerConversa: null,
});

// ---------------------------------------------------------------- vistas de mensagens

export const STATUS_DA_VISTA: Record<VistaLista, Status[]> = {
  revisar: ['pendente'],
  fila: ['aprovada', 'enviando'],
  enviadas: ['enviada'],
  erro: ['erro'],
  descartadas: ['descartada'],
};
export const VISTAS_LISTA = Object.keys(STATUS_DA_VISTA) as VistaLista[];
export const ehVistaLista = (v: Vista): v is VistaLista => v in STATUS_DA_VISTA;

function bate(m: Mensagem, busca: string) {
  if (!busca) return true;
  const alvo = semAcento(busca);
  return [m.corpo, m.destino_nome, m.sessao_nome, m.responder_a, m.para_pedido, m.assunto, `#${m.id}`].some((c) => semAcento(c).includes(alvo));
}

// a fila para revisar: cliente → destino → mensagens (mais antiga primeiro dentro do destino)
export interface GrupoDestino { chave: string; nome: string; itens: Mensagem[] }
export interface GrupoCliente { cliente: string; destinos: GrupoDestino[]; recente: number }

export function agruparRevisar(lista: Mensagem[]): GrupoCliente[] {
  const clientes = new Map<string, Map<string, GrupoDestino>>();
  const nomes = dados.get().resumo?.clientes;
  for (const m of lista) {
    const cliente = normCliente(m.cliente, m.app, nomes) || 'Sem cliente';
    const chave = m.destino_id ? `${m.canal}:${m.destino_id}` : `sem:${m.id}`;
    const destinos = clientes.get(cliente) || new Map<string, GrupoDestino>();
    const g = destinos.get(chave) || { chave, nome: m.destino_nome || m.para_pedido || 'Destino a escolher', itens: [] };
    g.itens.push(m);
    destinos.set(chave, g);
    clientes.set(cliente, destinos);
  }
  const grupos: GrupoCliente[] = [];
  for (const [cliente, destinos] of clientes) {
    const lista = [...destinos.values()];
    for (const g of lista) g.itens.sort((a, b) => a.criado_em - b.criado_em);
    lista.sort((a, b) => Math.max(...b.itens.map((x) => x.criado_em)) - Math.max(...a.itens.map((x) => x.criado_em)));
    grupos.push({ cliente, destinos: lista, recente: Math.max(...lista.flatMap((g) => g.itens.map((x) => x.criado_em))) });
  }
  // "Sem cliente" vai por último; os outros, quem recebeu algo mais recente primeiro
  return grupos.sort((a, b) => (a.cliente === 'Sem cliente' ? 1 : b.cliente === 'Sem cliente' ? -1 : b.recente - a.recente));
}

export function ordemDaFila(m: Mensagem) {
  if (m.status === 'enviando') return 0;
  const quando = Math.max(m.liberar_em || 0, m.agendar_para || 0, m.proxima_tentativa || 0) || m.aprovado_em || m.criado_em;
  // a que espera outra mensagem sai depois de todas as livres (1e13 ms passa de qualquer data)
  return m.aguardando ? quando + 1e13 : quando;
}

// lista da vista, na ordem exata em que aparece (J/K seguem esta ordem)
export function mensagensDaVista(msgs: Record<number, Mensagem>, vista: VistaLista, canal: Canal | '', busca: string): Mensagem[] {
  const status = STATUS_DA_VISTA[vista];
  const lista = Object.values(msgs).filter((m) => status.includes(m.status) && (!canal || m.canal === canal) && bate(m, busca));
  if (vista === 'revisar') return agruparRevisar(lista).flatMap((g) => g.destinos.flatMap((d) => d.itens));
  if (vista === 'fila') return lista.sort((a, b) => ordemDaFila(a) - ordemDaFila(b));
  if (vista === 'enviadas') return lista.sort((a, b) => (b.enviado_em || b.atualizado_em) - (a.enviado_em || a.atualizado_em));
  return lista.sort((a, b) => b.atualizado_em - a.atualizado_em);
}
