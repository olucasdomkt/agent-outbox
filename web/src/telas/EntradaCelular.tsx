// Entrada no celular: a lista e, com um toque, a conversa com a resposta embaixo.
import { useEffect, useReducer, useState } from 'react';
import { BookOpen, CircleAlert, EyeOff, Inbox } from 'lucide-react';
import { carregarEntrada } from '../lib/dados';
import { marcarVisto } from '../lib/acoes';
import { dados, ui, useSel } from '../lib/loja';
import { Esqueleto, Vazio } from '../componentes/ui';
import { Folha } from '../componentes/Folha';
import { TrocaEntrada } from '../componentes/TrocaEntrada';
import { Conversa, ItemDaLista, Resposta, quemEspera, useItensEntrada, rascunhosEntrada, citacoesEntrada } from './Entrada';
import type { ItemEntrada } from '../lib/tipos';

export function TelaEntradaCelular() {
  const entrada = useSel(dados, (e) => e.entrada);
  const estado = useSel(dados, (e) => e.entradaEstado);
  const verTudo = useSel(ui, (e) => e.verTudo);
  const lerTudo = useSel(ui, (e) => e.lerConversa);
  const itens = useItensEntrada();
  const [aberto, setAberto] = useState<ItemEntrada | null>(null);
  const [, mudou] = useReducer((x: number) => x + 1, 0);
  useEffect(() => { if (!entrada) void carregarEntrada(); }, [entrada]);
  const cont = entrada?.contagem;
  const citar = aberto ? (citacoesEntrada.has(aberto.chave) ? citacoesEntrada.get(aberto.chave)! : aberto.citar || null) : null;
  return (
    <div className="flex flex-col gap-3 px-3 pt-3 pb-28">
      <TrocaEntrada celular />
      <div className="grid grid-cols-2 rounded-botao segmentos bg-surface-3 p-0.5" role="group" aria-label="O que mostrar">
        <button type="button" aria-pressed={!verTudo} onClick={() => ui.set({ verTudo: false })} className={`min-h-10 rounded-[6px] text-ui font-semibold ${!verTudo ? 'bg-surface shadow-1' : 'text-tx-2'}`}>É pra você{cont ? ` (${cont.precisa})` : ''}</button>
        <button type="button" aria-pressed={verTudo} onClick={() => ui.set({ verTudo: true })} className={`min-h-10 rounded-[6px] text-ui font-semibold ${verTudo ? 'bg-surface shadow-1' : 'text-tx-2'}`}>Tudo{cont ? ` (${cont.total})` : ''}</button>
      </div>
      {!itens.length && estado === 'carregando' && <div className="px-1"><Esqueleto linhas={5} /></div>}
      {!itens.length && estado === 'erro' && (
        <Vazio titulo="Não consegui ler a Entrada." icone={<CircleAlert size={22} strokeWidth={1.75} />}>Os canais não responderam. A Central tenta de novo sozinha.</Vazio>
      )}
      {!itens.length && estado === 'ok' && <Vazio titulo={verTudo ? 'Nada chegou ainda.' : 'Ninguém espera você agora.'} icone={<Inbox size={22} strokeWidth={1.75} />} />}
      {itens.length > 0 && (
        <div className="flex flex-col gap-1 rounded-painel border border-line bg-surface p-1.5" role="listbox" aria-label="Entrada">
          {itens.map((i) => <ItemDaLista key={i.chave} i={i} selecionado={false} onClick={() => setAberto(i)} />)}
        </div>
      )}
      <Folha aberta={!!aberto} onFechar={() => setAberto(null)} titulo={aberto ? quemEspera(aberto) : ''} cheia>
        {aberto && (
          <div className="flex flex-col gap-4">
            <div className="@container max-h-[52dvh] overflow-y-auto rounded-painel bg-sunk p-2">
              <div className="flex justify-center"><Conversa i={aberto} rascunho={rascunhosEntrada.get(aberto.chave) || ''} citar={citar} onCitar={(c) => { citacoesEntrada.set(aberto.chave, c); mudou(); }} /></div>
            </div>
            <Resposta key={aberto.chave} i={aberto} onMudou={mudou} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" aria-pressed={lerTudo === aberto.chave} onClick={() => ui.set({ lerConversa: lerTudo === aberto.chave ? null : aberto.chave })}>
                <BookOpen size={15} strokeWidth={2} aria-hidden /> {lerTudo === aberto.chave ? 'Só o que chegou' : 'Ler a conversa'}
              </button>
              {aberto.precisa && (
                <button type="button" className="btn" onClick={() => { void marcarVisto(aberto); setAberto(null); }}>
                  <EyeOff size={15} strokeWidth={2} aria-hidden /> Não precisa de mim
                </button>
              )}
            </div>
          </div>
        )}
      </Folha>
    </div>
  );
}
