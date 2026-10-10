// Datas, horas e números em pt-BR, no jeito curto que o painel usa.

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const doisDigitos = (n: number) => String(n).padStart(2, '0');
export const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
};
const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
export const ddmm = (ms: number) => {
  const d = new Date(ms);
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}`;
};

// "hoje", "ontem", "amanhã", "sex", "25/09"
export function diaRelativo(ms: number, agora = Date.now()) {
  const d = new Date(ms);
  const hoje = new Date(agora);
  const ontem = new Date(agora - 864e5);
  const amanha = new Date(agora + 864e5);
  if (mesmoDia(d, hoje)) return 'hoje';
  if (mesmoDia(d, ontem)) return 'ontem';
  if (mesmoDia(d, amanha)) return 'amanhã';
  const dist = Math.abs(ms - agora);
  if (dist < 6 * 864e5) return DIAS_CURTOS[d.getDay()];
  return ddmm(ms);
}

// "há 3 min", "há 2 h", "ontem 14:02"
export function ha(ms: number, agora = Date.now()) {
  const s = (agora - ms) / 1000;
  if (s < 45) return 'agora';
  if (s < 3600) return `há ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 6 * 3600) return `há ${Math.round(s / 3600)} h`;
  return `${diaRelativo(ms, agora)} ${hhmm(ms)}`;
}

// curtíssimo para listas: "3 min", "2 h", "ontem", "25/09"
export function curto(ms: number, agora = Date.now()) {
  const s = (agora - ms) / 1000;
  if (s < 45) return 'agora';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 20 * 3600 && mesmoDia(new Date(ms), new Date(agora))) return `${Math.round(s / 3600)} h`;
  return diaRelativo(ms, agora);
}

// "hoje 13:49 · há 22 min" (o ponto só uma vez por linha)
export function horaClara(ms: number, agora = Date.now()) {
  const base = `${diaRelativo(ms, agora)} ${hhmm(ms)}`;
  const s = (agora - ms) / 1000;
  return s >= 0 && s < 6 * 3600 ? `${base} · ${ha(ms, agora)}` : base;
}

// futuro: "seg 08:00", "hoje 18:00", "amanhã 08:00"
export const quando = (ms: number, agora = Date.now()) => `${diaRelativo(ms, agora)} ${hhmm(ms)}`;

export const completa = (ms: number) =>
  new Date(ms).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' });

export const diaLongo = (ms: number) => DIAS_LONGOS[new Date(ms).getDay()];

export const numero = (n: number) => n.toLocaleString('pt-BR');

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

// segundos restantes para a contagem regressiva ("0:09")
export function regressiva(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${doisDigitos(s % 60)}`;
}

export const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`;

// cabeçalho de grupo por dia: "Hoje", "Ontem", "Quarta, 30/09"
export function cabecalhoDia(ms: number, agora = Date.now()) {
  const d = new Date(ms);
  if (mesmoDia(d, new Date(agora))) return 'Hoje';
  if (mesmoDia(d, new Date(agora - 864e5))) return 'Ontem';
  const nome = DIAS_LONGOS[d.getDay()];
  return `${nome[0].toUpperCase()}${nome.slice(1)}, ${ddmm(ms)}`;
}

export const chaveDia = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
};

export const semAcento = (s: string | null | undefined) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// aspas retas que vêm do servidor (lint, histórico) viram curvas, como no resto da tela
export const aspas = (s: string) => s.replace(/"([^"\n]+)"/g, '“$1”');
// o motivo do linter vem sem ponto final; emendado com outra frase, precisa de um
export const comPonto = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
