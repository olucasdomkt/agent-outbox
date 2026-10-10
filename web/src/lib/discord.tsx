// Markdown do Discord: **negrito**, *itálico*, __sublinhado__, ~~tachado~~, ||spoiler||, `código`,
// blocos ```, citações "> " e ">>> ", títulos #, ##, ###, "-# " (texto miúdo), listas e links.
import type { ReactNode } from 'react';
import { urlSegura } from './url';

const INLINE = new RegExp(
  [
    '(`+)([\\s\\S]*?[^`])\\1(?!`)', // 1,2 código
    '\\*\\*([\\s\\S]+?)\\*\\*(?!\\*)', // 3 negrito
    '__([\\s\\S]+?)__(?!_)', // 4 sublinhado
    '\\*(?!\\s)([\\s\\S]+?[^\\s*])\\*(?!\\*)', // 5 itálico
    '\\b_([\\s\\S]+?)_\\b', // 6 itálico
    '~~([\\s\\S]+?)~~', // 7 tachado
    '\\|\\|([\\s\\S]+?)\\|\\|', // 8 spoiler
    '\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)', // 9,10 link com texto
    '(https?:\\/\\/[^\\s<]+[^\\s<.,:;"\')\\]])', // 11 link
    '<@!?(\\d+)>', // 12 menção
    '<#(\\d+)>', // 13 canal
    '@(everyone|here)', // 14
  ].join('|'),
  'g',
);

export function inlineDiscord(s: string, k = 'd'): ReactNode[] {
  const out: ReactNode[] = [];
  let ultimo = 0;
  INLINE.lastIndex = 0;
  const re = new RegExp(INLINE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > ultimo) out.push(s.slice(ultimo, m.index));
    const chave = `${k}.${m.index}`;
    if (m[2] !== undefined) out.push(<code key={chave} className="dc-code">{m[2]}</code>);
    else if (m[3] !== undefined) out.push(<strong key={chave}>{inlineDiscord(m[3], chave)}</strong>);
    else if (m[4] !== undefined) out.push(<u key={chave}>{inlineDiscord(m[4], chave)}</u>);
    else if (m[5] !== undefined) out.push(<em key={chave}>{inlineDiscord(m[5], chave)}</em>);
    else if (m[6] !== undefined) out.push(<em key={chave}>{inlineDiscord(m[6], chave)}</em>);
    else if (m[7] !== undefined) out.push(<s key={chave}>{inlineDiscord(m[7], chave)}</s>);
    else if (m[8] !== undefined) out.push(<span key={chave} className="dc-spoiler" title="Spoiler: quem recebe clica para ver">{inlineDiscord(m[8], chave)}</span>);
    else if (m[9] !== undefined) {
      const alvo = urlSegura(m[10]);
      out.push(alvo ? <a key={chave} className="dc-link" href={alvo} target="_blank" rel="noopener noreferrer">{m[9]}</a> : m[0]);
    } else if (m[11] !== undefined) {
      const alvo = urlSegura(m[11]);
      out.push(alvo ? <a key={chave} className="dc-link" href={alvo} target="_blank" rel="noopener noreferrer">{m[11]}</a> : m[0]);
    }
    else if (m[12] !== undefined) out.push(<span key={chave} className="dc-mencao">@{m[12].slice(-4)}</span>);
    else if (m[13] !== undefined) out.push(<span key={chave} className="dc-mencao">#canal</span>);
    else if (m[14] !== undefined) out.push(<span key={chave} className="dc-mencao">@{m[14]}</span>);
    ultimo = m.index + m[0].length;
  }
  if (ultimo < s.length) out.push(s.slice(ultimo));
  return out;
}

export function TextoDiscord({ texto }: { texto: string }) {
  const linhas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  const blocos: ReactNode[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const k = `b${i}`;
    if (l.trimStart().startsWith('```')) {
      const abre = l.trimStart().slice(3);
      const fechaNaMesma = abre.indexOf('```');
      if (fechaNaMesma >= 0) {
        blocos.push(<pre key={k} className="dc-pre">{abre.slice(0, fechaNaMesma)}</pre>);
        continue;
      }
      let fim = i + 1;
      while (fim < linhas.length && !linhas[fim].includes('```')) fim++;
      if (fim < linhas.length) {
        const corpo = linhas.slice(i + 1, fim).join('\n') + (linhas[fim].split('```')[0] ? `\n${linhas[fim].split('```')[0]}` : '');
        blocos.push(<pre key={k} className="dc-pre">{/^[\w+-]+$/.test(abre.trim()) || !abre.trim() ? corpo : `${abre}\n${corpo}`}</pre>);
        i = fim;
        continue;
      }
    }
    if (l.startsWith('>>> ')) {
      const resto = [l.slice(4), ...linhas.slice(i + 1)];
      blocos.push(<blockquote key={k} className="dc-cit">{resto.map((r, j) => <div key={j}>{r ? inlineDiscord(r, `${k}.${j}`) : ' '}</div>)}</blockquote>);
      break;
    }
    if (/^>\s/.test(l)) {
      const grupo: string[] = [];
      while (i < linhas.length && /^>\s/.test(linhas[i])) grupo.push(linhas[i++].slice(2));
      i--;
      blocos.push(<blockquote key={k} className="dc-cit">{grupo.map((g, j) => <div key={j}>{g ? inlineDiscord(g, `${k}.${j}`) : ' '}</div>)}</blockquote>);
      continue;
    }
    const titulo = l.match(/^(#{1,3})\s+(.*)$/);
    if (titulo) {
      const n = titulo[1].length;
      blocos.push(<div key={k} className={`dc-h dc-h${n}`} role="heading" aria-level={n + 2}>{inlineDiscord(titulo[2], k)}</div>);
      continue;
    }
    const miudo = l.match(/^-#\s+(.*)$/);
    if (miudo) {
      blocos.push(<div key={k} className="dc-sub">{inlineDiscord(miudo[1], k)}</div>);
      continue;
    }
    const ul = l.match(/^(\s*)[-*]\s+(.*)$/);
    if (ul) {
      blocos.push(<div key={k} className="dc-li" style={{ paddingInlineStart: `${1.1 + Math.min(3, Math.floor(ul[1].length / 2)) * 1.1}rem` }}><span className="dc-bala" aria-hidden>•</span>{inlineDiscord(ul[2], k)}</div>);
      continue;
    }
    const ol = l.match(/^(\s*)(\d{1,3})\.\s+(.*)$/);
    if (ol) {
      blocos.push(<div key={k} className="dc-li"><span className="dc-num">{ol[2]}.</span>{inlineDiscord(ol[3], k)}</div>);
      continue;
    }
    blocos.push(<div key={k} className="dc-l">{l ? inlineDiscord(l, k) : ' '}</div>);
  }
  return <div className="dc-texto">{blocos}</div>;
}
