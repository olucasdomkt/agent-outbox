// Camada de API: uma função por rota do contrato v2. Toda escrita leva o cabeçalho x-central.
// A interface só conhece estas funções; o modo fixture vive no servidor (scripts/servidor-fixture.mjs).
import type {
  CamposLicao, Config, Conversa, ContextoDestino, Destino, Evento, ItemAcompanhar, ItemLint, Licao, Lint, Mensagem, MotivoCodigo,
  Pessoa, Previa, Relatorio, RespostaAcompanhar, RespostaEntrada, RespostaLicoes, Resumo, Saude, Versao,
} from './tipos';
import { comPonto } from './formato';

export class ErroApi extends Error {
  status: number;
  corpo: { erro?: string; status?: string; bloqueios?: ItemLint[] } & Record<string, unknown>;
  constructor(status: number, corpo: ErroApi['corpo']) {
    super(corpo?.erro || `HTTP ${status}`);
    this.status = status;
    this.corpo = corpo || {};
  }
}

interface Opcoes {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  corpo?: unknown;
  sinal?: AbortSignal;
}

async function req<T>(caminho: string, { metodo = 'GET', corpo, sinal }: Opcoes = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', 'x-central': '1' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: sinal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ErroApi(0, { erro: 'sem_conexao' });
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroApi(r.status, dados);
  return dados as T;
}

const qs = (p: Record<string, string | number | undefined | null>) =>
  Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

type ComOk = Mensagem & { ok?: boolean };
export interface ResultadoLote { id: number; ok: boolean; erro?: string; status?: string; bloqueios?: ItemLint[] }

const rotaNaoExiste = (e: unknown) => e instanceof ErroApi && e.status === 404 && /rota/.test(e.corpo.erro || '');

export const api = {
  resumo: () => req<Resumo>('/api/resumo'),
  saude: () => req<Saude>('/api/saude'),
  mensagens: (p: { status?: string; canal?: string; q?: string; limite?: number }) => req<Mensagem[]>(`/api/mensagens?${qs(p)}`),
  mensagem: (id: number) => req<Mensagem & { eventos: Evento[] }>(`/api/mensagens/${id}`),
  previa: (id: number, sinal?: AbortSignal) => req<Previa>(`/api/mensagens/${id}/previa`, { sinal }),
  versoes: (id: number) => req<Versao[]>(`/api/mensagens/${id}/versoes`),

  aprovar: (id: number) => req<ComOk>(`/api/mensagens/${id}/aprovar`, { metodo: 'POST', corpo: {} }),
  async desfazer(id: number) {
    try {
      return await req<ComOk>(`/api/mensagens/${id}/desfazer`, { metodo: 'POST', corpo: {} });
    } catch (e) {
      // servidor antigo: a mesma volta para revisão chamava "desaprovar"
      if (rotaNaoExiste(e)) return req<ComOk>(`/api/mensagens/${id}/desaprovar`, { metodo: 'POST', corpo: {} });
      throw e;
    }
  },
  descartar: (id: number, motivo_codigo: MotivoCodigo | null, motivo?: string) =>
    req<ComOk>(`/api/mensagens/${id}/descartar`, { metodo: 'POST', corpo: { motivo_codigo, ...(motivo ? { motivo } : {}) } }),
  restaurar: (id: number) => req<ComOk>(`/api/mensagens/${id}/restaurar`, { metodo: 'POST', corpo: {} }),
  agendar: (id: number, quando: number | null) => req<ComOk>(`/api/mensagens/${id}/agendar`, { metodo: 'POST', corpo: { quando } }),
  editar: (id: number, campos: Partial<Mensagem>) => req<Mensagem>(`/api/mensagens/${id}`, { metodo: 'PATCH', corpo: campos }),
  // ordem entre mensagens: depois_de null solta; sem espera_resposta, mantém o que está
  ordem: (id: number, corpo: { depois_de?: number | null; espera_resposta?: boolean }) =>
    req<Mensagem>(`/api/mensagens/${id}`, { metodo: 'PUT', corpo }),
  lote: (acao: 'aprovar' | 'descartar' | 'desfazer', ids: number[], motivo_codigo?: MotivoCodigo | null) =>
    req<{ resultados: ResultadoLote[] }>('/api/lote', { metodo: 'POST', corpo: { acao, ids, ...(motivo_codigo !== undefined ? { motivo_codigo } : {}) } }),
  lint: (dados: Record<string, unknown>, sinal?: AbortSignal) => req<Lint>('/api/lint', { metodo: 'POST', corpo: dados, sinal }),
  criar: (dados: Record<string, unknown>) => req<Mensagem>('/api/mensagens', { metodo: 'POST', corpo: dados }),
  pasta: (id: number, i: number) => req<{ ok: boolean }>(`/api/mensagens/${id}/anexo/${i}/pasta`, { metodo: 'POST', corpo: {} }),

  destinos: (canal: string, q: string, conta?: string | null) => req<Destino[]>(`/api/destinos?${qs({ canal, q, conta })}`),
  ler: (canal: string, chat: string, n = 30, conta?: string | null) => req<Conversa>(`/api/ler?${qs({ canal, chat, n, conta })}`),
  contexto: (canal: string, destino: string) => req<ContextoDestino>(`/api/contexto?${qs({ canal, destino })}`),
  entrada: () => req<RespostaEntrada>('/api/entrada'),
  entradaVisto: (chave: string, em: number) => req<{ ok: boolean }>('/api/entrada/visto', { metodo: 'POST', corpo: { chave, em } }),
  acompanhar: () => req<RespostaAcompanhar>('/api/acompanhar'),
  cobrar: (chave: string) => req<Mensagem & { ja?: boolean }>('/api/acompanhar/cobrar', { metodo: 'POST', corpo: { chave } }),
  promessa: (id: number, acao: 'cumpri' | 'recebi' | 'dispensar' | 'reabrir' | 'adiar') =>
    req<NonNullable<ItemAcompanhar['promessa']> & { prazo: number; status: string }>(`/api/promessas/${id}/${acao}`, { metodo: 'POST', corpo: {} }),

  relatorio: (dias: number) => req<Relatorio>(`/api/relatorio?dias=${dias}`),
  // lições: chave = virar a sugestão em lição (os campos mudam o que vem dela); sem chave, escrita à mão
  licoes: () => req<RespostaLicoes>('/api/licoes'),
  criarLicao: (campos: CamposLicao & { chave?: string }) => req<Licao>('/api/licoes', { metodo: 'POST', corpo: campos }),
  editarLicao: (id: number, campos: CamposLicao) => req<Licao>(`/api/licoes/${id}`, { metodo: 'PATCH', corpo: campos }),
  ignorarSugestao: (chave: string, desfazer = false) => req<{ ok: boolean }>('/api/licoes/ignorar', { metodo: 'POST', corpo: { chave, desfazer } }),
  config: () => req<Config>('/api/config'),
  async salvarConfig(parcial: Partial<Config>) {
    try {
      return await req<Config>('/api/config', { metodo: 'PUT', corpo: parcial });
    } catch (e) {
      if (rotaNaoExiste(e)) return req<Config>('/api/config', { metodo: 'POST', corpo: parcial });
      throw e;
    }
  },
  pessoas: () => req<Pessoa[]>('/api/pessoas'),
  varrer: () => req<{ sumiram: number[] }>('/api/varrer', { metodo: 'POST', corpo: {} }),
  pausar: () => req<{ pausado: boolean }>('/api/pausar', { metodo: 'POST', corpo: {} }),
  retomar: () => req<{ pausado: boolean }>('/api/retomar', { metodo: 'POST', corpo: {} }),
};

export const urlAnexo = (id: number, i: number, baixar = false) => `/api/mensagens/${id}/anexo/${i}${baixar ? '?baixar=1' : ''}`;

const STATUS_LEGIVEL: Record<string, string> = {
  pendente: 'esperando revisão', aprovada: 'aprovada', enviando: 'saindo agora', enviada: 'já enviada',
  erro: 'com erro', descartada: 'descartada', substituida: 'substituída por outra versão',
};

// o que fazer com uma bloqueada: no toque não existe a tecla E
export const comoCorrigir = () =>
  (window.matchMedia('(pointer: coarse)').matches ? 'Abra a mensagem, corrija e aprove de novo.' : 'Corrija no editor (E) e aprove de novo.');

// Erro em português claro: o que houve e o que fazer.
export function explicar(e: unknown, id?: number): string {
  const alvo = id ? `A #${id}` : 'A mensagem';
  if (!(e instanceof ErroApi)) return `Algo falhou aqui na tela: ${(e as Error)?.message || e}. Recarregue a página.`;
  const { status, corpo } = e;
  if (status === 0) return 'Sem conexão com a Central. Confira se ela está no ar (127.0.0.1:4912) e tente de novo.';
  if (status === 422 && corpo.bloqueios?.length) return `${alvo} está bloqueada: ${comPonto(corpo.bloqueios[0].msg)} ${comoCorrigir()}`;
  if (status === 409 && corpo.erro === 'ja_saiu') {
    return `${alvo} já saiu da janela de desfazer${corpo.status ? ` e está ${STATUS_LEGIVEL[corpo.status] || corpo.status}` : ''}. Não dá mais para voltar.`;
  }
  if (status === 409) return `${alvo} mudou enquanto você olhava${corpo.status ? `: agora está ${STATUS_LEGIVEL[corpo.status] || corpo.status}` : ''}. A tela já foi atualizada.`;
  if (status === 404) return `${alvo} não existe mais. Talvez outra sessão tenha substituído.`;
  if (status === 403) return 'A Central recusou o pedido (proteção de origem). Abra o painel pelo endereço 127.0.0.1:4912.';
  return corpo.erro ? `Não deu certo: ${corpo.erro}.` : `Não deu certo (erro ${status}).`;
}
