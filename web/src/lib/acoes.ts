// Ações com resposta imediata na tela (otimista) e volta atrás se o servidor recusar.
import { api, comoCorrigir, ErroApi, explicar, type ResultadoLote } from './api';
import {
  anunciar, avisar, dados, ehVistaLista, emVoo, gravarMensagens, mensagensDaVista, remendar, ui, type Saida,
} from './loja';
import type { Citar, Config, Destino, ItemAcompanhar, ItemEntrada, Mensagem, MotivoCodigo, VistaLista } from './tipos';
import { carregarAcompanhar } from './dados';
import { NOME_MOTIVO } from './motivos';
import { comPonto, quando as quandoTexto } from './formato';
import { esperaDe } from './ordem';

const janela = () => dados.get().config?.janelaDesfazerMs ?? 10_000;
const msg = (id: number) => dados.get().msgs[id];
const para = (m?: Mensagem) => m?.destino_nome || m?.para_pedido || 'destino a escolher';
const segundos = (ms: number) => Math.round(ms / 1000);

function guardar(ids: number[]) {
  const antes = ids.map(msg).filter(Boolean);
  for (const m of antes) emVoo.set(m.id, m.atualizado_em ?? 0);
  return antes;
}
function soltar(ids: number[]) {
  ids.forEach((id) => emVoo.delete(id));
}
function voltar(antes: Mensagem[]) {
  if (!antes.length) return;
  dados.set((e) => ({ msgs: { ...e.msgs, ...Object.fromEntries(antes.map((m) => [m.id, m])) } }));
}
async function recarregar(ids: number[]) {
  const r = await Promise.allSettled(ids.map((id) => api.mensagem(id)));
  ids.forEach((id) => emVoo.delete(id));
  gravarMensagens(r.flatMap((x) => (x.status === 'fulfilled' ? [x.value as Mensagem] : [])));
}

// quando a mensagem selecionada sai da vista, a seleção anda para a próxima
export function seguirEmFrente(ids: number[]) {
  const { vista, sel, canal, busca } = ui.get();
  if (!ehVistaLista(vista)) return;
  const atual = Number(sel[vista]);
  if (!ids.includes(atual)) return;
  const lista = mensagensDaVista(dados.get().msgs, vista, canal, busca);
  const i = lista.findIndex((m) => m.id === atual);
  const alvo = lista.slice(i + 1).find((m) => !ids.includes(m.id)) || lista.slice(0, Math.max(0, i)).reverse().find((m) => !ids.includes(m.id));
  ui.set((e) => ({ sel: { ...e.sel, [vista]: alvo ? String(alvo.id) : undefined }, marcadas: e.marcadas.filter((x) => !ids.includes(x)) }));
}

function abrirSaida(s: Omit<Saida, 'chave'>) {
  const chave = `${s.tipo}:${s.ids.join(',')}:${Date.now()}`;
  const agora = Date.now();
  dados.set((e) => ({ saindo: [...e.saindo.filter((x) => x.ate > agora && !x.ids.some((id) => s.ids.includes(id))), { ...s, chave }] }));
  return chave;
}
function fecharSaida(chave: string) {
  dados.set((e) => ({ saindo: e.saindo.filter((x) => x.chave !== chave) }));
}
function ajustarSaida(chave: string, ate: number) {
  dados.set((e) => ({ saindo: e.saindo.map((x) => (x.chave === chave ? { ...x, ate } : x)) }));
}

function falhasDoLote(resultados: ResultadoLote[]) {
  return resultados.filter((r) => !r.ok);
}
function textoFalhas(falhas: ResultadoLote[], verbo: string) {
  const exemplo = falhas[0];
  const porque = exemplo.bloqueios?.[0]?.msg || (exemplo.status ? `está ${exemplo.status}` : exemplo.erro || 'recusada');
  return falhas.length === 1
    ? `A #${exemplo.id} não deu para ${verbo}: ${porque}`
    : `${falhas.length} não deram para ${verbo} (a #${exemplo.id}: ${porque}). As outras foram.`;
}

// ---------------------------------------------------------------- aprovar (A), agendar (S), tentar de novo

export async function aprovar(ids: number[], opcoes: { agendar?: number | null } = {}) {
  const alvo = ids.map(msg).filter((m) => m && (m.status === 'pendente' || m.status === 'erro'));
  if (!alvo.length) return;
  const travadas = alvo.filter((m) => m.lint?.bloqueios?.length);
  const livres = alvo.filter((m) => !m.lint?.bloqueios?.length);
  if (travadas.length) {
    const m = travadas[0];
    avisar(
      travadas.length === 1 && !livres.length
        ? `A #${m.id} está bloqueada: ${comPonto(m.lint!.bloqueios[0].msg)} ${comoCorrigir()}`
        : `${travadas.length === 1 ? 'A #' + m.id + ' ficou' : travadas.length + ' ficaram'} de fora: ${m.lint!.bloqueios[0].msg}`,
      'erro',
    );
  }
  if (!livres.length) return;
  const ok = livres.map((m) => m.id);
  const agora = Date.now();
  const ate = agora + janela();
  const agendada = opcoes.agendar !== undefined ? opcoes.agendar : livres.length === 1 ? livres[0].agendar_para : null;
  seguirEmFrente(ok);
  const antes = guardar(ok);
  for (const m of livres) {
    remendar(m.id, {
      status: 'aprovada', aprovado_em: agora, liberar_em: ate, ultimo_erro: m.status === 'erro' ? m.ultimo_erro : null,
      ...(opcoes.agendar !== undefined ? { agendar_para: opcoes.agendar } : {}),
    });
  }
  const rotulo = ok.length === 1
    ? `${agendada && agendada > ate ? 'Agendada' : 'Aprovada'} para ${para(livres[0])}`
    : `${ok.length} aprovadas`;
  const curto = ok.length === 1 ? esperaDe(livres[0])?.curto : null;
  const espera = curto ? curto[0].toUpperCase() + curto.slice(1) : null;
  const chave = abrirSaida({
    tipo: opcoes.agendar ? 'agendar' : 'aprovar', ids: ok, ate, rotulo, agendada: agendada && agendada > ate ? agendada : null, espera,
  });
  anunciar(
    espera ? `${rotulo}. ${espera}. Z desfaz.`
      : agendada && agendada > ate
        ? `${rotulo}, sai ${quandoTexto(agendada)}. Z desfaz.`
        : `${rotulo}. Sai em ${segundos(ate - agora)} segundos. Z desfaz.`,
  );
  try {
    if (ok.length === 1) {
      const id = ok[0];
      if (opcoes.agendar !== undefined) await api.agendar(id, opcoes.agendar);
      const r = await api.aprovar(id);
      emVoo.delete(id);
      gravarMensagens([r]);
      if (r.liberar_em) ajustarSaida(chave, r.liberar_em);
    } else {
      const { resultados } = await api.lote('aprovar', ok);
      const falhas = falhasDoLote(resultados);
      soltar(ok);
      if (falhas.length) {
        voltar(antes.filter((m) => falhas.some((f) => f.id === m.id)));
        dados.set((e) => ({ saindo: e.saindo.map((x) => (x.chave === chave ? { ...x, ids: x.ids.filter((id) => !falhas.some((f) => f.id === id)), rotulo: `${ok.length - falhas.length} aprovadas` } : x)) }));
        avisar(textoFalhas(falhas, 'aprovar'), 'erro');
        void recarregar(falhas.map((f) => f.id));
      }
      void recarregar(ok.filter((id) => !falhas.some((f) => f.id === id)));
    }
  } catch (e) {
    soltar(ok);
    voltar(antes);
    fecharSaida(chave);
    avisar(explicar(e, ok.length === 1 ? ok[0] : undefined), 'erro', verDeNovo(ok[0]));
    if (e instanceof ErroApi && (e.status === 409 || e.status === 422)) void recarregar(ok);
  }
}

// botão "Ver" do aviso de falha: abre a mensagem na aba em que ela está agora
const ABA_DO_STATUS: Record<string, VistaLista> = {
  pendente: 'revisar', aprovada: 'fila', enviando: 'fila', enviada: 'enviadas', erro: 'erro', descartada: 'descartadas',
};
function verDeNovo(id: number) {
  return { rotulo: 'Ver', fazer: () => irPara(ABA_DO_STATUS[msg(id)?.status ?? 'pendente'] || 'revisar', id) };
}
// abre a mensagem na aba em que ela está (a anterior de uma sequência, por exemplo)
export const abrirMensagem = (id: number) => verDeNovo(id).fazer();

export const agendar = (id: number, quando: number | null) => aprovar([id], { agendar: quando });

// ---------------------------------------------------------------- descartar (D)

export async function descartar(ids: number[], motivo_codigo: MotivoCodigo | null, motivo?: string) {
  const alvo = ids.map(msg).filter((m) => m && ['pendente', 'erro', 'aprovada'].includes(m.status));
  if (!alvo.length) return;
  const ok = alvo.map((m) => m.id);
  seguirEmFrente(ok);
  const antes = guardar(ok);
  for (const id of ok) remendar(id, { status: 'descartada', motivo_codigo, motivo: motivo || null, liberar_em: null });
  const nomeMotivo = motivo_codigo ? NOME_MOTIVO[motivo_codigo].toLowerCase() : motivo ? motivo : null;
  const rotulo = ok.length === 1 ? `Descartada: ${para(alvo[0])}` : `${ok.length} descartadas`;
  const chave = abrirSaida({ tipo: 'descartar', ids: ok, ate: Date.now() + janela(), rotulo, detalhe: nomeMotivo || 'sem motivo' });
  anunciar(`${rotulo}${nomeMotivo ? `, motivo: ${nomeMotivo}` : ''}. Z desfaz.`);
  try {
    if (ok.length === 1) {
      const r = await api.descartar(ok[0], motivo_codigo, motivo);
      emVoo.delete(ok[0]);
      gravarMensagens([r]);
    } else {
      const { resultados } = await api.lote('descartar', ok, motivo_codigo);
      soltar(ok);
      const falhas = falhasDoLote(resultados);
      if (falhas.length) {
        voltar(antes.filter((m) => falhas.some((f) => f.id === m.id)));
        avisar(textoFalhas(falhas, 'descartar'), 'erro');
      }
      void recarregar(ok);
    }
  } catch (e) {
    soltar(ok);
    voltar(antes);
    fecharSaida(chave);
    avisar(explicar(e, ok.length === 1 ? ok[0] : undefined), 'erro', verDeNovo(ok[0]));
    if (e instanceof ErroApi && e.status === 409) void recarregar(ok);
  }
}

// ---------------------------------------------------------------- desfazer (Z)

export async function desfazer(saida?: Saida) {
  const agora = Date.now();
  const s = saida || [...dados.get().saindo].reverse().find((x) => x.ate > agora);
  if (!s) {
    avisar('Nada para desfazer agora. A janela é de 10 s depois de aprovar ou descartar.');
    return;
  }
  fecharSaida(s.chave);
  const antes = guardar(s.ids);
  for (const id of s.ids) remendar(id, { status: 'pendente', liberar_em: null, aprovado_em: null, motivo_codigo: null, motivo: null });
  // a seleção volta para o que foi desfeito, para você ver de novo
  const { vista } = ui.get();
  if (vista === 'revisar') ui.set((e) => ({ sel: { ...e.sel, revisar: String(s.ids[0]) } }));
  const falhas: { id: number; e: unknown }[] = [];
  await Promise.all(s.ids.map(async (id) => {
    try {
      const r = s.tipo === 'descartar' ? await api.restaurar(id) : await api.desfazer(id);
      if (s.tipo === 'agendar') await api.agendar(id, null).catch(() => null);
      emVoo.delete(id);
      gravarMensagens([s.tipo === 'agendar' ? { ...r, agendar_para: null } : r]);
    } catch (e) {
      falhas.push({ id, e });
    }
  }));
  soltar(s.ids);
  const voltaram = s.ids.length - falhas.length;
  if (voltaram) anunciar(voltaram === 1 && s.ids.length === 1 ? `Desfeito. A #${s.ids[0]} voltou para revisão.` : `Desfeito. ${voltaram} voltaram para revisão.`);
  if (falhas.length) {
    voltar(antes.filter((m) => falhas.some((f) => f.id === m.id)));
    avisar(explicar(falhas[0].e, falhas[0].id), 'erro', verDeNovo(falhas[0].id));
    void recarregar(falhas.map((f) => f.id));
  }
}

// ---------------------------------------------------------------- fila, erro e descartadas

export async function voltarParaRevisao(id: number) {
  const antes = guardar([id]);
  seguirEmFrente([id]);
  remendar(id, { status: 'pendente', liberar_em: null, aprovado_em: null });
  try {
    const r = await api.desfazer(id);
    emVoo.delete(id);
    gravarMensagens([r]);
    avisar(`A #${id} voltou para revisão.`, 'ok');
  } catch (e) {
    soltar([id]);
    voltar(antes);
    avisar(explicar(e, id), 'erro');
    void recarregar([id]);
  }
}

export async function enviarAgora(id: number) {
  const antes = guardar([id]);
  remendar(id, { agendar_para: null, proxima_tentativa: null });
  try {
    const r = await api.agendar(id, null);
    emVoo.delete(id);
    gravarMensagens([r]);
    anunciar(`A #${id} sai assim que a fila andar.`);
  } catch (e) {
    soltar([id]);
    voltar(antes);
    avisar(explicar(e, id), 'erro');
  }
}

export async function restaurar(id: number) {
  const antes = guardar([id]);
  seguirEmFrente([id]);
  remendar(id, { status: 'pendente', motivo_codigo: null, motivo: null });
  try {
    const r = await api.restaurar(id);
    emVoo.delete(id);
    gravarMensagens([r]);
    avisar(`A #${id} voltou para revisão.`, 'ok', { rotulo: 'Ver', fazer: () => irPara('revisar', id) });
  } catch (e) {
    soltar([id]);
    voltar(antes);
    avisar(explicar(e, id), 'erro');
  }
}

// ---------------------------------------------------------------- edição

export async function salvar(id: number, campos: Partial<Mensagem>): Promise<Mensagem | null> {
  try {
    const r = await api.editar(id, campos);
    gravarMensagens([r]);
    return r;
  } catch (e) {
    avisar(explicar(e, id), 'erro');
    if (e instanceof ErroApi && e.status === 409) void recarregar([id]);
    return null;
  }
}

export const trocarDestino = (id: number, d: Destino) =>
  salvar(id, { destino_id: d.id, destino_nome: d.nome, destino_tipo: d.tipo || null, candidatos: null });
export const trocarConta = (id: number, conta: string) => salvar(id, { conta });
export function trocarExtra(id: number, extra: Record<string, unknown>) {
  const m = msg(id);
  return salvar(id, { extra: { ...(m?.extra || {}), ...extra } });
}
export const trocarCitacao = (id: number, citar: Citar | null) => trocarExtra(id, { citar });

// ---------------------------------------------------------------- ordem entre mensagens

// a Central confere (ciclo, descartada, resposta só em conversa direta) e diz o porquê se recusar
async function ordem(id: number, corpo: { depois_de?: number | null; espera_resposta?: boolean }, feito: (r: Mensagem) => string) {
  try {
    const r = await api.ordem(id, corpo);
    gravarMensagens([r]);
    avisar(feito(r), 'ok');
    return r;
  } catch (e) {
    // 404 aqui pode ser a anterior que não existe: o texto da Central diz qual
    const anterior = e instanceof ErroApi && e.status === 404 && /anterior/.test(e.corpo.erro || '');
    avisar(anterior ? `Não deu certo: ${(e as ErroApi).corpo.erro}.` : explicar(e, id), 'erro');
    if (e instanceof ErroApi && e.status === 409) void recarregar([id]);
    return null;
  }
}
export const marcarDepois = (id: number, anterior: number, espera_resposta = false) =>
  ordem(id, { depois_de: anterior, espera_resposta }, (r) => `A #${id} sai depois da #${r.depois_de}${espera_resposta ? ', quando a pessoa responder' : ''}.`);
export const esperarResposta = (id: number, sim: boolean) =>
  ordem(id, { espera_resposta: sim }, (r) => (sim ? `A #${id} só sai depois da resposta à #${r.depois_de}.` : `A #${id} sai logo depois da #${r.depois_de}, sem esperar resposta.`));
export const soltarDaSequencia = (id: number) => ordem(id, { depois_de: null }, () => `A #${id} saiu da sequência: sai sem esperar outra.`);

// ---------------------------------------------------------------- envios e ajustes

export async function alternarPausa() {
  const r = dados.get().resumo;
  if (!r) return;
  const pausar = !r.pausado;
  dados.set({ resumo: { ...r, pausado: pausar } });
  try {
    const x = pausar ? await api.pausar() : await api.retomar();
    dados.set((e) => ({ resumo: e.resumo ? { ...e.resumo, pausado: x.pausado } : e.resumo }));
    avisar(x.pausado ? 'Envios pausados. Nada sai até você retomar.' : 'Envios retomados. A fila volta a andar.', x.pausado ? 'info' : 'ok');
  } catch (e) {
    dados.set((s) => ({ resumo: s.resumo ? { ...s.resumo, pausado: !pausar } : s.resumo }));
    avisar(explicar(e), 'erro');
  }
}

export async function salvarConfig(parcial: Partial<Config>) {
  const antes = dados.get().config;
  if (antes) dados.set({ config: { ...antes, ...parcial } });
  try {
    const r = await api.salvarConfig(parcial);
    dados.set({ config: { ...(antes || ({} as Config)), ...parcial, ...(r && typeof r === 'object' ? r : {}) } });
    if ('sumirRespondidas' in parcial) {
      dados.set((e) => ({ resumo: e.resumo ? { ...e.resumo, sumirRespondidas: !!parcial.sumirRespondidas } : e.resumo }));
    }
    return true;
  } catch (e) {
    if (antes) dados.set({ config: antes });
    avisar(explicar(e), 'erro');
    return false;
  }
}

// ---------------------------------------------------------------- entrada

export async function marcarVisto(item: ItemEntrada) {
  const antes = dados.get().entrada;
  if (antes) {
    dados.set({
      entrada: {
        ...antes,
        itens: antes.itens.map((i) => (i.chave === item.chave ? { ...i, precisa: false, motivo: 'você dispensou' } : i)),
        contagem: { ...antes.contagem, precisa: Math.max(0, antes.contagem.precisa - (item.precisa ? 1 : 0)) },
      },
    });
  }
  try {
    await api.entradaVisto(item.chave, item.em);
    anunciar(`${item.titulo} saiu da lista "É pra você".`);
  } catch (e) {
    if (antes) dados.set({ entrada: antes });
    avisar(explicar(e), 'erro');
  }
}

// `cc` só no e-mail, quando a resposta é para todos: os endereços de quem estava em cópia
export async function responder(item: ItemEntrada, corpo: string, citar: Citar | null, aprovarJa: boolean, cc = '') {
  try {
    const m = await api.criar({
      canal: item.canal,
      conta: item.conta,
      destino_id: item.destino.id,
      destino_nome: item.destino.nome,
      destino_tipo: item.destino.tipo,
      responder_a: `${item.de || item.titulo}: ${(item.texto || '').replace(/\s+/g, ' ').slice(0, 120)}`,
      contexto: `Resposta pela Entrada (${item.titulo})`,
      assunto: item.extra?.assunto,
      corpo,
      extra: { ...(item.extra || {}), entrada: item.chave, citar: citar || undefined, ...(cc ? { cc } : {}) },
      sessao_nome: 'painel',
    });
    gravarMensagens([m]);
    const antes = dados.get().entrada;
    if (antes) {
      dados.set({ entrada: { ...antes, itens: antes.itens.map((i) => (i.chave === item.chave ? { ...i, resposta: { id: m.id, status: m.status } } : i)) } });
    }
    if (aprovarJa) await aprovar([m.id]);
    else avisar(`Resposta #${m.id} foi para revisão.`, 'ok', { rotulo: 'Ver', fazer: () => irPara('revisar', m.id) });
    return m;
  } catch (e) {
    avisar(explicar(e), 'erro');
    return null;
  }
}

// ---------------------------------------------------------------- acompanhar

// tira o item da lista na hora (otimista); devolve o estado de antes para voltar se a Central recusar
function tirarDoAcompanhar(chave: string) {
  const antes = dados.get().acompanhar;
  if (antes) {
    const itens = antes.itens.filter((i) => i.chave !== chave);
    const contagem = { total: itens.length, esperando: itens.filter((i) => i.tipo === 'esperando').length, promessas: itens.filter((i) => i.tipo === 'promessa').length };
    dados.set({ acompanhar: { ...antes, itens, contagem }, acompanharContagem: contagem });
  }
  return antes;
}
function voltarAcompanhar(antes: ReturnType<typeof tirarDoAcompanhar>, e: unknown) {
  if (antes) dados.set({ acompanhar: antes, acompanharContagem: antes.contagem });
  avisar(explicar(e), 'erro');
}

// "Não preciso": some até chegar mensagem nova na conversa (o mesmo visto da Entrada)
export async function naoPreciso(item: ItemAcompanhar) {
  const antes = tirarDoAcompanhar(item.chave);
  try {
    await api.entradaVisto(item.chave, item.em);
    anunciar(`${item.destino.nome} saiu do Acompanhar até chegar mensagem nova.`);
  } catch (e) {
    voltarAcompanhar(antes, e);
  }
}

// Cobrar só cria o rascunho, pendente, como qualquer outra: nada sai sem aprovar
export async function cobrar(item: ItemAcompanhar) {
  try {
    const m = await api.cobrar(item.chave);
    gravarMensagens([m]);
    const antes = dados.get().acompanhar;
    if (antes) dados.set({ acompanhar: { ...antes, itens: antes.itens.map((i) => (i.chave === item.chave ? { ...i, cobranca: { id: m.id, status: m.status } } : i)) } });
    avisar(m.ja ? `A cobrança #${m.id} já estava na Central.` : `Cobrança #${m.id} foi para revisão.`, 'ok',
      { rotulo: 'Ver', fazer: () => irPara(m.status === 'pendente' ? 'revisar' : 'fila', m.id) });
    return m;
  } catch (e) {
    avisar(explicar(e), 'erro');
    return null;
  }
}

const FECHOU = { cumpri: 'cumprida', recebi: 'recebida', dispensar: 'dispensada' } as const;
export async function fecharPromessa(item: ItemAcompanhar, acao: keyof typeof FECHOU) {
  if (!item.promessa) return;
  const id = item.promessa.id;
  const antes = tirarDoAcompanhar(item.chave);
  try {
    await api.promessa(id, acao);
    avisar(`Promessa ${FECHOU[acao]} (${item.destino.nome}).`, 'ok', {
      rotulo: 'Desfazer',
      fazer: () => {
        api.promessa(id, 'reabrir').then(() => carregarAcompanhar(), (e) => avisar(explicar(e), 'erro'));
      },
    });
  } catch (e) {
    voltarAcompanhar(antes, e);
  }
}

export async function adiarPromessa(item: ItemAcompanhar) {
  if (!item.promessa) return;
  try {
    const p = await api.promessa(item.promessa.id, 'adiar');
    await carregarAcompanhar();
    avisar(`Adiada: vence ${quandoTexto(p.prazo)}.`, 'ok');
  } catch (e) {
    avisar(explicar(e), 'erro');
  }
}

// "Acompanhar a resposta" de uma mensagem do WhatsApp (horas; null tira). Não devolve a aprovada para revisão.
export async function acompanharResposta(id: number, horas: number | null) {
  try {
    gravarMensagens([await api.editar(id, { acompanhar: horas })]);
    anunciar(horas ? `#${id}: se não responder em ${horas} h, aparece no Acompanhar.` : `#${id} não é mais acompanhada.`);
  } catch (e) {
    avisar(explicar(e), 'erro');
  }
}

// ---------------------------------------------------------------- navegação

export function irPara(vista: import('./tipos').Vista, id?: number | string) {
  ui.set((e) => ({
    vista, editando: null, painel: null, comparando: null, detalheCelular: id !== undefined ? true : e.detalheCelular,
    sel: id !== undefined ? { ...e.sel, [vista]: String(id) } : e.sel,
  }));
}
