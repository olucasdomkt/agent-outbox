// Cache das leituras pesadas (prévia, contexto, histórico, conversa): só o cartão aberto busca,
// e o valor anterior continua na tela enquanto o novo chega (nada pisca ao andar com J/K).
import { useEffect, useReducer } from 'react';
import { api } from './api';
import type { ContextoDestino, Conversa, Evento, Lint, Mensagem, Previa, Versao } from './tipos';

interface Entrada { em: number; valor?: unknown; erro?: unknown; promessa?: Promise<void> }
const cache = new Map<string, Entrada>();
const ultimos = new Map<string, unknown>();
const MAX = 300;

function buscar<T>(chave: string, fn: () => Promise<T>, manter?: string, validade = Infinity): Entrada {
  const c = cache.get(chave);
  if (c && (c.promessa || Date.now() - c.em < validade)) return c;
  const e: Entrada = { em: Date.now(), valor: c?.valor };
  e.promessa = fn().then(
    (v) => {
      e.valor = v;
      e.erro = undefined;
      e.em = Date.now();
      if (manter) ultimos.set(manter, v);
    },
    (err) => { e.erro = err; },
  ).finally(() => { e.promessa = undefined; });
  cache.set(chave, e);
  if (cache.size > MAX) cache.delete(cache.keys().next().value as string);
  return e;
}

export function useConsulta<T>(chave: string | null, fn: () => Promise<T>, opcoes: { manter?: string; validade?: number } = {}) {
  const [, forcar] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    const e = buscar(chave, fn, opcoes.manter, opcoes.validade);
    e.promessa?.then(() => vivo && forcar());
    return () => { vivo = false; };
    // fn muda a cada render; a chave é o que importa
  }, [chave]);
  const e = chave ? cache.get(chave) : undefined;
  const valor = (e?.valor ?? (opcoes.manter ? ultimos.get(opcoes.manter) : undefined) ?? null) as T | null;
  return { dados: valor, carregando: !!e?.promessa, erro: e?.erro ?? null, recente: e?.valor !== undefined };
}

export const chavePrevia = (m: Pick<Mensagem, 'id' | 'atualizado_em'>) => `previa:${m.id}:${m.atualizado_em}`;

// sem destino o servidor não monta prévia (400): vale a local até escolherem o destino
const temPrevia = (m: Mensagem | null | undefined): m is Mensagem => !!m?.destino_id;
export function usePrevia(m: Mensagem | null | undefined) {
  const ok = temPrevia(m);
  return useConsulta<Previa>(ok ? chavePrevia(m) : null, () => api.previa(m!.id), { manter: ok ? `previa:${m.id}` : undefined });
}
export function preBuscarPrevia(m: Mensagem | undefined) {
  if (temPrevia(m)) buscar(chavePrevia(m), () => api.previa(m.id), `previa:${m.id}`);
}
export function useContexto(m: Mensagem | null | undefined) {
  const ok = m && m.destino_id;
  return useConsulta<ContextoDestino>(ok ? `contexto:${m!.canal}:${m!.destino_id}` : null, () => api.contexto(m!.canal, m!.destino_id!), { validade: 60_000 });
}
export function useEventos(m: Mensagem | null | undefined) {
  return useConsulta<Mensagem & { eventos: Evento[] }>(m ? `eventos:${m.id}:${m.atualizado_em}` : null, () => api.mensagem(m!.id), { manter: m ? `eventos:${m.id}` : undefined });
}
export function useVersoes(m: Mensagem | null | undefined) {
  return useConsulta<Versao[]>(m && m.substitui_id ? `versoes:${m.id}:${m.atualizado_em}` : null, () => api.versoes(m!.id));
}
export function useLer(canal: string | null, chat: string | null, n: number, conta?: string | null) {
  return useConsulta<Conversa>(canal && chat ? `ler:${canal}:${chat}:${n}:${conta || ''}` : null, () => api.ler(canal!, chat!, n, conta), { validade: 60_000 });
}
export function esquecer(prefixo: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(prefixo)) cache.delete(k);
}

// servidor antigo não manda o lint na linha: pede ao /api/lint
export function useLint(m: Mensagem | null | undefined): Lint | null {
  const falta = !!m && !m.lint;
  const { dados } = useConsulta<Lint>(falta ? `lint:${m!.id}:${m!.atualizado_em}` : null, () => api.lint({
    id: m!.id, canal: m!.canal, destino_id: m!.destino_id, destino_nome: m!.destino_nome, cliente: m!.cliente, assunto: m!.assunto, corpo: m!.corpo,
  }));
  return m?.lint || dados;
}
