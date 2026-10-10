// Linter das mensagens. Bloqueia (o aprovar recusa e o despachante confere de novo na hora de enviar):
// segredo em qualquer coisa que sai (o corpo como o canal monta, assunto, assinatura, citação, destinatário,
// nome de anexo, parte do Discord), dentro de link ou em anexo de texto; anexo recusado pela validação
// (credencial, compactado, sumiu) ou que não pôde ser checado; qualquer impossibilidade de checar segredo
// (cofre fora do ar, valor do cofre que não leu, anexo não conferido, texto acima de 200 mil caracteres: falha
// fechado, nunca vira aviso); destino vazio ou ambíguo; e-mail sem assunto; mais de 20 MB de anexo. Só avisa:
// duplicada, cliente cruzado, acento, formato, tamanho, cara de IA, horário, cópia oculta, anexo binário (não é
// lido), anexo que o canal não manda e as lições do dono (src/licoes.js).
// Função pura: o que vem de fora (o que o canal manda, valores do cofre, clientes e diretório de pessoas, outras
// pendentes, anexos já inspecionados por src/anexos.js, relógio) chega em `dados`. O valor de um segredo nunca
// aparece no resultado. O texto é varrido como o destinatário lê: sem caractere invisível, em NFKC, sem
// homógrafo; o valor do cofre também é procurado com separador no meio ("S e n h 4").
// Detector de segredo sem volta atrás: nenhuma regex de padrão varre o texto inteiro. Cada padrão é achado por
// indexOf do prefixo fixo (sk-, ghp_, eyJ, AKIA...) e conferido ali por uma regex ancorada (/y) de tamanho
// mínimo fixo; rótulo ("senha:") e parâmetro de link ("?token=") são achados por uma regex só de palavras fixas
// e o resto é lido com limite; valor do cofre é um indexOf por valor. Tudo linear, sem X{n,} (o V8 estoura a
// pilha com ele num trecho de 5+ MB): test/lint.test.js mede 50 mil caracteres maliciosos e anexo de 2 MB.
import { EMAIL, norm } from './util.js';
import { conferirLicoes } from './licoes.js';

// ---------------------------------------------------------------- detector de segredo

// o caractere antes do começo do padrão não pode ser destes (o \b de antes: letra, número ou _); nos que
// aparecem por acaso dentro de base64 (AIza, EAA), também + / -
const LETRA_OU_NUMERO = /[A-Za-z0-9_]/;
const DE_BASE64 = /[A-Za-z0-9+/_-]/;
// regex ancorada na posição do prefixo: devolve onde o valor termina (a cauda do mesmo tipo de caractere entra,
// para comparar com o valor liberado) ou -1
const ancorada = (re) => (texto, i) => {
  re.lastIndex = i;
  const m = re.exec(texto);
  return m ? i + m[0].length : -1;
};
// cabeçalho.payload.assinatura em base64url: "eyJ" + 10 até o ponto, 10 até o outro ponto, 10. Os "eyJ" de um
// mesmo trecho ("eyJ-eyJ-eyJ-...") dividem o resto dele: o trecho é medido uma vez só (memo).
const B64URL = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95;
function fimDoTrecho(texto, i) {
  while (i < texto.length && B64URL(texto.charCodeAt(i))) i++;
  return i;
}
function jwt(texto, i, memo) {
  if (!(i < memo.fimTrecho)) {
    const f1 = fimDoTrecho(texto, i);
    let fim = -1;
    if (texto[f1] === '.') {
      const f2 = fimDoTrecho(texto, f1 + 1);
      if (f2 - f1 - 1 >= 10 && texto[f2] === '.') {
        const f3 = fimDoTrecho(texto, f2 + 1);
        if (f3 - f2 - 1 >= 10) fim = f3;
      }
    }
    memo.fimTrecho = f1;
    memo.fimJwt = fim;
  }
  return memo.fimJwt !== -1 && memo.fimTrecho - i >= 13 ? memo.fimJwt : -1;
}
// "-----BEGIN ... PRIVATE KEY-----" (e "... KEY BLOCK-----", do PGP): achada pelo "PRIVATE KEY", conferida em volta
const BEGIN_ANTES = /-----BEGIN [A-Z ]{0,40}$/;
function chavePrivada(texto, i) {
  const fim = i + 11;
  const depois = texto.startsWith('-----', fim) ? fim + 5 : texto.startsWith(' BLOCK-----', fim) ? fim + 11 : -1;
  return depois !== -1 && BEGIN_ANTES.test(texto.slice(Math.max(0, i - 51), i)) ? depois : -1;
}
// [nome, prefixos, borda (o caractere de antes não pode ser deste tipo), confere(texto, i, memo) → fim ou -1]
const DETECTORES = [
  ['chave de API (sk-…)', ['sk-'], LETRA_OU_NUMERO, ancorada(/sk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20}[A-Za-z0-9_-]*/y)],
  ['token do GitHub', ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'], LETRA_OU_NUMERO,
    ancorada(/gh[pousr]_[A-Za-z0-9]{30}[A-Za-z0-9]*|github_pat_[A-Za-z0-9_]{20}[A-Za-z0-9_]*/y)],
  ['token do Slack', ['xox'], LETRA_OU_NUMERO, ancorada(/xox[a-z]-[A-Za-z0-9-]{10}[A-Za-z0-9-]*/y)],
  ['chave da AWS', ['AKIA'], LETRA_OU_NUMERO, ancorada(/AKIA[0-9A-Z]{16}(?![A-Za-z0-9_])/y)],
  ['token JWT', ['eyJ'], LETRA_OU_NUMERO, jwt],
  ['chave privada', ['PRIVATE KEY'], null, chavePrivada],
  ['chave do Google', ['AIza'], DE_BASE64, ancorada(/AIza[0-9A-Za-z_-]{35}/y)],
  ['token da Meta', ['EAA'], DE_BASE64, ancorada(/EAA[A-Za-z0-9]{80}[A-Za-z0-9]*/y)],
  ['chave do Stripe', ['sk_live_', 'rk_live_'], LETRA_OU_NUMERO, ancorada(/[sr]k_live_[A-Za-z0-9]{20}[A-Za-z0-9]*/y)],
  ['chave secreta do Supabase', ['sb_secret_'], LETRA_OU_NUMERO, ancorada(/sb_secret_[A-Za-z0-9_-]{20}[A-Za-z0-9_-]*/y)],
  // webhook leva o segredo no próprio caminho do link
  ['webhook do Slack', ['hooks.slack.com/services/'], LETRA_OU_NUMERO,
    ancorada(/hooks\.slack\.com\/services\/[A-Z0-9]{1,40}\/[A-Z0-9]{1,40}\/[A-Za-z0-9]{20}[A-Za-z0-9]*/y)],
  ['webhook do Discord', ['discord.com/api/webhooks/', 'discordapp.com/api/webhooks/'], LETRA_OU_NUMERO,
    ancorada(/discord(?:app)?\.com\/api\/webhooks\/\d{1,25}\/[\w-]{30}[\w-]*/y)],
];

// Cada ocorrência válida de um detector, em ordem: { i, fim }. Depois de uma ocorrência, o que começa dentro dela
// é pulado (seria um pedaço do mesmo valor): cada trecho é lido uma vez, mesmo com "sk-sk-sk-...".
function* ocorrencias(texto, [, prefixos, borda, confere]) {
  for (const prefixo of prefixos) {
    const memo = { fimTrecho: -1, fimJwt: -1 };
    let pularAte = 0;
    for (let i = texto.indexOf(prefixo); i !== -1; i = texto.indexOf(prefixo, i + 1)) {
      if (i < pularAte || (borda && i > 0 && borda.test(texto[i - 1]))) continue;
      const fim = confere(texto, i, memo);
      if (fim === -1) continue;
      pularAte = fim;
      yield { i, fim };
    }
  }
}

// O primeiro padrão de token que aparece no texto (o nome) ou null. src/anexos.js usa no conteúdo de todo
// anexo, qualquer que seja a extensão (id_rsa salvo como "contrato.pdf" cai aqui).
export function padraoDeSegredo(texto) {
  for (const d of DETECTORES) if (!ocorrencias(texto, d).next().done) return d[0];
  return null;
}

// Rótulo: "senha: X", "password = X", "token: X", "a senha é X", "a senha é: X", "senha do painel: X", "a senha
// do Wi-Fi é X", chave de JSON/YAML/.env ("access_token": "X", client_secret: X, DB_PASSWORD=X, SECRET_KEY=X,
// AWS_SECRET_ACCESS_KEY=X) e o negrito/itálico do WhatsApp em volta (*Senha:* X, *Senha*: X, _senha_: X).
// Só bloqueia quando X tem cara de credencial, então "o token de acesso expirou" e "a senha é a mesma de
// sempre" passam. Depois de "do painel" só vale ":", "=" ou "é" ("token de acesso e refresh_token1" não é rótulo).
// A regex do rótulo só tem palavras fixas; o que vem depois é lido na posição dele, tudo com limite.
const ROTULOS = /senha|password|passwd|pwd|token|secret(?:[ _-]?(?:access[ _-]?)?key)?|api[ _-]?key|access[ _-]?key|private[ _-]?key/gi;
const DEPOIS_DO_ROTULO = new RegExp([
  '(?:[ \\t]{1,10}d[aeo]s?[ \\t]{1,10}[^\\s:=*_~"\']{1,25}[*_~"\']{0,3}[ \\t]{0,10}(?:[:=]|(?<=[ \\t])é:?[ \\t])',
  '|[*_~"\']{0,3}[ \\t]{0,10}(?:[:=]|(?<=[ \\t])(?:é|e|eh):?[ \\t]))',
  '[*_~]{0,3}\\s{0,40}["\'`]?([^\\s"\'`]{4,256})',
].join(''), 'iy');
const ALFANUMERICO = /[A-Za-z0-9]/;
// Link não é isento: usuário:senha antes do @ (https://, postgres://...), achado pelo "://", e parâmetro de
// chave ou assinatura com valor de 12+ caracteres. Link comum passa porque o parâmetro não é desses:
// conversas?id=<uuid>, wa.me/...?text=, claude.ai/artifact, docs.google.com/...?usp=sharing.
const ESQUEMA_ANTES = /(?:^|[^a-z0-9+.-])[a-z][a-z0-9+.-]{0,30}$/i;
const USUARIO_SENHA = /[^\s/?#@:]{0,256}:([^\s/?#@]{1,256})@/y;
const PARAMETRO_SECRETO = /[?&#;](access_token|api_key|apikey|token|key|secret|password|senha|sig|signature|x-amz-signature|x-goog-signature|auth|code)=/gi;
const VALOR_DO_PARAMETRO = /[^\s&#"'<>]{12,4096}/y;

// palavra que só existe com acento ("nao" é sempre "não")
const SEM_ACENTO = new Set(('nao voce voces entao tambem ja ate sao estao proximo proxima numero numeros possivel amanha ' +
  'horario horarios informacao informacoes atencao duvida duvidas ultimo ultima ninguem alguem porem alem apos ola ' +
  'codigo pagina relatorio usuario conteudo necessario publico facil dificil rapido video videos audio audios area mes tres')
  .split(' '));

// Expressões que denunciam texto de IA. É gosto: apague daqui o que não fizer sentido para você.
const EXPRESSOES_IA = [
  // fechos de atendente robô
  'fico à disposição', 'qualquer dúvida estou aqui', 'qualquer dúvida, estou aqui', 'espero ter ajudado',
  'como posso te ajudar', 'conte comigo', 'estou à disposição',
  // aberturas de enchimento
  'espero que esteja bem', 'venho por meio desta', 'gostaria de', 'segue abaixo', 'conforme conversado',
  'passando para informar', 'dando continuidade',
  // conectivos de redação
  'vale ressaltar', 'é importante destacar', 'nesse sentido', 'dessa forma', 'além disso', 'por fim', 'em resumo',
  'sendo assim', 'no que tange', 'vale lembrar que', 'cabe destacar', 'resumindo:',
  // adjetivo e advérbio de brilho
  'robusto', 'robusta', 'estratégico', 'estratégica', 'assertivo', 'assertiva', 'extremamente', 'altamente',
  'fundamental', 'crucial', 'significativo', 'significativa', 'impactante', 'de forma eficiente',
];
// verbo rebuscado no lugar do comum (qualquer flexão: "viabilizar", "viabilizamos", "implementação")
const RAIZES_IA = ['constitu', 'viabiliz', 'otimiz', 'alavanc', 'implement', 'efetu', 'realiz', 'mapea'];

// texto: acima disso o texto (ou a citação) não é varrido e a mensagem é barrada; anexo de texto tem o limite
// dele em src/anexos.js
const LIMITE = { whatsappIdeal: 600, whatsappMax: 1000, discord: 2000, anexos: 20 * 1024 * 1024, texto: 200000 };

// ---------------------------------------------------------------- função principal

export function lint(m, dados = {}) {
  const bloqueios = [];
  const avisos = [];
  const corpo = String(m.corpo || '');
  const assunto = String(m.assunto || '');
  const texto = assunto ? `${assunto}\n${corpo}` : corpo;
  const agora = dados.agora ?? Date.now();
  const clientes = dados.clientes || [];
  const lado = ladoDoDestino(m, dados.pessoas || [], clientes);

  // Sem a lista do cofre ou com um nome dela sem leitura que sirva (src/segredos.js: não leu, ou a leitura
  // passou de 1 h) não dá para saber se um segredo está no texto: falha fechado. naoChecou = o despachante
  // trata como passageiro e tenta de novo (o cofre relê em 1 min). Com a lista parcial, o que foi lido ainda é
  // conferido abaixo: o valor achado aparece no motivo junto com este bloqueio.
  const falhas = Array.isArray(dados.cofreFalhas) ? dados.cofreFalhas : [];
  if (falhas.length) {
    const nomes = `${falhas.slice(0, 5).join(', ')}${falhas.length > 5 ? '…' : ''}`;
    const total = Math.max(dados.cofreTotal ?? 0, falhas.length);
    bloqueios.push({ regra: 'segredo', msg: `não consegui verificar segredos (${falhas.length} de ${total} não lidos: ${nomes})`, naoChecou: true });
  } else if (!Array.isArray(dados.segredos)) {
    bloqueios.push({ regra: 'segredo', msg: `não consegui verificar segredos: ${dados.cofreErro || 'cofre indisponível'}`, naoChecou: true });
  }
  const opcoes = {
    senhasDeCliente: dados.senhasDeCliente || {},
    clientes,
    // de quem é o destino: nome/diretório; sem isso, o cliente que a sessão declarou
    clienteDestino: lado.cliente || (m.cliente ? clienteCanonico(m.cliente, clientes) : null),
  };
  // Tudo o que sai da máquina: `dados.saida` é o montar() do canal (src/server.js → canal.saida: o corpo com as
  // menções trocadas e a assinatura, o assunto, o texto citado, os destinatários do e-mail, o nome de cada
  // anexo e cada parte do Discord); sem ele, os campos da linha (oQueSai). Mais o conteúdo dos anexos de texto
  // (src/anexos.js). Texto da mensagem (assunto + corpo) ou qualquer pedaço acima do limite não é varrido:
  // barra (falha fechado), sem naoChecou, porque tentar de novo não muda nada; a mensagem tem que encolher.
  const fontes = [];
  const fmt = (x) => x.toLocaleString('pt-BR');
  const grandeDemais = texto.length > LIMITE.texto;
  if (grandeDemais) {
    bloqueios.push({ regra: 'segredo', msg: `texto grande demais para checar: ${fmt(texto.length)} caracteres (o limite é 200 mil)` });
  } else {
    for (const f of Array.isArray(dados.saida) ? dados.saida : oQueSai(m)) {
      const t = String(f.texto ?? '');
      if (t.length > LIMITE.texto) {
        bloqueios.push({ regra: 'segredo', msg: `${f.nome} grande demais para checar: ${fmt(t.length)} caracteres (o limite é 200 mil)` });
      } else if (t) {
        fontes.push({ texto: t, onde: f.onde, esconder: /^(?:nome do anexo|destinatário)/.test(f.nome || '') });
      }
    }
  }
  for (const a of dados.anexos || []) if (a.texto) fontes.push({ texto: a.texto, onde: `no anexo ${a.nome}` });
  const escondidos = new Set(); // nome de anexo ou destinatário com segredo: não aparece em motivo nenhum
  for (const f of fontes) {
    const seg = segredos(f.texto, dados.segredos, { ...opcoes, onde: f.onde });
    if (f.esconder && seg.bloqueios.length) escondidos.add(f.texto);
    bloqueios.push(...seg.bloqueios);
    avisos.push(...seg.avisos);
  }
  const an = anexos(m, dados.anexos);
  bloqueios.push(...an.bloqueios);
  avisos.push(...an.avisos);

  if (!m.destino_id) {
    const n = Array.isArray(m.candidatos) ? m.candidatos.length : 0;
    bloqueios.push({ regra: 'destino', msg: n > 1 ? `destino ambíguo: ${n} opções, escolha uma` : 'sem destino' });
  }
  // número que não está na agenda nem tem conversa: dígito trocado manda para ninguém (ou para um estranho)
  if (m.destino_id && dados.destinoConhecido === false) {
    avisos.push({ regra: 'destino', msg: 'número fora da agenda e sem conversa com você: confira os dígitos antes de aprovar', trecho: String(m.destino_id).split('@')[0] });
  }
  if (m.canal === 'email' && !assunto.trim()) bloqueios.push({ regra: 'assunto', msg: 'e-mail sem assunto' });
  if (m.canal === 'email') {
    // cópia com "a@exemplo.com,b@exemplo.com" dentro de um endereço só (cabeçalho do e-mail que chegou) vira destinatário a mais
    for (const [campo, nome] of [['cc', 'cópia'], ['bcc', 'cópia oculta']]) {
      const ruins = String(m.extra?.[campo] || '').split(',').map((e) => e.trim()).filter((e) => e && !EMAIL.test(e));
      if (ruins.length) bloqueios.push({ regra: 'destino', msg: `${nome} com endereço inválido: ${ruins.join(', ')}` });
    }
    if (m.extra?.cc) avisos.push({ regra: 'destino', msg: `vai com cópia para ${m.extra.cc}`, trecho: String(m.extra.cc) });
  }
  if (m.canal === 'email' && m.extra?.bcc) avisos.push({ regra: 'destino', msg: `vai com cópia oculta (Cco) para ${m.extra.bcc}`, trecho: String(m.extra.bcc) });

  const outras = dados.outrasPendentes || [];
  if (outras.length) {
    avisos.push({ regra: 'duplicada', msg: `mais ${outras.length} pendente${outras.length > 1 ? 's' : ''} para o mesmo destino: ${outras.map((i) => `#${i}`).join(', ')}` });
  }

  // as regras que leem o texto inteiro só rodam se ele foi varrido (o grande demais já está barrado)
  if (!grandeDemais) {
    avisos.push(...clienteCruzado(m, texto, lado, clientes));
    avisos.push(...acentos(texto));
    avisos.push(...formato(m, corpo));
  }
  avisos.push(...tamanho(m.canal, corpo));
  if (!grandeDemais) avisos.push(...caraDeIa(texto));
  avisos.push(...horario(m, agora));

  const anterior = dados.anterior;
  if (anterior && ['enviada', 'enviando'].includes(anterior.status)) {
    avisos.push({ regra: 'versao', msg: `substitui uma mensagem que já foi enviada (#${anterior.id})` });
  } else if (anterior?.status === 'erro') {
    avisos.push({ regra: 'versao', msg: `a versão anterior (#${anterior.id}) deu erro: confira se ela saiu antes de aprovar` });
  }

  // lições do dono (src/licoes.js): só avisam; lição com defeito deixa de avisar, nunca barra a mensagem
  if (!grandeDemais && dados.licoes?.length) {
    try {
      avisos.push(...conferirLicoes(m, dados.licoes, { ultimaEnviada: dados.ultimaEnviada, agora, avisos }));
    } catch { /* nada */ }
  }

  // o nome do anexo (ou o destinatário) que tem segredo sai de todo motivo: anexo binário, recusa, cópia oculta
  for (const x of escondidos.size ? [...bloqueios, ...avisos] : []) {
    for (const s of escondidos) {
      x.msg = x.msg.split(s).join('••••');
      if (typeof x.trecho === 'string') x.trecho = x.trecho.split(s).join('••••');
    }
  }

  // cofre: true quando os valores do cofre entraram na conferência (false = só os padrões: cofre não lido, ou
  // nenhum cofre configurado)
  return { bloqueios, avisos, cofre: Array.isArray(dados.segredos) && !dados.semCofre };
}

// ---------------------------------------------------------------- texto como o destinatário lê
// Antes de varrer: sem caractere invisível ou de formatação (categoria Unicode Cf: U+200B a U+200D, U+2060,
// U+FEFF, U+00AD, marcas de direção, tags; e os vazios que não são Cf: seletor de variação, preenchimento
// hangul, U+034F), em NFKC (largura total e compatibilidade viram o caractere comum: "ｇｈｐ＿" é "ghp_"; NBSP e
// espaço fino viram espaço) e com os homógrafos cirílicos e gregos mais comuns trocados pela letra latina
// ("gһp_" é "ghp_"). Os valores do cofre passam pela mesma normalização. Texto só em ASCII já está assim.
const INVISIVEIS = /[\p{Cf}͏ᅟᅠ឴឵᠋-᠍ㅤﾠ︀-️\u{E0100}-\u{E01EF}]/gu;
const HOMOGRAFOS = Object.fromEntries([
  ...[...'аеорсухіјѕԁһӏԛԝ'].map((c, k) => [c, 'aeopcyxijsdhlqw'[k]]), // cirílico minúsculo
  ...[...'АВЕКМНОРСТХУІЈЅԚԜ'].map((c, k) => [c, 'ABEKMHOPCTXYIJSQW'[k]]), // cirílico maiúsculo
  ...[...'ΑΒΕΖΗΙΚΜΝΟΡΤΥΧοαν'].map((c, k) => [c, 'ABEZHIKMNOPTYXoav'[k]]), // grego
]);
const HOMOGRAFO = new RegExp(`[${Object.keys(HOMOGRAFOS).join('')}]`, 'g');
const FORA_DO_ASCII = /[^\x00-\x7F]/;
export function paraVarrer(texto) {
  if (!FORA_DO_ASCII.test(texto)) return texto;
  return texto.replace(INVISIVEIS, '').normalize('NFKC').replace(INVISIVEIS, '').replace(HOMOGRAFO, (c) => HOMOGRAFOS[c]);
}

// O texto "colado": só letras e números (sem espaço, quebra e pontuação), com onde cada trecho contínuo começa
// no texto. Valor do cofre escrito com separador no meio ("S e n h 4 # C o m e t a") aparece inteiro nele.
const LETRA_NUMERO = /[\p{L}\p{N}]/u;
function ehLetraOuNumero(t, i) {
  const c = t.charCodeAt(i);
  return c < 128 ? (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) : LETRA_NUMERO.test(t[i]);
}
function colar(texto) {
  const pedacos = [];
  const ini = []; // posição de cada trecho no colado
  const orig = []; // e no texto
  let n = 0;
  for (let i = 0; i < texto.length;) {
    if (!ehLetraOuNumero(texto, i)) {
      i++;
      continue;
    }
    const s = i;
    while (i < texto.length && ehLetraOuNumero(texto, i)) i++;
    pedacos.push(texto.slice(s, i));
    ini.push(n);
    orig.push(s);
    n += i - s;
  }
  return { texto: pedacos.join(''), ini, orig };
}
// o caractere g do colado: em que trecho está e a posição dele no texto (busca binária)
function noTexto(c, g) {
  let lo = 0;
  let hi = c.ini.length - 1;
  while (lo < hi) {
    const meio = (lo + hi + 1) >> 1;
    if (c.ini[meio] <= g) lo = meio;
    else hi = meio - 1;
  }
  return { trecho: lo, pos: c.orig[lo] + (g - c.ini[lo]) };
}
// o valor sem o que não é letra nem número nas pontas ("#Senh4x2026!" → "Senh4x2026")
function nucleo(v) {
  let i = 0;
  let j = v.length;
  while (i < j && !ehLetraOuNumero(v, i)) i++;
  while (j > i && !ehLetraOuNumero(v, j - 1)) j--;
  return v.slice(i, j);
}

// ---------------------------------------------------------------- o que sai

// O que sai da máquina em texto, pelos campos da linha: assunto, corpo, citação e nome de cada anexo. O servidor
// manda no lugar disso o montar() do canal (canal.saida: corpo com as menções trocadas, assinatura, citação
// automática, destinatários do e-mail, partes do Discord); isto vale para quem chama o linter sem ele.
export function oQueSai(m) {
  const f = [];
  if (m.assunto) f.push({ texto: String(m.assunto), onde: 'no assunto', nome: 'assunto' });
  f.push({ texto: String(m.corpo || ''), onde: 'no texto', nome: 'texto' });
  if (m.extra?.citar?.texto) f.push({ texto: String(m.extra.citar.texto), onde: 'na citação', nome: 'citação' });
  const anexos = Array.isArray(m.anexos) ? m.anexos : [];
  anexos.forEach((c, k) => f.push({ texto: String(c).split('/').pop(), onde: `no nome do anexo ${k + 1}`, nome: `nome do anexo ${k + 1}` }));
  return f;
}

// ---------------------------------------------------------------- regras

// tira a pontuação do fim ("senha: X." → "X") num laço: a regex /[.,;]+$/ volta atrás a cada posição
const PONTUACAO_FINAL = new Set('.,;:!?)]');
function aparar(v) {
  let j = v.length;
  while (j > 0 && PONTUACAO_FINAL.has(v[j - 1])) j--;
  return v.slice(0, j);
}

function pareceCredencial(v) {
  const s = aparar(v);
  if (s.length < 6) return false;
  return /\d/.test(s) || /[!@#$%^&*_+=?/\\|<>{}[\]~-]/.test(s) || /[a-z][A-Z]/.test(s) || s.length >= 12;
}

// a ênfase do WhatsApp em volta do valor ("*Senh4x2026*") sai só para comparar com o valor liberado
const ENFASE = new Set('*_~');
function semEnfase(v) {
  let i = 0;
  let j = v.length;
  while (i < j && ENFASE.has(v[i])) i++;
  while (j > i && ENFASE.has(v[j - 1])) j--;
  return v.slice(i, j);
}

const EH_LINK = /^(?:https?:\/\/|www\.)/i;
const ATE_O_ESPACO = /\S*/y;
const PROXIMA_PALAVRA = /\s{1,200}(\S{1,256})/y;
// a primeira palavra com letra ou número depois do link que termina em i, pulando pontuação solta ("→", "|")
function palavraDepois(texto, i) {
  for (let k = 0; k < 3; k++) {
    PROXIMA_PALAVRA.lastIndex = i;
    const m = PROXIMA_PALAVRA.exec(texto);
    if (!m) return '';
    if (/[\p{L}\p{N}]/u.test(m[1])) return m[1];
    i = m.index + m[0].length;
  }
  return '';
}

// Trecho para achar o segredo sem mostrar nada dele: as palavras que vêm antes + bolinhas. Não entra nada de
// outro achado (o trecho começa depois dele) e vira bolinha a palavra com cara de credencial, com valor do cofre
// dentro, ou que é pedaço de um valor achado (o "S e n h 4" de um valor escrito separado).
function antesDe(texto, i, achados, trechos) {
  let ini = Math.max(0, i - 24);
  for (const t of trechos) if (t.i < i) ini = Math.max(ini, Math.min(i, t.fim));
  const ehPedaco = (p) => {
    const c = colar(p).texto;
    return achados.some((v) => p.includes(v.valor) || (v.valor.includes(p) && p.length >= 6) || (c && v.colado.includes(c)));
  };
  const contexto = texto.slice(ini, i).replace(/\s+/g, ' ').trimStart().split(' ')
    .map((p) => (pareceCredencial(p) || ehPedaco(p) ? '••••' : p))
    .join(' ');
  return `${contexto}••••`;
}

// Os valores do cofre prontos para procurar (normalizados como o texto; valor de várias linhas também por linha
// longa), preparados uma vez por leitura do cofre, não a cada mensagem.
const MINIMO_COLADO = 8;
const PREPARADOS = new WeakMap();
function preparar(doCofre) {
  if (!Array.isArray(doCofre)) return [];
  let p = PREPARADOS.get(doCofre);
  if (!p) {
    p = [];
    for (const { nome, valor } of doCofre) {
      const v = paraVarrer(String(valor || '')).trim();
      if (v.length < 8) continue;
      const linhas = v.includes('\n') ? v.split('\n').map((l) => l.trim()).filter((l) => l.length >= 20) : [];
      p.push({ nome, pedacos: [v, ...linhas].map(pedacoDoValor) });
    }
    PREPARADOS.set(doCofre, p);
  }
  return p;
}
// o valor, só as letras e números dele, o núcleo (do primeiro ao último deles) e o que sobra nas pontas
function pedacoDoValor(valor) {
  const n = nucleo(valor);
  const ini = valor.indexOf(n);
  return { valor, colado: colar(valor).texto, nucleo: n, prefixo: valor.slice(0, ini), sufixo: valor.slice(ini + n.length) };
}

const ESPACO = /\s/;
// texto[i, fim) é o núcleo do valor fora os espaços e quebras ("Senh4# Cometa5120" é "Senh4#Cometa5120")?
function igualSemEspaco(texto, i, fim, v) {
  let a = i;
  let b = 0;
  for (;;) {
    while (a < fim && ESPACO.test(texto[a])) a++;
    while (b < v.length && ESPACO.test(v[b])) b++;
    if (a >= fim || b >= v.length) return a >= fim && b >= v.length;
    if (texto[a] !== v[b]) return false;
    a++;
    b++;
  }
}
// o texto tem `pedaco` (fora os espaços) logo antes de j / logo depois de j? Devolve onde ele começa / termina, ou -1
function antesTem(texto, j, pedaco) {
  let s = j;
  for (let k = pedaco.length - 1; k >= 0; k--) {
    if (ESPACO.test(pedaco[k])) continue;
    let t = s - 1;
    while (t >= 0 && ESPACO.test(texto[t])) t--;
    if (t < 0 || texto[t] !== pedaco[k]) return -1;
    s = t;
  }
  return s;
}
function depoisTem(texto, j, pedaco) {
  let e = j;
  for (let k = 0; k < pedaco.length; k++) {
    if (ESPACO.test(pedaco[k])) continue;
    let t = e;
    while (t < texto.length && ESPACO.test(texto[t])) t++;
    if (t >= texto.length || texto[t] !== pedaco[k]) return -1;
    e = t + 1;
  }
  return e;
}

// Acha o valor do cofre como "palavra" inteira ("Senh4x2026" não casa dentro de "xSenh4x2026y") e devolve onde ele
// está no texto ({ i, fim }) ou null. Com 8+ letras e números, procura as letras e números dele no texto colado
// e vale: o valor inteiro, com ou sem espaço e quebra no meio ("Senh4# Cometa5120"); ou com qualquer separador a
// cada 3 caracteres ou menos ("s k - p r o j", "S.e.n.h.4"). O que só tem as mesmas letras e números com outra
// pontuação não vale: "Brisas 5120" ou "#Brisas5120" não é "Brisas@5120!" do cofre, nem o nome de arquivo
// "Lago-Cometa-5120" é a senha "Lago.Cometa.5120".
function acharValor(texto, p, colado) {
  const borda = (i, fim) => !ALFANUMERICO.test(texto[i - 1] || '') && !ALFANUMERICO.test(texto[fim] || '');
  if (p.colado.length < MINIMO_COLADO) {
    for (let i = texto.indexOf(p.valor); i !== -1; i = texto.indexOf(p.valor, i + 1)) {
      if (borda(i, i + p.valor.length)) return { i, fim: i + p.valor.length };
    }
    return null;
  }
  const c = colado();
  const L = p.colado.length;
  for (let g = c.texto.indexOf(p.colado); g !== -1; g = c.texto.indexOf(p.colado, g + 1)) {
    const a = noTexto(c, g);
    const b = noTexto(c, g + L - 1);
    const i = a.pos;
    const fim = b.pos + 1;
    if (b.trecho - a.trecho >= Math.ceil(L / 3)) {
      if (borda(i, fim)) return { i, fim };
      continue;
    }
    if (fim - i > 4 * p.nucleo.length + 64 || !igualSemEspaco(texto, i, fim, p.nucleo)) continue;
    const s = antesTem(texto, i, p.prefixo);
    const e = s === -1 ? -1 : depoisTem(texto, fim, p.sufixo);
    if (e !== -1 && borda(s, e)) return { i: s, fim: e };
  }
  return null;
}

// Senha de página que é para ir ao cliente (relatório, área restrita) fica em config.json →
// senhasDeCliente { NOME_NO_COFRE: 'Cliente' }: para esse cliente vira aviso; para qualquer outro destino
// continua barrada (a senha de um cliente indo para outro). O mesmo valor guardado com dois nomes só passa se
// TODOS os nomes estiverem liberados para este cliente.
function segredos(original, doCofre, { senhasDeCliente = {}, clientes = [], clienteDestino = null, onde = 'no texto' } = {}) {
  const texto = paraVarrer(original); // uma vez; os valores do cofre passaram pela mesma normalização
  const bloqueios = [];
  const avisos = [];
  const achados = new Map(); // posição no texto → { valor, colado, nomes, fim }
  let c = null;
  const colado = () => (c ||= colar(texto)); // só monta se algum valor do cofre precisar
  for (const { nome, pedacos } of preparar(doCofre)) {
    for (const p of pedacos) {
      const achou = acharValor(texto, p, colado);
      if (!achou) continue;
      const a = achados.get(achou.i) || { valor: p.valor, colado: p.colado, nomes: [], fim: achou.fim };
      if (p.valor.length > a.valor.length) Object.assign(a, { valor: p.valor, colado: p.colado });
      a.fim = Math.max(a.fim, achou.fim);
      if (!a.nomes.includes(nome)) a.nomes.push(nome);
      achados.set(achou.i, a);
      break;
    }
  }
  const valores = [...achados.values()];
  const trechos = [...achados].map(([i, a]) => ({ i, fim: a.fim })); // onde há segredo: fora do trecho dos outros
  const liberados = [];
  const donoDe = (nome) => (senhasDeCliente[nome] ? clienteCanonico(senhasDeCliente[nome], clientes) : null);
  const liberadoAqui = (nome) => {
    const dono = donoDe(nome);
    return !!(dono && clienteDestino && dono.familia === clienteDestino.familia);
  };
  for (const [i, { valor, nomes }] of achados) {
    const barrou = nomes.find((n) => !liberadoAqui(n));
    if (barrou === undefined) {
      liberados.push(valor);
      avisos.push({ regra: 'segredo', msg: `senha de página de ${donoDe(nomes[0]).nome} (${nomes.join(', ')}) ${onde}, liberada para este cliente: confira o destino`, i });
      continue;
    }
    const dono = donoDe(barrou);
    bloqueios.push({
      regra: 'segredo',
      msg: dono
        ? `senha de ${dono.nome} (${barrou}) ${onde} indo para ${clienteDestino ? clienteDestino.nome : 'um destino sem cliente conhecido'}`
        : `valor do cofre ${barrou} ${onde} (senha de página do cliente? libere em config.json → senhasDeCliente)`,
      i,
    });
  }
  // o padrão só é perdoado se for o próprio valor liberado (ou um pedaço dele), nunca algo que o contenha
  const liberado = (s) => !!s && liberados.some((v) => v === s || v.includes(s));
  for (const d of DETECTORES) {
    for (const { i, fim } of ocorrencias(texto, d)) {
      if (liberado(texto.slice(i, fim))) continue;
      bloqueios.push({ regra: 'segredo', msg: `parece ${d[0]} ${onde}`, i });
      trechos.push({ i, fim });
      break;
    }
  }
  // rótulo: cada um achado pela regex de palavras fixas e lido na posição dele; um rótulo logo depois do outro
  // ("token e senha: X") também é achado, porque a busca não pula o valor
  let fimDoLink = { de: -1, ate: -1 }; // links seguidos sem espaço dividem o mesmo fim: medido uma vez
  ROTULOS.lastIndex = 0;
  for (let m; (m = ROTULOS.exec(texto));) {
    const e = m.index + m[0].length;
    if (ALFANUMERICO.test(texto[m.index - 1] || '') || ALFANUMERICO.test(texto[e] || '')) continue;
    DEPOIS_DO_ROTULO.lastIndex = e;
    const d = DEPOIS_DO_ROTULO.exec(texto);
    if (!d) continue;
    const inicio = e + d[0].length - d[1].length;
    let valor = aparar(d[1]);
    // "com senha: https://..." é o link da página protegida, não a senha: vale a palavra que
    // vem logo depois do link ("senha: https://... Senh4x2026" barra). O link em si continua conferido:
    // padrões e valores do cofre acima, usuário:senha e parâmetro secreto abaixo.
    if (EH_LINK.test(valor)) {
      if (!(inicio >= fimDoLink.de && inicio < fimDoLink.ate)) {
        ATE_O_ESPACO.lastIndex = inicio;
        fimDoLink = { de: inicio, ate: inicio + ATE_O_ESPACO.exec(texto)[0].length };
      }
      valor = aparar(palavraDepois(texto, fimDoLink.ate));
    }
    if (!pareceCredencial(valor) || EH_LINK.test(valor) || liberado(valor) || liberado(semEnfase(valor))) continue;
    bloqueios.push({ regra: 'segredo', msg: `parece ${m[0].toLowerCase()} ${onde}`, i: inicio });
    trechos.push({ i: inicio, fim: inicio + d[1].length });
    break;
  }
  for (let i = texto.indexOf('://'); i !== -1; i = texto.indexOf('://', i + 3)) {
    if (!ESQUEMA_ANTES.test(texto.slice(Math.max(0, i - 33), i))) continue;
    USUARIO_SENHA.lastIndex = i + 3;
    const m = USUARIO_SENHA.exec(texto);
    if (!m || liberado(aparar(m[1]))) continue;
    bloqueios.push({ regra: 'segredo', msg: `parece usuário e senha num link ${onde}`, trecho: 'usuário:••••@' });
    break;
  }
  PARAMETRO_SECRETO.lastIndex = 0;
  for (let m; (m = PARAMETRO_SECRETO.exec(texto));) {
    VALOR_DO_PARAMETRO.lastIndex = m.index + m[0].length;
    const v = VALOR_DO_PARAMETRO.exec(texto);
    if (!v || liberado(aparar(v[0]))) continue;
    const nome = m[1].toLowerCase();
    bloqueios.push({ regra: 'segredo', msg: `parece ${nome} num link ${onde}`, trecho: `${nome}=••••` });
    break;
  }
  const comTrecho = ({ i, ...a }) => (a.trecho ? a : { ...a, trecho: antesDe(texto, i, valores, trechos) });
  return { bloqueios: bloqueios.map(comTrecho), avisos: avisos.map(comTrecho) };
}

// ---------------------------------------------------------------- clientes (movido a dados, começa vazio)
// `clientes` vem do config.json: [{ nome, termos?, familia? }]. termos = como o cliente aparece num texto ou num
// nome de destino (palavra inteira, sem acento nem caixa; o padrão é o próprio nome); familia junta clientes do
// mesmo grupo, que podem aparecer um na conversa do outro (o padrão é o nome). Sem nenhum cliente configurado,
// só valem o diretório de pessoas e o cliente que a sessão declarou, comparados pelo nome.
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CLIENTES_PRONTOS = new WeakMap();
function prontos(clientes) {
  if (!Array.isArray(clientes) || !clientes.length) return [];
  let p = CLIENTES_PRONTOS.get(clientes);
  if (!p) {
    p = clientes.filter((c) => c && norm(c.nome)).map((c) => {
      const termos = [c.nome, ...(Array.isArray(c.termos) ? c.termos : [])].map(norm).filter(Boolean);
      return {
        nome: String(c.nome).trim(), familia: norm(c.familia) || norm(c.nome),
        re: new RegExp(`(?<![a-z0-9])(?:${termos.map(escapar).join('|')})(?![a-z0-9])`),
      };
    });
    CLIENTES_PRONTOS.set(clientes, p);
  }
  return p;
}

function clienteCanonico(s, clientes = []) {
  const n = norm(s);
  if (!n) return null;
  for (const c of prontos(clientes)) if (n === norm(c.nome) || c.re.test(n)) return { nome: c.nome, familia: c.familia };
  return { nome: String(s).trim(), familia: n };
}

function clientesNoTexto(textoNorm, clientes = []) {
  return prontos(clientes).filter((c) => c.re.test(textoNorm)).map(({ nome, familia }) => ({ nome, familia }));
}

// De que cliente é o destino: cliente no nome do destino (grupo, e-mail) > pessoa do diretório.
export function ladoDoDestino(m, pessoas = [], clientes = []) {
  const alvo = `${m.destino_nome || ''} ${m.destino_id || ''}`;
  const doNome = clientesNoTexto(norm(alvo), clientes);
  const familias = new Set(doNome.map((c) => c.familia));
  if (familias.size === 1) return { cliente: doNome[0], pessoa: null };
  if (familias.size > 1) return { ambiguo: true };
  const pessoa = acharPessoa(alvo, pessoas, clientes);
  if (pessoa?.cliente) return { cliente: clienteCanonico(pessoa.cliente, clientes), pessoa };
  return {};
}

// O destino é de um cliente e o texto (ou o cliente que a sessão declarou) fala de outro.
function clienteCruzado(m, texto, lado, clientes) {
  if (!lado.cliente) return [];
  const citados = clientesNoTexto(norm(texto), clientes);
  const declarado = m.cliente ? clienteCanonico(m.cliente, clientes) : null;
  if (declarado && !citados.some((c) => c.familia === declarado.familia)) citados.push(declarado);
  const outros = citados.filter((c) => c.familia !== lado.cliente.familia);
  if (!outros.length) return [];
  const nomes = [...new Set(outros.map((c) => c.nome))];
  return [{ regra: 'cliente_cruzado', msg: `o destino é ${lado.cliente.nome} e a mensagem fala de ${nomes.join(', ')}`, trecho: nomes[0] }];
}

// Acha a pessoa do diretório pelo destino: e-mail, nome completo ou apelido; primeiro nome só se não houver
// outra pessoa com ele.
export function acharPessoa(alvo, pessoas = [], clientes = []) {
  const n = norm(alvo);
  if (!n || !pessoas.length) return null;
  const porEmail = pessoas.find((p) => (p.emails || []).some((e) => e && n.includes(norm(e))));
  if (porEmail) return porEmail;
  const palavras = new Set(n.split(/[^a-z0-9]+/).filter(Boolean));
  const tokens = (nome) => norm(nome).split(/[^a-z0-9]+/).filter(Boolean);
  const nomes = (p) => [p.nome, ...(p.apelidos || [])].filter(Boolean);
  const umaSo = (achadas) => (new Set(achadas.map((p) => `${norm(p.nome)}|${clienteCanonico(p.cliente, clientes)?.familia ?? ''}`)).size === 1 ? achadas[0] : null);
  const completos = pessoas.filter((p) => nomes(p).some((x) => tokens(x).length >= 2 && tokens(x).every((t) => palavras.has(t))));
  // a mesma pessoa pode estar duas vezes no diretório (em dois clientes do mesmo grupo): é uma só se o nome e a
  // família batem; duas pessoas com o mesmo nome em clientes diferentes continuam ambíguas
  if (completos.length) return umaSo(completos);
  return umaSo(pessoas.filter((p) => nomes(p).some((x) => {
    const t = tokens(x);
    return t.length === 1 ? palavras.has(t[0]) : palavras.has(t[0]) && x === p.nome;
  })));
}

// tira link, e-mail, @menção e código antes de olhar palavra por palavra. O e-mail só começa no início de
// uma palavra: sem o (?<!...), uma palavra comprida sem "@" seria varrida de novo a partir de cada letra.
const semCodigo = (t) => t.replace(/```[\s\S]*?```|`[^`]*`/g, ' ')
  .replace(/\bhttps?:\/\/\S+|\bwww\.\S+|(?<![\w.+-])[\w.+-]+@[\w.-]+|@\S+/g, ' ');

function acentos(texto) {
  const achadas = [];
  for (const [p] of semCodigo(texto).toLowerCase().matchAll(/\p{L}+/gu)) {
    if (SEM_ACENTO.has(p) && !achadas.includes(p)) achadas.push(p);
  }
  if (!achadas.length) return [];
  return [{ regra: 'acento', msg: `sem acento: ${achadas.slice(0, 5).join(', ')}`, trecho: achadas[0] }];
}

function formato(m, corpo) {
  const avisos = [];
  // [ \t]* e não \s*: com /m, \s* atravessa as quebras de linha e cada linha em branco varre o resto do texto
  if (m.canal === 'whatsapp') {
    if (/\*\*/.test(corpo)) avisos.push({ regra: 'formato', msg: '**duplo** aparece cru no WhatsApp: use *um asterisco*', trecho: '**' });
    if (/^[ \t]*#{1,6}\s/m.test(corpo)) avisos.push({ regra: 'formato', msg: 'título com # não existe no WhatsApp', trecho: '#' });
    if (/^[ \t]*>/m.test(corpo)) avisos.push({ regra: 'formato', msg: 'citação com > não vale no WhatsApp', trecho: '>' });
  }
  if (m.canal === 'email' && !m.extra?.html) {
    // o link do markdown tem limite: sem ele, "[a](b[a](b..." sem ")" lê até o fim a partir de cada "[" (quadrático)
    const md = corpo.match(/\*[^*\s][^*\n]*\*|^[ \t]*#{1,6}\s|\[[^[\]\n]+\]\([^)\s]{1,500}\)|`[^`\n]+`/m);
    // o trecho é um pedaço do texto: palavra com cara de credencial vira bolinha ("*ghp_...*" não volta inteiro)
    const trecho = md?.[0].trim().slice(0, 40).split(/(\s+)/).map((p) => (pareceCredencial(p) ? '••••' : p)).join('');
    if (md) avisos.push({ regra: 'formato', msg: 'asterisco ou markdown aparece cru no Gmail: e-mail vai em texto simples', trecho });
  }
  return avisos;
}

// O que cada canal faz com anexo: WhatsApp manda só o primeiro, e-mail manda todos, Discord não manda
// nenhum. `info` vem de src/anexos.js (inspecionarAnexos): recusa da validação (barra sempre, menos "sumiu",
// que só barra se o anexo vai sair), naoLido (texto que não deu para varrer: barra), binario (não é lido pelo
// linter: avisa). Sem `info`, os anexos não foram conferidos: falha fechado.
function anexos(m, info) {
  const lista = Array.isArray(m.anexos) ? m.anexos : [];
  if (!lista.length) return { bloqueios: [], avisos: [] };
  const bloqueios = [];
  const avisos = [];
  const vaiSair = new Set(m.canal === 'whatsapp' ? lista.slice(0, 1) : m.canal === 'email' ? lista : []);
  if (m.canal === 'whatsapp' && lista.length > 1) {
    avisos.push({ regra: 'anexo', msg: `o WhatsApp manda só o primeiro anexo: ${lista.length - 1} fica${lista.length > 2 ? 'm' : ''} de fora` });
  }
  if (m.canal === 'discord') {
    avisos.push({ regra: 'anexo', msg: 'o Discord não recebe anexo pela Central: vai só o texto' });
  }
  if (!Array.isArray(info)) {
    bloqueios.push({ regra: 'segredo', msg: 'não consegui verificar segredos: os anexos não foram conferidos', naoChecou: true });
    return { bloqueios, avisos };
  }
  for (const a of info) {
    if (a.recusa) {
      if (a.recusa.codigo === 'sumiu' && !vaiSair.has(a.caminho)) continue;
      // credencial, compactado, chave no conteúdo, ilegível e trocado depois da conferência: é segredo
      const regra = ['sensivel', 'compactado', 'conteudo', 'ilegivel', 'mudou'].includes(a.recusa.codigo) ? 'segredo' : 'anexo';
      bloqueios.push({ regra, msg: a.recusa.msg, trecho: a.nome });
    } else if (a.naoLido) {
      bloqueios.push({ regra: 'segredo', msg: `anexo ${a.nome} não pôde ser checado: ${a.naoLido}`, trecho: a.nome });
    } else if (a.binario && vaiSair.has(a.caminho)) {
      avisos.push({ regra: 'anexo', msg: `anexo binário não verificado: ${a.nome} (o linter não lê PDF, imagem nem planilha)`, trecho: a.nome });
    }
  }
  const total = info.reduce((s, a) => s + (a.bytes || 0), 0);
  if (total > LIMITE.anexos) {
    const mb = (total / 1048576).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    bloqueios.push({ regra: 'anexo', msg: `anexos somam ${mb} MB; o limite é 20 MB por mensagem: mande por link` });
  }
  return { bloqueios, avisos };
}

function tamanho(canal, corpo) {
  const n = corpo.length;
  const fmt = (x) => x.toLocaleString('pt-BR');
  if (canal === 'whatsapp' && n > LIMITE.whatsappMax) {
    return [{ regra: 'tamanho', msg: `muito longa para WhatsApp: ${fmt(n)} caracteres (passa de ${fmt(LIMITE.whatsappMax)}; o ideal é até ${LIMITE.whatsappIdeal})` }];
  }
  if (canal === 'whatsapp' && n > LIMITE.whatsappIdeal) {
    return [{ regra: 'tamanho', msg: `longa para WhatsApp: ${fmt(n)} caracteres (o ideal é até ${LIMITE.whatsappIdeal})` }];
  }
  if (canal === 'discord' && n > LIMITE.discord) {
    return [{ regra: 'tamanho', msg: `passa de ${fmt(LIMITE.discord)} caracteres: o Discord recebe em ${Math.ceil(n / 1990)} partes` }];
  }
  return [];
}

const EXPRESSOES_RE = EXPRESSOES_IA.map((e) => [e, new RegExp(`(?:^|[^a-z0-9])${escapar(norm(e)).replace(/ /g, '\\s+')}(?![a-z0-9])`)]);
// lista vazia não casa com nada (sem isto, a regex sem raiz nenhuma casaria com qualquer palavra)
const RAIZES_RE = RAIZES_IA.length ? new RegExp(`\\b(${RAIZES_IA.join('|')})[a-z]*`, 'g') : /(?!)/g;

function caraDeIa(texto) {
  const n = norm(semCodigo(texto));
  const achadas = EXPRESSOES_RE.filter(([, re]) => re.test(n)).map(([e]) => e);
  for (const [palavra] of n.matchAll(RAIZES_RE)) if (!achadas.includes(palavra)) achadas.push(palavra);
  // aqui com acento: sem ele, "é" (verbo) e "e" (conjunção) viram a mesma coisa
  const baixo = texto.toLowerCase();
  if (/(?:^|\s)não é\s[^.!?\n]{1,60}?,\s*é\s/.test(baixo)) achadas.push('"não é X, é Y"');
  if (/(?:^|\s)não (?:só|apenas)\s[^.!?\n]{1,80}?\bmas também\b/.test(baixo)) achadas.push('"não só X, mas também Y"');
  if (/[—–]/.test(texto)) achadas.push('travessão (—)');
  if ((texto.match(/^[ \t]*\p{Extended_Pictographic}/gmu) || []).length >= 2) achadas.push('emoji como marcador de item');
  if (!achadas.length) return [];
  return [{ regra: 'ia', msg: `cara de IA: ${achadas.slice(0, 4).join(', ')}${achadas.length > 4 ? ` e mais ${achadas.length - 4}` : ''}`, trecho: achadas[0] }];
}

// próximo horário útil: dia de semana às 8h
export function proximoHorarioUtil(t) {
  const d = new Date(t);
  if (d.getHours() >= 8) d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function horario(m, agora) {
  const quando = m.agendar_para && m.agendar_para > agora ? m.agendar_para : agora;
  const d = new Date(quando);
  const fimDeSemana = d.getDay() === 0 || d.getDay() === 6;
  const madrugada = d.getHours() < 7 || d.getHours() >= 22;
  if (!fimDeSemana && !madrugada) return [];
  const sugestao = proximoHorarioUtil(quando);
  const dia = new Date(sugestao).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return [{
    regra: 'horario',
    msg: `${madrugada ? 'madrugada' : 'fim de semana'} (${hora}): agendar para ${dia} às 8h?`,
    sugestao,
  }];
}
