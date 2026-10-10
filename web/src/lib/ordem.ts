// Ordem entre mensagens (docs/contrato-api-v2.md): o que a mensagem espera, em texto de gente, e quem sugerir como
// anterior. Quem decide é a Central (o campo `aguardando` vem pronto); aqui só se mostra.
import type { Mensagem, Status } from './tipos';

// "Otávio Ramos" vira "Otávio"; número fica como está (o mesmo do servidor)
export const primeiroNome = (nome?: string | null) => {
  const n = String(nome || '').trim();
  return /^\p{L}/u.test(n) ? n.split(/\s+/)[0] : n || 'a pessoa';
};

export const VIVAS: Status[] = ['pendente', 'aprovada', 'enviando', 'erro'];

// esperar a resposta só vale para WhatsApp em conversa direta (grupo não)
export const conversaDireta = (m: Mensagem) => m.canal === 'whatsapp' && !!m.destino_id && !m.destino_id.endsWith('@g.us');

export interface Espera {
  motivo: 'anterior' | 'resposta' | 'bloqueada';
  curto: string; // na lista: "depois da #485"
  aprovada: string; // no selo da aprovada: "Aprovada, esperando a #485"
  longo: string; // no detalhe, frase inteira
}

// null: não espera nada (sem anterior, ou a anterior já saiu e a resposta, se pedida, já veio)
export function esperaDe(m: Mensagem): Espera | null {
  const a = m.aguardando;
  if (!a) return null;
  const quem = primeiroNome(a.quem);
  if (a.motivo === 'bloqueada') {
    const porque = a.status === 'descartada' ? 'foi descartada' : a.status === 'erro' ? 'deu erro' : 'não existe mais';
    return {
      motivo: a.motivo,
      curto: `bloqueada: a #${a.id} ${porque}`,
      aprovada: `Aprovada, mas a #${a.id} ${porque}`,
      longo: `Bloqueada: a #${a.id} ${porque} e esta esperava por ela. Não sai sozinha: solte para sair sem esperar, ou descarte.`,
    };
  }
  if (a.motivo === 'resposta') {
    return { motivo: a.motivo, curto: `espera ${quem} responder`, aprovada: `Aprovada, esperando ${quem} responder`, longo: `A #${a.id} já saiu. Esta sai quando ${quem} responder.` };
  }
  const resposta = !!m.espera_resposta;
  return {
    motivo: a.motivo,
    curto: `depois da #${a.id}${resposta ? ' e da resposta' : ''}`,
    aprovada: `Aprovada, esperando a #${a.id}${resposta ? ` e ${quem} responder` : ''}`,
    longo: `Sai depois que a #${a.id} sair${resposta ? ` e ${quem} responder` : ''}.`,
  };
}

// Quem pode vir antes: primeiro as que ainda não saíram para o mesmo destino (as criadas antes desta na frente),
// depois as duas últimas que já saíram para ele. Fica de fora quem já espera por esta (a Central recusa o ciclo).
export function sugestoesDeAnterior(m: Mensagem, msgs: Record<number, Mensagem>): Mensagem[] {
  if (!m.destino_id) return [];
  const esperaPorEsta = (x: Mensagem) => {
    for (let y: Mensagem | undefined = x, i = 0; y && i < 50; y = y.depois_de ? msgs[y.depois_de] : undefined, i++) if (y.id === m.id) return true;
    return false;
  };
  const mesmo = Object.values(msgs).filter((x) => x.id !== m.id && x.canal === m.canal && x.destino_id === m.destino_id && !esperaPorEsta(x));
  const antes = (x: Mensagem) => (x.id < m.id ? 0 : 1);
  const abertas = mesmo.filter((x) => VIVAS.includes(x.status)).sort((a, b) => antes(a) - antes(b) || b.id - a.id);
  const sairam = mesmo.filter((x) => x.status === 'enviada').sort((a, b) => (b.enviado_em || 0) - (a.enviado_em || 0)).slice(0, 2);
  return [...abertas, ...sairam].slice(0, 6);
}
