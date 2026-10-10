// Carga inicial, ao vivo pelo SSE (/api/stream) e plano B por consulta a cada 5 s se o SSE cair.
import { api } from './api';
import { anunciar, dados, gravarMensagens, STATUS_DA_VISTA, VISTAS_LISTA } from './loja';
import type { ContagemAcompanhar, Mensagem, Resumo, Saude, VistaLista } from './tipos';

const LIMITE: Record<VistaLista, number> = { revisar: 500, fila: 300, enviadas: 300, erro: 200, descartadas: 300 };

export async function carregarVista(v: VistaLista) {
  dados.set((e) => ({ estadoVista: { ...e.estadoVista, [v]: e.estadoVista[v] === 'ok' ? 'ok' : 'carregando' } }));
  try {
    const status = STATUS_DA_VISTA[v];
    const lista = await api.mensagens({ status: status.join(','), limite: LIMITE[v] });
    // quem estava nesta vista e não veio mais mudou de estado lá fora: busca a linha nova
    const vieram = new Set(lista.map((m) => m.id));
    const sumiram = Object.values(dados.get().msgs).filter((m) => status.includes(m.status) && !vieram.has(m.id)).map((m) => m.id);
    gravarMensagens(lista);
    if (sumiram.length && sumiram.length < 30 && v !== 'enviadas' && v !== 'descartadas') {
      const novas = await Promise.allSettled(sumiram.map((id) => api.mensagem(id)));
      gravarMensagens(novas.flatMap((r) => (r.status === 'fulfilled' ? [r.value as Mensagem] : [])));
    }
    dados.set((e) => ({ estadoVista: { ...e.estadoVista, [v]: 'ok' } }));
  } catch {
    dados.set((e) => ({ estadoVista: { ...e.estadoVista, [v]: e.estadoVista[v] === 'ok' ? 'ok' : 'erro' } }));
  }
}

export async function carregarResumo() {
  try { dados.set({ resumo: await api.resumo() }); } catch { /* o SSE ou a próxima volta traz */ }
}
export async function carregarSaude() {
  try { dados.set({ saude: await api.saude() }); } catch { /* idem */ }
}

let entradaEmCurso: Promise<void> | null = null;
export function carregarEntrada() {
  if (entradaEmCurso) return entradaEmCurso;
  dados.set((e) => ({ entradaEstado: e.entrada ? e.entradaEstado : 'carregando' }));
  entradaEmCurso = api.entrada()
    .then((r) => dados.set({ entrada: r, entradaEstado: 'ok', entradaContagem: r.contagem }))
    .catch(() => dados.set((e) => ({ entradaEstado: e.entrada ? 'ok' : 'erro' })))
    .finally(() => { entradaEmCurso = null; });
  return entradaEmCurso;
}

let acompanharEmCurso: Promise<void> | null = null;
export function carregarAcompanhar() {
  if (acompanharEmCurso) return acompanharEmCurso;
  dados.set((e) => ({ acompanharEstado: e.acompanhar ? e.acompanharEstado : 'carregando' }));
  acompanharEmCurso = api.acompanhar()
    .then((r) => dados.set({ acompanhar: r, acompanharEstado: 'ok', acompanharContagem: r.contagem }))
    .catch(() => dados.set((e) => ({ acompanharEstado: e.acompanhar ? 'ok' : 'erro' })))
    .finally(() => { acompanharEmCurso = null; });
  return acompanharEmCurso;
}

export async function carregarTudo() {
  const [config, pessoas] = await Promise.allSettled([api.config(), api.pessoas()]);
  if (config.status === 'fulfilled') dados.set({ config: config.value });
  if (pessoas.status === 'fulfilled' && Array.isArray(pessoas.value)) dados.set({ pessoas: pessoas.value });
  await carregarResumo(); // antes das listas: traz os canais ligados e os clientes que agrupam a fila
  await Promise.all([carregarSaude(), carregarVista('revisar'), carregarVista('fila'), carregarVista('erro')]);
  // o resto não segura a primeira tela
  void carregarVista('enviadas');
  void carregarVista('descartadas');
  void carregarEntrada();
}

// ---------------------------------------------------------------- ao vivo

let fonte: EventSource | null = null;

// leitor de tela: mensagem nova para revisar é anunciada; uma rajada de sessões vira uma frase só
let chegadas: Mensagem[] = [];
let relogioChegada = 0;
function avisarChegada(m: Mensagem) {
  chegadas.push(m);
  window.clearTimeout(relogioChegada);
  relogioChegada = window.setTimeout(() => {
    const n = chegadas.length;
    anunciar(n === 1 ? `Nova para revisar: ${chegadas[0].destino_nome || chegadas[0].para_pedido || 'destino a escolher'}.` : `${n} novas para revisar.`);
    chegadas = [];
  }, 1500);
}
let falhas = 0;
let caiu = false;
let consulta: number | null = null;
let religar: number | null = null;

function pararConsulta() {
  if (consulta !== null) window.clearInterval(consulta);
  consulta = null;
}
function iniciarConsulta() {
  if (consulta !== null) return;
  consulta = window.setInterval(() => {
    void carregarResumo();
    void carregarVista('revisar');
    void carregarVista('fila');
    void carregarVista('erro');
  }, 5000);
}

const ler = <T,>(ev: MessageEvent): T | null => {
  try { return JSON.parse(ev.data) as T; } catch { return null; }
};

export function ligarAoVivo() {
  if (religar !== null) window.clearTimeout(religar);
  fonte?.close();
  const es = new EventSource('/api/stream');
  fonte = es;
  es.addEventListener('open', () => {
    dados.set({ conexao: 'ao-vivo' });
    pararConsulta();
    if (caiu) {
      // voltou depois de cair: o que mudou no meio do caminho não chegou
      caiu = false;
      VISTAS_LISTA.forEach((v) => void carregarVista(v));
      void carregarSaude();
      if (dados.get().entrada) void carregarEntrada();
      if (dados.get().acompanhar) void carregarAcompanhar();
    }
    falhas = 0;
  });
  es.addEventListener('mensagem', (ev) => {
    const m = ler<Mensagem>(ev as MessageEvent);
    if (!m) return;
    if (m.status === 'pendente' && !dados.get().msgs[m.id]) avisarChegada(m);
    gravarMensagens([m]);
  });
  es.addEventListener('resumo', (ev) => {
    const r = ler<Resumo>(ev as MessageEvent);
    if (r) dados.set({ resumo: r });
  });
  es.addEventListener('saude', (ev) => {
    const s = ler<Saude>(ev as MessageEvent);
    if (s) dados.set({ saude: s });
  });
  es.addEventListener('entrada', (ev) => {
    const c = ler<{ precisa: number; total: number }>(ev as MessageEvent);
    if (!c) return;
    const antes = dados.get().entradaContagem;
    dados.set({ entradaContagem: c });
    if (dados.get().entrada && (!antes || antes.precisa !== c.precisa || antes.total !== c.total)) void carregarEntrada();
  });
  es.addEventListener('acompanhar', (ev) => {
    const c = ler<ContagemAcompanhar>(ev as MessageEvent);
    if (!c) return;
    const antes = dados.get().acompanharContagem;
    dados.set({ acompanharContagem: c });
    if (dados.get().acompanhar && (!antes || antes.total !== c.total)) void carregarAcompanhar();
  });
  es.onerror = () => {
    es.close();
    if (fonte === es) fonte = null;
    caiu = true;
    falhas++;
    dados.set({ conexao: 'reconectando' });
    if (falhas >= 2) iniciarConsulta();
    religar = window.setTimeout(ligarAoVivo, Math.min(30_000, 1000 * 2 ** Math.min(falhas, 5)));
  };
}

export function iniciar() {
  void carregarTudo();
  ligarAoVivo();
  // saúde dos canais muda devagar; a contagem regressiva das saídas é de cada componente
  window.setInterval(() => void carregarSaude(), 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && dados.get().conexao !== 'ao-vivo') ligarAoVivo();
  });
}
