// Celular (390 px): uma coluna. Em "Para revisar", deslizar para a direita aprova, para a esquerda descarta
// (abre os motivos) e um toque abre o editor. As outras abas abrem o detalhe com a prévia e as ações.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock, ChartColumn, Check, ChevronRight, CircleAlert, Ellipsis, GraduationCap, Inbox, ListOrdered, OctagonX, Pause, RotateCcw, Send, Settings2, Trash,
  TriangleAlert, Undo2,
} from 'lucide-react';
import { agendar, alternarPausa, aprovar, descartar, enviarAgora, restaurar, salvar, trocarDestino, voltarParaRevisao, irPara } from '../lib/acoes';
import { dados, ui, useSel } from '../lib/loja';
import { api } from '../lib/api';
import { FAIXAS, GlifoOuFoto, faixaDoTamanho } from '../lib/canais';
import { aspas, curto, numero, plural, quando } from '../lib/formato';
import { explicarErroEnvio } from '../lib/estado';
import { MOTIVOS } from '../lib/motivos';
import { useAgora } from '../lib/tempo';
import { textoLimpo } from '../lib/whatsapp';
import { useLint } from '../lib/consultas';
import { Previa } from '../previas/Previa';
import { SeloEstado } from '../componentes/Estado';
import { ControleOrdem, SeloOrdem } from '../componentes/Ordem';
import { ControleAcompanhar } from '../componentes/AcompanharResposta';
import { useContagens } from '../componentes/Topo';
import { VAZIO } from '../componentes/ColunaLista';
import { TrocarDestino } from '../componentes/TrocarDestino';
import { Vazio, Etiqueta } from '../componentes/ui';
import { Folha } from '../componentes/Folha';
import { useListaDaVista } from './Mensagens';
import { TelaEntradaCelular } from './EntradaCelular';
import { TelaAcompanharCelular } from './Acompanhar';
import { TelaRelatorio } from './Relatorio';
import { TelaAjustes } from './Ajustes';
import { TelaLicoes } from './Licoes';
import type { Lint, Mensagem, MotivoCodigo, VistaLista } from '../lib/tipos';

function Motivos({ ids, onFeito }: { ids: number[]; onFeito: () => void }) {
  const [texto, setTexto] = useState('');
  const fazer = (c: MotivoCodigo | null, livre?: string) => { onFeito(); void descartar(ids, livre ? 'outro' : c, livre); };
  return (
    <div className="flex flex-col gap-2">
      {MOTIVOS.map((m) => (
        <button key={m.codigo} type="button" className="flex min-h-12 items-center gap-3 rounded-item border border-line px-4 py-2 text-left active:bg-surface-2" onClick={() => fazer(m.codigo)}>
          <span><span className="block font-semibold">{m.nome}</span><span className="block text-meta text-tx-3">{m.dica}</span></span>
        </button>
      ))}
      <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); fazer(null, texto.trim() || undefined); }}>
        <input className="campo h-11" placeholder="Outro motivo (opcional)" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Outro motivo" />
        <button type="submit" className="btn h-11 flex-none">{texto.trim() ? 'Descartar' : 'Sem motivo'}</button>
      </form>
    </div>
  );
}

const paraQuem = (m: Mensagem) => (m.destino_nome ? `Para ${m.destino_nome}` : 'Destino a escolher');

// ---------------------------------------------------------------- cartão que desliza

const LIMIAR = 96;

interface PropsDeslize {
  onDireita: () => void; onEsquerda: () => void; onToque: () => void; children: React.ReactNode;
  ativo: boolean; bloqueada: boolean; rotulo: string;
}

function Deslizavel({ onDireita, onEsquerda, onToque, children, ativo, bloqueada, rotulo }: PropsDeslize) {
  const [dx, setDx] = useState(0);
  const [solto, setSolto] = useState(true);
  const [saindo, setSaindo] = useState(false);
  const [treme, setTreme] = useState(false);
  const toque = useRef<{ x: number; y: number; id: number; eixo: 'h' | 'v' | null; t: number } | null>(null);
  const arrastou = useRef(false);
  const fim = () => {
    const t = toque.current;
    toque.current = null;
    setSolto(true);
    if (!t || t.eixo !== 'h') return;
    // passou do ponto, ou foi um peteleco rápido
    const vai = Math.abs(dx) > LIMIAR || (Math.abs(dx) > 40 && Math.abs(dx) / Math.max(1, Date.now() - t.t) > 0.6);
    if (vai && dx > 0) {
      // bloqueada não finge que aprova: volta, treme e abre o editor, onde está o motivo
      if (bloqueada) { setDx(0); setTreme(true); onToque(); return; }
      setDx(window.innerWidth);
      window.setTimeout(() => setSaindo(true), 140);
      window.setTimeout(() => { onDireita(); setDx(0); setSaindo(false); }, 320);
      return;
    }
    if (vai && dx < 0) { setDx(0); onEsquerda(); return; }
    setDx(0);
  };
  const armado = Math.abs(dx) > LIMIAR;
  const lado = dx > 0 ? (bloqueada ? 'bloqueada' : 'aprovar') : 'descartar';
  return (
    <div className="deslize-vaga" data-saindo={saindo}>
      <div className="deslize">
        {ativo && dx !== 0 && (
          <div className={`deslize-fundo ${lado}`} data-armado={armado && !bloqueada} aria-hidden>
            {dx > 0
              ? (bloqueada ? <OctagonX size={22} strokeWidth={2.4} /> : <Check size={22} strokeWidth={2.6} />)
              : <Trash size={21} strokeWidth={2.2} />}
          </div>
        )}
        <div
          className={`deslize-carta ${treme ? 'anima-treme' : ''}`}
          data-bloqueada={bloqueada || undefined}
          style={{ transform: `translateX(${dx}px)`, transition: solto ? 'transform 220ms var(--curva-saida)' : 'none' }}
          // sem gesto também funciona: Enter, Espaço ou o toque duplo do VoiceOver abrem o editor (lá tem Aprovar e Descartar)
          role={ativo ? 'button' : undefined}
          tabIndex={ativo ? 0 : undefined}
          aria-label={ativo ? rotulo : undefined}
          onKeyDown={ativo ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToque(); } } : undefined}
          onClick={(e) => {
            if (arrastou.current) { arrastou.current = false; return; }
            // nas outras abas o botão Abrir do cartão já cuida do toque nele
            if ((e.target as HTMLElement).closest('button, a') && e.target !== e.currentTarget) return;
            onToque();
          }}
          onAnimationEnd={() => setTreme(false)}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            arrastou.current = false;
            toque.current = { x: e.clientX, y: e.clientY, id: e.pointerId, eixo: null, t: Date.now() };
          }}
          onPointerMove={(e) => {
            const t = toque.current;
            if (!t || t.id !== e.pointerId) return;
            const mx = e.clientX - t.x;
            const my = e.clientY - t.y;
            if (!t.eixo) {
              if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.2 && ativo) {
                t.eixo = 'h';
                arrastou.current = true;
                setSolto(false);
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              } else if (Math.abs(my) > 10) { t.eixo = 'v'; arrastou.current = true; }
            }
            if (t.eixo === 'h') setDx(mx);
          }}
          onPointerUp={fim}
          onPointerCancel={() => { toque.current = null; setSolto(true); setDx(0); }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function ResumoCanal({ m }: { m: Mensagem }) {
  if (m.canal === 'whatsapp') return <Previa m={m} compacta />;
  return (
    <div className="rounded-item bg-surface-2 px-3 py-2.5">
      {m.canal === 'email' && <p className="mb-1 truncate font-bold">{m.assunto || '(sem assunto)'}</p>}
      <p className="line-clamp-6 whitespace-pre-wrap text-ui text-tx-2">{m.canal === 'discord' ? m.corpo : textoLimpo(m.corpo)}</p>
    </div>
  );
}

function Limite({ children }: { children: React.ReactNode }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [corta, setCorta] = useState(false);
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setCorta(el.scrollHeight > el.clientHeight + 2);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="relative">
      <div ref={caixa} className={`max-h-[46dvh] overflow-hidden ${corta ? 'cartao-corta' : ''}`}>{children}</div>
      {corta && <p className="absolute inset-x-0 bottom-1 text-center text-meta font-semibold text-tx-2">Toque para ler tudo</p>}
    </div>
  );
}

function Cartao({ m, vista, onAbrir }: { m: Mensagem; vista: VistaLista; onAbrir: () => void }) {
  const agora = useAgora(30_000);
  const lint = m.lint;
  const bloqueio = lint?.bloqueios?.[0];
  const avisos = (lint?.avisos || []).length;
  const faixa = faixaDoTamanho(m.canal, m.corpo.length);
  return (
    <article className="flex flex-col gap-2.5 rounded-painel border border-line bg-surface p-3.5 shadow-1" aria-label={paraQuem(m)}>
      <header className="flex items-start gap-2.5">
        <GlifoOuFoto canal={m.canal} jid={m.destino_id} tamanho={18} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline justify-between gap-2">
            <span className={`truncate font-bold ${m.destino_id ? '' : 'text-danger'}`}>{m.destino_nome || 'Destino a escolher'}</span>
            <span className="flex-none text-meta text-tx-3 tabular">{curto(m.criado_em, agora)}</span>
          </p>
          <p className="truncate text-meta text-tx-3">{vista === 'revisar' ? m.sessao_nome || 'sessão sem nome' : <SeloEstado m={m} tamanho={12} className="text-meta" />}</p>
          {m.status !== 'aprovada' && <SeloOrdem m={m} className="mt-0.5" />}
        </div>
      </header>
      <Limite><ResumoCanal m={m} /></Limite>
      {bloqueio && (
        <p className="flex items-start gap-1.5 text-meta font-semibold text-danger"><OctagonX size={14} strokeWidth={2.4} className="mt-px flex-none" aria-hidden /> {aspas(bloqueio.msg)}</p>
      )}
      {((!bloqueio && avisos > 0) || faixa !== 'ok') && (
        <div className="flex flex-wrap gap-1.5">
          {!bloqueio && avisos > 0 && <Etiqueta tom="aviso"><TriangleAlert size={12} strokeWidth={2.4} aria-hidden /> {plural(avisos, 'aviso', 'avisos')}</Etiqueta>}
          {faixa !== 'ok' && <Etiqueta tom={faixa === 'perigo' ? 'perigo' : 'aviso'}>{numero(m.corpo.length)} caracteres</Etiqueta>}
        </div>
      )}
      {vista !== 'revisar' && (
        <button type="button" className="btn btn-pequeno self-start" onClick={onAbrir}>Abrir <ChevronRight size={14} strokeWidth={2} aria-hidden /></button>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- editor no celular (toque)

function EditorCelular({ m, onFechar, onDescartar }: { m: Mensagem; onFechar: () => void; onDescartar: () => void }) {
  const [corpo, setCorpo] = useState(m.corpo);
  const [ver, setVer] = useState<'texto' | 'previa'>('previa');
  const [lint, setLint] = useState<Lint | null>(m.lint || null);
  const lintAtual = useLint(m);
  const f = FAIXAS[m.canal];
  const faixa = faixaDoTamanho(m.canal, corpo.length);
  useEffect(() => {
    if (corpo === m.corpo) { setLint(lintAtual); return; }
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      api.lint({ id: m.id, canal: m.canal, destino_id: m.destino_id, destino_nome: m.destino_nome, cliente: m.cliente, assunto: m.assunto, corpo }, ctl.signal).then(setLint, () => null);
    }, 400);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [corpo, m, lintAtual]);
  const gravar = async (eAprovar: boolean) => {
    const r = corpo !== m.corpo ? await salvar(m.id, { corpo }) : m;
    if (!r) return;
    onFechar();
    if (eAprovar) await aprovar([m.id]);
  };
  const bloqueio = lint?.bloqueios?.[0];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid flex-none grid-cols-2 rounded-botao segmentos bg-surface-3 p-0.5" role="group" aria-label="Ver">
        {(['previa', 'texto'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={ver === v} onClick={() => setVer(v)} className={`min-h-11 rounded-[6px] font-semibold ${ver === v ? 'bg-surface shadow-1' : 'text-tx-2'}`}>
            {v === 'previa' ? 'Como vai chegar' : 'Editar o texto'}
          </button>
        ))}
      </div>
      {ver === 'texto' ? (
        <textarea className="campo min-h-0 flex-1 resize-none text-ler" value={corpo} onChange={(e) => setCorpo(e.target.value)} lang="pt-BR" aria-label="Texto da mensagem" autoFocus />
      ) : (
        <div className="@container min-h-0 flex-1 overflow-y-auto rounded-painel bg-sunk p-2"><div className="flex justify-center"><Previa m={{ ...m, corpo }} corpo={corpo} /></div></div>
      )}
      <p className={`flex-none text-meta tabular ${faixa === 'ok' ? 'text-tx-3' : faixa === 'aviso' ? 'text-warn' : 'text-danger'}`}>{numero(corpo.length)} caracteres{f.nota(corpo.length) ? `: ${f.nota(corpo.length)}` : ''}</p>
      {lint && (lint.bloqueios.length > 0 || lint.avisos.length > 0) && (
        <ul className="flex max-h-36 flex-none flex-col gap-1.5 overflow-y-auto">
          {lint.bloqueios.map((b, i) => <li key={`b${i}`} className="flex gap-2 text-ui font-semibold text-danger"><OctagonX size={15} strokeWidth={2.2} className="mt-0.5 flex-none" aria-hidden />{aspas(b.msg)}</li>)}
          {lint.avisos.filter((a) => a.regra !== 'tamanho').map((a, i) => (
            <li key={`a${i}`} className="flex gap-2 text-ui text-warn">
              <TriangleAlert size={15} strokeWidth={2.2} className="mt-0.5 flex-none text-warn-icon" aria-hidden />
              <div className="flex min-w-0 flex-col items-start gap-1.5">
                <span>{aspas(a.msg)}</span>
                {a.regra === 'horario' && a.sugestao && m.status === 'pendente' && (
                  <button type="button" className="btn btn-pequeno" onClick={() => { onFechar(); void agendar(m.id, a.sugestao!); }}>
                    <CalendarClock size={14} strokeWidth={2} aria-hidden /> Agendar para {quando(a.sugestao)}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {bloqueio?.regra === 'destino' && (
        <div className="flex-none">
          <TrocarDestino m={m} autoFoco={false} onFechar={onFechar} onEscolher={async (d) => { await trocarDestino(m.id, d); onFechar(); }} />
        </div>
      )}
      <div className="max-h-[40dvh] flex-none overflow-y-auto"><ControleOrdem m={m} /></div>
      <div className="flex-none"><ControleAcompanhar m={m} /></div>
      <div className="grid flex-none grid-cols-[auto_1fr_1fr] gap-2">
        <button type="button" className="btn btn-fantasma btn-perigo" onClick={onDescartar}><Trash size={15} strokeWidth={2} aria-hidden /> Descartar</button>
        <button type="button" className="btn" onClick={() => gravar(false)} disabled={corpo === m.corpo}>Salvar</button>
        <button type="button" className="btn btn-principal" onClick={() => gravar(true)} disabled={!!bloqueio}><Check size={16} strokeWidth={2.4} aria-hidden /> Aprovar</button>
      </div>
    </div>
  );
}

function ErroExplicado({ m }: { m: Mensagem }) {
  const erro = explicarErroEnvio(m);
  return (
    <div className="rounded-item border border-danger-line bg-danger-soft px-3 py-2">
      <p className="flex items-start gap-1.5 font-bold text-danger"><CircleAlert size={15} strokeWidth={2.2} className="mt-0.5 flex-none" aria-hidden />{erro.oque}</p>
      <p className="mt-1 text-ui text-tx-2">{erro.fazer}</p>
    </div>
  );
}

function DetalheCelular({ m, onFechar }: { m: Mensagem; onFechar: () => void }) {
  const fechar = (f: () => void) => () => { onFechar(); f(); };
  return (
    <div className="flex flex-col gap-3">
      <SeloEstado m={m} />
      {m.status === 'erro' && <ErroExplicado m={m} />}
      <ControleOrdem m={m} />
      <ControleAcompanhar m={m} />
      <div className="@container max-h-[58dvh] overflow-y-auto rounded-painel bg-sunk p-2"><div className="flex justify-center"><Previa m={m} /></div></div>
      <div className="grid grid-cols-2 gap-2">
        {m.status === 'aprovada' && <button type="button" className="btn" onClick={fechar(() => void voltarParaRevisao(m.id))}><Undo2 size={15} strokeWidth={2} aria-hidden /> Voltar para revisão</button>}
        {m.status === 'aprovada' && (m.agendar_para || m.proxima_tentativa) ? <button type="button" className="btn" onClick={fechar(() => void enviarAgora(m.id))}><Send size={15} strokeWidth={2} aria-hidden /> Enviar agora</button> : null}
        {m.status === 'erro' && <button type="button" className="btn btn-principal" onClick={fechar(() => void aprovar([m.id]))}><RotateCcw size={15} strokeWidth={2.2} aria-hidden /> Tentar de novo</button>}
        {m.status === 'descartada' && <button type="button" className="btn btn-principal" onClick={fechar(() => void restaurar(m.id))}><RotateCcw size={15} strokeWidth={2.2} aria-hidden /> Restaurar</button>}
      </div>
      <dl className="text-meta text-tx-3">
        <dt className="sr-only">Sessão</dt><dd>{m.sessao_nome || 'Sessão sem nome'}</dd>
        {m.responder_a && <><dt className="sr-only">Responde a</dt><dd className="mt-1">Responde a: {m.responder_a}</dd></>}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- telas

function ListaCelular({ vista }: { vista: VistaLista }) {
  const lista = useListaDaVista(vista);
  const estado = useSel(dados, (e) => e.estadoVista[vista]);
  const [editando, setEditando] = useState<Mensagem | null>(null);
  const [descartando, setDescartando] = useState<number[] | null>(null);
  const [aberta, setAberta] = useState<Mensagem | null>(null);
  const precisaEntrada = useSel(dados, (e) => e.entradaContagem?.precisa || 0);
  return (
    <div className="flex flex-col gap-3 px-3 pt-3 pb-28">
      {vista === 'revisar' && lista.length > 0 && (
        <p className="px-1 text-meta text-tx-3">Deslize para a direita para aprovar, para a esquerda para descartar. Toque para editar.</p>
      )}
      {estado === 'carregando' && !lista.length && <p className="px-1 text-ui text-tx-3">Carregando…</p>}
      {estado === 'erro' && !lista.length && (
        <Vazio titulo="Não consegui carregar." icone={<TriangleAlert size={22} strokeWidth={1.75} />}>
          <p>A Central não respondeu. Ela tenta de novo sozinha a cada 5 s.</p>
        </Vazio>
      )}
      {estado !== 'carregando' && estado !== 'erro' && !lista.length && (
        <Vazio titulo={VAZIO[vista].titulo} icone={<Inbox size={22} strokeWidth={1.75} />}>
          <p>{VAZIO[vista].texto}</p>
          {vista === 'revisar' && precisaEntrada > 0 && <button type="button" className="btn btn-pequeno mt-2" onClick={() => irPara('entrada')}>{plural(precisaEntrada, 'conversa espera', 'conversas esperam')} você na Entrada</button>}
        </Vazio>
      )}
      {lista.map((m) => (
        <Deslizavel
          key={m.id}
          ativo={vista === 'revisar'}
          bloqueada={!!m.lint?.bloqueios?.length}
          rotulo={`${paraQuem(m)}. Abrir para editar, aprovar ou descartar`}
          onDireita={() => void aprovar([m.id])}
          onEsquerda={() => setDescartando([m.id])}
          onToque={() => (vista === 'revisar' ? setEditando(m) : setAberta(m))}
        >
          <Cartao m={m} vista={vista} onAbrir={() => setAberta(m)} />
        </Deslizavel>
      ))}
      <Folha aberta={!!editando} onFechar={() => setEditando(null)} titulo={editando ? paraQuem(editando) : ''} cheia semRolagem>
        {editando && <EditorCelular m={editando} onFechar={() => setEditando(null)} onDescartar={() => { setEditando(null); setDescartando([editando.id]); }} />}
      </Folha>
      <Folha aberta={!!descartando} onFechar={() => setDescartando(null)} titulo="Por que descartar?">
        {descartando && <Motivos ids={descartando} onFeito={() => setDescartando(null)} />}
      </Folha>
      <Folha aberta={!!aberta} onFechar={() => setAberta(null)} titulo={aberta ? paraQuem(aberta) : ''} cheia>
        {aberta && <DetalheCelular m={aberta} onFechar={() => setAberta(null)} />}
      </Folha>
    </div>
  );
}

export function TelaCelular() {
  const vista = useSel(ui, (e) => e.vista);
  const pausado = useSel(dados, (e) => !!e.resumo?.pausado);
  const n = useContagens();
  const [mais, setMais] = useState(false);
  const titulo = useMemo(() => ({ revisar: 'Para revisar', entrada: 'Entrada', acompanhar: 'Entrada', fila: 'Na fila', enviadas: 'Entregues', erro: 'Com erro', descartadas: 'Descartadas', relatorio: 'Relatório', ajustes: 'Ajustes', licoes: 'Lições' }[vista]), [vista]);
  const abas = [
    { vista: 'revisar' as const, rotulo: 'Revisar', Icone: Check, n: n.revisar },
    { vista: 'entrada' as const, rotulo: 'Entrada', Icone: Inbox, n: n.entrada },
    { vista: 'fila' as const, rotulo: 'Fila', Icone: ListOrdered, n: n.fila },
  ];
  // Chegou e Acompanhar são as duas abas de dentro da Entrada
  const naBarra = vista === 'acompanhar' ? 'entrada' : vista;
  const noMais = !abas.some((a) => a.vista === naBarra);
  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-line bg-surface px-4 pt-[max(0.625rem,env(safe-area-inset-top))] pb-2.5">
        <h1 className="text-titulo font-extrabold tracking-[-0.01em]">{titulo}</h1>
        {(vista === 'revisar' || vista === 'fila' || vista === 'erro') && (
          <span className="font-num text-[1.75rem] leading-none font-bold">{numero(n[vista] || 0)}</span>
        )}
      </header>
      {pausado && (
        <div className="flex flex-none items-center gap-2 border-b border-warn-line bg-warn-soft py-1.5 pr-3 pl-4 text-ui font-semibold text-warn">
          <Pause size={14} strokeWidth={2.2} className="flex-none" aria-hidden />
          <span className="min-w-0 flex-1">Envios pausados. Nada sai até você retomar.</span>
          <button type="button" className="btn btn-pequeno flex-none" onClick={() => void alternarPausa()}>Retomar</button>
        </div>
      )}
      <main key={vista} className="min-h-0 flex-1 overflow-y-auto">
        {vista === 'entrada' ? <TelaEntradaCelular />
          : vista === 'acompanhar' ? <TelaAcompanharCelular />
          : vista === 'relatorio' ? <TelaRelatorio />
            : vista === 'ajustes' ? <TelaAjustes />
              : vista === 'licoes' ? <TelaLicoes />
                : <ListaCelular key={vista} vista={vista} />}
      </main>
      <nav className="grid flex-none grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]" aria-label="Abas">
        {abas.map((a) => (
          <button key={a.vista} type="button" aria-current={naBarra === a.vista ? 'page' : undefined} onClick={() => irPara(a.vista)} className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-meta font-semibold ${naBarra === a.vista ? 'text-accent-tx' : 'text-tx-3'}`}>
            <a.Icone size={20} strokeWidth={naBarra === a.vista ? 2.4 : 1.9} aria-hidden />
            {a.rotulo}
            {a.n ? <span className="absolute top-1 left-[calc(50%+0.5rem)] min-w-[1.35rem] rounded-full bg-accent px-1 text-center text-meta leading-[1.35rem] font-bold text-accent-fg tabular">{a.n}</span> : null}
          </button>
        ))}
        <button type="button" onClick={() => setMais(true)} aria-current={noMais ? 'page' : undefined} className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-meta font-semibold ${noMais ? 'text-accent-tx' : 'text-tx-3'}`}>
          <Ellipsis size={20} strokeWidth={1.9} aria-hidden /> Mais
          {n.erro ? (
            <span className="absolute top-1 left-[calc(50%+0.5rem)] min-w-[1.35rem] rounded-full bg-danger px-1 text-center text-meta leading-[1.35rem] font-bold text-surface tabular">
              <span aria-hidden>{n.erro}</span><span className="sr-only">, {n.erro} com erro</span>
            </span>
          ) : null}
        </button>
      </nav>
      <Folha aberta={mais} onFechar={() => setMais(false)} titulo="Mais">
        <ul className="flex flex-col pb-2">
          {([
            ['enviadas', 'Entregues', Check],
            ['erro', 'Com erro', CircleAlert],
            ['descartadas', 'Descartadas', Trash],
            ['relatorio', 'Relatório', ChartColumn],
            ['licoes', 'Lições', GraduationCap],
            ['ajustes', 'Ajustes', Settings2],
          ] as const).map(([v, rotulo, Icone]) => (
            <li key={v}>
              <button type="button" className="flex min-h-12 w-full items-center gap-3 border-b border-line px-1 text-left font-semibold" onClick={() => { setMais(false); irPara(v); }}>
                <Icone size={18} strokeWidth={1.9} className={v === 'erro' && n.erro ? 'text-danger' : 'text-tx-3'} aria-hidden />
                {rotulo}
                {v === 'erro' && n.erro ? <Etiqueta tom="perigo" className="ml-auto">{n.erro}</Etiqueta> : <ChevronRight size={16} strokeWidth={2} className="ml-auto text-tx-3" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </Folha>
    </div>
  );
}

