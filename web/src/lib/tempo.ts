// Relógio compartilhado: um timer por intervalo, não um por componente.
// A função de assinatura é fixa por intervalo: se mudasse a cada render, o React reassinaria
// em todo render e o relógio acertado na assinatura viraria um laço infinito de renderização.
import { useSyncExternalStore } from 'react';

interface Relogio { agora: number; ouvintes: Set<() => void>; timer: number | null; assinar: (f: () => void) => () => void; ler: () => number }

const relogios = new Map<number, Relogio>();

function relogio(ms: number): Relogio {
  const existente = relogios.get(ms);
  if (existente) return existente;
  const r: Relogio = {
    agora: Date.now(),
    ouvintes: new Set(),
    timer: null,
    assinar: (f) => {
      r.ouvintes.add(f);
      if (r.timer === null) {
        const tique = () => { r.agora = Date.now(); r.ouvintes.forEach((g) => g()); };
        r.timer = window.setInterval(tique, ms);
        // parado há mais de um intervalo: acerta logo depois da renderização, não durante
        if (Date.now() - r.agora >= ms) queueMicrotask(tique);
      }
      return () => {
        r.ouvintes.delete(f);
        if (!r.ouvintes.size && r.timer !== null) {
          window.clearInterval(r.timer);
          r.timer = null;
        }
      };
    },
    ler: () => r.agora,
  };
  relogios.set(ms, r);
  return r;
}

export function useAgora(ms = 30_000) {
  const r = relogio(ms);
  return useSyncExternalStore(r.assinar, r.ler, r.ler);
}
