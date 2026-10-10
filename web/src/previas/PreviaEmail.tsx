// E-mail como o Gmail vai mostrar: assunto, conversa anterior recolhida, conta, para/cc, corpo, assinatura e anexos.
// Asterisco e markdown aparecem crus (é isso que o Gmail faz) e ficam marcados para você ver.
import { useState, type ReactNode } from 'react';
import { ChevronDown, Paperclip } from 'lucide-react';
import { ddmm, diaRelativo, hhmm, ha } from '../lib/formato';
import { useAgora } from '../lib/tempo';
import { matiz } from '../lib/canais';
import { dados, useSel } from '../lib/loja';
import { Miniatura } from '../componentes/Miniatura';
import { urlSegura } from '../lib/url';
import type { Mensagem, PreviaEmail as P } from '../lib/tipos';

const RE_CRU = /(\*\*[^*\n]+\*\*|(?<![\p{L}\p{N}*])\*(?!\s)[^*\n]+?\*(?![\p{L}\p{N}*])|^#{1,6}\s|`[^`\n]+`|^>\s|\[[^\]\n]+\]\([^)\n]+\))/gmu;

function marcarCru(texto: string): ReactNode[] {
  const out: ReactNode[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(RE_CRU)) {
    const i = m.index ?? 0;
    if (i > ultimo) out.push(texto.slice(ultimo, i));
    out.push(<mark key={i} className="gm-cru" title="O Gmail mostra isso cru, com os símbolos">{m[0]}</mark>);
    ultimo = i + m[0].length;
  }
  if (ultimo < texto.length) out.push(texto.slice(ultimo));
  return out;
}

export const avatar = (nome: string) => ({ background: `oklch(0.53 0.12 ${matiz(nome)})` });
export const inicial = (s: string) => (s.replace(/[^\p{L}]/gu, '')[0] || '?').toUpperCase();
const nomeDe = (de: string) => de.replace(/<.*>/, '').replace(/"/g, '').trim() || de;

export function dataGmail(ms: number, agora: number) {
  const dia = diaRelativo(ms, agora);
  if (dia === 'hoje') return `${hhmm(ms)} (${ha(ms, agora)})`;
  return `${ddmm(ms)}, ${hhmm(ms)}`;
}

// A mensagem que sai, como vai aparecer no fio: conta, para/cc, corpo com o que o Gmail mostra cru, assinatura
// e anexos. `marca` troca a hora por um aviso (a resposta que ainda está sendo escrita na Entrada).
export function SaidaEmail({ m, previa, texto, marca }: { m: Mensagem; previa: P; texto: string; marca?: string }) {
  const agora = useAgora(30_000);
  const quando = m.status === 'enviada' && m.enviado_em ? m.enviado_em : agora;
  const conta = previa.conta?.email || previa.conta?.id || m.conta || '';
  const dono = useSel(dados, (e) => e.resumo?.dono) || 'Você'; // o nome do config.json, como o Gmail assina
  return (
    <div className="gm-msg" data-rascunho={marca ? '' : undefined}>
      <div className="gm-cab">
        <span className="gm-avatar" style={avatar(dono)}>{inicial(dono)}</span>
        <span className="min-w-0">
          <span className="gm-de">{dono}</span> <span className="gm-email">&lt;{conta}&gt;</span>
          <span className="gm-para flex items-center gap-1">
            <span className="truncate">para {previa.para || <em className="text-danger not-italic">ninguém</em>}{previa.cc ? `, cc: ${previa.cc}` : ''}</span>
            <ChevronDown size={14} strokeWidth={2} aria-hidden className="flex-none" />
          </span>
        </span>
        <span className="whitespace-nowrap text-[12px] text-[var(--gm-meta)]">{marca || dataGmail(quando, agora)}</span>
      </div>
      <div className="gm-corpo">{texto ? marcarCru(texto) : <span className="text-[var(--gm-meta)]">(corpo vazio)</span>}</div>
      {previa.assinatura && <div className="gm-assinatura">{'-- \n'}{previa.assinatura}</div>}
      {previa.anexos && previa.anexos.length > 0 && (
        <div className="gm-anexos">
          <p className="flex w-full items-center gap-1.5 text-[13px] font-medium text-[var(--gm-meta)]">
            <Paperclip size={14} strokeWidth={2} aria-hidden /> {previa.anexos.length === 1 ? '1 anexo' : `${previa.anexos.length} anexos`}
          </p>
          {previa.anexos.map((a, i) => {
            const seguro = urlSegura(a.url);
            const dentro = <><Miniatura url={a.url} mime={a.mime} nome={a.nome} largura={176} className="capa" /><span className="nome">{a.nome}</span></>;
            return seguro
              ? <a key={i} className="gm-anexo" href={seguro} target="_blank" rel="noopener noreferrer" title={`Abrir ${a.nome}`}>{dentro}</a>
              : <div key={i} className="gm-anexo" title="O endereço deste anexo não é http(s): a Central não abre.">{dentro}</div>;
          })}
        </div>
      )}
    </div>
  );
}

export function PreviaEmail({ m, previa, corpo, assunto }: { m: Mensagem; previa: P; corpo?: string; assunto?: string }) {
  const agora = useAgora(30_000);
  const [abrirFio, setAbrirFio] = useState(false);
  const texto = corpo !== undefined ? corpo : previa.corpo ?? m.corpo;
  const titulo = (assunto !== undefined ? assunto : previa.assunto ?? m.assunto) || '';
  const fio = previa.thread || [];
  const recolhidas = fio.length > 3 && !abrirFio ? fio.length - 2 : 0;
  const visiveis = recolhidas ? fio.slice(-2) : fio;
  return (
    <div className="gm" aria-label={`Prévia do e-mail para ${previa.para}`}>
      <div className={`gm-assunto ${titulo.trim() ? '' : 'text-danger'}`}>{titulo.trim() || '(sem assunto: não sai assim)'}</div>
      {previa.threadAviso && <p className="px-6 pb-2 font-sans text-meta text-tx-3">{previa.threadAviso}</p>}
      {fio.length > 0 && (
        <div>
          {recolhidas > 0 && (
            <>
              <FioLinha de={fio[0].de} trecho={fio[0].trecho} em={fio[0].em} agora={agora} />
              <button type="button" className="relative flex w-full items-center gap-3 border-t border-[var(--gm-line)] px-6 py-1.5 text-left text-[var(--gm-meta)] hover:bg-[var(--gm-chip)]" onClick={() => setAbrirFio(true)}>
                <span className="grid size-10 place-items-center"><span className="grid size-7 place-items-center rounded-full border border-[var(--gm-line)] bg-[var(--gm-bg)] text-[12px] font-semibold">{recolhidas - 1}</span></span>
                <span className="text-[13px]">{recolhidas - 1 === 1 ? 'mais 1 mensagem' : `mais ${recolhidas - 1} mensagens`}</span>
              </button>
            </>
          )}
          {visiveis.map((t, i) => <FioLinha key={i} de={t.de} trecho={t.trecho} em={t.em} agora={agora} />)}
        </div>
      )}
      <SaidaEmail m={m} previa={previa} texto={texto} />
    </div>
  );
}

function FioLinha({ de, trecho, em, agora }: { de: string; trecho: string; em: number; agora: number }) {
  const nome = nomeDe(de);
  return (
    <div className="gm-fio">
      <span className="gm-avatar" style={avatar(nome)}>{inicial(nome)}</span>
      <span className="quem">{nome}</span>
      <span className="trecho">{trecho}</span>
      <span className="whitespace-nowrap text-[12px]">{dataGmail(em, agora)}</span>
    </div>
  );
}
