// Horário útil: segunda a sexta, das 8h às 20h. Fora disso a Central sugere agendar.
import { diaRelativo, hhmm } from './formato';

const util = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;

export function foraDoHorario(agora = Date.now()) {
  const d = new Date(agora);
  return !util(d) || d.getHours() < 8 || d.getHours() >= 20;
}

// próximo dia útil às 8h (ou hoje às 8h, se ainda não deu 8h num dia útil)
export function proximoUtil(agora = Date.now()) {
  const d = new Date(agora);
  const alvo = new Date(d);
  alvo.setHours(8, 0, 0, 0);
  if (util(d) && d.getHours() < 8) return alvo.getTime();
  do alvo.setDate(alvo.getDate() + 1); while (!util(alvo));
  return alvo.getTime();
}

export interface Sugestao { rotulo: string; detalhe: string; quando: number; principal?: boolean }

const em = (base: number, dias: number, h: number, min = 0) => {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  d.setHours(h, min, 0, 0);
  return d.getTime();
};

// opções do S (agendar), a primeira é a que o Enter escolhe
export function sugestoesAgendar(agora = Date.now()): Sugestao[] {
  const lista: Sugestao[] = [];
  const fora = foraDoHorario(agora);
  const util8 = proximoUtil(agora);
  const add = (rotulo: string, quando: number, principal = false) => {
    if (quando <= agora + 5 * 60e3 || lista.some((s) => s.quando === quando)) return;
    lista.push({ rotulo, detalhe: `${diaRelativo(quando, agora)} ${hhmm(quando)}`, quando, principal });
  };
  if (fora) add('Próximo horário útil', util8, true);
  else {
    const umaHora = new Date(agora + 60 * 60e3);
    umaHora.setMinutes(umaHora.getMinutes() < 30 ? 30 : 60, 0, 0);
    add('Daqui a pouco', umaHora.getTime(), true);
    if (new Date(agora).getHours() < 17) add('Fim da tarde', em(agora, 0, 18));
  }
  add('Amanhã cedo', util(new Date(em(agora, 1, 8))) ? em(agora, 1, 8) : util8);
  add('Amanhã depois do almoço', util(new Date(em(agora, 1, 14))) ? em(agora, 1, 14) : util8 + 6 * 3600e3);
  if (!fora) add('Próximo dia útil', util8);
  return lista.slice(0, 4);
}

// valor para <input type="datetime-local">
export function paraInputLocal(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
