// Entrada: o que chegou e espera você. Lista | conversa no canal (clique para citar) | resposta.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BookOpen, Check, CircleAlert, EyeOff, Inbox, MessagesSquare, Send, TriangleAlert, X } from 'lucide-react';
import { carregarEntrada } from '../lib/dados';
import { marcarVisto, responder, irPara } from '../lib/acoes';
import { explicar } from '../lib/api';
import { dados, ui, useSel } from '../lib/loja';
import { useLer } from '../lib/consultas';
import { useMidia } from '../lib/midia';
import { FORMATACAO, Glifo, GlifoOuFoto, NOME_CANAL, TIPO_DESTINO, FAIXAS, faixaDoTamanho } from '../lib/canais';
import { cabecalhoDia, chaveDia, curto, hhmm, numero, plural, semAcento } from '../lib/formato';
import { useAgora } from '../lib/tempo';
import { atalhoDeFormato } from '../lib/edicao';
import { TextoDiscord } from '../lib/discord';
import { textoLimpo } from '../lib/whatsapp';
import { PreviaWhatsapp } from '../previas/PreviaWhatsapp';
import { SaidaEmail } from '../previas/PreviaEmail';
import { EmailLido, type MensagemLida } from '../previas/EmailLido';
import { CampoBusca } from '../componentes/ColunaLista';
import { TrocaEntrada } from '../componentes/TrocaEntrada';
import { Esqueleto, Etiqueta, Iniciais, Tecla, Vazio } from '../componentes/ui';
import type { Citar, FalaContexto, ItemEntrada, Mensagem, RespostaEntrada } from '../lib/tipos';

const rascunhos = new Map<string, string>();
const citacoes = new Map<string, Citar | null>();
const paraTodos = new Set<string>(); // e-mail: itens em que a resposta vai também para quem estava em cópia
const noPedido = new Set<string>(); // e-mail: itens em que ele escolheu responder no Reply-To de outro domínio
// fala minha: o servidor assina com "Você" ou com o nome do dono (config.json)
const ehEu = (de: string) => {
  const d = de.trim().toLowerCase();
  const dono = (dados.get().resumo?.dono || '').trim().toLowerCase();
  return /^(você|voce|eu)$/.test(d) || (!!dono && (d === dono || d === dono.split(/\s+/)[0]));
};

// para onde a resposta vai: quem assinou, ou o endereço que o e-mail pediu (outro domínio) se ele marcou
export const paraQuem = (i: ItemEntrada) => (i.canal === 'email' && i.email?.pedeRespostaEm && noPedido.has(i.chave) ? i.email.pedeRespostaEm : i.destino.id);

// No e-mail quem espera é a pessoa; o assunto é da conversa e fica no cartão.
export const quemEspera = (i: ItemEntrada) => (i.canal === 'email' ? i.de || i.destino.nome : i.titulo);
// quem entra em cópia quando a resposta é para todos
export const copiasDe = (i: ItemEntrada) => (paraTodos.has(i.chave) ? (i.email?.outros || []).map((e) => e.email).join(', ') : '');
// a conversa de um e-mail é o fio dele, não a busca pelo endereço
const alvoDeLeitura = (i: ItemEntrada) => (i.canal === 'email' && i.extra?.thread_id ? String(i.extra.thread_id) : i.destino.id);
// o resumo da lista é para ler de relance: sem endereço e sem os colchetes de link de e-mail em HTML
const semLinks = (t: string) => t.replace(/[(<]?\s*https?:\/\/[^\s)>]+\s*[)>]?/g, ' ').replace(/[[\]]|\*\*/g, ' ');

export function filtrarEntrada(entrada: RespostaEntrada | null, verTudo: boolean, busca: string) {
  const alvo = semAcento(busca);
  return (entrada?.itens || [])
    .filter((i) => verTudo || i.precisa)
    .filter((i) => !alvo || [i.titulo, i.de, i.texto, i.destino.nome].some((c) => semAcento(c).includes(alvo)))
    .sort((a, b) => b.em - a.em);
}

export function useItensEntrada() {
  const entrada = useSel(dados, (e) => e.entrada);
  const verTudo = useSel(ui, (e) => e.verTudo);
  const busca = useSel(ui, (e) => e.busca);
  return useMemo(() => filtrarEntrada(entrada, verTudo, busca), [entrada, verTudo, busca]);
}

// mensagem de mentira para as prévias (a resposta só vira mensagem de verdade ao enviar)
function rascunhoComoMensagem(i: ItemEntrada, corpo: string): Mensagem {
  const agora = Date.now();
  return {
    id: 0, criado_em: agora, atualizado_em: agora, status: 'pendente', canal: i.canal, conta: i.conta || null,
    destino_id: paraQuem(i), destino_nome: i.destino.nome, destino_tipo: i.destino.tipo || null, para_pedido: null, candidatos: null,
    responder_a: null, contexto: null, assunto: (i.extra?.assunto as string) || null, corpo, corpo_original: corpo, anexos: null,
    extra: { ...(i.extra || {}), ...(copiasDe(i) ? { cc: copiasDe(i) } : {}) }, cliente: null, sessao_nome: 'painel', sessao_job: null, agendar_para: null, aprovado_em: null, enviado_em: null,
    proxima_tentativa: null, tentativas: 0, ultimo_erro: null, resultado: null, app: null, origem: null,
  };
}

function falasDo(i: ItemEntrada, conversa?: { em: string; de: string; texto: string; eu?: boolean }[]): FalaContexto[] {
  if (conversa?.length) {
    return conversa.map((c, k) => ({ id: '', de: c.de, eu: c.eu ?? ehEu(c.de), texto: c.texto, em: Date.parse(c.em) || i.em - (conversa.length - k) * 60e3 }));
  }
  const lista = i.mensagens?.length ? i.mensagens : [{ id: i.citar?.id, de: i.de || i.titulo, texto: i.texto || '', em: i.em, sender: i.citar?.sender || undefined }];
  return lista.map((f) => ({ id: f.id || '', sender: f.sender, de: f.de, eu: ehEu(f.de), texto: f.texto, em: f.em }));
}

export function ItemDaLista({ i, selecionado, onClick }: { i: ItemEntrada; selecionado: boolean; onClick: () => void }) {
  const agora = useAgora(30_000);
  const msgs = i.mensagens?.length || 1;
  return (
    <div id={`ent-${i.chave}`} role="option" aria-selected={selecionado} data-atual={selecionado} className="item cursor-pointer" onClick={onClick}>
      <span className="mt-0.5 flex h-5 items-center justify-center"><GlifoOuFoto canal={i.canal} jid={i.destino.id} /></span>
      <span className="min-w-0">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-bold">{quemEspera(i)}</span>
          <span className="flex-none text-meta text-tx-3 tabular">{curto(i.em, agora)}</span>
        </span>
        {i.canal === 'email' ? (
          <span className="mt-0.5 line-clamp-2 text-ui text-tx-2">
            <span className="font-semibold text-tx">{i.titulo}</span>{' '}
            {textoLimpo(semLinks(i.texto || '')).slice(0, 200)}
          </span>
        ) : (
          <span className="mt-0.5 line-clamp-2 text-ui text-tx-2">
            {i.de && i.de !== i.titulo ? <span className="font-semibold text-tx">{i.de.split(' ')[0]}: </span> : null}
            {textoLimpo(i.texto || '')}
          </span>
        )}
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-meta">
          {i.motivo && <Etiqueta>{i.motivo}</Etiqueta>}
          {msgs > 1 && <span className="text-tx-3">{msgs} seguidas</span>}
          {i.resposta && (
            <Etiqueta tom={i.resposta.status === 'enviada' ? 'ok' : 'contorno'}>
              {i.resposta.status === 'enviada' ? <Check size={12} strokeWidth={2.4} aria-hidden /> : null}
              {i.resposta.status === 'enviada' ? 'respondida' : `resposta #${i.resposta.id} ${i.resposta.status === 'pendente' ? 'para revisar' : i.resposta.status}`}
            </Etiqueta>
          )}
        </span>
      </span>
    </div>
  );
}

// sem onCitar (aba Acompanhar) a conversa é só para ler: nada vira citação
export function Conversa({ i, rascunho, citar, onCitar }: { i: ItemEntrada; rascunho: string; citar: Citar | null; onCitar?: (c: Citar | null) => void }) {
  const lerTudo = useSel(ui, (e) => e.lerConversa === i.chave);
  const config = useSel(dados, (e) => e.config);
  const ler = useLer(lerTudo ? i.canal : null, lerTudo ? alvoDeLeitura(i) : null, 40, i.conta);
  const agora = useAgora(30_000);
  const falas = falasDo(i, lerTudo ? ler.dados?.mensagens : undefined);
  const m = rascunhoComoMensagem(i, rascunho);
  const temRascunho = !!rascunho.trim();

  if (i.canal === 'whatsapp') {
    return (
      <PreviaWhatsapp
        m={m}
        previa={{ canal: 'whatsapp', para: { id: i.destino.id, nome: i.destino.nome, tipo: i.destino.tipo === 'grupo' ? 'grupo' : 'contato' }, corpo: rascunho, mencoes: [], citar, anexos: [], contexto: falas }}
        corpo={rascunho}
        citar={citar}
        onCitar={onCitar}
        semResposta={!temRascunho}
        medir={temRascunho}
      />
    );
  }
  if (i.canal === 'email') {
    // o que chegou, por inteiro; com "Ler a conversa", o fio do Gmail, e a resposta em rascunho entra no fim
    const fio = lerTudo ? ler.dados?.mensagens : undefined;
    const lidas: MensagemLida[] = fio?.length
      ? fio.map((f) => ({ de: f.de, email: f.email, em: Date.parse(f.em) || 0, texto: f.texto, citado: f.citado, para: f.para, cc: f.cc, anexos: f.anexos, cortado: f.cortado }))
      : [{ de: i.de || i.destino.nome, email: i.email?.de, em: i.em, texto: i.texto || '', citado: i.citado, para: i.email?.para, cc: i.email?.cc, anexos: i.email?.anexos, cortado: i.email?.cortado, semLeitura: i.email ? !i.email.lido : false }];
    const cc = copiasDe(i);
    return (
      <EmailLido
        key={fio?.length ? 'fio' : 'chegou'}
        assunto={i.titulo}
        mensagens={lidas}
        conta={i.conta || ''}
        link={i.link}
        nota={lerTudo && !fio?.length ? (ler.erro ? `Não consegui ler a conversa: ${explicar(ler.erro)}` : ler.dados?.aviso || 'Lendo a conversa no Gmail.') : undefined}
      >
        {temRascunho && (
          <SaidaEmail
            m={m}
            texto={rascunho}
            marca="ainda não enviada"
            previa={{
              canal: 'email', conta: { id: i.conta || '', email: i.conta || '' }, para: paraQuem(i), cc: cc || null,
              assunto: String(i.extra?.assunto || `Re: ${i.titulo}`), corpo: rascunho, assinatura: config?.assinaturas?.[i.conta || ''] || '', thread: [],
            }}
          />
        )}
      </EmailLido>
    );
  }
  // discord
  let dia = '';
  return (
    <div className="dc">
      <div className="dc-topo"><span className="text-[var(--dc-meta)]">#</span><span className="truncate">{i.destino.nome.replace(/^#/, '')}</span></div>
      <div className="dc-corpo">
        {falas.map((f, k) => {
          const novoDia = chaveDia(f.em) !== dia;
          dia = chaveDia(f.em);
          return (
            <div key={k}>
              {novoDia && <div className="dc-corte text-[var(--dc-meta)] before:bg-[var(--dc-head-line)] after:bg-[var(--dc-head-line)]">{cabecalhoDia(f.em, agora)}</div>}
              <div className="dc-msg">
                <Iniciais nome={f.de} tamanho={40} />
                <div className="min-w-0">
                  <div className="dc-cab"><span className="dc-nome">{f.de}</span><span className="dc-hora">{hhmm(f.em)}</span></div>
                  <TextoDiscord texto={f.texto} />
                </div>
              </div>
            </div>
          );
        })}
        {temRascunho && (
          <div className="dc-msg mt-2 rounded-item bg-accent-soft/50 py-2">
            <Iniciais nome="Bot" tamanho={40} />
            <div className="min-w-0">
              <div className="dc-cab"><span className="dc-nome">Bot</span><span className="dc-app">APP</span><span className="dc-hora">ainda não enviada</span></div>
              <TextoDiscord texto={rascunho} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Resposta({ i, onMudou }: { i: ItemEntrada; onMudou: () => void }) {
  const [texto, setTexto] = useState(rascunhos.get(i.chave) || '');
  const [enviando, setEnviando] = useState(false);
  const respondendo = useSel(ui, (e) => e.respondendo);
  const campo = useRef<HTMLTextAreaElement>(null);
  const fmt = FORMATACAO[i.canal];
  const citar = citacoes.has(i.chave) ? citacoes.get(i.chave)! : i.citar || null;
  const n = texto.length;
  const faixa = faixaDoTamanho(i.canal, n);

  useEffect(() => { if (respondendo === i.chave) campo.current?.focus(); }, [respondendo, i.chave]);
  useEffect(() => { rascunhos.set(i.chave, texto); onMudou(); }, [texto, i.chave, onMudou]);

  const enviar = async (aprovar: boolean) => {
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    const alvo = paraQuem(i) === i.destino.id ? i : { ...i, destino: { ...i.destino, id: paraQuem(i) } };
    const r = await responder(alvo, texto.trim(), citar, aprovar, copiasDe(i));
    setEnviando(false);
    if (r) {
      rascunhos.delete(i.chave);
      citacoes.delete(i.chave);
      paraTodos.delete(i.chave);
      noPedido.delete(i.chave);
      setTexto('');
      ui.set({ respondendo: null });
    }
  };
  const outros = i.canal === 'email' ? i.email?.outros || [] : [];
  // o endereço, não o nome: o nome em To/Cc é texto de quem mandou o e-mail ("Fulana <x@exemplo.net>")
  const enderecosDosOutros = outros.map((e) => e.email);
  const pedido = i.canal === 'email' ? i.email?.pedeRespostaEm : undefined;
  // no e-mail o que identifica o destino é o endereço (pode ser o Reply-To, diferente de quem assinou)
  const comoVai = i.canal === 'email' ? paraQuem(i) : i.destino.tipo ? (TIPO_DESTINO[i.destino.tipo] || i.destino.tipo).toLowerCase() : null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="rotulo">Responder para</p>
        <p className="font-bold">{i.destino.nome}</p>
        <p className="text-meta text-tx-3 [overflow-wrap:anywhere]">{[NOME_CANAL[i.canal], comoVai, i.conta ? `conta ${i.conta}` : null].filter(Boolean).join(', ')}</p>
      </div>
      {pedido && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-item border border-warn-line bg-warn-soft px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4 flex-none accent-[var(--accent)]"
            checked={noPedido.has(i.chave)}
            onChange={(e) => { if (e.target.checked) noPedido.add(i.chave); else noPedido.delete(i.chave); onMudou(); }}
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block text-ui font-semibold">Responder em {pedido}</span>
            <span className="block text-meta text-tx-2">
              O e-mail pede resposta nesse endereço, de outro domínio que o de quem assinou ({i.email?.de}). Marque só se reconhecer o endereço.
            </span>
          </span>
        </label>
      )}
      {outros.length > 0 && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-item border border-line bg-surface-2 px-3 py-2.5">
          <input
            type="checkbox"
            className="mt-0.5 size-4 flex-none accent-[var(--accent)]"
            checked={paraTodos.has(i.chave)}
            onChange={(e) => { if (e.target.checked) paraTodos.add(i.chave); else paraTodos.delete(i.chave); onMudou(); }}
          />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block text-ui font-semibold">Responder a todos</span>
            <span className="block text-meta text-tx-3" title={enderecosDosOutros.join(', ')}>
              {paraTodos.has(i.chave) ? 'Vai em cópia para ' : `Sem isso, ${outros.length === 1 ? 'fica de fora' : 'ficam de fora'} `}
              {enderecosDosOutros.length > 4 ? `${enderecosDosOutros.slice(0, 3).join(', ')} e mais ${enderecosDosOutros.length - 3}` : enderecosDosOutros.join(', ')}.
            </span>
          </span>
        </label>
      )}
      {i.canal === 'whatsapp' && (
        citar ? (
          <div className="relative rounded-item border border-line bg-surface-2 px-3 py-2">
            <p className="text-meta font-bold text-accent-tx">Citando {citar.de || 'a mensagem'}</p>
            <p className="line-clamp-2 text-ui text-tx-2">{textoLimpo(citar.texto || '')}</p>
            <p className="mt-1 text-meta text-tx-3">Escolha outra mensagem da conversa para trocar.</p>
            <button type="button" className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full text-tx-3 hover:bg-surface-3" onClick={() => { citacoes.set(i.chave, null); onMudou(); }} aria-label="Tirar a citação"><X size={14} strokeWidth={2} /></button>
          </div>
        ) : <p className="text-meta text-tx-3">Sem citação. Escolha uma mensagem da conversa para citar.</p>
      )}
      <label className="block">
        <span className="sr-only">Sua resposta</span>
        <textarea
          ref={campo}
          className="campo min-h-40 text-ler"
          value={texto}
          placeholder={`Escreva a resposta. ${fmt.negrito ? `${fmt.negrito}negrito${fmt.negrito} funciona aqui.` : 'Texto simples.'}`}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); return; }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void enviar(true); return; }
            if (campo.current) atalhoDeFormato(e, campo.current, fmt);
          }}
          lang="pt-BR"
        />
      </label>
      <p className={`text-meta tabular ${faixa === 'ok' ? 'text-tx-3' : faixa === 'aviso' ? 'text-warn' : 'text-danger'}`}>
        {numero(n)} caracteres{FAIXAS[i.canal].nota(n) ? `: ${FAIXAS[i.canal].nota(n)}` : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-principal" disabled={!texto.trim() || enviando} onClick={() => enviar(true)}>
          <Send size={15} strokeWidth={2.2} aria-hidden /> Aprovar e enviar <Tecla>⌘↵</Tecla>
        </button>
        <button type="button" className="btn" disabled={!texto.trim() || enviando} onClick={() => enviar(false)}>Deixar para revisar</button>
      </div>
    </div>
  );
}

export function TelaEntrada({ buscaRef }: { buscaRef: React.RefObject<HTMLInputElement | null> }) {
  const entrada = useSel(dados, (e) => e.entrada);
  const estado = useSel(dados, (e) => e.entradaEstado);
  const verTudo = useSel(ui, (e) => e.verTudo);
  const sel = useSel(ui, (e) => e.sel.entrada);
  const lerTudo = useSel(ui, (e) => e.lerConversa);
  const [, mudou] = useReducer((x: number) => x + 1, 0); // rascunho e citação vivem fora do React
  const itens = useItensEntrada();
  const largo = useMidia('(min-width: 1180px)');
  const atual = itens.find((i) => i.chave === sel) || null;

  useEffect(() => { if (!entrada) void carregarEntrada(); }, [entrada]);
  useEffect(() => {
    if (!atual && itens.length) ui.set((e) => ({ sel: { ...e.sel, entrada: itens[0].chave } }));
  }, [atual, itens]);
  useEffect(() => {
    document.getElementById(`ent-${sel}`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const alternarVerTudo = (v: boolean) => {
    ui.set({ verTudo: v });
    try { localStorage.setItem('central:verTudo', v ? '1' : '0'); } catch { /* sem storage */ }
  };
  const citarAtual = atual ? (citacoes.has(atual.chave) ? citacoes.get(atual.chave)! : atual.citar || null) : null;
  const erros = Object.entries(entrada?.erros || {});
  const cont = entrada?.contagem;

  return (
    <div className={`grid h-full min-h-0 ${largo ? 'grid-cols-[22rem_minmax(0,1fr)_23rem]' : 'grid-cols-[20rem_minmax(0,1fr)]'}`}>
      <aside className="flex min-h-0 flex-col border-r border-line" aria-label="O que chegou">
        <div className="flex flex-col gap-3 px-4 pt-5 pb-3">
          <div className="flex items-end justify-between">
            <h1 className="text-sub font-bold text-tx-2">Entrada</h1>
            <span className="font-num text-[1.5rem] leading-none font-bold tabular">{numero(cont?.precisa ?? 0)}</span>
          </div>
          <TrocaEntrada />
          <div className="grid grid-cols-2 rounded-botao segmentos bg-surface-3 p-0.5" role="group" aria-label="O que mostrar">
            <button type="button" aria-pressed={!verTudo} onClick={() => alternarVerTudo(false)} className={`rounded-[6px] px-2 py-1.5 text-ui font-semibold ${!verTudo ? 'bg-surface text-tx shadow-1' : 'text-tx-2'}`}>
              É pra você{cont ? ` (${cont.precisa})` : ''}
            </button>
            <button type="button" aria-pressed={verTudo} onClick={() => alternarVerTudo(true)} className={`rounded-[6px] px-2 py-1.5 text-ui font-semibold ${verTudo ? 'bg-surface text-tx shadow-1' : 'text-tx-2'}`}>
              Tudo que chegou{cont ? ` (${cont.total})` : ''}
            </button>
          </div>
          <CampoBusca ref={buscaRef} />
          {erros.length > 0 && (
            <div className="rounded-item border border-warn-line bg-warn-soft px-3 py-2 text-meta text-warn">
              {erros.map(([canal, erro]) => <p key={canal}><span className="font-bold">{NOME_CANAL[canal as keyof typeof NOME_CANAL] || canal}:</span> {erro}</p>)}
            </div>
          )}
        </div>
        {!itens.length && (
          <div className="rolagem min-h-0 flex-1 px-2 pb-10">
            {estado === 'carregando' && <div className="px-3"><Esqueleto linhas={6} /></div>}
            {estado === 'erro' && <Vazio titulo="Não consegui ler a Entrada." icone={<CircleAlert size={22} strokeWidth={1.75} />}>Os canais não responderam. A Central tenta de novo sozinha.</Vazio>}
            {estado === 'ok' && (
              <Vazio titulo={verTudo ? 'Nada chegou ainda.' : 'Ninguém espera você agora.'} icone={<Inbox size={22} strokeWidth={1.75} />}>
                {!verTudo && cont?.total ? <button type="button" className="btn btn-pequeno mt-1" onClick={() => alternarVerTudo(true)}>Ver as {cont.total} que chegaram</button> : null}
              </Vazio>
            )}
          </div>
        )}
        {itens.length > 0 && (
          <div className="rolagem min-h-0 flex-1 px-2 pb-10" role="listbox" aria-label="Entrada" aria-activedescendant={sel ? `ent-${sel}` : undefined} tabIndex={0}>
            {itens.map((i) => <ItemDaLista key={i.chave} i={i} selecionado={i.chave === sel} onClick={() => ui.set((e) => ({ sel: { ...e.sel, entrada: i.chave } }))} />)}
          </div>
        )}
      </aside>

      {atual ? (
        <>
          <main className="flex min-h-0 flex-col bg-sunk">
            <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-meta text-tx-3"><Glifo canal={atual.canal} tamanho={14} /> {NOME_CANAL[atual.canal]}{atual.conta ? `, conta ${atual.conta}` : ''}</p>
                <h2 className="mt-1 truncate text-titulo font-extrabold tracking-[-0.01em]">{quemEspera(atual)}</h2>
                {atual.motivo && <p className="mt-0.5 text-ui text-tx-2">{atual.motivo}</p>}
              </div>
              <div className="flex flex-none flex-wrap justify-end gap-2">
                <button type="button" className="btn btn-pequeno" aria-pressed={lerTudo === atual.chave} onClick={() => ui.set({ lerConversa: lerTudo === atual.chave ? null : atual.chave })}>
                  <BookOpen size={14} strokeWidth={2} aria-hidden /> {lerTudo === atual.chave ? 'Só o que chegou' : 'Ler a conversa'} <Tecla>L</Tecla>
                </button>
                {atual.precisa && (
                  <button type="button" className="btn btn-pequeno" onClick={() => marcarVisto(atual)}>
                    <EyeOff size={14} strokeWidth={2} aria-hidden /> Não precisa de mim <Tecla>I</Tecla>
                  </button>
                )}
                {atual.resposta && (
                  <button type="button" className="btn btn-pequeno" onClick={() => irPara(atual.resposta!.status === 'pendente' ? 'revisar' : atual.resposta!.status === 'enviada' ? 'enviadas' : 'fila', atual.resposta!.id)}>
                    <MessagesSquare size={14} strokeWidth={2} aria-hidden /> Ver a resposta #{atual.resposta.id}
                  </button>
                )}
              </div>
            </header>
            <div key={atual.chave} className="rolagem @container min-h-0 flex-1 px-6 pb-10" tabIndex={0} role="region" aria-label={`Conversa com ${quemEspera(atual)}`}>
              <div className="flex justify-center">
                <Conversa
                  i={atual}
                  rascunho={rascunhos.get(atual.chave) || ''}
                  citar={citarAtual}
                  onCitar={(c) => { citacoes.set(atual.chave, c); mudou(); }}
                />
              </div>
            </div>
            {!largo && (
              <div className="border-t border-line bg-surface px-6 py-4"><Resposta key={atual.chave} i={atual} onMudou={mudou} /></div>
            )}
          </main>
          {largo && (
            <aside className="rolagem min-h-0 border-l border-line bg-surface px-5 py-5" aria-label="Resposta">
              <Resposta key={atual.chave} i={atual} onMudou={mudou} />
              {atual.precisa === false && atual.motivo && (
                <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-meta text-tx-3"><TriangleAlert size={14} strokeWidth={2} className="mt-0.5" aria-hidden /> Está aqui só porque você pediu para ver tudo.</p>
              )}
              <div className="mt-6 border-t border-line pt-4 text-meta text-tx-3">
                <p className="rotulo">Atalhos aqui</p>
                <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
                  <dt className="flex gap-1"><Tecla>J</Tecla><Tecla>K</Tecla></dt><dd>anda pela lista</dd>
                  <dt><Tecla>R</Tecla></dt><dd>responde citando a mensagem escolhida</dd>
                  <dt><Tecla>I</Tecla></dt><dd>não precisa de mim</dd>
                  <dt><Tecla>L</Tecla></dt><dd>lê a conversa inteira</dd>
                </dl>
              </div>
            </aside>
          )}
        </>
      ) : (
        <main className={`grid min-h-0 place-items-center bg-sunk ${largo ? 'col-span-2' : ''}`}>
          <Vazio titulo="Escolha uma conversa." icone={<MessagesSquare size={22} strokeWidth={1.75} />}>
            <p>{plural(itens.length, 'conversa', 'conversas')} na lista.</p>
          </Vazio>
        </main>
      )}
    </div>
  );
}

export { rascunhos as rascunhosEntrada, citacoes as citacoesEntrada };
