// WhatsApp como o celular de quem recebe vai mostrar: conversa de cima, citação, menções, mídia e a hora com os tiques.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, CheckCheck, CircleAlert, Clock3, FileText, Image, Mic, Reply, Users, Video, X } from 'lucide-react';
import { TextoWhatsapp, textoLimpo } from '../lib/whatsapp';
import { bytes, cabecalhoDia, chaveDia, hhmm, numero, regressiva, quando } from '../lib/formato';
import { useAgora } from '../lib/tempo';
import { usarCapaPdf, IconeArquivo } from '../componentes/Miniatura';
import { matiz } from '../lib/canais';
import { useFoto } from '../lib/fotos';
import { esperaDe } from '../lib/ordem';
import { urlSegura } from '../lib/url';
import type { AnexoPrevia, Citar, FalaContexto, Mensagem, Participante, PreviaWhatsapp as P } from '../lib/tipos';

const corNome = (nome: string): CSSProperties => {
  const h = matiz(nome || '?');
  return { color: `light-dark(oklch(0.5 0.15 ${h}), oklch(0.78 0.12 ${h}))`, ['--cor' as string]: `light-dark(oklch(0.55 0.15 ${h}), oklch(0.74 0.12 ${h}))` };
};

function rotuloMidia(midia?: string) {
  const t = String(midia || '').toLowerCase();
  if (/image|foto|imagem|sticker|figur/.test(t)) return { Icone: Image, texto: t.includes('stick') || t.includes('figur') ? 'Figurinha' : 'Foto' };
  if (/audio|áudio|ptt|voz/.test(t)) return { Icone: Mic, texto: 'Áudio' };
  if (/video|vídeo/.test(t)) return { Icone: Video, texto: 'Vídeo' };
  return { Icone: FileText, texto: 'Documento' };
}

function Tique({ status }: { status: Mensagem['status'] }) {
  if (status === 'enviada') return <CheckCheck size={15} strokeWidth={2} aria-label="entregue" />;
  if (status === 'enviando') return <Check size={15} strokeWidth={2} aria-label="enviando" />;
  if (status === 'erro') return <CircleAlert size={13} strokeWidth={2.2} className="text-danger" aria-label="não saiu" />;
  return <Clock3 size={12} strokeWidth={2.2} aria-label="ainda não enviada" />;
}

function MidiaPrincipal({ a }: { a: AnexoPrevia }) {
  const pdf = a.mime === 'application/pdf';
  const seguro = urlSegura(a.url);
  const { src } = usarCapaPdf(pdf ? seguro : null, 360);
  if (a.mime.startsWith('image/') && seguro) {
    return <div className="wa-midia"><img src={seguro} alt={a.nome} loading="lazy" /></div>;
  }
  return (
    <>
      {pdf && src && <div className="wa-doc-capa"><img src={src} alt={`Primeira página de ${a.nome}`} className="block w-full" /></div>}
      <div className="wa-doc">
        <span className={`grid size-9 flex-none place-items-center rounded-md ${pdf ? 'bg-[#e5252a] text-white' : 'bg-[color-mix(in_oklch,var(--wa-text)_10%,transparent)]'}`}>
          {pdf ? <span className="text-[10px] font-bold">PDF</span> : <IconeArquivo mime={a.mime} nome={a.nome} tamanho={18} />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px]">{a.nome}</span>
          <span className="block text-[11.5px] text-[var(--wa-meta)]">{[a.nome.split('.').pop()?.toUpperCase(), a.bytes ? bytes(a.bytes) : null].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
    </>
  );
}

function Balao({ f, cauda, grupo, citavel, citando, onClick }: { f: FalaContexto; cauda: boolean; grupo: boolean; citavel: boolean; citando: boolean; onClick?: () => void }) {
  const lado = f.eu ? 'out' : 'in';
  const midia = f.midia ? rotuloMidia(f.midia) : null;
  const conteudo = (
    <>
      {grupo && !f.eu && cauda && <div className="wa-autor" style={corNome(f.de)}>{f.de}</div>}
      {midia && (
        <div className="wa-midia-ctx mb-0.5">
          <midia.Icone size={14} strokeWidth={2} aria-hidden /> {midia.texto}
        </div>
      )}
      {f.texto ? (
        <TextoWhatsapp texto={f.texto} rabo={<span className="wa-rabo" />} />
      ) : (
        <span className="wa-rabo" />
      )}
      <span className="wa-meta">{hhmm(f.em)}{f.eu && <CheckCheck size={15} strokeWidth={2} aria-hidden />}</span>
    </>
  );
  const classe = `wa-balao ${lado}${cauda ? ' cauda' : ''}${citavel ? ' citavel' : ''}${citando ? ' citando' : ''}`;
  if (!citavel) return <div className={classe}>{conteudo}</div>;
  return (
    <div
      role="button"
      tabIndex={0}
      className={classe}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
      title={citando ? 'Esta é a mensagem citada' : 'Citar esta mensagem na resposta'}
      aria-pressed={citando}
    >
      {conteudo}
    </div>
  );
}

export function quemTambemLe(participantes: P['para']['participantes']) {
  if (Array.isArray(participantes) && participantes.length) {
    const nomes = participantes.map((p) => p.nome.split(' ')[0]);
    const mostrar = nomes.slice(0, 3);
    return `Também leem: ${mostrar.join(', ')}${nomes.length > 3 ? ` e mais ${nomes.length - 3}` : ''}`;
  }
  if (typeof participantes === 'number') return `${numero(participantes)} pessoas no grupo`;
  return 'Grupo';
}

function Topo({ previa, grupo }: { previa: P; grupo: boolean }) {
  const nome = previa.para?.nome || 'Destino a escolher';
  const foto = useFoto(previa.para?.id);
  return (
    <div className="wa-topo">
      <span className="wa-avatar" style={{ background: grupo ? 'light-dark(#dfe5e7, #6a7175)' : `oklch(0.53 0.11 ${matiz(nome)})` }}>
        {grupo ? <Users size={18} strokeWidth={2} className="text-[light-dark(#fff,#cfd4d6)]" aria-hidden /> : nome.slice(0, 1).toUpperCase()}
        {foto && <img src={foto} alt="" aria-hidden className="foto anima-aparece absolute inset-0 size-full rounded-full object-cover" />}
      </span>
      <span className="min-w-0">
        <span className="wa-nome block truncate">{nome}</span>
        <span className="wa-sub block truncate">{grupo ? quemTambemLe(previa.para.participantes) : 'conversa direta'}</span>
      </span>
    </div>
  );
}

function DicaCitar() {
  return (
    <div className="mb-1 inline-flex items-center gap-1.5 self-center rounded-md px-2 py-0.5 font-sans text-meta font-semibold text-[var(--wa-meta)]">
      <Reply size={12} strokeWidth={2.2} aria-hidden /> Clique numa mensagem para citar na resposta
    </div>
  );
}

interface Props {
  m: Mensagem;
  previa: P;
  corpo?: string;
  citar?: Citar | null;
  onCitar?: (c: Citar | null) => void;
  compacta?: boolean;
  medir?: boolean;
  semResposta?: boolean;
}

function rolador(el: HTMLElement) {
  let pai = el.parentElement;
  while (pai && !/(auto|scroll)/.test(getComputedStyle(pai).overflowY)) pai = pai.parentElement;
  return !pai || pai === document.body || pai === document.documentElement ? null : pai;
}

// a conversa chega do servidor depois do rascunho: o balão fica onde estava e a conversa cresce para cima dele
function segurar(el: HTMLElement | null, topoAntes: number) {
  const pai = el && rolador(el);
  if (!el || !pai) return false;
  const caixa = pai.getBoundingClientRect();
  if (topoAntes < caixa.top || topoAntes > caixa.bottom - 40) return false;
  pai.scrollTop += el.getBoundingClientRect().top - topoAntes;
  return true;
}

// a coluna que rola mostra o rascunho logo de cara, com o fim da conversa logo acima
function mostrar(el: HTMLElement | null, onde: 'rascunho' | 'fim') {
  const pai = el && rolador(el);
  if (!el || !pai) return;
  if (onde === 'fim') { pai.scrollTop = pai.scrollHeight; return; }
  const caixa = pai.getBoundingClientRect();
  const alvo = el.getBoundingClientRect();
  if (alvo.top >= caixa.top + 40 && alvo.top <= caixa.bottom - 180) return;
  // o rascunho entra com o dia e o aviso de cima inteiros, logo abaixo do topo grudado do WhatsApp
  const topo = pai.querySelector('.wa-topo');
  const limite = topo ? topo.getBoundingClientRect().bottom : caixa.top;
  let ancora: Element = el;
  for (let s = el.previousElementSibling, i = 0; s && i < 3; s = s.previousElementSibling, i++) {
    if (s.classList.contains('wa-dia') || s.classList.contains('wa-sistema')) ancora = s;
  }
  pai.scrollTop += ancora.getBoundingClientRect().top - limite - 16;
}

// a prévia vem do servidor; campo que faltar cai no que a própria mensagem sabe
function completar(p: P, m: Mensagem): P {
  const id = p.para?.id || m.destino_id || '';
  return {
    ...p,
    para: {
      id,
      nome: p.para?.nome || m.destino_nome || 'Destino a escolher',
      tipo: p.para?.tipo || (id.endsWith('@g.us') ? 'grupo' : 'contato'),
      participantes: p.para?.participantes,
    },
    corpo: p.corpo ?? m.corpo,
    mencoes: p.mencoes || [],
    anexos: p.anexos || [],
    contexto: p.contexto || [],
    citar: p.citar ?? null,
  };
}

export function PreviaWhatsapp({ m, previa: bruta, corpo, citar: citarFora, onCitar, compacta = false, medir = true, semResposta = false }: Props) {
  const previa = useMemo(() => completar(bruta, m), [bruta, m]);
  const agora = useAgora(m.status === 'aprovada' && m.liberar_em && m.liberar_em > Date.now() ? 1000 : 30_000);
  const grupo = previa.para.tipo === 'grupo';
  const participantes: Participante[] = Array.isArray(previa.para.participantes) ? previa.para.participantes : [];
  const aoVivo = corpo !== undefined;
  const texto = aoVivo ? corpo! : previa.corpo;
  const citar = citarFora !== undefined ? citarFora : previa.citar;
  // no cartão do celular quem manda é a resposta: da conversa fica só a última fala, encurtada
  const contexto = compacta ? previa.contexto.slice(-1) : previa.contexto;
  const [principal, ...resto] = previa.anexos || [];
  const naoVao = (previa.anexos || []).filter((a) => a.enviado === false);
  const balao = useRef<HTMLDivElement>(null);
  const fim = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState(0);

  const antes = useRef<{ id: number; topo: number } | null>(null);
  useLayoutEffect(() => {
    if (compacta) return;
    if (semResposta) { mostrar(fim.current, 'fim'); return; }
    const a = antes.current;
    if (a && a.id === m.id && segurar(balao.current, a.topo)) return;
    mostrar(balao.current, 'rascunho');
  }, [m.id, previa.contexto.length, compacta, semResposta]);
  // onde o balão ficou depois de cada pintura (é a referência quando a conversa chegar)
  useEffect(() => {
    if (!compacta && balao.current) antes.current = { id: m.id, topo: balao.current.getBoundingClientRect().top };
  });

  useEffect(() => {
    if (!medir || !balao.current) return;
    const ro = new ResizeObserver(([e]) => setAltura(e.contentRect.height));
    ro.observe(balao.current);
    return () => ro.disconnect();
  }, [medir]);

  const linhas: ReactNode[] = [];
  let anterior: FalaContexto | null = null;
  for (const f of contexto) {
    const novoDia = !anterior || chaveDia(anterior.em) !== chaveDia(f.em);
    if (novoDia) linhas.push(<div key={`d${f.id}`} className="wa-dia">{cabecalhoDia(f.em, agora)}</div>);
    const cauda = novoDia || !anterior || anterior.eu !== f.eu || anterior.de !== f.de;
    const citavel = !!onCitar && !!f.id;
    linhas.push(
      <Balao
        key={f.id || `${f.em}`}
        f={compacta && f.texto.length > 100 ? { ...f, texto: `${f.texto.slice(0, 100).trimEnd()}…` } : f}
        cauda={cauda}
        grupo={grupo}
        citavel={citavel}
        citando={!!citar && citar.id === f.id}
        onClick={() => onCitar?.(citar?.id === f.id ? null : { id: f.id, sender: f.sender, de: f.eu ? 'Você' : f.de, texto: f.texto })}
      />,
    );
    anterior = f;
  }
  const hojeJa = anterior && chaveDia(anterior.em) === chaveDia(agora);
  if (semResposta) {
    return (
      <div className="wa w-full" aria-label={`Conversa com ${previa.para.nome}`}>
        {!compacta && <Topo previa={previa} grupo={grupo} />}
        <div className="wa-parede">
          {onCitar && contexto.length > 0 && <DicaCitar />}
          {linhas}
          <div ref={fim} />
        </div>
      </div>
    );
  }
  const quandoSai = m.status === 'enviada' && m.enviado_em ? m.enviado_em : m.status === 'aprovada' && m.agendar_para && m.agendar_para > agora ? m.agendar_para : agora;
  if (!hojeJa || chaveDia(quandoSai) !== chaveDia(agora)) linhas.push(<div key="dia-sai" className="wa-dia">{cabecalhoDia(quandoSai, agora)}</div>);

  let sistema: ReactNode = null;
  if (m.status === 'pendente' || aoVivo) sistema = 'Ainda não enviada';
  else if (m.status === 'aprovada') {
    // a que espera outra mensagem não sai no fim da janela: diz o que espera
    sistema = esperaDe(m)?.aprovada || (m.liberar_em && m.liberar_em > agora ? `Aprovada, sai em ${regressiva(m.liberar_em - agora)}`
      : m.agendar_para && m.agendar_para > agora ? `Agendada para ${quando(m.agendar_para, agora)}` : 'Na fila de envio');
  } else if (m.status === 'enviando') sistema = 'Enviando agora';
  else if (m.status === 'erro') sistema = 'Não saiu';
  else if (m.status === 'descartada') sistema = 'Descartada: não vai sair';
  if (sistema) linhas.push(<div key="sis" className="wa-sistema" data-tom={m.status === 'erro' ? 'perigo' : undefined}>{sistema}</div>);

  const anteriorEu = anterior?.eu && hojeJa;
  const corCitado = citar ? (citar.de === 'Você' ? undefined : corNome(citar.de || '')) : undefined;
  linhas.push(
    <div key="nova" ref={balao} className={`wa-balao out${anteriorEu ? '' : ' cauda'}${m.status === 'enviada' ? '' : ' pendente'}`}>
      {citar && (
        <div className="wa-citado group" style={corCitado}>
          <span className="quem block">{citar.de || 'Mensagem citada'}</span>
          <span className="oque">{textoLimpo(citar.texto || '')}</span>
          {onCitar && (
            <button
              type="button"
              className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-[var(--wa-out)] text-[var(--wa-meta)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => onCitar(null)}
              aria-label="Tirar a citação"
              title="Tirar a citação"
            >
              <X size={13} strokeWidth={2.4} />
            </button>
          )}
          {citar.automatica && <span className="mt-0.5 block text-meta text-[var(--wa-meta)]">citação automática (a resposta chama {citar.de?.split(' ')[0]})</span>}
        </div>
      )}
      {principal && principal.enviado !== false && <MidiaPrincipal a={principal} />}
      {texto.trim() ? (
        <TextoWhatsapp texto={texto} rabo={<span className="wa-rabo" />} mencoes={aoVivo ? undefined : previa.mencoes} participantes={participantes} grupo={grupo && participantes.length > 0} />
      ) : (
        <span className="wa-rabo" />
      )}
      <span className="wa-meta">{hhmm(quandoSai)}<Tique status={m.status} /></span>
    </div>,
  );
  if (naoVao.length || resto.some((a) => a.enviado === false)) {
    linhas.push(
      <div key="naovao" className="wa-sistema" data-tom="aviso">
        {naoVao.length === 1 ? `${naoVao[0].nome} não vai junto` : `${naoVao.length} anexos não vão junto`}: no WhatsApp só o primeiro segue
      </div>,
    );
  }

  const telas = altura / 640;
  const medida = !medir || !altura ? null
    : telas < 0.45 ? 'cabe folgado na tela do celular'
      : telas < 0.95 ? 'ocupa quase uma tela do celular'
        : `ocupa ${telas.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} telas do celular`;

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="wa" aria-label={`Prévia no WhatsApp para ${previa.para.nome}`}>
        {!compacta && <Topo previa={previa} grupo={grupo} />}
        <div className="wa-parede">
          {onCitar && contexto.length > 0 && !compacta && <DicaCitar />}
          {linhas}
        </div>
      </div>
      {medida && (
        <p className={`text-meta tabular ${telas >= 0.95 ? 'text-warn' : 'text-tx-3'}`}>
          {numero(texto.length)} caracteres, {medida}
        </p>
      )}
    </div>
  );
}
