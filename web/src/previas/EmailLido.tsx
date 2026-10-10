// O e-mail que chegou, como no Gmail: assunto, quem mandou e para quem, o texto em parágrafos, o histórico
// citado recolhido e os anexos. Com a conversa lida, as mensagens de antes ficam em linhas e abrem com um clique.
import { useState, type ReactNode } from 'react';
import { ChevronDown, Ellipsis, ExternalLink, File, FileImage, FileSpreadsheet, FileText } from 'lucide-react';
import { completa } from '../lib/formato';
import { useAgora } from '../lib/tempo';
import { urlSegura } from '../lib/url';
import { avatar, dataGmail, inicial } from './PreviaEmail';
import type { AnexoRecebido, Endereco } from '../lib/tipos';

export interface MensagemLida {
  de: string;
  email?: string;
  em: number;
  texto: string;
  citado?: string;
  para?: Endereco[];
  cc?: Endereco[];
  anexos?: AnexoRecebido[];
  cortado?: boolean;
  /** o Gmail não devolveu o texto: o cartão diz isso no lugar do corpo */
  semLeitura?: boolean;
}

// endereço solto no texto, ou "[rótulo](endereço)", que é como chega o link de e-mail escrito só em HTML
const RE_LINK = /\[\s*(?:\[([^[\]\n]{1,120})\]|([^[\]]{1,200}?))\s*\]\(\s*(https?:\/\/[^\s)]+)\s*\)|<?(https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}])>?/g;
const semWww = (h: string) => h.replace(/^www\./, '');

// o link mostra para onde vai (domínio e começo do caminho), não a fileira de rastreio
function rotuloDoLink(seguro: string) {
  const u = new URL(seguro);
  const caminho = u.pathname === '/' ? '' : u.pathname;
  return `${semWww(u.hostname)}${caminho.slice(0, 28)}${caminho.length > 28 || u.search || u.hash ? '…' : ''}`;
}

// O rótulo de um link é texto de quem mandou o e-mail e pode citar um site e levar para outro, com truques que
// comparação nenhuma pega (caractere invisível antes do ponto, ponto parecido, dois domínios no rótulo). Então o
// destino de verdade aparece sempre ao lado, lido do endereço pelo mesmo leitor de URL do navegador; só some
// quando o rótulo é o próprio destino.
const comoTexto = (s: string) => s.normalize('NFKC').replace(/[\p{Cf}\p{Mn}]/gu, '').toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

function comLinks(texto: string): ReactNode[] {
  const out: ReactNode[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(RE_LINK)) {
    const i = m.index ?? 0;
    const endereco = m[3] || m[4];
    const seguro = urlSegura(endereco);
    if (!seguro) continue;
    const rotulo = (m[1] || m[2] || '').replace(/\s+/g, ' ').trim();
    const destino = semWww(new URL(seguro).hostname);
    const mostrarDestino = !!rotulo && ![destino, comoTexto(seguro)].includes(comoTexto(rotulo));
    if (i > ultimo) out.push(texto.slice(ultimo, i));
    out.push(<a key={i} className="gm-link" href={seguro} target="_blank" rel="noopener noreferrer" title={seguro}>{rotulo || rotuloDoLink(seguro)}</a>);
    if (mostrarDestino) out.push(<span key={`${i}d`} className="gm-destino"> ({destino})</span>);
    ultimo = i + m[0].length;
  }
  if (ultimo < texto.length) out.push(texto.slice(ultimo));
  return out;
}

const comNome = (e: Endereco) => (e.nome && e.nome.toLowerCase() !== e.email ? `${e.nome} <${e.email}>` : e.email);
const primeiroNome = (e: Endereco) => (e.nome && !e.nome.includes('@') ? e.nome.split(/\s+/)[0] : e.email.split('@')[0]);

// "para mim, Clara, Mateus e mais 4", como a linha cinza do Gmail
function resumoDeQuem(para: Endereco[], cc: Endereco[], conta: string) {
  const todos = [...para, ...cc];
  if (!todos.length) return 'para mim';
  const nomes = todos.map((e) => (e.email === conta.toLowerCase() ? 'mim' : primeiroNome(e)));
  return nomes.length > 5 ? `para ${nomes.slice(0, 4).join(', ')} e mais ${nomes.length - 4}` : `para ${nomes.join(', ')}`;
}

// logo de assinatura e pixel de rastreio chegam como anexo: imagem de poucos KB não é arquivo que alguém mandou
function enfeite(a: AnexoRecebido) {
  const [, n, unidade] = a.tamanho.match(/([\d.,]+)\s*([KMGT]?)B/i) || [];
  return a.tipo.startsWith('image/') && (!unidade || (unidade.toUpperCase() === 'K' && Number(String(n).replace(',', '.')) < 12));
}

function IconeDoAnexo({ tipo }: { tipo: string }) {
  const Icone = tipo.startsWith('image/') ? FileImage : /sheet|excel|csv/.test(tipo) ? FileSpreadsheet : /pdf|word|document|text|presentation|powerpoint/.test(tipo) ? FileText : File;
  return <Icone size={15} strokeWidth={1.9} aria-hidden className="flex-none text-[var(--gm-meta)]" />;
}

function Aberta({ msg, conta, agora, onRecolher }: { msg: MensagemLida; conta: string; agora: number; onRecolher?: () => void }) {
  const [detalhes, setDetalhes] = useState(false);
  const [citado, setCitado] = useState(false);
  const para = msg.para || [];
  const cc = msg.cc || [];
  const anexos = (msg.anexos || []).filter((a) => !enfeite(a));
  const quem = <><span className="gm-de">{msg.de}</span>{msg.email && msg.email !== msg.de.toLowerCase() ? <> <span className="gm-email">&lt;{msg.email}&gt;</span></> : null}</>;
  return (
    <div className="gm-msg">
      <div className="gm-cab">
        <span className="gm-avatar" style={avatar(msg.de)}>{inicial(msg.de)}</span>
        <span className="min-w-0">
          {onRecolher
            ? <button type="button" className="gm-quem" onClick={onRecolher} title="Recolher esta mensagem">{quem}</button>
            : <span className="gm-quem">{quem}</span>}
          <button type="button" className="gm-para gm-quais" aria-expanded={detalhes} onClick={() => setDetalhes(!detalhes)} title={detalhes ? 'Esconder os endereços' : 'Ver os endereços'}>
            <span className="truncate">{resumoDeQuem(para, cc, conta)}</span>
            <ChevronDown size={14} strokeWidth={2} aria-hidden className={`flex-none ${detalhes ? 'rotate-180' : ''}`} />
          </button>
        </span>
        {msg.em ? <time className="whitespace-nowrap text-[12px] text-[var(--gm-meta)]" dateTime={new Date(msg.em).toISOString()} title={completa(msg.em)}>{dataGmail(msg.em, agora)}</time> : <span />}
      </div>
      {detalhes && (
        <dl className="gm-detalhes">
          <dt>de</dt><dd>{msg.email ? comNome({ nome: msg.de, email: msg.email }) : msg.de}</dd>
          <dt>para</dt><dd>{para.length ? para.map(comNome).join(', ') : conta}</dd>
          {cc.length > 0 && <><dt>cc</dt><dd>{cc.map(comNome).join(', ')}</dd></>}
          {msg.em ? <><dt>data</dt><dd>{completa(msg.em)}</dd></> : null}
        </dl>
      )}
      <div className="gm-corpo gm-lido">
        {msg.texto
          ? comLinks(msg.texto)
          : <span className="text-[var(--gm-meta)]">{msg.semLeitura ? 'Não consegui ler o texto deste e-mail agora. A Central tenta de novo sozinha.' : 'Sem texto: o conteúdo está em anexo ou em imagem.'}</span>}
      </div>
      {msg.cortado && <p className="gm-nota">O texto é longo e foi cortado aqui. O resto está no Gmail.</p>}
      {msg.citado && (
        <>
          <button type="button" className="gm-mais" aria-expanded={citado} aria-label={citado ? 'Esconder o histórico citado' : 'Mostrar o histórico citado'} title={citado ? 'Esconder o histórico citado' : 'Mostrar o histórico citado'} onClick={() => setCitado(!citado)}>
            <Ellipsis size={16} strokeWidth={2.2} aria-hidden />
          </button>
          {citado && <div className="gm-citado">{comLinks(msg.citado)}</div>}
        </>
      )}
      {anexos.length > 0 && (
        <ul className="gm-fichas" aria-label={anexos.length === 1 ? '1 anexo' : `${anexos.length} anexos`}>
          {anexos.map((a, k) => (
            <li key={k} className="gm-ficha" title={a.nome}>
              <IconeDoAnexo tipo={a.tipo} />
              <span className="nome">{a.nome}</span>
              {a.tamanho && <span className="tam">{a.tamanho.replace('.', ',')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Linha({ msg, agora, onAbrir }: { msg: MensagemLida; agora: number; onAbrir: () => void }) {
  return (
    <button type="button" className="gm-fio" aria-expanded={false} onClick={onAbrir} title="Abrir esta mensagem">
      <span className="gm-avatar" style={avatar(msg.de)}>{inicial(msg.de)}</span>
      <span className="quem">{msg.de}</span>
      <span className="trecho">{msg.texto.replace(/\s+/g, ' ').slice(0, 180)}</span>
      <span className="whitespace-nowrap text-[12px]">{msg.em ? dataGmail(msg.em, agora) : ''}</span>
    </button>
  );
}

export function EmailLido({ assunto, mensagens, conta, link, nota, children }: {
  assunto: string;
  mensagens: MensagemLida[];
  conta: string;
  link?: string;
  /** uma linha sob o assunto: a conversa ainda está sendo lida, ou não deu para ler */
  nota?: ReactNode;
  /** a resposta em rascunho, que entra no fim do fio */
  children?: ReactNode;
}) {
  const agora = useAgora(30_000);
  const [abertas, setAbertas] = useState<Set<number>>(() => new Set());
  const [todas, setTodas] = useState(false);
  const ultima = mensagens.length - 1;
  // fio comprido: a primeira, um contador e as duas de antes da última, como o Gmail
  const escondidas = !todas && ultima > 4 ? ultima - 3 : 0;
  const alternar = (k: number) => setAbertas((s) => {
    const novo = new Set(s);
    if (!novo.delete(k)) novo.add(k);
    return novo;
  });
  const gmail = urlSegura(link);
  return (
    <div className="gm" data-lido="" aria-label={`E-mail: ${assunto}`}>
      <div className="gm-topo">
        <div className="gm-assunto">{assunto}</div>
        {gmail && <a className="gm-abrir" href={gmail} target="_blank" rel="noopener noreferrer">Abrir no Gmail <ExternalLink size={13} strokeWidth={2} aria-hidden /></a>}
      </div>
      {nota && <p className="gm-aviso">{nota}</p>}
      {mensagens.map((msg, k) => {
        if (escondidas && k >= 1 && k <= ultima - 3) {
          return k === 1 ? (
            <button key="mais" type="button" className="gm-fio gm-contador" onClick={() => setTodas(true)}>
              <span className="grid size-10 place-items-center"><span className="grid size-7 place-items-center rounded-full border border-[var(--gm-line)] bg-[var(--gm-bg)] text-[12px] font-semibold">{escondidas}</span></span>
              <span className="trecho">{escondidas === 1 ? 'mais 1 mensagem' : `mais ${escondidas} mensagens`}</span>
            </button>
          ) : null;
        }
        return k === ultima || abertas.has(k)
          ? <Aberta key={k} msg={msg} conta={conta} agora={agora} onRecolher={k === ultima ? undefined : () => alternar(k)} />
          : <Linha key={k} msg={msg} agora={agora} onAbrir={() => alternar(k)} />;
      })}
      {children}
    </div>
  );
}
