// Faixa "Sai em 10 s · Desfazer (Z)", avisos passageiros e a voz para leitor de tela.
import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Check, CircleAlert, CircleCheck, Info, Trash, X } from 'lucide-react';
import { desfazer } from '../lib/acoes';
import { dados, fecharAviso, useSel, type Aviso } from '../lib/loja';
import { quando } from '../lib/formato';
import { useAgora } from '../lib/tempo';
import { Tecla } from './ui';

export function FaixaDesfazer({ celular = false }: { celular?: boolean }) {
  const saindo = useSel(dados, (e) => e.saindo);
  const agora = useAgora(250);
  const ativas = saindo.filter((s) => s.ate > agora);
  useEffect(() => {
    if (saindo.length && !ativas.length) dados.set({ saindo: [] });
  }, [saindo.length, ativas.length]);
  const s = ativas[ativas.length - 1];
  if (!s) return null;
  const resta = Math.max(0, s.ate - agora);
  const segundos = Math.ceil(resta / 1000);
  const descarte = s.tipo === 'descartar';
  const Icone = descarte ? Trash : s.agendada ? CalendarClock : Check;
  const detalhe = descarte
    ? `Motivo: ${s.detalhe}`
    : s.espera ? `${s.espera}. Dá para desfazer por mais ${segundos} s.`
      : s.agendada ? `Sai ${quando(s.agendada)}. Dá para desfazer por mais ${segundos} s.` : `Sai em ${segundos} s.`;
  return (
    <div
      className={`fixed left-1/2 z-[350] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 ${celular ? 'bottom-[calc(4.25rem+env(safe-area-inset-bottom))]' : 'bottom-[4.75rem]'}`}
      role="status"
      aria-live="off"
    >
      <div key={s.chave} className={`anima-sobe overflow-hidden rounded-painel shadow-pop ${descarte ? 'bg-tx text-bg' : 'bg-accent text-accent-fg'}`}>
        <div className="flex items-center gap-3 py-2.5 pr-2.5 pl-4">
          <Icone size={18} strokeWidth={2.4} aria-hidden className="flex-none" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{s.rotulo}</p>
            <p className="truncate text-meta opacity-85">{detalhe}</p>
          </div>
          {ativas.length > 1 && <span className="rounded-full bg-[color-mix(in_oklch,currentColor_16%,transparent)] px-2 py-0.5 text-meta font-bold">+{ativas.length - 1}</span>}
          {!s.agendada && (
            <span className="font-num text-[1.75rem] leading-none font-bold tabular" aria-hidden>{segundos}</span>
          )}
          <button
            type="button"
            className={`flex items-center gap-2 rounded-botao bg-[color-mix(in_oklch,currentColor_16%,transparent)] px-3 font-bold hover:bg-[color-mix(in_oklch,currentColor_24%,transparent)] ${celular ? 'h-11' : 'h-9'}`}
            onClick={() => desfazer(s)}
          >
            Desfazer {!celular && <Tecla className="border-[color-mix(in_oklch,currentColor_35%,transparent)] bg-transparent text-current">Z</Tecla>}
          </button>
        </div>
        <div className="h-[3px] bg-[color-mix(in_oklch,currentColor_18%,transparent)]" aria-hidden>
          <BarraTempo key={`${s.chave}:${s.ate}`} ate={s.ate} />
        </div>
      </div>
    </div>
  );
}

// a duração é lida uma vez: re-renderizar a cada 250 ms não reinicia a animação
function BarraTempo({ ate }: { ate: number }) {
  const [duracao] = useState(() => Math.max(0, ate - Date.now()));
  return <div className="barra-tempo h-full origin-left bg-current" style={{ animation: `esvazia ${duracao}ms linear forwards`, '--dur': `${duracao}ms` } as React.CSSProperties} />;
}

export function Avisos() {
  const avisos = useSel(dados, (e) => e.avisos);
  if (!avisos.length) return null;
  return (
    <div className="pointer-events-none fixed top-[3.9rem] right-4 z-[500] flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2">
      {avisos.map((a) => <ItemAviso key={a.id} a={a} />)}
    </div>
  );
}

// some sozinho depois de a.duracao; com o mouse ou o foco em cima, o relógio para (dá tempo de ler e clicar)
function ItemAviso({ a }: { a: Aviso }) {
  const [parado, setParado] = useState(false);
  const resta = useRef(a.duracao);
  useEffect(() => {
    if (parado) return;
    const inicio = Date.now();
    const t = window.setTimeout(() => fecharAviso(a.id), resta.current);
    return () => { window.clearTimeout(t); resta.current = Math.max(1500, resta.current - (Date.now() - inicio)); };
  }, [parado, a.id]);
  const Icone = a.tipo === 'erro' ? CircleAlert : a.tipo === 'ok' ? CircleCheck : Info;
  return (
    <div
      // erro é lido na hora (alert); ok e info já foram para a região polite do Anunciador
      role={a.tipo === 'erro' ? 'alert' : undefined}
      className={`anima-sobe pointer-events-auto flex items-start gap-3 rounded-painel border px-4 py-3 shadow-pop ${a.tipo === 'erro' ? 'border-danger-line bg-surface' : 'border-line bg-surface'}`}
      onPointerEnter={() => setParado(true)}
      onPointerLeave={() => setParado(false)}
      onFocus={() => setParado(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setParado(false); }}
    >
      <Icone size={17} strokeWidth={2.2} className={`mt-0.5 flex-none ${a.tipo === 'erro' ? 'text-danger' : a.tipo === 'ok' ? 'text-ok' : 'text-accent-tx'}`} aria-hidden />
      <p className="min-w-0 flex-1 text-ui">{a.texto}</p>
      {a.acao && (
        <button type="button" className="btn btn-pequeno" onClick={() => { a.acao!.fazer(); fecharAviso(a.id); }}>{a.acao.rotulo}</button>
      )}
      <button type="button" className="-mt-0.5 -mr-1 grid size-7 flex-none place-items-center rounded-full text-tx-3 hover:bg-surface-2 pointer-coarse:size-11" onClick={() => fecharAviso(a.id)} aria-label="Fechar aviso">
        <X size={15} strokeWidth={2} />
      </button>
    </div>
  );
}

export function Anunciador() {
  const fala = useSel(dados, (e) => e.fala);
  return <div className="sr-only" aria-live="polite" aria-atomic="true">{fala}</div>;
}
