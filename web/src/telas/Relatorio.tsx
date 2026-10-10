// Relatório "por que descarto" (spec P5): motivo, sessão, volume por canal e dia, tempo até aprovar e edição.
// Gráficos em SVG à mão seguindo o método do dataviz: barras finas, ponta arredondada de 4px, vão de 2px,
// grade em fio, legenda + tabela equivalente para cada gráfico, cores de canal validadas (claro e escuro).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChartColumn, Table2, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import { Glifo, NOME_CANAL } from '../lib/canais';
import { NOME_MOTIVO } from '../lib/motivos';
import { cabecalhoDia, numero, plural } from '../lib/formato';
import { Esqueleto, Vazio } from '../componentes/ui';
import type { Canal, MotivoCodigo, Relatorio } from '../lib/tipos';

// paleta validada (validate_palette.js, adjacente): claro #fcfdfe, escuro #15171c; ordem da pilha fixa
const COR_SERIE: Record<Canal, string> = {
  whatsapp: 'light-dark(#1baf7a, #199e70)',
  discord: 'light-dark(#4a3aa7, #9085e9)',
  email: 'light-dark(#e34948, #e66767)',
};
const ORDEM_PILHA: Canal[] = ['whatsapp', 'discord', 'email'];
const PERIODOS = [7, 14, 30];

const pct = (n: number, de: number) => (de ? Math.round((n / de) * 100) : 0);
const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
function minutos(n: number | null | undefined) {
  if (n === null || n === undefined) return 'sem dado';
  if (n < 60) return `${Math.round(n)} min`;
  const h = n / 60;
  return `${h.toLocaleString('pt-BR', { maximumFractionDigits: h < 10 ? 1 : 0 })} h`;
}
function passoBonito(max: number, alvo = 4) {
  if (max <= 0) return 1;
  const bruto = max / alvo;
  const p = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const diaIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Cartao({ titulo, subtitulo, tabela, children, acao }: { titulo: string; subtitulo?: string; tabela: React.ReactNode; children: React.ReactNode; acao?: React.ReactNode }) {
  const [verTabela, setVerTabela] = useState(false);
  return (
    <figure className="m-0 rounded-painel border border-line bg-surface">
      <figcaption className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sub font-extrabold">{titulo}</h2>
          {subtitulo && <p className="mt-0.5 text-ui text-tx-2">{subtitulo}</p>}
        </div>
        <div className="flex flex-none items-center gap-2">
          {acao}
          <button type="button" className="btn btn-pequeno" aria-pressed={verTabela} onClick={() => setVerTabela((v) => !v)}>
            {verTabela ? <ChartColumn size={14} strokeWidth={2} aria-hidden /> : <Table2 size={14} strokeWidth={2} aria-hidden />}
            {verTabela ? 'Ver gráfico' : 'Ver tabela'}
          </button>
        </div>
      </figcaption>
      <div className="px-5 py-4">{verTabela ? tabela : children}</div>
    </figure>
  );
}

function Tabela({ cabecalho, linhas, alinhar }: { cabecalho: string[]; linhas: (React.ReactNode)[][]; alinhar?: ('l' | 'r')[] }) {
  return (
    <div className="overflow-x-auto" data-rola-lado>
      <table className="w-full border-collapse text-ui">
        <thead>
          <tr>{cabecalho.map((c, i) => <th key={c} scope="col" className={`border-b border-line px-2 py-2 text-meta font-bold text-tx-3 ${alinhar?.[i] === 'r' ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-b border-line last:border-b-0">
              {l.map((c, j) => <td key={j} className={`px-2 py-2 ${alinhar?.[j] === 'r' ? 'text-right tabular' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- descartes por motivo (barras horizontais, 1 série)

function BarrasMotivo({ r }: { r: Relatorio }) {
  const total = r.descartesPorMotivo.reduce((s, x) => s + x.n, 0);
  const max = Math.max(1, ...r.descartesPorMotivo.map((x) => x.n));
  const nome = (c: MotivoCodigo | null) => (c ? NOME_MOTIVO[c] : 'Sem motivo');
  const semMotivo = r.descartesPorMotivo.find((x) => x.motivo_codigo === null)?.n || 0;
  if (!total) {
    return (
      <figure className="m-0 rounded-painel border border-line bg-surface px-5 py-4">
        <h2 className="text-sub font-extrabold">Por que você descarta</h2>
        <p className="mt-1 text-ui text-tx-2">Nada descartado no período.</p>
      </figure>
    );
  }
  return (
    <Cartao
      titulo="Por que você descarta"
      subtitulo={semMotivo ? `${plural(semMotivo, 'descarte ficou', 'descartes ficaram')} sem motivo (${pct(semMotivo, total)}%). Sem motivo, a sessão repete o erro.` : `${plural(total, 'descarte', 'descartes')}, todos com motivo.`}
      tabela={<Tabela cabecalho={['Motivo', 'Descartes', '% do total']} alinhar={['l', 'r', 'r']} linhas={r.descartesPorMotivo.map((x) => [nome(x.motivo_codigo), numero(x.n), `${pct(x.n, total)}%`])} />}
    >
      <ul className="flex flex-col gap-2.5" aria-label="Descartes por motivo">
        {r.descartesPorMotivo.map((x) => {
          const semNome = x.motivo_codigo === null;
          return (
            <li key={x.motivo_codigo ?? 'nenhum'} className="grid grid-cols-1 gap-1 sm:grid-cols-[11.5rem_minmax(0,1fr)] sm:items-center sm:gap-3" title={`${nome(x.motivo_codigo)}: ${x.n}`}>
              <span className={`line-clamp-2 text-ui leading-snug ${semNome ? 'font-bold text-tx' : 'text-tx-2'}`}>{nome(x.motivo_codigo)}</span>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="h-5 min-w-1 rounded-r-[4px]" style={{ width: `calc((100% - 5.5rem) * ${x.n / max})`, background: semNome ? 'var(--text-3)' : 'var(--accent)' }} aria-hidden />
                <span className="flex-none text-ui font-semibold tabular">{numero(x.n)} <span className="font-normal text-tx-3">{pct(x.n, total)}%</span></span>
              </span>
            </li>
          );
        })}
      </ul>
    </Cartao>
  );
}

// ---------------------------------------------------------------- volume por canal e dia (colunas empilhadas)

interface DiaVolume { dia: string; ms: number; porCanal: Record<Canal, number>; total: number }

function ColunasPorDia({ r, dias }: { r: Relatorio; dias: number }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(280);
  const [foco, setFoco] = useState<number | null>(null);
  // mede antes de pintar: o gráfico já nasce com a largura da coluna, sem pulo
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    setLargura(Math.max(240, el.clientWidth));
    const ro = new ResizeObserver(([e]) => setLargura(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const serie: DiaVolume[] = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(12, 0, 0, 0);
    const lista: DiaVolume[] = [];
    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date(hoje);
      d.setDate(d.getDate() - i);
      lista.push({ dia: diaIso(d), ms: d.getTime(), porCanal: { whatsapp: 0, email: 0, discord: 0 }, total: 0 });
    }
    for (const x of r.porDia) {
      const alvo = lista.find((d) => d.dia === x.dia);
      if (!alvo) continue;
      alvo.porCanal[x.canal] += x.criadas;
      alvo.total += x.criadas;
    }
    return lista;
  }, [r, dias]);

  const max = Math.max(1, ...serie.map((d) => d.total));
  const passo = passoBonito(max);
  const topo = Math.ceil(max / passo) * passo;
  const altura = 220;
  const esq = 34;
  const base = 22;
  const util = largura - esq - 8;
  const fatia = util / serie.length;
  const barra = Math.min(24, Math.max(6, fatia * 0.56));
  const y = (v: number) => (altura - base) - (v / topo) * (altura - base - 8);
  const ticks: number[] = [];
  for (let t = 0; t <= topo; t += passo) ticks.push(t);
  const cadaRotulo = Math.max(1, Math.ceil(serie.length / Math.max(4, Math.floor(util / 46))));
  const pico = serie.reduce((a, b) => (b.total > a.total ? b : a), serie[0]);
  const presentes = ORDEM_PILHA.filter((c) => serie.some((d) => d.porCanal[c]));
  const f = foco !== null ? serie[foco] : null;

  return (
    <Cartao
      titulo="O que chegou por dia"
      subtitulo={pico.total ? `Pico em ${cabecalhoDia(pico.ms).toLowerCase()}: ${plural(pico.total, 'mensagem', 'mensagens')}.` : 'Nada chegou no período.'}
      tabela={
        <Tabela
          cabecalho={['Dia', ...presentes.map((c) => NOME_CANAL[c]), 'Total']}
          alinhar={['l', ...presentes.map(() => 'r' as const), 'r']}
          linhas={serie.map((d) => [cabecalhoDia(d.ms), ...presentes.map((c) => numero(d.porCanal[c])), numero(d.total)])}
        />
      }
    >
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legenda">
        {presentes.map((c) => (
          <li key={c} className="flex items-center gap-1.5 text-meta text-tx-2">
            <span className="size-2.5 rounded-[2px]" style={{ background: COR_SERIE[c] }} aria-hidden />
            <Glifo canal={c} tamanho={12} />
            {NOME_CANAL[c]}
          </li>
        ))}
      </ul>
      <div ref={caixa} className="relative" onPointerLeave={() => setFoco(null)}>
        <svg width={largura} height={altura} role="img" aria-label={`Mensagens que chegaram por dia nos últimos ${dias} dias, por canal. Pico: ${pico.total}.`} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={esq} x2={largura} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--line-strong)' : 'var(--line)'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={esq - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[var(--text-3)] text-[12.5px] tabular">{numero(t)}</text>
            </g>
          ))}
          {serie.map((d, i) => {
            const cx = esq + fatia * i + fatia / 2;
            let acumulado = 0;
            const segmentos = ORDEM_PILHA.filter((c) => d.porCanal[c]).map((c, k, todos) => {
              const v = d.porCanal[c];
              const y0 = y(acumulado);
              const y1 = y(acumulado + v);
              acumulado += v;
              const ultimo = k === todos.length - 1;
              const h = Math.max(1, y0 - y1 - (k > 0 ? 2 : 0));
              const topoY = y1;
              const x0 = cx - barra / 2;
              const rr = ultimo ? Math.min(4, h, barra / 2) : 0;
              const caminho = `M${x0},${topoY + h} V${topoY + rr} Q${x0},${topoY} ${x0 + rr},${topoY} H${x0 + barra - rr} Q${x0 + barra},${topoY} ${x0 + barra},${topoY + rr} V${topoY + h} Z`;
              return <path key={c} d={caminho} fill={COR_SERIE[c]} opacity={foco === null || foco === i ? 1 : 0.45} />;
            });
            const rotulo = (serie.length - 1 - i) % cadaRotulo === 0;
            const dt = new Date(d.ms);
            return (
              <g
                key={d.dia}
                tabIndex={0}
                role="listitem"
                aria-label={`${cabecalhoDia(d.ms)}: ${d.total} no total. ${presentes.map((c) => `${NOME_CANAL[c]} ${d.porCanal[c]}`).join(', ')}.`}
                onPointerEnter={() => setFoco(i)}
                onFocus={() => setFoco(i)}
                onBlur={() => setFoco(null)}
                className="outline-none"
              >
                <rect x={esq + fatia * i} y={0} width={fatia} height={altura - base} fill="transparent" />
                {foco === i && <rect x={cx - barra / 2 - 4} y={4} width={barra + 8} height={altura - base - 4} rx={6} fill="var(--surface-2)" />}
                {segmentos}
                {d === pico && d.total > 0 && (
                  <text x={cx} y={y(d.total) - 6} textAnchor="middle" className="fill-[var(--text)] text-[12.5px] font-bold tabular">{d.total}</text>
                )}
                {rotulo && (
                  <text x={cx} y={altura - 6} textAnchor="middle" className={`text-[12.5px] tabular ${foco === i ? 'fill-[var(--text)] font-bold' : 'fill-[var(--text-3)]'}`}>
                    {`${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {f && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-44 rounded-item border border-line bg-surface px-3 py-2.5 shadow-pop"
            style={{ left: Math.min(largura - 190, Math.max(0, esq + fatia * (foco ?? 0) + fatia / 2 + 16)) }}
            role="tooltip"
          >
            <p className="text-meta text-tx-3">{cabecalhoDia(f.ms)}</p>
            <p className="font-num text-[1.5rem] leading-tight font-bold">{numero(f.total)} <span className="font-sans text-meta font-semibold text-tx-3">no total</span></p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {[...ORDEM_PILHA].reverse().filter((c) => presentes.includes(c)).map((c) => (
                <li key={c} className="flex items-center gap-2 text-meta">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: COR_SERIE[c] }} aria-hidden />
                  <span className="w-6 text-right font-bold text-tx tabular">{f.porCanal[c]}</span>
                  <span className="text-tx-2">{NOME_CANAL[c]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Cartao>
  );
}

// ---------------------------------------------------------------- sessões (tabela com medidor)

function TabelaSessoes({ r }: { r: Relatorio }) {
  const [todas, setTodas] = useState(false);
  const lista = todas ? r.descartesPorSessao : r.descartesPorSessao.slice(0, 8);
  if (!r.descartesPorSessao.length) return null;
  const linhas = lista.map((s) => {
    const taxa = pct(s.descartadas, s.criadas);
    const tom = taxa >= 60 ? 'var(--danger)' : taxa >= 35 ? 'var(--warn-icon)' : 'var(--accent)';
    return [
      <span className="block max-w-[22rem] truncate font-semibold" title={s.sessao}>{s.sessao}</span>,
      numero(s.criadas),
      numero(s.descartadas),
      <span className="flex items-center justify-end gap-2">
        <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${taxa}%`, background: tom }} />
        </span>
        <span className="w-10 text-right font-semibold">{taxa}%</span>
      </span>,
      <span className="text-tx-2">{s.motivoTop ? NOME_MOTIVO[s.motivoTop] : 'sem motivo'}</span>,
    ];
  });
  return (
    <figure className="m-0 rounded-painel border border-line bg-surface">
      <figcaption className="border-b border-line px-5 py-4">
        <h2 className="text-sub font-extrabold">Sessões que mais geram descarte</h2>
        <p className="mt-0.5 text-ui text-tx-2">A taxa é o que você descartou do que a sessão mandou. É daqui que sai a regra da semana para cada sessão.</p>
      </figcaption>
      <div className="px-3 py-2">
        <Tabela cabecalho={['Sessão', 'Mandou', 'Descartadas', 'Taxa', 'Motivo mais comum']} alinhar={['l', 'r', 'r', 'r', 'l']} linhas={linhas} />
        {r.descartesPorSessao.length > 8 && (
          <button type="button" className="btn btn-fantasma btn-pequeno mx-2 mt-1 mb-2" onClick={() => setTodas((t) => !t)}>
            {todas ? 'Mostrar só as 8 primeiras' : `Ver as ${r.descartesPorSessao.length} sessões`}
          </button>
        )}
      </div>
    </figure>
  );
}

function TabelaCanais({ r }: { r: Relatorio }) {
  const linhas = r.porCanal.filter((c) => c.criadas).map((c) => [
    <span className="flex items-center gap-2 font-semibold"><Glifo canal={c.canal} tamanho={14} /> {NOME_CANAL[c.canal]}</span>,
    numero(c.criadas),
    numero(c.enviadas),
    <span>{numero(c.descartadas)} <span className="text-tx-3">({pct(c.descartadas, c.criadas)}%)</span></span>,
    numero(c.editadas),
    c.tamanhoMedio ? numero(c.tamanhoMedio) : '',
    minutos(c.aprovacaoMedianaMin),
  ]);
  return (
    <figure className="m-0 rounded-painel border border-line bg-surface">
      <figcaption className="border-b border-line px-5 py-4">
        <h2 className="text-sub font-extrabold">Cada canal</h2>
      </figcaption>
      <div className="px-3 py-2">
        <Tabela cabecalho={['Canal', 'Chegaram', 'Entregues', 'Descartadas', 'Você editou', 'Tamanho médio', 'Até aprovar']} alinhar={['l', 'r', 'r', 'r', 'r', 'r', 'r']} linhas={linhas} />
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------- tela

export function TelaRelatorio() {
  const [dias, setDias] = useState(14);
  const [r, setR] = useState<Relatorio | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    api.relatorio(dias)
      .then((x) => { if (vivo) { setR(x); setErro(false); } })
      .catch(() => { if (vivo) setErro(true); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [dias]);

  const tot = useMemo(() => {
    if (!r) return null;
    const criadas = r.porCanal.reduce((s, c) => s + c.criadas, 0);
    const enviadas = r.porCanal.reduce((s, c) => s + c.enviadas, 0);
    const descartadas = r.porCanal.reduce((s, c) => s + c.descartadas, 0);
    return { criadas, enviadas, descartadas };
  }, [r]);

  return (
    <div className="rolagem h-full bg-bg">
      <div className="mx-auto flex max-w-[68rem] flex-col gap-5 px-6 pt-6 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-titulo font-extrabold tracking-[-0.01em] max-[760px]:sr-only">Relatório</h1>
            <p className="mt-1 text-ui text-tx-2">O que as sessões mandaram, o que saiu e por que você descartou.</p>
          </div>
          <div className="flex rounded-botao segmentos bg-surface-3 p-0.5" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p} type="button" aria-pressed={dias === p} onClick={() => setDias(p)} className={`rounded-[6px] px-3 py-1.5 text-ui font-semibold ${dias === p ? 'bg-surface text-tx shadow-1' : 'text-tx-2 hover:text-tx'}`}>
                {p} dias
              </button>
            ))}
          </div>
        </div>

        {erro && !r && <Vazio titulo="Não consegui montar o relatório." icone={<TriangleAlert size={22} strokeWidth={1.75} />}>A Central não respondeu a /api/relatorio. Tente de novo em instantes.</Vazio>}
        {!r && !erro && <div className="rounded-painel border border-line bg-surface p-6"><Esqueleto linhas={5} /></div>}

        {r && tot && (
          <div className={`flex flex-col gap-5 transition-opacity duration-200 ${carregando ? 'opacity-55' : ''}`} aria-busy={carregando}>
            <section className="grid gap-px overflow-hidden rounded-painel border border-line bg-line sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]" aria-label="Resumo do período">
              <div className="bg-surface px-5 py-4">
                <p className="text-meta font-bold text-tx-3">Descartadas</p>
                <p className="mt-1 font-num text-[3.25rem] leading-none font-bold">{pct(tot.descartadas, tot.criadas)}%</p>
                <p className="mt-1.5 text-ui text-tx-2">{numero(tot.descartadas)} de {plural(tot.criadas, 'mensagem', 'mensagens')} em {dias} dias</p>
              </div>
              <div className="bg-surface px-5 py-4">
                <p className="text-meta font-bold text-tx-3">Entregues</p>
                <p className="mt-1 font-num text-[2.25rem] leading-none font-bold">{numero(tot.enviadas)}</p>
                <p className="mt-1.5 text-ui text-tx-2">{pct(tot.enviadas, tot.criadas)}% do que chegou</p>
              </div>
              <div className="bg-surface px-5 py-4">
                <p className="text-meta font-bold text-tx-3">Até você aprovar</p>
                <p className="mt-1 font-num text-[2.25rem] leading-none font-bold">{minutos(r.tempoAprovacaoMedianaMin)}</p>
                <p className="mt-1.5 text-ui text-tx-2">mediana, da chegada ao aprovar</p>
              </div>
              <div className="bg-surface px-5 py-4">
                <p className="text-meta font-bold text-tx-3">Você editou</p>
                <p className="mt-1 font-num text-[2.25rem] leading-none font-bold">{fmtPct(r.editadasPct)}</p>
                <p className="mt-1.5 text-ui text-tx-2">das mensagens antes de sair</p>
              </div>
            </section>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <BarrasMotivo r={r} />
              <ColunasPorDia r={r} dias={dias} />
            </div>
            <TabelaSessoes r={r} />
            <TabelaCanais r={r} />
          </div>
        )}
      </div>
    </div>
  );
}

