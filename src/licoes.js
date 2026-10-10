// Lições: o que o dono sempre corrige nas mensagens das sessões, para elas acertarem antes de ele precisar.
// Lê as mensagens que ele editou antes de sair (corpo ≠ corpo_original) e os descartes; aqui nada é gravado.
// Sugestão só a partir de 2 "famílias": a mesma mensagem mandada a 4 grupos (texto quase igual) conta uma vez,
// senão um aviso repetido em 4 grupos vira uma dúzia de lições falsas. A contagem mostrada é de mensagens.
import { dono } from './config.js';
import { norm } from './util.js';

export const JANELA_DIAS = 90;
export const CANAIS_LICAO = ['whatsapp', 'email', 'discord'];
const MAX_PALAVRAS = 6; // trecho mais longo que vira lição
const MAX_EVIDENCIAS = 4;
const MAX_EVITAR = 12;
const MAX_TROCAR = 8;
const MESMA_FAMILIA = 0.7; // parte das palavras longas do texto menor que aparece no outro (como o semelhanca do util)
const HORA = 3600e3;

// palavra de ligação: não começa nem termina trecho ("e responde por aqui" vira "responde por aqui"). Sem "esta"
// e "este": sem acento viram "está" também.
const VAZIAS = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas num numa por pelo pela pelos pelas ' +
  'para pra pro pras pros com sem e ou mas que se ao aos me te lhe lhes vos eu tu ele ela eles elas voce voces vc vcs ' +
  'seu sua seus suas meu minha meus minhas teu tua nosso nossa esse essa esses essas isso isto aquele aquela aquilo').split(' '));
// troca de fato (data, dia, hora, saudação do horário) não é lição: "quinta 08/10" → "sexta 09/10" foi o prazo que mudou
const FATOS = new Set(('segunda terça quarta quinta sexta sábado domingo feira hoje amanhã ontem bom boa dia tarde noite manhã ' +
  'janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro').split(' ').map(norm));

// texto como chave de busca: ' palavra palavra ' (sem acento, minúsculo, pontuação vira espaço)
const limpa = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const comoChave = (s) => ` ${limpa(s)} `;
const semPontaSolta = (s) => String(s).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
const FIM_DE_FRASE = /[.!?;:…]["'”’)\]*_~]*$/;

// Palavra por palavra: t = como está no texto, k = chave (sem acento e sem pontuação; vazia em emoji e "—"),
// fim = a frase acaba nela (pontuação ou quebra de linha depois), inicio = começa frase
export function palavras(texto) {
  const s = String(texto || '');
  const lista = [];
  for (const x of s.matchAll(/\S+/g)) lista.push({ t: x[0], k: limpa(x[0]), de: x.index, ate: x.index + x[0].length });
  lista.forEach((p, i) => {
    const prox = lista[i + 1];
    p.fim = FIM_DE_FRASE.test(p.t) || !prox || s.slice(p.ate, prox.de).includes('\n');
    p.inicio = i === 0 || lista[i - 1].fim;
  });
  return lista;
}

// Diferença por palavras (LCS sobre as chaves): blocos tirado, acrescentado e trocado com a posição dos dois lados.
// posB[i] = onde a palavra i do original cai no texto final (para mostrar o "depois" do mesmo lugar).
export function diferenca(antes, depois) {
  const A = palavras(antes);
  const B = palavras(depois);
  const igual = (i, j) => (A[i].k || A[i].t) === (B[j].k || B[j].t);
  let ini = 0;
  while (ini < A.length && ini < B.length && igual(ini, ini)) ini++;
  let fa = A.length;
  let fb = B.length;
  while (fa > ini && fb > ini && igual(fa - 1, fb - 1)) { fa--; fb--; }
  const posB = new Array(A.length + 1);
  for (let i = 0; i < ini; i++) posB[i] = i;
  for (let i = fa; i <= A.length; i++) posB[i] = fb + (i - fa);
  const blocos = [];
  const bloco = (i1, i2, j1, j2) => blocos.push({
    op: i1 === i2 ? 'acrescentado' : j1 === j2 ? 'tirado' : 'trocado', i1, i2, j1, j2,
    antes: A.slice(i1, i2).map((p) => p.t).join(' '), depois: B.slice(j1, j2).map((p) => p.t).join(' '),
  });
  const n = fa - ini;
  const m = fb - ini;
  if (n * m > 1e6) { // texto enorme reescrito: um bloco só
    for (let i = ini; i < fa; i++) posB[i] = ini;
    if (n || m) bloco(ini, fa, ini, fb);
    return { A, B, blocos, posB };
  }
  const W = m + 1;
  const L = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * W + j] = igual(ini + i, ini + j) ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  let aberto = null;
  const fechar = () => { if (aberto) { bloco(ini + aberto[0], ini + i, ini + aberto[1], ini + j); aberto = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && igual(ini + i, ini + j)) { fechar(); posB[ini + i] = ini + j; i++; j++; continue; }
    if (!aberto) aberto = [i, j];
    if (j >= m || (i < n && L[(i + 1) * W + j] >= L[i * W + j + 1])) { posB[ini + i] = ini + j; i++; } else j++;
  }
  fechar();
  return { A, B, blocos, posB };
}

// o trecho com algumas palavras em volta, curto, para a evidência
function recorte(lista, i1, i2, ctx = 4, max = 160) {
  const a = Math.max(0, i1 - ctx);
  const b = Math.min(lista.length, i2 + ctx);
  let s = lista.slice(a, b).map((p) => p.t).join(' ');
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return `${a > 0 ? '…' : ''}${s}${b < lista.length && !s.endsWith('…') ? '…' : ''}`;
}

// ---------------------------------------------------------------- padrões (regra que a máquina confere)

const SAUDACOES = ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'tudo bom', 'tudo certo', 'e ai'];
const FECHOS = ['qualquer duvida', 'a disposicao', 'abraco', 'abracos', 'abs', 'att', 'atenciosamente', 'obrigado', 'obrigada',
  'valeu', 'bom fim de semana', 'bom final de semana', 'boa semana', 'ate mais', 'ate logo', 'ate amanha', 'beijo', 'beijos', 'bjs',
  'grato', 'grata', 'conte comigo', 'qualquer coisa me chama', 'qualquer coisa me avisa'];
const temSaudacao = (t) => { const c = comoChave(String(t).slice(0, 60)); return SAUDACOES.some((s) => c.includes(` ${s} `)); };
// a última frase (com letra: o emoji solto no fim não conta), se ela é um fecho ("Qualquer dúvida, me chama.",
// "Bom fim de semana!"); null se não é
function fecho(t) {
  const frases = String(t).trim().split(/(?<=[.!?…])\s+|\n+/).map((f) => f.trim()).filter((f) => /\p{L}/u.test(f));
  const ultima = frases[frases.length - 1] || '';
  if (ultima.length > 90) return null;
  const c = comoChave(ultima);
  return FECHOS.some((f) => c.includes(` ${f} `)) ? ultima.slice(0, 60) : null;
}
const emojis = (t) => (String(t).match(/\p{Extended_Pictographic}/gu) || []).length;

// na(original, final): a mensagem mostra o padrão; confere(texto, extras): a mensagem nova cai nele (sem confere = só
// aparece no guia). texto: como o aviso começa.
export const PADROES = {
  saudacao_tirada: {
    nome: 'Tira a saudação do começo',
    na: (a, b) => temSaudacao(a) && !temSaudacao(b),
    confere: (t) => temSaudacao(t),
    texto: () => `o ${dono()} costuma tirar a saudação do começo`,
  },
  saudacao_acrescentada: {
    nome: 'Abre com saudação',
    na: (a, b) => !temSaudacao(a) && temSaudacao(b),
    // só na primeira do dia para o destino: no meio da conversa ninguém dá bom dia de novo
    confere: (t, { ultimaEnviada, agora }) => !temSaudacao(t) && !(ultimaEnviada && agora - ultimaEnviada < 12 * HORA),
    texto: () => `o ${dono()} costuma abrir com "bom dia" ou "boa tarde" na primeira mensagem do dia`,
  },
  fecho_tirado: {
    nome: 'Tira o fecho',
    na: (a, b) => !!fecho(a) && !fecho(b),
    confere: (t) => fecho(t),
    texto: (achado) => `o ${dono()} costuma tirar o fecho${typeof achado === 'string' ? ` ("${achado}")` : ''}`,
  },
  emoji_tirado: {
    nome: 'Tira emoji',
    na: (a, b) => emojis(b) < emojis(a),
    confere: (t) => emojis(t) > 0,
    texto: () => `o ${dono()} costuma tirar emoji`,
  },
  negrito_duplo: {
    nome: 'Troca o **duplo**',
    na: (a, b) => /\*\*/.test(a) && !/\*\*/.test(b),
    // no WhatsApp o aviso de formato já diz isso
    confere: (t, { avisos }) => /\*\*/.test(t) && !avisos.some((x) => x.trecho === '**'),
    texto: () => `o ${dono()} costuma tirar o **duplo**`,
  },
  encurtado: {
    nome: 'Encurta',
    na: (a, b) => b.length <= a.length * 0.85,
    texto: () => `o ${dono()} costuma encurtar a mensagem`,
  },
};

// Só os padrões desta lista: "constructor" ou "toString" vindos da API achariam o protótipo do objeto, a lição
// passaria na validação e o texto dela quebraria toda leitura das lições (e o linter, que as lê antes de enviar).
export const padraoDe = (chave) => (chave && Object.hasOwn(PADROES, chave) ? PADROES[chave] : null);

// avisa no linter quando tem trecho ou padrão que a máquina confere; sem isso, a lição só aparece no msg guia
export const avisaNoLint = (l) => (l.padrao ? !!padraoDe(l.padrao)?.confere : !!l.trecho);

// O texto do aviso (e da linha do msg guia): 'o dono costuma tirar "Espero que esteja bem" (4×)'; com nome no
// config.json, o nome dele no lugar de "o dono"
export function textoDaLicao(l, achado) {
  const vezes = l.contagem > 0 ? ` (${l.contagem}×)` : '';
  const nota = l.nota ? `: ${l.nota}` : '';
  if (l.tipo === 'evitar') return `o ${dono()} costuma tirar "${l.trecho}"${vezes}${nota}`;
  if (l.tipo === 'trocar') return `o ${dono()} costuma trocar "${l.trecho}" por "${l.por}"${vezes}${nota}`;
  const p = padraoDe(l.padrao);
  if (p) return `${p.texto(achado)}${vezes}${nota}`;
  return `${l.nota || `evite "${l.trecho}"`}${vezes}`;
}

// Lições ativas que a mensagem dispara: aviso, nunca bloqueio. extras: ultimaEnviada (a Central mandou para o mesmo
// destino), agora e os avisos que o linter já deu.
export function conferirLicoes(m, licoes, { ultimaEnviada = null, agora = Date.now(), avisos = [] } = {}) {
  const corpo = String(m.corpo || '');
  const chave = comoChave(corpo);
  const saida = [];
  for (const l of licoes || []) {
    if (l.canal && l.canal !== m.canal) continue;
    let achou = false;
    if (l.padrao) achou = padraoDe(l.padrao)?.confere?.(corpo, { ultimaEnviada, agora, avisos }) || false;
    else if (l.trecho) {
      const alvo = limpa(l.trecho);
      achou = alvo ? chave.includes(` ${alvo} `) : corpo.includes(l.trecho); // "**" e outros sem letra: como está
    }
    if (achou) saida.push({ regra: 'licao', licao: l.id, msg: textoDaLicao(l, achou) });
  }
  return saida;
}

// ---------------------------------------------------------------- sugestões

// famílias: textos originais quase iguais (o mesmo aviso para vários grupos) viram uma só
function familias(msgs) {
  const conj = msgs.map((m) => new Set(palavras(m.corpo_original).map((p) => p.k).filter((k) => k.length >= 4 && !k.includes(' '))));
  const pai = msgs.map((_, i) => i);
  const raiz = (x) => { while (pai[x] !== x) x = pai[x] = pai[pai[x]]; return x; };
  for (let i = 0; i < msgs.length; i++) {
    for (let j = i + 1; j < msgs.length; j++) {
      const [a, b] = conj[i].size <= conj[j].size ? [conj[i], conj[j]] : [conj[j], conj[i]];
      if (a.size < 6) continue;
      let juntos = 0;
      for (const p of a) if (b.has(p)) juntos++;
      if (juntos / a.size >= MESMA_FAMILIA) pai[raiz(j)] = raiz(i);
    }
  }
  return new Map(msgs.map((m, i) => [m.id, raiz(i)]));
}

const primeiraLetra = (p) => p.t.match(/\p{L}/u)?.[0] || '';
// palavra de conteúdo: 4 letras ou mais, não é de ligação e está em minúscula (nome próprio não ensina nada)
const conteudo = (p) => /^\p{L}{4,}$/u.test(p.k) && !VAZIAS.has(p.k) && primeiraLetra(p) === primeiraLetra(p).toLowerCase();
// nome próprio no meio da frase ("o Ivo responde") não começa nem termina trecho: a lição tem que servir para outros
const nome = (p) => !p.inicio && /\p{Lu}/u.test(primeiraLetra(p));
const borda = (p) => !!p.k && !VAZIAS.has(p.k) && !nome(p);

const soFato = (lista) => lista.every((p) => !p.k || /^\d/.test(p.k) || FATOS.has(p.k) || VAZIAS.has(p.k));

// Trechos que o dono tirou desta mensagem: de 2 a 6 palavras (palavra solta só dá ruído: "mídia",
// "quinta"), dentro de uma frase, com uma palavra que ele mexeu e uma de conteúdo, sem palavra de ligação nas pontas,
// que não é só data ou dia e que sumiu mesmo do texto final.
function trechosTirados(d) {
  const mexida = new Array(d.A.length).fill(false);
  for (const b of d.blocos) for (let i = b.i1; i < b.i2; i++) mexida[i] = true;
  const final = comoChave(d.B.map((p) => p.t).join(' '));
  const achados = new Map();
  for (let i = 0; i < d.A.length; i++) {
    if (!borda(d.A[i]) || d.A[i].fim) continue;
    let tocou = mexida[i];
    for (let n = 2; n <= MAX_PALAVRAS && i + n <= d.A.length; n++) {
      const p = d.A[i + n - 1];
      if (!p.k) break; // emoji, "—": quebra o trecho
      tocou ||= mexida[i + n - 1];
      const lista = d.A.slice(i, i + n);
      const chave = lista.map((x) => x.k).join(' ');
      if (tocou && borda(p) && lista.some(conteudo) && !soFato(lista) && !final.includes(` ${chave} `) && !achados.has(chave)) {
        achados.set(chave, {
          chave, texto: semPontaSolta(lista.map((x) => x.t).join(' ')), i1: i, i2: i + n, palavras: n,
          conteudo: lista.filter(conteudo).map((x) => x.k),
        });
      }
      if (p.fim) break;
    }
  }
  return [...achados.values()];
}

// mensagens: [{id, canal, sessao_nome, corpo_original, corpo}] (enviadas ou aprovadas, o dono editou)
export function sugerirLicoes(mensagens) {
  const msgs = (mensagens || []).filter((m) => m.corpo_original && m.corpo != null && m.corpo !== m.corpo_original);
  const familia = familias(msgs);
  const cand = new Map();
  const anotar = (chave, base, m, ev) => {
    const c = cand.get(chave) || { chave, ...base, ids: new Set(), familias: new Set(), sessoes: new Set(), canais: new Set(), evidencias: [] };
    if (c.ids.has(m.id)) return;
    c.ids.add(m.id);
    c.familias.add(familia.get(m.id));
    c.sessoes.add(m.sessao_nome || '');
    c.canais.add(m.canal);
    c.evidencias.push({ id: m.id, ...ev });
    cand.set(chave, c);
  };
  let encurtadas = 0;
  let corteTotal = 0;
  for (const m of msgs) {
    const d = diferenca(m.corpo_original, m.corpo);
    for (const g of trechosTirados(d)) {
      anotar(`evitar:${g.chave}`, { tipo: 'evitar', trecho: g.texto, palavras: g.palavras, conteudo: g.conteudo }, m, {
        antes: recorte(d.A, g.i1, g.i2), depois: recorte(d.B, d.posB[g.i1], d.posB[g.i2]),
      });
    }
    for (const b of d.blocos) {
      if (b.op !== 'trocado' || b.i2 - b.i1 > 3 || b.j2 - b.j1 > 3) continue;
      const de = d.A.slice(b.i1, b.i2);
      const para = d.B.slice(b.j1, b.j2);
      if (soFato([...de, ...para])) continue;
      const ka = de.map((p) => p.k).join(' ').trim();
      const kb = para.map((p) => p.k).join(' ').trim();
      if (!ka || !kb) continue;
      anotar(`trocar:${ka}>${kb}`, { tipo: 'trocar', trecho: semPontaSolta(b.antes), por: semPontaSolta(b.depois) }, m, {
        antes: recorte(d.A, b.i1, b.i2, 3), depois: recorte(d.B, b.j1, b.j2, 3),
      });
    }
    // evidência do padrão: o começo, o fim ou a palavra onde ele aparece, nos dois textos
    const inicio = { antes: recorte(d.A, 0, 10, 0), depois: recorte(d.B, 0, 10, 0) };
    const naPalavra = (re) => {
      const i = d.A.findIndex((p) => re.test(p.t));
      return i < 0 ? inicio : { antes: recorte(d.A, i, i + 1), depois: recorte(d.B, d.posB[i], d.posB[i + 1]) };
    };
    const EVIDENCIA = {
      saudacao_tirada: () => inicio,
      saudacao_acrescentada: () => inicio,
      fecho_tirado: () => ({ antes: recorte(d.A, d.A.length - 10, d.A.length, 0), depois: recorte(d.B, d.B.length - 10, d.B.length, 0) }),
      emoji_tirado: () => naPalavra(/\p{Extended_Pictographic}/u),
      negrito_duplo: () => naPalavra(/\*\*/),
      encurtado: () => ({ antes: `${m.corpo_original.length} caracteres`, depois: `${m.corpo.length} caracteres` }),
    };
    for (const [padrao, p] of Object.entries(PADROES)) {
      if (p.na(m.corpo_original, m.corpo)) anotar(`regra:${padrao}`, { tipo: 'regra', padrao, nome: p.nome }, m, EVIDENCIA[padrao]());
    }
    if (PADROES.encurtado.na(m.corpo_original, m.corpo)) {
      encurtadas++;
      corteTotal += 1 - m.corpo.length / m.corpo_original.length;
    }
  }
  const encurtadoPct = encurtadas ? Math.round((100 * corteTotal) / encurtadas) : 0;

  const fechar = (c) => {
    const s = {
      chave: c.chave, tipo: c.tipo, trecho: c.trecho ?? null, por: c.por ?? null, padrao: c.padrao ?? null,
      nota: c.padrao === 'encurtado' ? `em média ${encurtadoPct}% mais curta; mande só o essencial` : null,
      canal: c.canais.size === 1 ? [...c.canais][0] : null,
      contagem: c.ids.size, familias: c.familias.size, sessoes: c.sessoes.size,
      evidencias: c.evidencias.sort((a, b) => b.id - a.id).slice(0, MAX_EVIDENCIAS),
    };
    return { ...s, nome: c.nome || null, texto: textoDaLicao(s), avisa: avisaNoLint(s) };
  };
  const ordem = (a, b) => b.familias.size - a.familias.size || b.ids.size - a.ids.size || (b.palavras || 0) - (a.palavras || 0)
    || (a.chave < b.chave ? -1 : 1);
  const todos = [...cand.values()];
  // evitar: um pedaço do mesmo trecho não vira outra sugestão ("Nesse período alguém" e "alguém responde por aqui" saem do
  // mesmo corte que "período alguém responde"): fica de fora o que está contido em outro ou divide mensagem e palavra com ele
  const evitar = [];
  for (const c of todos.filter((x) => x.tipo === 'evitar' && x.familias.size >= 2).sort(ordem)) {
    const k = ` ${c.chave.slice(7)} `;
    const repete = (e) => e.k.includes(k) || k.includes(e.k)
      || ([...c.ids].some((id) => e.c.ids.has(id)) && c.conteudo.some((p) => e.c.conteudo.includes(p)));
    if (evitar.some(repete)) continue;
    evitar.push({ c, k });
    if (evitar.length >= MAX_EVITAR) break;
  }
  const trocar = todos.filter((x) => x.tipo === 'trocar' && x.familias.size >= 2).sort(ordem).slice(0, MAX_TROCAR);
  const regras = todos.filter((x) => x.tipo === 'regra' && x.familias.size >= 2).sort(ordem);
  const sugestoes = [...regras, ...evitar.map((e) => e.c), ...trocar].map(fechar)
    .sort((a, b) => b.familias - a.familias || b.contagem - a.contagem);
  return { sugestoes, edicoes: { total: msgs.length, encurtadas, encurtadoPct } };
}

// ---------------------------------------------------------------- descartes

// motivo escrito que não diz nada (o padrão do msg descartar) ou automático (varredura do "já respondi")
const LIVRE_VAZIO = /^(?:descartada pela sessão|sumiu sozinha:)/i;
// Por canal e por sessão: quantos, e por quê (código do painel, "escrito" = só texto livre, null = sem motivo)
export function analisarDescartes(lista) {
  const grupo = (campo, vazio) => {
    const mapa = new Map();
    for (const d of lista) {
      const nomeGrupo = d[campo] || vazio;
      const g = mapa.get(nomeGrupo) || { nome: nomeGrupo, n: 0, porMotivo: new Map(), exemplos: [] };
      const livre = String(d.motivo || '').trim();
      const util = livre && !LIVRE_VAZIO.test(livre);
      const motivo = d.motivo_codigo || (util ? 'escrito' : null);
      g.n++;
      g.porMotivo.set(motivo, (g.porMotivo.get(motivo) || 0) + 1);
      if (util && g.exemplos.length < 3 && !g.exemplos.includes(livre.slice(0, 140))) g.exemplos.push(livre.slice(0, 140));
      mapa.set(nomeGrupo, g);
    }
    return [...mapa.values()].sort((a, b) => b.n - a.n || (a.nome < b.nome ? -1 : 1)).map((g) => ({
      nome: g.nome, n: g.n, semMotivo: g.porMotivo.get(null) || 0, exemplos: g.exemplos,
      motivos: [...g.porMotivo].map(([codigo, n]) => ({ codigo, n })).sort((a, b) => b.n - a.n),
    }));
  };
  const porCanal = grupo('canal', '?');
  return {
    total: lista.length, semMotivo: porCanal.reduce((s, c) => s + c.semMotivo, 0),
    porCanal, porSessao: grupo('sessao_nome', '(sem sessão)').slice(0, 10),
  };
}
