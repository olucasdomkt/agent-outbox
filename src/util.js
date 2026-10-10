// Utilitários compartilhados pelos canais.
import fs from 'node:fs';
import path from 'node:path';

// tipo do anexo pela extensão (o painel abre e a prévia mostra)
const TIPOS_ANEXO = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg', '.wav': 'audio/wav',
};
export const mimeDe = (caminho) => TIPOS_ANEXO[path.extname(String(caminho)).toLowerCase()] || 'application/octet-stream';

// o que a prévia mostra de cada anexo; bytes null = o arquivo não está mais lá (o envio vai falhar)
export function infoAnexo(caminho, i, id) {
  let bytes = null;
  try {
    const st = fs.statSync(caminho);
    if (st.isFile()) bytes = st.size;
  } catch { /* sumiu */ }
  return { caminho, nome: path.basename(String(caminho)), bytes, mime: mimeDe(caminho), url: `/api/mensagens/${id}/anexo/${i}` };
}

// "Diretoria Tecnica" casa com "DIRETORIA TÉCNICA AURORA"
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// um endereço de e-mail só: sem vírgula, ponto e vírgula, espaço ou segundo @ (que virariam dois destinatários)
export const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

// Pontua o quanto um nome casa com a busca. 0 = não casa.
export function pontuar(nome, busca) {
  const n = norm(nome);
  const b = norm(busca);
  if (!n || !b) return 0;
  if (n === b) return 100;
  if (n.startsWith(b)) return 80;
  if (n.includes(b)) return 60;
  const tokens = b.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => n.includes(t))) return 50;
  return 0;
}

// Escolhe o destino a partir de uma lista pontuada: resolve quando há um vencedor claro,
// senão devolve candidatos para o dono escolher no painel.
export function decidir(lista) {
  const ord = lista.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || (b.recencia || 0) - (a.recencia || 0));
  if (!ord.length) return { candidatos: [] };
  const [primeiro, segundo] = ord;
  const soUmExato = primeiro.score === 100 && (!segundo || segundo.score < 100);
  if (soUmExato || ord.length === 1) return { destino: limpar(primeiro) };
  return { candidatos: ord.slice(0, 8).map(limpar) };
}
const limpar = ({ score, recencia, ...resto }) => resto;

// "Já mandei isso?": quanto das palavras da mensagem MENOR aparece na outra.
// Medido em uso: mensagem repetida deu 1.00; outras ao mesmo contato, 0.22 a 0.27.
const palavrasLongas = (s) => new Set(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((p) => p.length >= 4));

export function semelhanca(a, b) {
  const A = palavrasLongas(a);
  const B = palavrasLongas(b);
  const menor = Math.min(A.size, B.size);
  if (menor < 6) return 0; // "ok", "pode ser": curto demais para servir de prova
  let juntos = 0;
  for (const p of A) if (B.has(p)) juntos++;
  return juntos / menor;
}

// Erro que vale retentar (canal fora do ar, rede, 429/5xx). O resto é definitivo.
export function erroTransitorio(msg) {
  const e = new Error(msg);
  e.transitorio = true;
  return e;
}

export async function fetchJson(url, opts = {}, timeoutMs = 15000) {
  let r;
  try {
    r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
    // limite de chamadas (Discord, Gmail): espera o que ele pediu e tenta mais uma vez
    if (r.status === 429) {
      const espera = Number(r.headers.get('retry-after') || 1);
      await new Promise((ok) => setTimeout(ok, Math.min(espera * 1000 + 250, 5000)));
      r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
    }
  } catch (e) {
    throw erroTransitorio(`sem conexão com ${new URL(url).host}: ${e.cause?.code || e.message}`);
  }
  const texto = await r.text();
  let corpo;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { corpo = texto; }
  if (!r.ok) {
    const detalhe = typeof corpo === 'string' ? corpo.slice(0, 300) : JSON.stringify(corpo).slice(0, 300);
    const msg = `HTTP ${r.status} em ${new URL(url).pathname}: ${detalhe}`;
    throw r.status === 429 || r.status >= 500 ? erroTransitorio(msg) : new Error(msg);
  }
  return corpo;
}

// "+2h", "+30m", "+1d", "2026-09-22 15:00", ISO ou epoch ms → epoch ms (null se vazio)
export function parseQuando(v, agora = Date.now()) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const rel = s.match(/^\+(\d+)\s*(m|min|h|d)$/i);
  if (rel) return agora + Number(rel[1]) * { m: 60e3, min: 60e3, h: 3600e3, d: 86400e3 }[rel[2].toLowerCase()];
  if (/^\d{12,}$/.test(s)) return Number(s);
  const t = Date.parse(s.replace(' ', 'T'));
  if (Number.isNaN(t)) throw new Error(`não entendi a data "${s}" (use +2h, +30m, +1d ou 2026-09-22 15:00)`);
  return t;
}

// Divide texto longo em pedaços respeitando parágrafos (Discord aceita 2000 caracteres).
export function fatiar(texto, max) {
  if (texto.length <= max) return [texto];
  const partes = [];
  let atual = '';
  for (const par of texto.split(/\n\n/)) {
    const bloco = atual ? `${atual}\n\n${par}` : par;
    if (bloco.length <= max) { atual = bloco; continue; }
    if (atual) partes.push(atual);
    if (par.length <= max) { atual = par; continue; }
    for (let i = 0; i < par.length; i += max) partes.push(par.slice(i, i + max));
    atual = '';
  }
  if (atual) partes.push(atual);
  return partes;
}
