// Acompanhar (dentro da Entrada): quem não respondeu a você e as promessas, suas e para você. Atrasadas primeiro.
// Cobrar só cria um rascunho pendente: nada sai sem aprovar. "Ler a conversa" é o mesmo da Entrada.
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarClock, Check, CheckCheck, CircleAlert, EyeOff, Handshake, Hourglass, MessagesSquare, Send, X } from 'lucide-react';
import { carregarAcompanhar } from '../lib/dados';
import { adiarPromessa, cobrar, fecharPromessa, irPara, naoPreciso } from '../lib/acoes';
import { dados, ui, useSel } from '../lib/loja';
import { useMidia } from '../lib/midia';
import { Glifo, GlifoOuFoto, NOME_CANAL } from '../lib/canais';
import { curto, numero, plural, quando, semAcento } from '../lib/formato';
import { useAgora } from '../lib/tempo';
import { textoLimpo } from '../lib/whatsapp';
import { CampoBusca } from '../componentes/ColunaLista';
import { Folha } from '../componentes/Folha';
import { TrocaEntrada } from '../componentes/TrocaEntrada';
import { Esqueleto, Etiqueta, Tecla, Vazio } from '../componentes/ui';
import { Conversa } from './Entrada';
import type { ItemAcompanhar, ItemEntrada, RespostaAcompanhar } from '../lib/tipos';

// ---------------------------------------------------------------- lista

// Esperando eles primeiro, depois as promessas; dentro de cada uma, a ordem da Central (prazo: atrasadas primeiro)
export function filtrarAcompanhar(r: RespostaAcompanhar | null, busca: string) {
  const alvo = semAcento(busca);
  const itens = (r?.itens || []).filter((i) => !alvo || [i.destino.nome, i.texto, i.promessa?.trecho].some((c) => semAcento(c).includes(alvo)));
  return [...itens.filter((i) => i.tipo === 'esperando'), ...itens.filter((i) => i.tipo === 'promessa')];
}
function useItensAcompanhar() {
  const r = useSel(dados, (e) => e.acompanhar);
  const busca = useSel(ui, (e) => e.busca);
  return useMemo(() => filtrarAcompanhar(r, busca), [r, busca]);
}

// "40 min", "5 h", "3 dias"
function distancia(ms: number) {
  const h = Math.abs(ms) / 3600e3;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} dias`;
}
const textoPrazo = (i: ItemAcompanhar, agora: number) => (i.tipo === 'esperando'
  ? `sem resposta há ${distancia(agora - i.em)}`
  : i.atrasada ? `venceu há ${distancia(agora - i.prazo)}` : `vence em ${distancia(i.prazo - agora)}`);
const doDono = (i: ItemAcompanhar) => i.tipo === 'esperando' || i.promessa?.sentido === 'minha';
const QUEM = (i: ItemAcompanhar) => (i.tipo === 'esperando' ? 'Esperando resposta' : i.promessa?.sentido === 'minha' ? 'Promessa sua' : 'Promessa para você');

// o texto com o compromisso ("te mando") marcado
function Texto({ i }: { i: ItemAcompanhar }) {
  const t = textoLimpo(i.texto || '');
  const trecho = i.promessa?.trecho || '';
  const k = trecho ? t.indexOf(trecho) : -1;
  return (
    <>
      {doDono(i) && <span className="font-semibold text-tx">Você: </span>}
      {k < 0 ? t : <>{t.slice(0, k)}<mark className="rounded-[3px] bg-accent-soft px-0.5 text-tx">{trecho}</mark>{t.slice(k + trecho.length)}</>}
    </>
  );
}

function Linha({ i, selecionado, onClick }: { i: ItemAcompanhar; selecionado: boolean; onClick: () => void }) {
  const agora = useAgora(30_000);
  return (
    <div id={`acp-${i.chave}`} role="option" aria-selected={selecionado} data-atual={selecionado} className="item cursor-pointer" onClick={onClick}>
      <span className="mt-0.5 flex h-5 items-center justify-center"><GlifoOuFoto canal={i.canal} jid={i.destino.id} /></span>
      <span className="min-w-0">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-bold">{i.destino.nome}</span>
          <span className="flex-none text-meta text-tx-3 tabular">{curto(i.em, agora)}</span>
        </span>
        <span className="mt-0.5 line-clamp-2 text-ui text-tx-2"><Texto i={i} /></span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-meta">
          <Etiqueta tom={i.atrasada ? 'perigo' : 'aviso'}>{textoPrazo(i, agora)}</Etiqueta>
          {i.promessa && <span className="text-tx-3">{i.promessa.sentido === 'minha' ? 'você prometeu' : 'prometeu a você'}</span>}
          {i.marcada && <span className="text-tx-3">marcada para acompanhar</span>}
          {i.cobranca && <Etiqueta tom="contorno">cobrança #{i.cobranca.id} {i.cobranca.status === 'pendente' ? 'para revisar' : i.cobranca.status}</Etiqueta>}
        </span>
      </span>
    </div>
  );
}

function Lista({ itens, sel, onEscolher }: { itens: ItemAcompanhar[]; sel?: string | null; onEscolher: (i: ItemAcompanhar) => void }) {
  const secoes = [
    { titulo: 'Esperando eles', itens: itens.filter((i) => i.tipo === 'esperando') },
    { titulo: 'Promessas', itens: itens.filter((i) => i.tipo === 'promessa') },
  ].filter((s) => s.itens.length);
  return (
    <>
      {secoes.map((s) => (
        <section key={s.titulo} aria-label={s.titulo}>
          <p className="rotulo mt-2 mb-1 px-3">{s.titulo} · {numero(s.itens.length)}</p>
          {s.itens.map((i) => <Linha key={i.chave} i={i} selecionado={i.chave === sel} onClick={() => onEscolher(i)} />)}
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- detalhe

function Acoes({ i, celular = false, aoFechar }: { i: ItemAcompanhar; celular?: boolean; aoFechar?: () => void }) {
  const lerTudo = useSel(ui, (e) => e.lerConversa === i.chave);
  const b = celular ? 'btn' : 'btn btn-pequeno';
  const tam = celular ? 15 : 14;
  const tecla = (t: string) => (celular ? null : <Tecla>{t}</Tecla>);
  const fechando = (f: () => void) => () => { f(); aoFechar?.(); };
  const cobravel = i.tipo === 'esperando' || i.promessa?.sentido === 'dele';
  const naFila = i.cobranca && i.cobranca.status !== 'enviada' ? i.cobranca : null;
  return (
    <div className="flex flex-wrap gap-2">
      {cobravel && (naFila ? (
        <button type="button" className={b} onClick={() => irPara(naFila.status === 'pendente' ? 'revisar' : 'fila', naFila.id)}>
          <MessagesSquare size={tam} strokeWidth={2} aria-hidden /> Ver a cobrança #{naFila.id}
        </button>
      ) : (
        <button type="button" className={`${b} btn-principal`} onClick={() => void cobrar(i)}>
          <Send size={tam} strokeWidth={2} aria-hidden /> Cobrar {tecla('C')}
        </button>
      ))}
      {i.tipo === 'esperando' && (
        <button type="button" className={b} onClick={fechando(() => void naoPreciso(i))}><EyeOff size={tam} strokeWidth={2} aria-hidden /> Não preciso {tecla('I')}</button>
      )}
      {i.promessa?.sentido === 'minha' && (
        <>
          <button type="button" className={`${b} btn-principal`} onClick={fechando(() => void fecharPromessa(i, 'cumpri'))}><Check size={tam} strokeWidth={2.4} aria-hidden /> Cumpri {tecla('F')}</button>
          <button type="button" className={b} onClick={() => void adiarPromessa(i)}><CalendarClock size={tam} strokeWidth={2} aria-hidden /> Adiar 1 dia</button>
        </>
      )}
      {i.promessa?.sentido === 'dele' && (
        <button type="button" className={b} onClick={fechando(() => void fecharPromessa(i, 'recebi'))}><CheckCheck size={tam} strokeWidth={2} aria-hidden /> Recebi {tecla('F')}</button>
      )}
      {i.promessa && (
        <button type="button" className={`${b} btn-fantasma`} onClick={fechando(() => void fecharPromessa(i, 'dispensar'))}><X size={tam} strokeWidth={2} aria-hidden /> Dispensar {tecla('I')}</button>
      )}
      {i.canal === 'whatsapp' && (
        <button type="button" className={`${b} btn-fantasma`} aria-pressed={lerTudo} onClick={() => ui.set({ lerConversa: lerTudo ? null : i.chave })}>
          <BookOpen size={tam} strokeWidth={2} aria-hidden /> {lerTudo ? 'Só a mensagem' : 'Ler a conversa'} {tecla('L')}
        </button>
      )}
    </div>
  );
}

// o que está parado, em uma ou duas linhas: desde quando, o prazo e a última mensagem sua
function Situacao({ i }: { i: ItemAcompanhar }) {
  const agora = useAgora(30_000);
  const linhas: string[] = [];
  if (i.tipo === 'esperando') {
    linhas.push(`Sua última mensagem: ${quando(i.em, agora)}. Sem resposta há ${distancia(agora - i.em)}.`);
    if (i.marcada) linhas.push(`Marcada para acompanhar (#${i.marcada.id}): avisar se não responder em ${i.marcada.horas} h.`);
  } else if (i.promessa) {
    const prazo = i.promessa.prazo_dito ? `disse “${i.promessa.prazo_dito}”` : 'sem prazo dito, contei 48 h';
    linhas.push(`${i.atrasada ? 'Venceu' : 'Vence'} ${quando(i.prazo, agora)} (${prazo}).`);
    if (i.minhaUltimaEm) linhas.push(`Última mensagem sua para ${i.destino.tipo === 'grupo' ? 'o grupo' : 'ele'}: há ${distancia(agora - i.minhaUltimaEm)}.`);
  }
  return <div className="flex flex-col gap-0.5 text-ui text-tx-2">{linhas.map((l) => <p key={l}>{l}</p>)}</div>;
}

// a conversa do WhatsApp com o componente da Entrada; o resto mostra a frase
const comoEntrada = (i: ItemAcompanhar): ItemEntrada => {
  const de = doDono(i) ? 'você' : i.destino.nome;
  return {
    chave: i.chave, canal: i.canal, conta: i.conta || undefined, titulo: i.destino.nome, de, texto: i.texto, em: i.em,
    destino: i.destino, precisa: true, mensagens: [{ id: '', de, texto: i.texto, em: i.em }],
  };
};
function Corpo({ i }: { i: ItemAcompanhar }) {
  if (i.canal === 'whatsapp') return <Conversa i={comoEntrada(i)} rascunho="" citar={null} />;
  return (
    <figure className="w-full max-w-[34rem] rounded-painel border border-line bg-surface px-4 py-3">
      <figcaption className="mb-1.5 flex items-center gap-2 text-meta text-tx-3"><Glifo canal={i.canal} tamanho={14} /> {NOME_CANAL[i.canal]} · {quando(i.em)}</figcaption>
      <blockquote className="text-ui"><Texto i={i} /></blockquote>
      {i.promessa?.mensagem_id ? (
        <button type="button" className="btn btn-fantasma btn-pequeno mt-2 -ml-2" onClick={() => irPara('enviadas', i.promessa!.mensagem_id!)}>Ver a #{i.promessa.mensagem_id} inteira</button>
      ) : null}
    </figure>
  );
}

function Icone({ i }: { i: ItemAcompanhar }) {
  const I = i.tipo === 'esperando' ? Hourglass : Handshake;
  return <I size={14} strokeWidth={2} aria-hidden />;
}

// ---------------------------------------------------------------- computador

export function TelaAcompanhar({ buscaRef }: { buscaRef: React.RefObject<HTMLInputElement | null> }) {
  const r = useSel(dados, (e) => e.acompanhar);
  const estado = useSel(dados, (e) => e.acompanharEstado);
  const sel = useSel(ui, (e) => e.sel.acompanhar);
  const itens = useItensAcompanhar();
  const largo = useMidia('(min-width: 1180px)');
  const atual = itens.find((i) => i.chave === sel) || null;

  useEffect(() => { void carregarAcompanhar(); }, []);
  useEffect(() => {
    if (!atual && itens.length) ui.set((e) => ({ sel: { ...e.sel, acompanhar: itens[0].chave } }));
  }, [atual, itens]);
  useEffect(() => { document.getElementById(`acp-${sel}`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);
  const erros = Object.entries(r?.erros || {});

  return (
    <div className={`grid h-full min-h-0 ${largo ? 'grid-cols-[22rem_minmax(0,1fr)]' : 'grid-cols-[20rem_minmax(0,1fr)]'}`}>
      <aside className="flex min-h-0 flex-col border-r border-line" aria-label="O que acompanhar">
        <div className="flex flex-col gap-3 px-4 pt-5 pb-3">
          <div className="flex items-end justify-between">
            <h1 className="text-sub font-bold text-tx-2">Entrada</h1>
            <span className="font-num text-[1.5rem] leading-none font-bold tabular">{numero(r?.contagem.total ?? 0)}</span>
          </div>
          <TrocaEntrada />
          <CampoBusca ref={buscaRef} />
          {erros.length > 0 && (
            <div className="rounded-item border border-warn-line bg-warn-soft px-3 py-2 text-meta text-warn">
              {erros.map(([canal, erro]) => <p key={canal}><span className="font-bold">{NOME_CANAL[canal as keyof typeof NOME_CANAL] || canal}:</span> {erro}</p>)}
            </div>
          )}
        </div>
        <div className="rolagem min-h-0 flex-1 px-2 pb-10" role="listbox" aria-label="Acompanhar" aria-activedescendant={sel ? `acp-${sel}` : undefined} tabIndex={0}>
          {!itens.length && estado === 'carregando' && <div className="px-3"><Esqueleto linhas={6} /></div>}
          {!itens.length && estado === 'erro' && <Vazio titulo="Não consegui ler o Acompanhar." icone={<CircleAlert size={22} strokeWidth={1.75} />}>A Central tenta de novo sozinha.</Vazio>}
          {!itens.length && estado === 'ok' && (
            <Vazio titulo="Nada parado agora." icone={<Hourglass size={22} strokeWidth={1.75} />}>
              Pergunta sua sem resposta há mais de 24 h e promessa perto do prazo aparecem aqui.
            </Vazio>
          )}
          <Lista itens={itens} sel={sel} onEscolher={(i) => ui.set((e) => ({ sel: { ...e.sel, acompanhar: i.chave } }))} />
        </div>
      </aside>

      {atual ? (
        <main className="flex min-h-0 flex-col bg-sunk">
          <header className="flex flex-col gap-3 px-6 pt-5 pb-4">
            <div className="min-w-0">
              <p className={`flex items-center gap-1.5 text-meta font-semibold ${atual.atrasada ? 'text-danger' : 'text-warn'}`}><Icone i={atual} /> {QUEM(atual)}</p>
              <h2 className="mt-1 truncate text-titulo font-extrabold tracking-[-0.01em]">{atual.destino.nome}</h2>
              <div className="mt-1"><Situacao i={atual} /></div>
            </div>
            <Acoes i={atual} />
          </header>
          <div key={atual.chave} className="rolagem @container min-h-0 flex-1 px-6 pb-10" tabIndex={0} role="region" aria-label={`Conversa com ${atual.destino.nome}`}>
            <div className="flex justify-center"><Corpo i={atual} /></div>
          </div>
        </main>
      ) : (
        <main className="grid min-h-0 place-items-center bg-sunk">
          <Vazio titulo={itens.length ? 'Escolha uma conversa.' : 'Tudo em dia.'} icone={<MessagesSquare size={22} strokeWidth={1.75} />}>
            {itens.length ? <p>{plural(itens.length, 'item', 'itens')} na lista.</p> : null}
          </Vazio>
        </main>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- celular

export function TelaAcompanharCelular() {
  const r = useSel(dados, (e) => e.acompanhar);
  const estado = useSel(dados, (e) => e.acompanharEstado);
  const itens = useItensAcompanhar();
  const [chave, setChave] = useState<string | null>(null);
  // a linha viva da lista: Cobrar muda o item aberto; resolvido some e a folha fecha
  const aberto = itens.find((i) => i.chave === chave) || null;
  useEffect(() => { void carregarAcompanhar(); }, []);
  const erros = Object.entries(r?.erros || {});
  return (
    <div className="flex flex-col gap-3 px-3 pt-3 pb-28">
      <TrocaEntrada celular />
      {erros.map(([canal, erro]) => (
        <p key={canal} className="rounded-item border border-warn-line bg-warn-soft px-3 py-2 text-meta text-warn"><span className="font-bold">{NOME_CANAL[canal as keyof typeof NOME_CANAL] || canal}:</span> {erro}</p>
      ))}
      {!itens.length && estado === 'carregando' && <div className="px-1"><Esqueleto linhas={5} /></div>}
      {!itens.length && estado === 'erro' && <Vazio titulo="Não consegui ler o Acompanhar." icone={<CircleAlert size={22} strokeWidth={1.75} />}>A Central tenta de novo sozinha.</Vazio>}
      {!itens.length && estado === 'ok' && (
        <Vazio titulo="Nada parado agora." icone={<Hourglass size={22} strokeWidth={1.75} />}>Pergunta sua sem resposta há mais de 24 h e promessa perto do prazo aparecem aqui.</Vazio>
      )}
      {itens.length > 0 && (
        <div className="flex flex-col gap-1 rounded-painel border border-line bg-surface p-1.5 pt-0" role="listbox" aria-label="Acompanhar">
          <Lista itens={itens} onEscolher={(i) => setChave(i.chave)} />
        </div>
      )}
      <Folha aberta={!!aberto} onFechar={() => setChave(null)} titulo={aberto?.destino.nome || ''} cheia>
        {aberto && (
          <div className="flex flex-col gap-4">
            <div>
              <p className={`flex items-center gap-1.5 text-meta font-semibold ${aberto.atrasada ? 'text-danger' : 'text-warn'}`}><Icone i={aberto} /> {QUEM(aberto)}</p>
              <div className="mt-1"><Situacao i={aberto} /></div>
            </div>
            <div className="@container max-h-[52dvh] overflow-y-auto rounded-painel bg-sunk p-2">
              <div className="flex justify-center"><Corpo i={aberto} /></div>
            </div>
            <Acoes i={aberto} celular aoFechar={() => setChave(null)} />
          </div>
        )}
      </Folha>
    </div>
  );
}
