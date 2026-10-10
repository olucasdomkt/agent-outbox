// Folha que sobe de baixo (celular): editor, motivos de descarte, detalhe e o menu "Mais".
// Arrastar a alça ou o título para baixo fecha; ao fechar ela desce com o último conteúdo, sem piscar vazia.
import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';

interface Props { aberta: boolean; onFechar: () => void; titulo: string; children: React.ReactNode; cheia?: boolean; semRolagem?: boolean }

export function Folha({ aberta, onFechar, titulo, children, cheia = false, semRolagem = false }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const ultimo = useRef({ titulo, children });
  if (aberta) ultimo.current = { titulo, children };
  const mostrar = aberta ? { titulo, children } : ultimo.current;
  const [dy, setDy] = useState(0);
  const arrasto = useRef<{ y: number; t: number } | null>(null);
  useEffect(() => { if (aberta) setDy(0); }, [aberta]);

  const alca = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      arrasto.current = { y: e.clientY, t: Date.now() };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (arrasto.current) setDy(Math.max(0, e.clientY - arrasto.current.y));
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const a = arrasto.current;
      arrasto.current = null;
      if (!a) return;
      const d = e.clientY - a.y;
      if (d > 80 || d / Math.max(1, Date.now() - a.t) > 0.5) onFechar();
      else setDy(0);
    },
    onPointerCancel: () => { arrasto.current = null; setDy(0); },
  };

  return (
    <Dialog.Root open={aberta} onOpenChange={(v) => { if (!v) onFechar(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="folha-fundo fixed inset-0 z-[400] bg-veu" />
        <Dialog.Content
          ref={caixa}
          tabIndex={-1}
          onOpenAutoFocus={(e) => { e.preventDefault(); caixa.current?.focus(); }}
          className={`folha fixed inset-x-0 bottom-0 z-[401] flex flex-col overflow-hidden rounded-t-[16px] bg-surface shadow-pop outline-none ${cheia ? 'top-2' : 'max-h-[88dvh]'}`}
          style={{ transform: dy ? `translateY(${dy}px)` : undefined, transition: arrasto.current ? 'none' : 'transform 200ms var(--curva-saida)' }}
          aria-describedby={undefined}
        >
          <div className="flex-none touch-none select-none" {...alca}>
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
            <div className="flex items-center justify-between px-4 pt-2 pb-1">
              <Dialog.Title className="text-sub font-extrabold">{mostrar.titulo}</Dialog.Title>
              <Dialog.Close className="btn btn-fantasma btn-icone" aria-label="Fechar"><X size={18} strokeWidth={2} /></Dialog.Close>
            </div>
          </div>
          <div className={`min-h-0 flex-1 px-4 pt-1 pb-[max(1rem,env(safe-area-inset-bottom))] ${semRolagem ? 'flex flex-col' : 'overflow-y-auto'}`}>{mostrar.children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
