// Barra de cima: as abas (com # no endereço), a saúde dos canais ligados (e da cópia de segurança),
// ao vivo, pausa e Cmd+K.
import { useMemo } from 'react';
import { ChartColumn, GraduationCap, Mailbox, Pause, Play, Settings2, TriangleAlert } from 'lucide-react';
import { alternarPausa } from '../lib/acoes';
import { dados, ui, useSel } from '../lib/loja';
import { Glifo, NOME_CANAL, useCanais } from '../lib/canais';
import { numero } from '../lib/formato';
import { Dica, Tecla } from './ui';
import type { Vista } from '../lib/tipos';

export const ABAS: { vista: Vista; rotulo: string }[] = [
  { vista: 'revisar', rotulo: 'Para revisar' },
  { vista: 'entrada', rotulo: 'Entrada' },
  { vista: 'fila', rotulo: 'Na fila' },
  { vista: 'enviadas', rotulo: 'Entregues' },
  { vista: 'erro', rotulo: 'Com erro' },
  { vista: 'descartadas', rotulo: 'Descartadas' },
];

export function useContagens() {
  const msgs = useSel(dados, (e) => e.msgs);
  const resumo = useSel(dados, (e) => e.resumo);
  const entrada = useSel(dados, (e) => e.entradaContagem);
  const acompanhar = useSel(dados, (e) => e.acompanharContagem?.total ?? 0);
  const estado = useSel(dados, (e) => e.estadoVista);
  return useMemo(() => {
    const local = { pendente: 0, fila: 0, erro: 0 };
    for (const m of Object.values(msgs)) {
      if (m.status === 'pendente') local.pendente++;
      else if (m.status === 'aprovada' || m.status === 'enviando') local.fila++;
      else if (m.status === 'erro') local.erro++;
    }
    const c = resumo?.contagens || {};
    return {
      revisar: estado.revisar === 'ok' ? local.pendente : c.pendente ?? 0,
      fila: estado.fila === 'ok' ? local.fila : (c.aprovada ?? 0) + (c.enviando ?? 0),
      erro: estado.erro === 'ok' ? local.erro : c.erro ?? 0,
      entrada: entrada?.precisa ?? 0,
      acompanhar,
    } as Partial<Record<Vista, number>>;
  }, [msgs, resumo, entrada, acompanhar, estado]);
}

function Saude() {
  const saude = useSel(dados, (e) => e.saude);
  const canais = useCanais();
  const fora = canais.filter((c) => saude?.[c] && !saude[c]!.ok);
  const copia = saude?.copia;
  return (
    <Dica
      texto={
        <span className="flex flex-col gap-1 py-0.5">
          {canais.map((c) => (
            <span key={c}>
              <span className="font-bold">{NOME_CANAL[c]}:</span> {saude?.[c]?.resumo || 'sem notícia'}
              {saude?.[c] && !saude[c]!.ok && saude[c]!.acao ? <span className="block font-normal opacity-80">{saude[c]!.acao}</span> : null}
            </span>
          ))}
          {copia && <span className={copia.aviso ? 'font-bold' : 'font-normal opacity-80'}>{copia.resumo}</span>}
        </span>
      }
    >
      <button
        type="button"
        className="flex h-8 items-center gap-2 rounded-botao px-2 hover:bg-surface-2"
        aria-label={`${fora.length ? `Canais fora: ${fora.map((c) => NOME_CANAL[c]).join(', ')}` : canais.length === 1 ? `${NOME_CANAL[canais[0]]} no ar` : `Os ${canais.length} canais estão no ar`}${copia?.aviso ? `. ${copia.resumo}` : ''}`}
        onClick={() => ui.set({ vista: 'ajustes' })}
      >
        <span className="flex items-center gap-1.5">
          {canais.map((c) => {
            const ok = !saude?.[c] || saude[c]!.ok;
            return (
              <span key={c} className={`relative ${ok ? '' : 'opacity-45 grayscale'}`}>
                <Glifo canal={c} tamanho={15} />
                {!ok && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-danger ring-2 ring-surface" aria-hidden />}
              </span>
            );
          })}
        </span>
        {fora.length > 0 && (
          <span className="text-meta font-bold text-danger max-xl:sr-only">{fora.length === 1 ? `${NOME_CANAL[fora[0]]} fora` : `${fora.length} canais fora`}</span>
        )}
        {/* cópia de segurança que falhou ou atrasou: o detalhe está na dica e em Ajustes */}
        {copia?.aviso && <TriangleAlert size={14} strokeWidth={2.2} className="text-warn-icon" aria-hidden />}
      </button>
    </Dica>
  );
}

function AoVivo() {
  const conexao = useSel(dados, (e) => e.conexao);
  const rotulo = conexao === 'ao-vivo' ? 'Ao vivo' : conexao === 'reconectando' ? 'Reconectando' : 'Conectando';
  return (
    <span className={`flex items-center gap-1.5 text-meta font-semibold ${conexao === 'ao-vivo' ? 'text-tx-3' : 'text-warn'}`} role="status" aria-live="polite">
      <span className={`size-1.5 rounded-full ${conexao === 'ao-vivo' ? 'bg-ok' : 'vivo-ponto bg-warn-icon'}`} aria-hidden />
      <span className={conexao === 'ao-vivo' ? 'max-xl:sr-only' : ''}>{rotulo}</span>
    </span>
  );
}

export function Topo() {
  const vista = useSel(ui, (e) => e.vista);
  const pausado = useSel(dados, (e) => !!e.resumo?.pausado);
  const n = useContagens();
  const ir = (v: Vista) => ui.set({ vista: v, editando: null, painel: null, comparando: null, marcadas: [] });
  return (
    <header className="relative z-20 flex h-[3.25rem] flex-none items-center gap-5 border-b border-line bg-surface px-4 max-xl:gap-3">
      <a href="#revisar" className="flex flex-none items-center gap-2 rounded-botao pr-1" onClick={(e) => { e.preventDefault(); ir('revisar'); }}>
        <span className="grid size-7 place-items-center rounded-botao bg-accent text-accent-fg"><Mailbox size={17} strokeWidth={2} aria-hidden /></span>
        <span className="text-sub font-extrabold tracking-[-0.01em] max-xl:sr-only">Central</span>
      </a>
      <nav className="flex h-full min-w-0 items-stretch gap-0.5 overflow-x-auto" aria-label="Abas" data-rola-lado>
        {ABAS.map((a) => {
          const qtd = n[a.vista];
          // a Entrada tem duas abas dentro (Chegou e Acompanhar): a pílula de contorno é a do Acompanhar
          const ativa = vista === a.vista || (a.vista === 'entrada' && vista === 'acompanhar');
          const parado = a.vista === 'entrada' ? n.acompanhar : 0;
          return (
            <a
              key={a.vista}
              href={`#${a.vista}`}
              aria-current={ativa ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); ir(a.vista); }}
              className={`relative flex flex-none items-center gap-1.5 px-2.5 text-ui font-semibold transition-colors focus-visible:-outline-offset-2 ${ativa ? 'text-tx' : 'text-tx-3 hover:text-tx'}`}
            >
              {a.rotulo}
              {qtd ? (
                <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-meta leading-none font-bold tabular ${a.vista === 'erro' ? 'bg-danger text-[var(--accent-fg)]' : ativa ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-tx-2'}`}>
                  {numero(qtd)}
                </span>
              ) : null}
              {parado ? (
                <span className="min-w-5 rounded-full px-1.5 py-0.5 text-center text-meta leading-none font-bold text-tx-2 tabular shadow-[inset_0_0_0_1px_var(--line-strong)]">
                  <span aria-hidden>{numero(parado)}</span><span className="sr-only">, e {numero(parado)} para acompanhar</span>
                </span>
              ) : null}
              {ativa && <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden />}
            </a>
          );
        })}
      </nav>
      <div className="ml-auto flex flex-none items-center gap-1.5">
        <AoVivo />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <Saude />
        <button type="button" className={`btn btn-pequeno ${pausado ? 'border-warn-line bg-warn-soft text-warn' : 'btn-fantasma'}`} onClick={() => alternarPausa()} aria-pressed={pausado}>
          {pausado ? <Play size={14} strokeWidth={2.2} aria-hidden /> : <Pause size={14} strokeWidth={2.2} aria-hidden />}
          <span className="max-xl:sr-only">{pausado ? 'Retomar envios' : 'Pausar envios'}</span>
        </button>
        <Dica texto="Lições"><a href="#licoes" className={`btn btn-fantasma btn-icone ${vista === 'licoes' ? 'bg-surface-2' : ''}`} aria-label="Lições" aria-current={vista === 'licoes' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); ir('licoes'); }}><GraduationCap size={17} strokeWidth={1.75} /></a></Dica>
        <Dica texto="Relatório"><a href="#relatorio" className={`btn btn-fantasma btn-icone ${vista === 'relatorio' ? 'bg-surface-2' : ''}`} aria-label="Relatório" aria-current={vista === 'relatorio' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); ir('relatorio'); }}><ChartColumn size={17} strokeWidth={1.75} /></a></Dica>
        <Dica texto="Ajustes"><a href="#ajustes" className={`btn btn-fantasma btn-icone ${vista === 'ajustes' ? 'bg-surface-2' : ''}`} aria-label="Ajustes" aria-current={vista === 'ajustes' ? 'page' : undefined} onClick={(e) => { e.preventDefault(); ir('ajustes'); }}><Settings2 size={17} strokeWidth={1.75} /></a></Dica>
        <button type="button" className="btn btn-pequeno" onClick={() => ui.set({ paleta: true })} aria-label="Comandos: ir para, fazer ou procurar">
          <span className="max-xl:sr-only">Comandos</span> <Tecla>⌘K</Tecla>
        </button>
      </div>
    </header>
  );
}

export function FaixaPausa() {
  const pausado = useSel(dados, (e) => !!e.resumo?.pausado);
  const segredos = useSel(dados, (e) => e.saude?.segredos);
  if (!pausado && !segredos?.bloqueia) return null;
  // sem a faixa do cofre todo aprovar volta recusado e a tela não diz por quê
  const porque = segredos?.lendo ? 'lendo o cofre agora' : segredos?.erro || `${segredos?.falhas.length ?? 0} de ${segredos?.total ?? 0} segredos sem leitura`;
  return (
    <>
      {segredos?.bloqueia ? (
        <div className="flex flex-none items-center justify-center gap-3 border-b border-warn-line bg-warn-soft px-4 py-2 text-ui text-warn" role="alert">
          <span className="font-semibold">Aprovação travada: não consegui conferir segredos ({porque}). Nada é aprovado até o cofre responder.</span>
        </div>
      ) : null}
      {pausado ? (
        <div className="flex flex-none items-center justify-center gap-3 border-b border-warn-line bg-warn-soft px-4 py-2 text-ui text-warn" role="status">
          <Pause size={15} strokeWidth={2.2} aria-hidden />
          <span className="font-semibold">Envios pausados. Nada sai até você retomar; aprovar continua valendo.</span>
          <button type="button" className="btn btn-pequeno" onClick={() => alternarPausa()}>Retomar</button>
        </div>
      ) : null}
    </>
  );
}
