// Escolhe a prévia do canal. Usa /previa (mesmo código do envio) e, enquanto ela não chega, monta uma local.
// Na prévia grande, a local só aparece se a do servidor demorar: senão o rascunho surge sozinho e,
// um instante depois, a conversa entra em cima dele (a tela pula). J/K não esperam: a vizinha já vem buscada.
import { useEffect, useReducer, useRef } from 'react';
import { usePrevia } from '../lib/consultas';
import { previaLocal } from './local';
import { PreviaWhatsapp } from './PreviaWhatsapp';
import { PreviaEmail } from './PreviaEmail';
import { PreviaDiscord } from './PreviaDiscord';
import { diffPalavras, contarMudancas } from '../lib/diff';
import type { Citar, Mensagem, Previa as TPrevia } from '../lib/tipos';

export interface PropsPrevia {
  m: Mensagem;
  corpo?: string;
  assunto?: string;
  citar?: Citar | null;
  onCitar?: (c: Citar | null) => void;
  compacta?: boolean;
  previaFixa?: TPrevia | null;
}

const PACIENCIA = 450;

export function Previa({ m, corpo, assunto, citar, onCitar, compacta, previaFixa }: PropsPrevia) {
  const { dados, erro } = usePrevia(previaFixa === undefined ? m : null);
  const servidor = previaFixa !== undefined ? previaFixa : dados;
  const inicio = useRef({ id: m.id, em: Date.now() });
  if (inicio.current.id !== m.id) inicio.current = { id: m.id, em: Date.now() };
  const [, forcar] = useReducer((x: number) => x + 1, 0);
  const esperar = !compacta && previaFixa === undefined && !!m.destino_id && !servidor && !erro && Date.now() - inicio.current.em < PACIENCIA;
  useEffect(() => {
    if (!esperar) return;
    const t = window.setTimeout(forcar, PACIENCIA - (Date.now() - inicio.current.em));
    return () => window.clearTimeout(t);
  }, [esperar, m.id]);
  if (esperar) return <div className="min-h-[40vh] w-full" aria-busy="true" />;
  const p = servidor && servidor.canal === m.canal ? servidor : previaLocal(m);
  if (p.canal === 'whatsapp') return <PreviaWhatsapp m={m} previa={p} corpo={corpo} citar={citar} onCitar={onCitar} compacta={compacta} medir={!compacta} />;
  if (p.canal === 'email') return <PreviaEmail m={m} previa={p} corpo={corpo} assunto={assunto} />;
  return <PreviaDiscord m={m} previa={p} corpo={corpo} />;
}

export function Diferenca({ antes, depois, rotuloAntes, rotuloDepois }: { antes: string; depois: string; rotuloAntes: string; rotuloDepois: string }) {
  const trechos = diffPalavras(antes, depois);
  const { mais, menos } = contarMudancas(trechos);
  return (
    <div className="w-full max-w-[46rem] rounded-painel border border-line bg-surface shadow-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 text-meta">
        <span className="font-bold text-tx">{rotuloAntes} → {rotuloDepois}</span>
        <span className="text-ok tabular">+{mais} {mais === 1 ? 'palavra' : 'palavras'}</span>
        <span className="text-danger tabular">−{menos} {menos === 1 ? 'palavra' : 'palavras'}</span>
        <span className="ml-auto text-tx-3">Esc volta para a prévia</span>
      </div>
      <p className="whitespace-pre-wrap px-5 py-4 text-ler">
        {trechos.map((t, i) => t.tipo === 'igual' ? <span key={i}>{t.texto}</span>
          : t.tipo === 'mais' ? <ins key={i} className="diff-mais">{t.texto}</ins>
            : <del key={i} className="diff-menos">{t.texto}</del>)}
      </p>
    </div>
  );
}
