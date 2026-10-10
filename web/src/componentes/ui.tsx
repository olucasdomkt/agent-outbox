// Peças pequenas usadas em todo canto.
import type { ReactNode } from 'react';
import { Tooltip as T } from 'radix-ui';
import { ArrowBigUp, Command, CornerDownLeft, Users } from 'lucide-react';
import { useFoto } from '../lib/fotos';

const GLIFOS: Record<string, ReactNode> = {
  '⇧': <ArrowBigUp size={11} strokeWidth={2.2} aria-label="Shift" />,
  '⌘': <Command size={10} strokeWidth={2.4} aria-label="Command" />,
  '↵': <CornerDownLeft size={11} strokeWidth={2.4} aria-label="Enter" />,
};

export function Tecla({ children, className = '' }: { children: ReactNode; className?: string }) {
  const conteudo = typeof children === 'string' && /[⇧⌘↵]/.test(children)
    ? [...children].map((c, i) => (GLIFOS[c] ? <span key={i} className="inline-flex">{GLIFOS[c]}</span> : c))
    : children;
  return <kbd className={`tecla ${className}`}>{conteudo}</kbd>;
}

export function Etiqueta({ tom, children, className = '', titulo }: { tom?: 'aviso' | 'perigo' | 'ok' | 'acento' | 'contorno'; children: ReactNode; className?: string; titulo?: string }) {
  return <span className={`etiqueta ${className}`} data-tom={tom} title={titulo}>{children}</span>;
}

export function Secao({ titulo, children, acao, className = '' }: { titulo: ReactNode; children: ReactNode; acao?: ReactNode; className?: string }) {
  return (
    <section className={`border-b border-line px-5 py-4 last:border-b-0 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="rotulo mb-0">{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

export function Vazio({ icone, titulo, children, className = '' }: { icone?: ReactNode; titulo: string; children?: ReactNode; className?: string }) {
  return (
    <div className={`mx-auto flex max-w-[30rem] flex-col items-start gap-2 px-6 py-10 text-left ${className}`}>
      {icone && <div className="mb-1 text-tx-3">{icone}</div>}
      <p className="text-sub font-bold text-tx">{titulo}</p>
      {children && <div className="text-ui text-tx-2">{children}</div>}
    </div>
  );
}

export function Esqueleto({ linhas = 3, className = '' }: { linhas?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-hidden>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="h-3 animate-pulse rounded-full bg-surface-3" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

// dica no passar do mouse (e no foco do teclado)
export function Dica({ texto, children, lado = 'bottom' }: { texto: ReactNode; children: ReactNode; lado?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={lado}
          sideOffset={6}
          className="anima-aparece z-[600] max-w-[22rem] rounded-botao bg-tx px-2.5 py-1.5 text-meta font-semibold text-bg shadow-pop"
        >
          {texto}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

// Quem é, no WhatsApp: a foto de perfil por cima das iniciais (grupo sem foto leva o ícone de grupo, como no
// aplicativo). As iniciais ficam por baixo enquanto a foto não chega e quando a pessoa não tem ou esconde.
export function Foto({ jid, nome, grupo = false, tamanho = 32, className = '' }: { jid?: string | null; nome: string; grupo?: boolean; tamanho?: number; className?: string }) {
  const src = useFoto(jid);
  return (
    <span aria-hidden className={`relative inline-grid flex-none ${className}`} style={{ width: tamanho, height: tamanho }}>
      {grupo ? (
        <span className="grid size-full place-items-center rounded-full bg-[light-dark(#dfe5e7,#6a7175)] text-[light-dark(#fff,#cfd4d6)]">
          <Users size={tamanho * 0.5} strokeWidth={2} />
        </span>
      ) : <Iniciais nome={nome} tamanho={tamanho} />}
      {src && <img src={src} alt="" className="foto anima-aparece absolute inset-0 size-full rounded-full object-cover" />}
    </span>
  );
}

export function Iniciais({ nome, tamanho = 32, className = '' }: { nome: string; tamanho?: number; className?: string }) {
  const partes = String(nome || '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/);
  const ini = ((partes[0]?.[0] || '?') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
  let h = 0;
  for (const c of nome || '') h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden
      className={`inline-grid flex-none place-items-center rounded-full font-bold text-white ${className}`}
      style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.38, background: `oklch(0.53 0.12 ${h})` }}
    >
      {ini}
    </span>
  );
}
