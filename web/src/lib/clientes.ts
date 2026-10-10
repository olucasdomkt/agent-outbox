// Nome do cliente como aparece no painel. Com o cliente no config.json vale a grafia de lá ("aurora" e "AURORA"
// viram "Aurora"); mensagem sem cliente declarado ganha o do config.json que aparecer no nome do app.
// `nomes` vem do resumo da Central (começa vazio).
import { semAcento } from './formato';

export function normCliente(cliente: string | null | undefined, app: string | null | undefined, nomes: string[] = []): string | null {
  const c = semAcento(cliente).trim();
  if (c) return nomes.find((n) => semAcento(n) === c) || String(cliente).trim();
  const a = semAcento(app);
  return (a && nomes.find((n) => a.includes(semAcento(n)))) || null;
}
