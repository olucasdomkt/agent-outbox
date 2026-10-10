// Editor (E): texto cru à esquerda com a barra de formatação do canal, prévia ao vivo à direita,
// contador com as faixas do canal e o linter rodando enquanto você digita.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bold, Code, CircleCheck, GitCompareArrows, Italic, List, ListOrdered, OctagonX, Quote, Strikethrough, TriangleAlert, X,
} from 'lucide-react';
import { api } from '../lib/api';
import { aprovar, salvar } from '../lib/acoes';
import { avisar, ui } from '../lib/loja';
import { FAIXAS, FORMATACAO, NOME_CANAL, faixaDoTamanho, Glifo } from '../lib/canais';
import { aspas, numero } from '../lib/formato';
import { devolverFoco } from '../lib/foco';
import { Previa, Diferenca } from '../previas/Previa';
import { atalhoDeFormato, envolver, prefixar } from '../lib/edicao';
import { Tecla, Dica } from './ui';
import type { Citar, Lint, Mensagem } from '../lib/tipos';

const rascunhos = new Map<number, { corpo: string; assunto: string }>();

function Contador({ m, n }: { m: Mensagem; n: number }) {
  const f = FAIXAS[m.canal];
  const faixa = faixaDoTamanho(m.canal, n);
  const teto = Math.max(n, (f.limite || f.bom) * 1.3);
  const nota = f.nota(n);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <div className="absolute inset-y-0 left-0 bg-ok-soft" style={{ width: `${(f.bom / teto) * 100}%` }} />
        {f.limite && <div className="absolute inset-y-0 bg-warn-soft" style={{ left: `${(f.bom / teto) * 100}%`, width: `${((f.limite - f.bom) / teto) * 100}%` }} />}
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ${faixa === 'ok' ? 'bg-ok' : faixa === 'aviso' ? 'bg-warn-icon' : 'bg-danger'}`}
          style={{ width: `${Math.min(100, (n / teto) * 100)}%` }}
        />
      </div>
      <p className={`text-meta tabular ${faixa === 'ok' ? 'text-tx-3' : faixa === 'aviso' ? 'font-semibold text-warn' : 'font-semibold text-danger'}`}>
        {numero(n)} caracteres{nota ? `: ${nota}` : f.limite ? `, bom até ${numero(f.bom)} no ${NOME_CANAL[m.canal]}` : ''}
      </p>
    </div>
  );
}

function LintAoVivo({ lint, carregando }: { lint: Lint | null; carregando: boolean }) {
  if (!lint) return <p className="text-meta text-tx-3">{carregando ? 'Conferindo…' : ''}</p>;
  const itens = [...lint.bloqueios.map((b) => ({ ...b, bloqueia: true })), ...lint.avisos.filter((a) => a.regra !== 'tamanho').map((a) => ({ ...a, bloqueia: false }))];
  if (!itens.length) {
    return <p className="flex items-center gap-2 text-ui text-ok"><CircleCheck size={15} strokeWidth={2} aria-hidden /> Nada a apontar.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {itens.map((x, i) => (
        <li key={i} className={`flex items-start gap-2 text-ui ${x.bloqueia ? 'font-semibold text-danger' : 'text-warn'}`}>
          {x.bloqueia ? <OctagonX size={15} strokeWidth={2.2} className="mt-0.5 flex-none" aria-hidden /> : <TriangleAlert size={15} strokeWidth={2.2} className="mt-0.5 flex-none text-warn-icon" aria-hidden />}
          <span>{aspas(x.msg)}{x.trecho ? <span className="ml-1 font-mono text-meta text-tx-2">{x.trecho}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

export function Editor({ m }: { m: Mensagem }) {
  const rascunho = rascunhos.get(m.id);
  const [corpo, setCorpo] = useState(rascunho?.corpo ?? m.corpo);
  const [assunto, setAssunto] = useState(rascunho?.assunto ?? (m.assunto || ''));
  const [citar, setCitar] = useState<Citar | null | undefined>(undefined);
  const [lint, setLint] = useState<Lint | null>(m.lint || null);
  const [conferindo, setConferindo] = useState(false);
  const [diff, setDiff] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  const fmt = FORMATACAO[m.canal];
  const mudou = corpo !== m.corpo || (m.canal === 'email' && assunto !== (m.assunto || '')) || citar !== undefined;

  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    if (rascunho) avisar('Voltei com o rascunho que você não salvou.', 'info');
    // só na abertura
  }, []);

  // guarda o rascunho enquanto edita (Esc não perde o que você escreveu)
  useEffect(() => {
    if (mudou) rascunhos.set(m.id, { corpo, assunto });
    else rascunhos.delete(m.id);
  }, [corpo, assunto, mudou, m.id]);

  useEffect(() => {
    const ctl = new AbortController();
    setConferindo(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await api.lint({ id: m.id, canal: m.canal, destino_id: m.destino_id, destino_nome: m.destino_nome, cliente: m.cliente, assunto, corpo }, ctl.signal);
        setLint(r);
      } catch { /* mantém o último */ }
      finally { if (!ctl.signal.aborted) setConferindo(false); }
    }, 380);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [corpo, assunto, m.id, m.canal, m.destino_id, m.destino_nome, m.cliente]);

  const fechar = () => { ui.set({ editando: null }); devolverFoco(); };
  const gravar = async (eAprovar: boolean) => {
    if (salvando) return;
    if (!corpo.trim()) { avisar('O texto está vazio.', 'erro'); return; }
    setSalvando(true);
    const campos: Partial<Mensagem> = {};
    if (corpo !== m.corpo) campos.corpo = corpo;
    if (m.canal === 'email' && assunto !== (m.assunto || '')) campos.assunto = assunto;
    if (citar !== undefined) campos.extra = { ...(m.extra || {}), citar };
    const r = Object.keys(campos).length ? await salvar(m.id, campos) : m;
    setSalvando(false);
    if (!r) return;
    rascunhos.delete(m.id);
    fechar();
    if (eAprovar) await aprovar([m.id]);
    else avisar(`#${m.id} salva${r.status === 'pendente' && m.status === 'aprovada' ? ' e de volta para revisão' : ''}.`, 'ok');
  };

  const teclas = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    const cmd = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); return; }
    if (cmd && e.key === 'Enter') { e.preventDefault(); void gravar(true); return; }
    if (cmd && e.key.toLowerCase() === 's') { e.preventDefault(); void gravar(false); return; }
    const el = campo.current;
    if (el && e.currentTarget === el) atalhoDeFormato(e, el, fmt);
  };

  const ferramentas = useMemo(() => [
    { id: 'b', rotulo: 'Negrito', atalho: '⌘B', Icone: Bold, ok: !!fmt.negrito, fazer: (el: HTMLTextAreaElement) => envolver(el, fmt.negrito!) },
    { id: 'i', rotulo: 'Itálico', atalho: '⌘I', Icone: Italic, ok: !!fmt.italico, fazer: (el: HTMLTextAreaElement) => envolver(el, fmt.italico!) },
    { id: 's', rotulo: 'Tachado', atalho: '⌘⇧X', Icone: Strikethrough, ok: !!fmt.tachado, fazer: (el: HTMLTextAreaElement) => envolver(el, fmt.tachado!) },
    { id: 'c', rotulo: 'Código', atalho: '⌘E', Icone: Code, ok: !!fmt.codigo, fazer: (el: HTMLTextAreaElement) => envolver(el, fmt.codigo!) },
    { id: 'ul', rotulo: 'Lista', atalho: '⌘⇧8', Icone: List, ok: fmt.lista, fazer: (el: HTMLTextAreaElement) => prefixar(el, 'ul') },
    { id: 'ol', rotulo: 'Lista numerada', atalho: '⌘⇧7', Icone: ListOrdered, ok: fmt.lista, fazer: (el: HTMLTextAreaElement) => prefixar(el, 'ol') },
    { id: 'q', rotulo: 'Citação', atalho: '', Icone: Quote, ok: fmt.citacao, fazer: (el: HTMLTextAreaElement) => prefixar(el, 'cit') },
  ], [fmt]);

  const vivo = { ...m, corpo, assunto, extra: citar !== undefined ? { ...(m.extra || {}), citar } : m.extra } as Mensagem;
  const largo = m.canal !== 'whatsapp';

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" role="region" aria-label={`Editando a #${m.id}`}>
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3.5">
        <Glifo canal={m.canal} tamanho={16} />
        <h2 className="min-w-0 truncate text-sub font-extrabold">Editando para {m.destino_nome || m.para_pedido || 'destino a escolher'}</h2>
        <span className="font-mono text-meta text-tx-3">#{m.id}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className="btn btn-fantasma" onClick={fechar}>Cancelar <Tecla>Esc</Tecla></button>
          <button type="button" className="btn" disabled={!mudou || salvando} onClick={() => gravar(false)}>Salvar <Tecla>⌘S</Tecla></button>
          <button type="button" className="btn btn-principal" disabled={salvando || !!lint?.bloqueios?.length} onClick={() => gravar(true)}>
            Salvar e aprovar <Tecla>⌘↵</Tecla>
          </button>
        </div>
      </header>
      <div className={`grid min-h-0 flex-1 ${largo ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_minmax(0,27rem)]'}`}>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-line px-6 py-4">
          {m.canal === 'email' && (
            <label className="block">
              <span className="rotulo">Assunto</span>
              <input className="campo" value={assunto} onChange={(e) => setAssunto(e.target.value)} onKeyDown={teclas} placeholder="Assunto do e-mail" />
            </label>
          )}
          <div className="flex items-center gap-1" role="toolbar" aria-label={`Formatação do ${NOME_CANAL[m.canal]}`}>
            {ferramentas.filter((f) => f.ok).map((f) => (
              <Dica key={f.id} texto={<>{f.rotulo}{f.atalho ? <span className="ml-2 font-mono opacity-70">{f.atalho}</span> : null}</>}>
                <button
                  type="button"
                  className="btn btn-fantasma btn-icone h-8 w-8"
                  aria-label={f.rotulo}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => campo.current && f.fazer(campo.current)}
                >
                  <f.Icone size={16} strokeWidth={2} />
                </button>
              </Dica>
            ))}
            <span className="ml-2 min-w-0 truncate text-meta text-tx-3">
              {fmt.explicacao.split(/(`{3}[^`]+`{3}|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_|~~?[^~]+~~?)/).map((p, i) => (i % 2 ? <code key={i} className="font-mono text-tx-2">{p}</code> : p))}
            </span>
          </div>
          <textarea
            ref={campo}
            className="campo min-h-[18rem] flex-1 resize-none font-sans text-ler"
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            onKeyDown={teclas}
            spellCheck
            lang="pt-BR"
            aria-label="Texto da mensagem"
          />
          <Contador m={m} n={corpo.length} />
        </div>
        <div className="flex min-h-0 flex-col overflow-y-auto bg-sunk">
          <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
            <p className="rotulo mb-0">{diff ? 'O que mudou desde a sessão' : 'Como vai chegar'}</p>
            {(m.corpo_original !== corpo) && (
              <button type="button" className="btn btn-fantasma btn-pequeno" onClick={() => setDiff((d) => !d)} aria-pressed={diff}>
                {diff ? <X size={14} strokeWidth={2} aria-hidden /> : <GitCompareArrows size={14} strokeWidth={2} aria-hidden />} {diff ? 'Voltar à prévia' : 'Ver diferença'}
              </button>
            )}
          </div>
          <div className="@container flex justify-center px-5 pb-4">
            {diff
              ? <Diferenca antes={m.corpo_original} depois={corpo} rotuloAntes="Sessão" rotuloDepois="Agora" />
              : <Previa m={vivo} corpo={corpo} assunto={assunto} citar={citar !== undefined ? citar : undefined} onCitar={m.canal === 'whatsapp' ? (c) => setCitar(c) : undefined} />}
          </div>
          <div className="sticky bottom-0 z-10 mt-auto border-t border-line bg-surface px-5 py-3.5">
            <p className="rotulo">Conferência ao vivo</p>
            <LintAoVivo lint={lint} carregando={conferindo} />
          </div>
        </div>
      </div>
    </div>
  );
}
