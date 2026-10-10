// As abas de mensagens no computador: fila | prévia | contexto (spec, seção 4). O editor ocupa prévia e contexto.
import { useEffect, useMemo, useRef } from 'react';
import { MousePointerClick, X } from 'lucide-react';
import { dados, mensagensDaVista, ui, useSel } from '../lib/loja';
import { preBuscarPrevia } from '../lib/consultas';
import { useMidia } from '../lib/midia';
import { ColunaLista } from '../componentes/ColunaLista';
import { ColunaCentro } from '../componentes/ColunaCentro';
import { ColunaContexto } from '../componentes/ColunaContexto';
import { Editor } from '../componentes/Editor';
import { PainelDescartar } from '../componentes/Paineis';
import { Vazio, Tecla } from '../componentes/ui';
import { Protegido } from '../componentes/Protegido';
import type { Mensagem, VistaLista } from '../lib/tipos';

export function useListaDaVista(vista: VistaLista) {
  const msgs = useSel(dados, (e) => e.msgs);
  const canal = useSel(ui, (e) => e.canal);
  const busca = useSel(ui, (e) => e.busca);
  return useMemo(() => mensagensDaVista(msgs, vista, canal, busca), [msgs, vista, canal, busca]);
}

// mantém sempre uma mensagem selecionada; se a atual sumir (saiu por outra sessão), fica a vizinha
export function useSelecao(vista: VistaLista, lista: Mensagem[]) {
  const sel = useSel(ui, (e) => e.sel[vista]);
  const anterior = useRef<{ ids: number[]; i: number }>({ ids: [], i: 0 });
  const atual = lista.find((m) => String(m.id) === sel) || null;
  useEffect(() => {
    if (atual) {
      anterior.current = { ids: lista.map((m) => m.id), i: lista.indexOf(atual) };
      return;
    }
    if (!lista.length) return;
    const { ids, i } = anterior.current;
    const resto = ids.slice(i).concat(ids.slice(0, i).reverse());
    const vizinha = resto.map((id) => lista.find((m) => m.id === id)).find(Boolean) || lista[Math.min(i, lista.length - 1)];
    ui.set((e) => ({ sel: { ...e.sel, [vista]: String(vizinha!.id) } }));
  }, [atual, lista, vista]);
  // a próxima e a anterior já ficam com a prévia pronta (J/K sem espera)
  useEffect(() => {
    if (!atual) return;
    const i = lista.indexOf(atual);
    preBuscarPrevia(lista[i + 1]);
    preBuscarPrevia(lista[i - 1]);
  }, [atual, lista]);
  return atual;
}

export function TelaMensagens({ vista, buscaRef }: { vista: VistaLista; buscaRef: React.RefObject<HTMLInputElement | null> }) {
  const lista = useListaDaVista(vista);
  const m = useSelecao(vista, lista);
  const editando = useSel(ui, (e) => e.editando);
  const contextoAberto = useSel(ui, (e) => e.contextoAberto);
  const painelLote = useSel(ui, (e) => (e.painel && e.painel.ids.length > 1 ? e.painel : null));
  const largo = useMidia('(min-width: 1180px)');
  const medio = useMidia('(min-width: 1000px)');
  const emEdicao = !!m && editando === m.id;
  // tela estreita: o contexto (I) vira coluna em vez de gaveta por cima, para não cobrir Descartar nem a faixa de pausa.
  // Abaixo de 1000 px não cabem três colunas e ele ocupa o lugar da lista até fechar (I ou Esc).
  const contextoAoLado = !largo && contextoAberto && !!m && !emEdicao;
  const semLista = contextoAoLado && !medio;
  const colunas = largo ? 'grid-cols-[22rem_minmax(0,1fr)_21.5rem]'
    : !contextoAoLado ? 'grid-cols-[20rem_minmax(0,1fr)]'
      : medio ? 'grid-cols-[20rem_minmax(0,1fr)_21.5rem]' : 'grid-cols-[minmax(0,1fr)_21.5rem]';

  return (
    <div className={`grid h-full min-h-0 ${colunas}`}>
      <aside className={`relative min-h-0 border-r border-line ${semLista ? 'hidden' : ''}`} aria-label="Lista">
        <ColunaLista vista={vista} lista={lista} buscaRef={buscaRef} />
        {painelLote && (
          <PainelDescartar ids={painelLote.ids} onFechar={() => ui.set({ painel: null })} className="absolute top-40 left-3 z-30" />
        )}
      </aside>
      {emEdicao ? (
        <main className={`min-h-0 ${largo ? 'col-span-2' : ''}`}><Protegido rotulo="O editor" chave={m.id}><Editor key={m.id} m={m} /></Protegido></main>
      ) : m ? (
        <>
          <main className="relative min-h-0"><Protegido rotulo="A prévia" chave={m.id}><ColunaCentro m={m} contextoVisivel={largo || contextoAoLado} /></Protegido></main>
          {largo ? (
            <aside key={m.id} className="rolagem min-h-0 border-l border-line bg-surface" aria-label="Contexto"><Protegido rotulo="O contexto" chave={m.id}><ColunaContexto m={m} /></Protegido></aside>
          ) : contextoAoLado && (
            <aside className="rolagem anima-aparece min-h-0 border-l border-line bg-surface" aria-label="Contexto">
              <div className="flex items-center justify-between border-b border-line py-2 pr-3 pl-5">
                <span className="font-bold">Contexto</span>
                <button type="button" className="btn btn-fantasma btn-pequeno" onClick={() => ui.set({ contextoAberto: false })} aria-label="Fechar o contexto">
                  <X size={15} strokeWidth={2} aria-hidden /> <Tecla>I</Tecla>
                </button>
              </div>
              <Protegido rotulo="O contexto" chave={m.id}><ColunaContexto m={m} /></Protegido>
            </aside>
          )}
        </>
      ) : (
        <main className={`grid min-h-0 place-items-center bg-sunk ${largo ? 'col-span-2' : ''}`}>
          <Vazio titulo={lista.length ? 'Escolha uma mensagem.' : 'Nada aqui por enquanto.'} icone={<MousePointerClick size={22} strokeWidth={1.75} />}>
            {lista.length ? <p>Use <Tecla>J</Tecla> e <Tecla>K</Tecla> para andar pela lista.</p> : <p>Quando chegar algo, a prévia aparece aqui.</p>}
          </Vazio>
        </main>
      )}
    </div>
  );
}
