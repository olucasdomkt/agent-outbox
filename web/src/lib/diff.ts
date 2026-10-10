// Diferença palavra a palavra entre duas versões (LCS simples; textos da Central cabem folgado).
export interface Trecho { tipo: 'igual' | 'mais' | 'menos'; texto: string }

const tokens = (s: string): string[] => s.match(/\s+|[^\s]+/g) || [];

export function diffPalavras(antes: string, depois: string): Trecho[] {
  let a = tokens(antes);
  let b = tokens(depois);
  // prefixo e sufixo iguais saem da conta (deixa o LCS pequeno)
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fimA = a.length;
  let fimB = b.length;
  while (fimA > ini && fimB > ini && a[fimA - 1] === b[fimB - 1]) { fimA--; fimB--; }
  const prefixo = a.slice(0, ini).join('');
  const sufixo = a.slice(fimA).join('');
  a = a.slice(ini, fimA);
  b = b.slice(ini, fimB);

  const saida: Trecho[] = [];
  const empurrar = (tipo: Trecho['tipo'], texto: string) => {
    if (!texto) return;
    const ult = saida[saida.length - 1];
    if (ult && ult.tipo === tipo) ult.texto += texto;
    else saida.push({ tipo, texto });
  };
  empurrar('igual', prefixo);

  if (a.length * b.length > 4_000_000) {
    empurrar('menos', a.join(''));
    empurrar('mais', b.join(''));
  } else {
    const n = a.length;
    const m = b.length;
    const L = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i * (m + 1) + j] = a[i] === b[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { empurrar('igual', a[i]); i++; j++; }
      else if (L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1]) empurrar('menos', a[i++]);
      else empurrar('mais', b[j++]);
    }
    while (i < n) empurrar('menos', a[i++]);
    while (j < m) empurrar('mais', b[j++]);
  }
  empurrar('igual', sufixo);
  return saida;
}

export function contarMudancas(t: Trecho[]) {
  const palavras = (s: string) => (s.match(/[^\s]+/g) || []).length;
  return {
    mais: t.filter((x) => x.tipo === 'mais').reduce((s, x) => s + palavras(x.texto), 0),
    menos: t.filter((x) => x.tipo === 'menos').reduce((s, x) => s + palavras(x.texto), 0),
  };
}
