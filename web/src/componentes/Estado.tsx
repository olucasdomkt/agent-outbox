// Selo de estado: ícone, cor e texto diferentes para cada passo (revisar, janela, fila, enviando, entregue, erro).
import {
  CalendarClock, CheckCheck, CircleAlert, CircleDashed, Hourglass, Layers, ListOrdered, LoaderCircle, RotateCcw, Timer, Trash,
} from 'lucide-react';
import { estadoDe, type IconeEstado } from '../lib/estado';
import { useAgora } from '../lib/tempo';
import type { Mensagem } from '../lib/tipos';

const ICONES: Record<IconeEstado, typeof Timer> = {
  revisar: CircleDashed, janela: Timer, agendada: CalendarClock, fila: ListOrdered, espera: Hourglass, tentativa: RotateCcw,
  enviando: LoaderCircle, entregue: CheckCheck, erro: CircleAlert, descartada: Trash, versao: Layers,
};
const COR = { neutro: 'text-tx-2', acento: 'text-accent-tx', aviso: 'text-warn', perigo: 'text-danger', ok: 'text-ok' } as const;

export function SeloEstado({ m, className = '', tamanho = 14 }: { m: Mensagem; className?: string; tamanho?: number }) {
  const precisaSegundos = m.status === 'aprovada' && !m.aguardando && !!m.liberar_em && m.liberar_em > Date.now();
  const agora = useAgora(precisaSegundos ? 1000 : 30_000);
  const e = estadoDe(m, agora);
  const Icone = ICONES[e.icone];
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${COR[e.tom]} ${className}`}>
      <Icone size={tamanho} strokeWidth={2} aria-hidden className={e.icone === 'enviando' ? 'animate-spin' : ''} />
      <span className="tabular">{e.texto}</span>
    </span>
  );
}

