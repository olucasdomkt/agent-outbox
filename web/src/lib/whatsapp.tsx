// Formatação do WhatsApp do jeito que o app mostra: *negrito*, _itálico_, ~tachado~, ```mono```, `código`,
// listas com "- ", "* " e "1. ", citação com "> ", links e menções.
// Marcador só abre colado numa palavra e só fecha na mesma linha (por isso "**duplo**" sobra asterisco).
import type { ReactNode } from 'react';
import type { Participante } from './tipos';
import { semAcento } from './formato';
import { urlSegura } from './url';

export interface OpcoesWa {
  mencoes?: Participante[];
  participantes?: Participante[];
  grupo?: boolean;
}

const ehLetra = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
const espaco = (c: string | undefined) => !c || /\s/.test(c);
const TAG = { '*': 'strong', _: 'em', '~': 's' } as const;
type Marca = keyof typeof TAG;
const ehMarca = (c: string): c is Marca => c === '*' || c === '_' || c === '~';

const RE_URL = /(?:https?:\/\/|www\.)[^\s<>"]+/y;
const RE_NUM = /@(\d{8,15})/y;
const RE_NOME = /@([\p{L}][\p{L}\p{N}._-]*)/uy;

export function acharParticipante(nome: string, lista: Participante[] = []) {
  const alvo = semAcento(nome);
  return lista.find((p) => semAcento(p.nome).split(/\s+/).includes(alvo)) || lista.find((p) => semAcento(p.nome).startsWith(alvo));
}

function aparar(url: string) {
  // ponto, vírgula ou parêntese no fim fica fora do link
  const m = url.match(/[.,;:!?)\]]+$/);
  return m ? url.slice(0, -m[0].length) : url;
}

export function formatarLinha(s: string, o: OpcoesWa, k = 'l'): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push(buf);
    buf = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const chave = `${k}.${i}`;

    if (s.startsWith('```', i)) {
      const fim = s.indexOf('```', i + 3);
      if (fim > i + 3) {
        flush();
        out.push(<code key={chave} className="wa-mono">{s.slice(i + 3, fim)}</code>);
        i = fim + 3;
        continue;
      }
    }
    if (c === '`') {
      const fim = s.indexOf('`', i + 1);
      if (fim > i + 1) {
        flush();
        out.push(<code key={chave} className="wa-code">{s.slice(i + 1, fim)}</code>);
        i = fim + 1;
        continue;
      }
    }
    if (!ehLetra(s[i - 1]) && (c === 'h' || c === 'w')) {
      RE_URL.lastIndex = i;
      const m = RE_URL.exec(s);
      if (m) {
        const url = aparar(m[0]);
        const alvo = urlSegura(url.startsWith('www.') ? `https://${url}` : url);
        if (alvo) {
          flush();
          out.push(<a key={chave} className="wa-link" href={alvo} target="_blank" rel="noopener noreferrer">{url}</a>);
          i += url.length;
          continue;
        }
      }
    }
    if (c === '@' && !ehLetra(s[i - 1]) && s[i - 1] !== '.') {
      RE_NUM.lastIndex = i;
      const num = RE_NUM.exec(s);
      if (num) {
        const p = o.mencoes?.find((x) => x.numero === num[1] || x.jid.startsWith(num[1])) || o.participantes?.find((x) => x.numero === num[1]);
        flush();
        out.push(p
          ? <span key={chave} className="wa-mencao">@{p.nome}</span>
          : <span key={chave}>{num[0]}</span>);
        i += num[0].length;
        continue;
      }
      RE_NOME.lastIndex = i;
      const nome = RE_NOME.exec(s);
      if (nome && o.grupo) {
        const p = acharParticipante(nome[1], o.participantes);
        flush();
        out.push(p
          ? <span key={chave} className="wa-mencao">@{p.nome}</span>
          : <span key={chave} className="wa-mencao-ruim" title="Ninguém com esse nome aqui: vai sair como texto, sem marcar ninguém">{nome[0]}</span>);
        i += nome[0].length;
        continue;
      }
    }
    if (ehMarca(c) && !ehLetra(s[i - 1]) && !espaco(s[i + 1]) && s[i + 1] !== c) {
      let fecha = -1;
      for (let j = i + 2; j < s.length; j++) {
        if (s[j] === c && !espaco(s[j - 1]) && !ehLetra(s[j + 1])) {
          fecha = j;
          break;
        }
      }
      if (fecha > 0) {
        flush();
        const Tag = TAG[c];
        out.push(<Tag key={chave}>{formatarLinha(s.slice(i + 1, fecha), o, chave)}</Tag>);
        i = fecha + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

type Bloco =
  | { tipo: 'l'; texto: string }
  | { tipo: 'ul'; texto: string }
  | { tipo: 'ol'; n: string; texto: string }
  | { tipo: 'cit'; linhas: string[] }
  | { tipo: 'pre'; texto: string };

export function blocosWhatsapp(texto: string): Bloco[] {
  const linhas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  const blocos: Bloco[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const aberto = l.trimStart();
    if (aberto.startsWith('```') && !aberto.slice(3).includes('```')) {
      let fim = i + 1;
      while (fim < linhas.length && !linhas[fim].includes('```')) fim++;
      if (fim < linhas.length) {
        const ultima = linhas[fim];
        const corte = ultima.indexOf('```');
        const miolo = [aberto.slice(3), ...linhas.slice(i + 1, fim), ultima.slice(0, corte)];
        if (!miolo[0]) miolo.shift();
        if (miolo.length && !miolo[miolo.length - 1]) miolo.pop();
        blocos.push({ tipo: 'pre', texto: miolo.join('\n') });
        const resto = ultima.slice(corte + 3);
        if (resto.trim()) blocos.push({ tipo: 'l', texto: resto });
        i = fim;
        continue;
      }
    }
    if (/^>\s/.test(l)) {
      const grupo: string[] = [];
      while (i < linhas.length && /^>\s/.test(linhas[i])) grupo.push(linhas[i++].replace(/^>\s/, ''));
      i--;
      blocos.push({ tipo: 'cit', linhas: grupo });
      continue;
    }
    const ul = l.match(/^\s{0,3}[-*•]\s+(.*)$/);
    if (ul) {
      blocos.push({ tipo: 'ul', texto: ul[1] });
      continue;
    }
    const ol = l.match(/^\s{0,3}(\d{1,3})\.\s+(.*)$/);
    if (ol) {
      blocos.push({ tipo: 'ol', n: ol[1], texto: ol[2] });
      continue;
    }
    blocos.push({ tipo: 'l', texto: l });
  }
  return blocos;
}

// texto inteiro; "rabo" é o espaço reservado para a hora e os tiques no fim da última linha (como o app faz)
export function TextoWhatsapp({ texto, rabo, ...o }: { texto: string; rabo?: ReactNode } & OpcoesWa) {
  const blocos = blocosWhatsapp(texto);
  while (blocos.length > 1 && blocos[blocos.length - 1].tipo === 'l' && !(blocos[blocos.length - 1] as { texto: string }).texto.trim()) blocos.pop();
  const ultimo = blocos.length - 1;
  return (
    <div className="wa-texto">
      {blocos.map((b, i) => {
        const k = `b${i}`;
        const fim = i === ultimo ? rabo : null;
        if (b.tipo === 'pre') return <pre key={k} className="wa-pre">{b.texto}{fim}</pre>;
        if (b.tipo === 'cit') {
          return (
            <div key={k} className="wa-cit">
              {b.linhas.map((g, j) => <div key={j} className="wa-l">{g ? formatarLinha(g, o, `${k}.${j}`) : ' '}{j === b.linhas.length - 1 ? fim : null}</div>)}
            </div>
          );
        }
        if (b.tipo === 'ul') return <div key={k} className="wa-li"><span className="wa-bala" aria-hidden>•</span><span>{formatarLinha(b.texto, o, k)}{fim}</span></div>;
        if (b.tipo === 'ol') return <div key={k} className="wa-li"><span className="wa-num">{b.n}.</span><span>{formatarLinha(b.texto, o, k)}{fim}</span></div>;
        return <div key={k} className="wa-l">{b.texto ? formatarLinha(b.texto, o, k) : ' '}{fim}</div>;
      })}
    </div>
  );
}

// texto sem marcação, para a lista e para a citação (o app também tira os asteriscos ali)
export function textoLimpo(texto: string) {
  return String(texto || '')
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/(^|[^\p{L}\p{N}])([*_~])(?!\s)([^\n]*?[^\s])\2(?![\p{L}\p{N}])/gu, '$1$3')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
