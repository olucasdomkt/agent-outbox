// Coluna da esquerda: a fila agrupada por cliente e destino (em "Para revisar") ou por estado nas outras abas.
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, Inbox, Layers, OctagonX, Paperclip, PenLine, Search, SquareCheck, TriangleAlert, Users, X } from 'lucide-react';
import { Glifo, GlifoOuFoto, NOME_CANAL, faixaDoTamanho, useCanais } from '../lib/canais';
import { agruparRevisar, dados, ui, useSel, type GrupoCliente } from '../lib/loja';
import { curto, ha, numero, plural, quando } from '../lib/formato';
import { textoLimpo } from '../lib/whatsapp';
import { useAgora } from '../lib/tempo';
import { aprovar } from '../lib/acoes';
import { devolverFoco } from '../lib/foco';
import { SeloEstado } from './Estado';
import { SeloOrdem } from './Ordem';
import { Tecla, Vazio, Esqueleto } from './ui';
import type { Canal, Mensagem, VistaLista } from '../lib/tipos';

export const TITULO_VISTA: Record<VistaLista, string> = {
  revisar: 'Para revisar', fila: 'Na fila', enviadas: 'Entregues', erro: 'Com erro', descartadas: 'Descartadas',
};

function Sinais({ m }: { m: Mensagem }) {
  const agora = useAgora(60_000);
  const n = m.corpo.length;
  const faixa = faixaDoTamanho(m.canal, n);
  const bloqueios = m.lint?.bloqueios?.length || 0;
  const avisos = (m.lint?.avisos || []).filter((a) => a.regra !== 'tamanho').length;
  return (
    <span className="flex flex-none items-center gap-2.5">
      {bloqueios > 0 && <span className="inline-flex items-center gap-0.5 font-semibold text-danger" title={m.lint!.bloqueios[0].msg}><OctagonX size={13} strokeWidth={2.2} aria-hidden /><span className="sr-only">bloqueada</span></span>}
      {avisos > 0 && <span className="inline-flex items-center gap-0.5 font-semibold text-warn" title={m.lint!.avisos.map((a) => a.msg).join('\n')}><TriangleAlert size={13} strokeWidth={2.2} className="text-warn-icon" aria-hidden />{avisos}<span className="sr-only"> avisos</span></span>}
      {faixa !== 'ok' && <span className="tabular font-semibold text-warn" title={`${numero(n)} caracteres`}>{n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : n} car.</span>}
      {m.agendar_para && m.agendar_para > agora && <span className="inline-flex items-center gap-0.5 text-accent-tx" title={`Agendada para ${quando(m.agendar_para, agora)}`}><CalendarClock size={13} strokeWidth={2} aria-hidden /><span className="sr-only">agendada</span></span>}
      {(m.anexos?.length || 0) > 0 && <span className="inline-flex items-center text-tx-3" title={plural(m.anexos!.length, 'anexo', 'anexos')}><Paperclip size={13} strokeWidth={2} aria-hidden />{m.anexos!.length > 1 ? m.anexos!.length : ''}</span>}
      {m.corpo !== m.corpo_original && <span className="text-tx-3" title="Você editou"><PenLine size={13} strokeWidth={2} aria-hidden /><span className="sr-only">editada</span></span>}
      {m.substitui_id && <span className="text-tx-3" title={`Versão nova da #${m.substitui_id}`}><Layers size={13} strokeWidth={2} aria-hidden /><span className="sr-only">versão nova</span></span>}
    </span>
  );
}

interface PropsItem { m: Mensagem; vista: VistaLista; selecionada: boolean; marcada: boolean; modoLote: boolean; animar: boolean; onClick: (e: React.MouseEvent) => void }

const ItemMensagem = forwardRef<HTMLDivElement, PropsItem>(function ItemMensagem({ m, vista, selecionada, marcada, modoLote, animar, onClick }, ref) {
  const agora = useAgora(30_000);
  // só anima o que chega depois de a lista abrir (SSE, desfazer); trocar de aba ou andar com J/K não pisca
  const [entra] = useState(animar);
  const resumo = textoLimpo(m.canal === 'email' && m.assunto ? `${m.assunto}: ${m.corpo}` : m.corpo);
  return (
    <div
      ref={ref}
      id={`msg-${m.id}`}
      role="option"
      // no lote, "selecionada" é o que está marcado; fora dele, é a mensagem aberta
      aria-selected={modoLote ? marcada : selecionada}
      data-atual={selecionada}
      data-marcada={marcada}
      className={`item cursor-pointer ${entra ? 'item-entra' : ''}`}
      onClick={onClick}
    >
      <span className="relative mt-0.5 flex h-5 items-center justify-center">
        {marcada ? <SquareCheck size={18} strokeWidth={2} className="text-accent" aria-label="marcada" />
          : modoLote ? <span className="size-4 rounded-[4px] border-[1.5px] border-line-campo" aria-hidden />
            : <GlifoOuFoto canal={m.canal} jid={m.destino_id} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate font-bold ${m.destino_id ? 'text-tx' : 'text-danger'}`}>{m.destino_nome || (m.para_pedido ? `“${m.para_pedido}”?` : 'Sem destino')}</span>
          <span className="flex-none text-meta text-tx-3 tabular">{curto(vista === 'enviadas' && m.enviado_em ? m.enviado_em : vista === 'revisar' ? m.criado_em : m.atualizado_em, agora)}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 text-ui text-tx-2">{resumo || <em className="text-tx-3">sem texto</em>}</span>
        {/* na aprovada quem diz o que ela espera é o selo de estado */}
        {m.status !== 'aprovada' && <SeloOrdem m={m} className="mt-1" />}
        <span className="mt-1.5 flex items-center justify-between gap-2 text-meta text-tx-3">
          {vista === 'revisar' ? <span className="min-w-0 truncate">{m.sessao_nome || 'sessão sem nome'}</span> : <SeloEstado m={m} tamanho={13} className="min-w-0 truncate text-meta" />}
          <Sinais m={m} />
        </span>
      </span>
    </div>
  );
});

function Filtros({ lista }: { lista: Mensagem[] }) {
  const canal = useSel(ui, (e) => e.canal);
  const contagem = useMemo(() => {
    const c: Partial<Record<Canal, number>> = {};
    for (const m of lista) c[m.canal] = (c[m.canal] || 0) + 1;
    return c;
  }, [lista]);
  const escolher = (c: Canal | '') => {
    ui.set({ canal: c });
    try { localStorage.setItem('central:canal', c); } catch { /* sem storage */ }
  };
  const canais = useCanais();
  const ligados = useSel(dados, (e) => e.resumo?.canais);
  // filtro guardado de um canal que não está mais ligado esconderia a lista inteira
  useEffect(() => { if (ligados && canal && !ligados.some((c) => c.id === canal)) escolher(''); }, [ligados, canal]);
  if (canais.length < 2) return null; // um canal só: não há o que filtrar
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por canal">
      <button type="button" className={`etiqueta h-7 px-2.5 ${!canal ? 'bg-tx text-bg' : 'hover:bg-line'}`} aria-pressed={!canal} onClick={() => escolher('')}>Todos</button>
      {canais.map((c) => (
        <button
          key={c}
          type="button"
          className={`etiqueta h-7 gap-1.5 px-2.5 disabled:cursor-default disabled:opacity-55 ${canal === c ? 'bg-tx text-bg' : 'enabled:hover:bg-line'}`}
          disabled={!contagem[c] && canal !== c}
          aria-pressed={canal === c}
          aria-label={`${NOME_CANAL[c]}: ${contagem[c] || 0}`}
          onClick={() => escolher(canal === c ? '' : c)}
        >
          <Glifo canal={c} tamanho={13} className={canal === c ? 'text-bg!' : ''} />
          <span className="tabular">{contagem[c] || 0}</span>
        </button>
      ))}
    </div>
  );
}

export const CampoBusca = forwardRef<HTMLInputElement, object>(function CampoBusca(_, ref) {
  const busca = useSel(ui, (e) => e.busca);
  return (
    <label className="relative block">
      <Search size={15} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tx-3" aria-hidden />
      <input
        ref={ref}
        type="search"
        className="campo h-8 pr-14 pl-8 text-ui"
        placeholder="Buscar texto, pessoa ou sessão"
        aria-label="Buscar nesta lista"
        value={busca}
        onChange={(e) => ui.set({ busca: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); ui.set({ busca: '' }); (e.target as HTMLInputElement).blur(); devolverFoco(); }
          if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); (e.target as HTMLInputElement).blur(); devolverFoco(); }
        }}
      />
      {busca ? (
        <button type="button" className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-full text-tx-3 hover:bg-surface-3" onClick={() => ui.set({ busca: '' })} aria-label="Limpar busca">
          <X size={14} strokeWidth={2} />
        </button>
      ) : (
        <Tecla className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">/</Tecla>
      )}
    </label>
  );
});

function BarraLote({ marcadas, vista }: { marcadas: number[]; vista: VistaLista }) {
  if (!marcadas.length) return null;
  return (
    <div className="anima-sobe mx-3 mb-2 flex flex-col gap-2 rounded-item border border-accent-line bg-accent-soft p-2.5 pl-3" role="region" aria-label="Ações em lote">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-accent-tx tabular">{plural(marcadas.length, 'marcada', 'marcadas')}</span>
        <button type="button" className="btn btn-fantasma btn-pequeno h-7 px-2 text-meta" onClick={() => ui.set({ marcadas: [] })}>
          <X size={13} strokeWidth={2.2} aria-hidden /> Desmarcar <Tecla>Esc</Tecla>
        </button>
      </div>
      <div className={`grid gap-1.5 ${vista === 'revisar' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {vista === 'revisar' && (
          <button type="button" className="btn btn-principal btn-pequeno" onClick={() => aprovar(marcadas)}>
            <Check size={14} strokeWidth={2.4} aria-hidden /> Aprovar <Tecla>⇧A</Tecla>
          </button>
        )}
        <button type="button" className="btn btn-pequeno btn-perigo" onClick={() => ui.set({ painel: { tipo: 'descartar', ids: marcadas } })}>
          Descartar <Tecla>⇧D</Tecla>
        </button>
      </div>
    </div>
  );
}

export const VAZIO: Record<VistaLista, { titulo: string; texto: string }> = {
  revisar: { titulo: 'Nada para revisar.', texto: 'Quando uma sessão rodar msg add, a mensagem aparece aqui na hora, já com a prévia.' },
  fila: { titulo: 'Fila vazia.', texto: 'O que você aprovar passa por aqui antes de sair: primeiro os 10 s de desfazer, depois o intervalo do canal.' },
  enviadas: { titulo: 'Nada entregue nesta lista.', texto: 'Entregue aparece só quando o canal confirma o envio.' },
  erro: { titulo: 'Nenhum envio com erro.', texto: 'Se algo falhar, aparece aqui com o motivo e o botão de tentar de novo.' },
  descartadas: { titulo: 'Nenhuma descartada.', texto: 'O que você descartar fica aqui, com o motivo, e dá para restaurar.' },
};

export function ColunaLista({ vista, lista, buscaRef }: { vista: VistaLista; lista: Mensagem[]; buscaRef: React.RefObject<HTMLInputElement | null> }) {
  const sel = useSel(ui, (e) => e.sel[vista]);
  const marcadas = useSel(ui, (e) => e.marcadas);
  const canal = useSel(ui, (e) => e.canal);
  const busca = useSel(ui, (e) => e.busca);
  const estado = useSel(dados, (e) => e.estadoVista[vista]);
  const todasDaVista = useSel(dados, (e) => e.msgs);
  const precisaEntrada = useSel(dados, (e) => e.entradaContagem?.precisa || 0);
  const agora = useAgora(60_000);
  const refs = useRef(new Map<number, HTMLDivElement>());
  const montada = useRef(false);
  useEffect(() => { montada.current = true; }, []);

  const semFiltro = useMemo(() => {
    const status = { revisar: ['pendente'], fila: ['aprovada', 'enviando'], enviadas: ['enviada'], erro: ['erro'], descartadas: ['descartada'] }[vista];
    return Object.values(todasDaVista).filter((m) => status.includes(m.status));
  }, [todasDaVista, vista]);

  const grupos: GrupoCliente[] | null = useMemo(() => (vista === 'revisar' ? agruparRevisar(lista) : null), [lista, vista]);

  useEffect(() => {
    const el = sel ? refs.current.get(Number(sel)) : null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const clicar = (m: Mensagem) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || marcadas.length) {
      ui.set((s) => ({ marcadas: s.marcadas.includes(m.id) ? s.marcadas.filter((x) => x !== m.id) : [...s.marcadas, m.id], sel: { ...s.sel, [vista]: String(m.id) } }));
      return;
    }
    ui.set((s) => ({ sel: { ...s.sel, [vista]: String(m.id) }, detalheCelular: true, comparando: null }));
  };
  const item = (m: Mensagem) => (
    <ItemMensagem
      key={m.id}
      ref={(el) => { if (el) refs.current.set(m.id, el); else refs.current.delete(m.id); }}
      m={m}
      vista={vista}
      selecionada={String(m.id) === sel}
      marcada={marcadas.includes(m.id)}
      modoLote={marcadas.length > 0}
      animar={montada.current}
      onClick={clicar(m)}
    />
  );

  const maisAntiga = vista === 'revisar' && semFiltro.length ? Math.min(...semFiltro.map((m) => m.criado_em)) : null;
  const total = semFiltro.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 px-4 pt-5 pb-3">
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-sub font-bold text-tx-2">{TITULO_VISTA[vista]}</h1>
          <span className="font-num text-[1.5rem] leading-none font-bold text-tx tabular" aria-label={plural(total, 'mensagem', 'mensagens')}>{numero(total)}</span>
        </div>
        {/* a linha existe antes dos dados chegarem, para a busca não descer quando eles chegam */}
        {vista === 'revisar' && <p className="-mt-2 min-h-[1lh] text-meta text-tx-3">{maisAntiga ? `A mais antiga chegou ${ha(maisAntiga, agora)}.` : ''}</p>}
        <CampoBusca ref={buscaRef} />
        <Filtros lista={semFiltro} />
      </div>
      <BarraLote marcadas={marcadas} vista={vista} />
      {!lista.length && (
      <div className="rolagem min-h-0 flex-1 px-2 pb-24">
        {estado === 'carregando' && <div className="px-3 py-2"><Esqueleto linhas={6} /></div>}
        {estado === 'erro' && (
          <Vazio titulo="Não consegui carregar." icone={<TriangleAlert size={22} strokeWidth={1.75} />}>A Central não respondeu. Ela tenta de novo sozinha a cada 5 s.</Vazio>
        )}
        {estado !== 'carregando' && estado !== 'erro' && (
          (busca || canal) ? (
            <Vazio titulo={busca ? `Nada com “${busca}”.` : `Nada de ${NOME_CANAL[canal as Canal]} aqui.`}>
              <button type="button" className="btn btn-pequeno mt-1" onClick={() => ui.set({ busca: '', canal: '' })}>Limpar filtros</button>
            </Vazio>
          ) : (
            <Vazio titulo={VAZIO[vista].titulo} icone={<Inbox size={22} strokeWidth={1.75} />}>
              <p>{VAZIO[vista].texto}</p>
              {vista === 'revisar' && precisaEntrada > 0 && (
                <button type="button" className="btn btn-pequeno mt-3" onClick={() => ui.set({ vista: 'entrada' })}>
                  {plural(precisaEntrada, 'conversa espera', 'conversas esperam')} você na Entrada
                </button>
              )}
            </Vazio>
          )
        )}
      </div>
      )}
      {lista.length > 0 && (
      <div
        className="rolagem min-h-0 flex-1 px-2 pb-24"
        role="listbox"
        aria-label={TITULO_VISTA[vista]}
        aria-multiselectable={marcadas.length > 0}
        aria-activedescendant={sel ? `msg-${sel}` : undefined}
        tabIndex={0}
      >
        {grupos ? grupos.map((g) => (
          <section key={g.cliente} role="group" aria-label={g.cliente} className="mb-1">
            <h2 aria-hidden className="sticky top-0 z-10 flex items-center justify-between bg-bg px-3 pt-3 pb-1.5 text-meta font-bold text-tx-2 shadow-[0_1px_0_var(--line)]">
              <span>{g.cliente}</span>
              <span className="text-tx-3 tabular">{g.destinos.reduce((s, d) => s + d.itens.length, 0)}</span>
            </h2>
            {g.destinos.map((d) => d.itens.length > 1 ? (
              <div key={d.chave} role="group" aria-label={`${d.itens.length} para ${d.nome}: leia todas antes de aprovar`} className="-mx-[5px] my-1 rounded-painel border border-warn-line p-1">
                <p aria-hidden className="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-meta font-semibold text-warn">
                  <Users size={13} strokeWidth={2} aria-hidden /> {d.itens.length} para {d.nome}: leia todas antes de aprovar
                </p>
                {d.itens.map(item)}
              </div>
            ) : item(d.itens[0]))}
          </section>
        )) : lista.map(item)}
      </div>
      )}
    </div>
  );
}
