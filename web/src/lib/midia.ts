// Media query como hook (celular × computador, contexto em coluna ou em gaveta).
// Assinatura fixa por consulta: o React não reassina a cada render.
import { useSyncExternalStore } from 'react';

const assinaturas = new Map<string, (f: () => void) => () => void>();

function assinatura(consulta: string) {
  let a = assinaturas.get(consulta);
  if (!a) {
    a = (f) => {
      const mq = window.matchMedia(consulta);
      mq.addEventListener('change', f);
      return () => mq.removeEventListener('change', f);
    };
    assinaturas.set(consulta, a);
  }
  return a;
}

export function useMidia(consulta: string) {
  return useSyncExternalStore(assinatura(consulta), () => window.matchMedia(consulta).matches, () => false);
}

export const CONSULTA_CELULAR = '(max-width: 760px)';
