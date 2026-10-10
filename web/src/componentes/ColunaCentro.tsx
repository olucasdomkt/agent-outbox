// Coluna do meio: para quem vai, a prévia fiel no canal certo e a barra de decisão (A, E, S, D).
import { Ban, CalendarClock, Check, Copy, OctagonX, PanelRight, Pencil, RotateCcw, Send, Trash, Undo2 } from 'lucide-react';
import { aprovar, desfazer, enviarAgora, restaurar, trocarCitacao, voltarParaRevisao } from '../lib/acoes';
import { avisar, dados, ui, useSel } from '../lib/loja';
import { Glifo, NOME_CANAL, TIPO_DESTINO } from '../lib/canais';
import { aspas, completa, comPonto, horaClara } from '../lib/formato';
import { useAgora } from '../lib/tempo';
import { useLint, useVersoes } from '../lib/consultas';
import { Previa, Diferenca } from '../previas/Previa';
import { SeloEstado } from './Estado';
import { AvisoOrdem } from './Ordem';
import { PainelAgendar, PainelDescartar } from './Paineis';
import { Tecla } from './ui';
import type { Mensagem } from '../lib/tipos';

function Cabecalho({ m, contextoVisivel }: { m: Mensagem; contextoVisivel: boolean }) {
  const agora = useAgora(30_000);
  const conta = useSel(dados, (e) => e.resumo?.canais.find((c) => c.id === m.canal)?.contas.find((c) => c.id === m.conta)?.nome);
  const tipo = m.destino_tipo ? TIPO_DESTINO[m.destino_tipo] || m.destino_tipo : null;
  return (
    <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-meta text-tx-3">
          <Glifo canal={m.canal} tamanho={14} />
          <span>{[NOME_CANAL[m.canal], m.canal === 'email' ? (conta || m.conta ? `pela conta ${conta || m.conta}` : null) : tipo?.toLowerCase()].filter(Boolean).join(', ')}</span>
        </p>
        <h2 className="mt-1 truncate text-titulo font-extrabold tracking-[-0.01em]">
          {m.destino_nome || (m.para_pedido ? `“${m.para_pedido}”, destino a escolher` : 'Sem destino')}
        </h2>
        {m.canal === 'email' && m.assunto && <p className="mt-0.5 truncate text-ui text-tx-2">{m.assunto}</p>}
      </div>
      <div className="flex flex-none flex-col items-end gap-1 text-right">
        <SeloEstado m={m} />
        <p className="text-meta text-tx-3 tabular" title={completa(m.criado_em)}><span className="font-mono">#{m.id}</span>, {horaClara(m.criado_em, agora)}</p>
        {!contextoVisivel && (
          <button type="button" className="btn btn-pequeno mt-1" onClick={() => ui.set((e) => ({ contextoAberto: !e.contextoAberto }))}>
            <PanelRight size={14} strokeWidth={2} aria-hidden /> Contexto <Tecla>I</Tecla>
          </button>
        )}
      </div>
    </header>
  );
}

function Barra({ m, contextoVisivel }: { m: Mensagem; contextoVisivel: boolean }) {
  const lint = useLint(m);
  const saindo = useSel(dados, (e) => e.saindo);
  const painel = useSel(ui, (e) => e.painel);
  const agora = useAgora(1000);
  const bloqueio = lint?.bloqueios?.[0];
  const naJanela = m.status === 'aprovada' && !!m.liberar_em && m.liberar_em > agora && saindo.some((s) => s.ids.includes(m.id));
  const abrir = (tipo: 'descartar' | 'agendar') => ui.set({ painel: painel?.tipo === tipo ? null : { tipo, ids: [m.id] } });
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(m.corpo);
      avisar('Texto copiado.', 'ok');
    } catch {
      avisar('Não deu para copiar daqui. Selecione o texto na prévia.', 'erro');
    }
  };

  let botoes: React.ReactNode = null;
  if (m.status === 'pendente' || m.status === 'erro') {
    botoes = (
      <>
        <button type="button" className={`btn btn-principal ${bloqueio ? '' : ''}`} disabled={!!bloqueio} onClick={() => aprovar([m.id])}>
          {m.status === 'erro' ? <RotateCcw size={16} strokeWidth={2.2} aria-hidden /> : <Check size={16} strokeWidth={2.4} aria-hidden />}
          {m.status === 'erro' ? 'Tentar de novo' : 'Aprovar'} <Tecla>{m.status === 'erro' ? 'T' : 'A'}</Tecla>
        </button>
        <button type="button" className="btn" onClick={() => ui.set({ editando: m.id, painel: null })}>
          <Pencil size={15} strokeWidth={2} aria-hidden /> Editar <Tecla>E</Tecla>
        </button>
        {m.status === 'pendente' && (
          <button type="button" className="btn" disabled={!!bloqueio} onClick={() => abrir('agendar')} aria-expanded={painel?.tipo === 'agendar'}>
            <CalendarClock size={15} strokeWidth={2} aria-hidden /> Agendar <Tecla>S</Tecla>
          </button>
        )}
        <button type="button" className="btn btn-fantasma btn-perigo ml-auto" onClick={() => abrir('descartar')} aria-expanded={painel?.tipo === 'descartar'}>
          <Trash size={15} strokeWidth={2} aria-hidden /> Descartar <Tecla>D</Tecla>
        </button>
      </>
    );
  } else if (m.status === 'aprovada') {
    const agendada = m.agendar_para && m.agendar_para > agora;
    botoes = (
      <>
        {naJanela ? (
          <button type="button" className="btn btn-principal" onClick={() => desfazer(saindo.find((s) => s.ids.includes(m.id)))}>
            <Undo2 size={16} strokeWidth={2.2} aria-hidden /> Desfazer <Tecla>Z</Tecla>
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => voltarParaRevisao(m.id)}>
            <Undo2 size={15} strokeWidth={2} aria-hidden /> Voltar para revisão <Tecla>U</Tecla>
          </button>
        )}
        {(agendada || m.proxima_tentativa) && (
          <button type="button" className="btn" onClick={() => enviarAgora(m.id)}>
            <Send size={15} strokeWidth={2} aria-hidden /> Enviar agora <Tecla>N</Tecla>
          </button>
        )}
        <button type="button" className="btn" onClick={() => abrir('agendar')}>
          <CalendarClock size={15} strokeWidth={2} aria-hidden /> {agendada ? 'Mudar horário' : 'Agendar'} <Tecla>S</Tecla>
        </button>
        <button type="button" className="btn btn-fantasma btn-perigo ml-auto" onClick={() => abrir('descartar')}>
          <Trash size={15} strokeWidth={2} aria-hidden /> Descartar <Tecla>D</Tecla>
        </button>
      </>
    );
  } else if (m.status === 'enviando') {
    botoes = <p className="text-ui text-tx-2">Saindo agora. Não dá mais para voltar.</p>;
  } else if (m.status === 'enviada') {
    botoes = (
      <button type="button" className="btn" onClick={copiar}>
        <Copy size={15} strokeWidth={2} aria-hidden /> Copiar texto <Tecla>C</Tecla>
      </button>
    );
  } else if (m.status === 'descartada') {
    botoes = (
      <button type="button" className="btn btn-principal" onClick={() => restaurar(m.id)}>
        <RotateCcw size={15} strokeWidth={2.2} aria-hidden /> Restaurar para revisão <Tecla>R</Tecla>
      </button>
    );
  } else {
    botoes = <p className="flex items-center gap-2 text-ui text-tx-2"><Ban size={15} strokeWidth={2} aria-hidden /> Versão antiga: a nova está na fila.</p>;
  }

  return (
    <div className="relative border-t border-line bg-surface px-6 py-3">
      {painel && painel.ids.includes(m.id) && painel.ids.length === 1 && (
        painel.tipo === 'descartar'
          ? <PainelDescartar ids={painel.ids} onFechar={() => ui.set({ painel: null })} className="absolute right-6 bottom-[calc(100%+8px)] z-30" />
          : <PainelAgendar id={m.id} onFechar={() => ui.set({ painel: null })} className="absolute bottom-[calc(100%+8px)] left-6 z-30" />
      )}
      {bloqueio && (m.status === 'pendente' || m.status === 'erro') && (
        <p className="anima-aparece mb-2.5 flex items-start gap-2 text-ui font-semibold text-danger" role="status">
          <OctagonX size={16} strokeWidth={2.2} className="mt-0.5 flex-none" aria-hidden />
          <span>
            {bloqueio.regra === 'destino'
              ? (contextoVisivel ? 'Bloqueada: escolha o destino no painel ao lado.' : `Bloqueada: ${comPonto(aspas(bloqueio.msg))} Abra o Contexto (I) para escolher o destino.`)
              : `Bloqueada: ${comPonto(aspas(bloqueio.msg))} Corrija no editor (E) para aprovar.`}
            {bloqueio.regra === 'segredo' && bloqueio.msg.startsWith('parece senha') && (
              <span className="mt-0.5 block font-normal text-tx-2">Senha de página de cliente só sai se estiver no cofre e liberada para ele em ~/.central-mensagens/config.json (senhasDeCliente).</span>
            )}
          </span>
        </p>
      )}
      <AvisoOrdem m={m} />
      <div className="flex flex-wrap items-center gap-2">{botoes}</div>
    </div>
  );
}

export function ColunaCentro({ m, contextoVisivel }: { m: Mensagem; contextoVisivel: boolean }) {
  const comparando = useSel(ui, (e) => (e.comparando?.id === m.id ? e.comparando : null));
  const versoes = useVersoes(comparando && comparando.contra !== 'original' ? m : null).dados;
  const editavel = m.status === 'pendente' || m.status === 'erro' || m.status === 'aprovada';
  let conteudo: React.ReactNode;
  if (comparando) {
    const outra = comparando.contra === 'original' ? null : versoes?.find((v) => v.id === comparando.contra);
    conteudo = comparando.contra === 'original'
      ? <Diferenca antes={m.corpo_original} depois={m.corpo} rotuloAntes="Como a sessão escreveu" rotuloDepois="Como está agora" />
      : outra ? <Diferenca antes={outra.corpo} depois={m.corpo} rotuloAntes={`Versão anterior (#${outra.id})`} rotuloDepois={`Esta (#${m.id})`} />
        : <p className="text-tx-3">Carregando a versão anterior…</p>;
  } else {
    conteudo = (
      <Previa
        m={m}
        onCitar={m.canal === 'whatsapp' && editavel ? (c) => void trocarCitacao(m.id, c) : undefined}
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-sunk">
      <Cabecalho m={m} contextoVisivel={contextoVisivel} />
      <div key={m.id} className="rolagem @container min-h-0 flex-1 px-6 pb-10" tabIndex={0} role="region" aria-label={comparando ? 'Comparação de versões' : 'Prévia'}>
        {/* o respiro de cima fica aqui dentro: padding no contêiner de rolagem desloca o topo grudado do WhatsApp */}
        <div key={`${m.id}:${comparando ? 'diff' : 'previa'}`} className="flex justify-center pt-1">{conteudo}</div>
      </div>
      <Barra m={m} contextoVisivel={contextoVisivel} />
    </div>
  );
}
