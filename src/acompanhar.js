// Aba Acompanhar (dentro da Entrada): quem não respondeu ao dono e as promessas, dele e para ele.
// Precisão vale mais que cobertura: melhor deixar passar uma promessa duvidosa do que encher a aba
// de alarme falso. Lê a ponte do WhatsApp (só leitura); grava só na Central (promessas e o ponto da varredura).
// Prazos no fuso de São Paulo, seja qual for o fuso do processo.
const HORA = 3600e3;
const DIA = 24 * HORA;
export const JANELA_DIAS = 14; // conversa mais velha que isso não entra, nem na varredura
const PADRAO_HORAS = 24; // pergunta sem resposta entra na aba depois de 24 h
const SEM_PRAZO_HORAS = 48; // promessa sem prazo dito vence em 48 h
const AVISO_HORAS = 12; // promessa aparece quando faltam 12 h ou já venceu
const ATRASO_MAX_DIAS = 7; // atrasada há mais de uma semana sai da aba (ou foi feita, ou morreu); fica no "tudo"
const ARQUIVO_LOGO_DEPOIS_MS = 10 * 60e3; // "te mando o contrato" + o PDF em seguida: já entregou

// ---------------------------------------------------------------- data e hora em São Paulo

const FORMATO_SP = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', weekday: 'short',
});
const SEMANA_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function partesSP(ms) {
  const p = Object.fromEntries(FORMATO_SP.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour, min: +p.minute, sem: SEMANA_EN.indexOf(p.weekday) };
}
// ms de "dia/mês/ano h:min" em São Paulo; dia fora do mês passa para o seguinte (31/10 + 1 = 01/11)
function horaSP(ano, mes, dia, h, min = 0) {
  const chute = Date.UTC(ano, mes - 1, dia, h, min);
  const p = partesSP(chute);
  return chute - (Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min) - chute);
}

// ---------------------------------------------------------------- texto

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// citação não é de quem escreve: linha "> ..." e trecho entre aspas (ele disse: "te mando amanhã")
const semCitacao = (t) => String(t || '').normalize('NFC').split('\n').filter((l) => !/^\s*>/.test(l)).join('\n')
  .replace(/["“”][^"“”\n]{1,400}["“”]/g, ' ');
// frase a frase, com a pontuação no fim (a pergunta termina em "?")
const frases = (t) => t.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const URL = /https?:\/\/\S+|www\.\S+/g;
export const resumo = (t, n = 140) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};

// "tudo bem?" no começo da conversa não é pergunta que espera resposta
const SAUDACAO = /\b(?:tudo (?:bem|bom|certo|tranquilo|joia|ok|em paz)|td (?:bem|bom|certo)|como (?:vai|voce esta|vc esta|voce ta|vc ta|esta|estas|anda|andam|vao)|beleza|blz|e ai|tranquilo|como foi (?:o|a) (?:fim de semana|final de semana|feriado|viagem))\s*\?+/g;
export function temPergunta(texto) {
  return semAcento(semCitacao(texto)).replace(URL, ' ').replace(SAUDACAO, ' ').includes('?');
}

// ---------------------------------------------------------------- prazo dito

const DIAS_SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
// O prazo que a frase diz, a partir de quando a mensagem saiu (em). null = não diz.
// hoje/fim do dia: 18h (23h59 se já passou das 18h) · amanhã: 18h · amanhã cedo/de manhã: 10h · dia da semana: o
// próximo, 18h · "até 10/10" e "dia 10": esse dia, 18h · semana que vem: segunda, 18h · hora ("às 15h"): hoje
export function prazoDito(n, em) {
  const p = partesSP(em);
  const dia = (mais, h, min = 0) => horaSP(p.ano, p.mes, p.dia + mais, h, min);
  const hoje = () => (p.hora >= 18 ? dia(0, 23, 59) : dia(0, 18));
  let m;
  if ((m = n.match(/\bamanha\s+(?:cedo|de manha|pela manha|logo cedo|bem cedo|cedinho)\b/))) return { em: dia(1, 10), dito: m[0] };
  if ((m = n.match(/\bdepois de amanha\b/))) return { em: dia(2, 18), dito: m[0] };
  if ((m = n.match(/\bamanha\b/))) return { em: dia(1, 18), dito: m[0] };
  if ((m = n.match(/\b(?:ainda hoje|hoje ainda|hoje|hj|ate o (?:fim|final) do dia|(?:no )?(?:fim|final) do dia|mais tarde|(?:a|de) tarde|(?:a|de) noite)\b/))) {
    return { em: hoje(), dito: m[0] };
  }
  if ((m = n.match(/\b(?:semana que vem|proxima semana)\b/))) return { em: dia(((1 - p.sem + 7) % 7) || 7, 18), dito: m[0] };
  // "segunda" e "quarta" também são ordinais ("segunda versão"): sem "na", "até"... só com "-feira";
  // "troca de sexta para sábado" é data do assunto, não prazo
  if ((m = n.match(/\b(?:(?:na|no|ate|nesta|neste|nessa|nesse|essa|esta|proxima|proximo)\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo)(?:-feira)?|(?<!\b(?:de|para|pra)\s)(segunda|terca|quarta|quinta)-feira|(?<!\b(?:de|para|pra)\s)(sexta|sabado|domingo))\b/))) {
    const alvo = DIAS_SEMANA.indexOf(m[1] || m[2] || m[3]);
    return { em: dia(((alvo - p.sem + 7) % 7) || 7, 18), dito: m[0] };
  }
  if ((m = n.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/))) {
    const [d, mes] = [Number(m[1]), Number(m[2])];
    const ano = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : p.ano;
    // data que já passou é referência ("o relatório de 01/10"), não prazo
    if (d >= 1 && d <= 31 && mes >= 1 && mes <= 12 && horaSP(ano, mes, d, 18) >= dia(0, 0)) return { em: horaSP(ano, mes, d, 18), dito: m[0] };
  }
  if ((m = n.match(/\bdia\s+(\d{1,2})\b/)) && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
    const d = Number(m[1]);
    return { em: horaSP(p.ano, p.mes + (d < p.dia ? 1 : 0), d, 18), dito: m[0] };
  }
  if ((m = n.match(/\b(?:de manha|pela manha|cedinho|cedo)\b/))) return { em: p.hora < 10 ? dia(0, 10) : dia(1, 10), dito: m[0] };
  if ((m = n.match(/\b(?:as|ate as)\s+\d{1,2}(?:h\d{0,2}|:\d{2}|\s?horas)\b/))) return { em: hoje(), dito: m[0] };
  return null;
}

// ---------------------------------------------------------------- detector de promessa

const PESSOA = '(?:voce|vc|vcs|voces|ti|o senhor|a senhora)';
const DETERMINANTE = 'o|os|um|uns|seu|meu|teu|nosso|esse|este|desse|deste|novo|proximo|primeiro|ultimo|do|no|pelo|ao|de|da';
// compromisso claro, em 1ª pessoa, com quem lê: vale mesmo sem prazo (vence em 48 h)
const FORTE = [
  /\b(?:te|lhe)\s+(?:mando|envio|retorno|aviso|confirmo|respondo|encaminho|atualizo|entrego|mandamos|enviamos|retornamos|avisamos|confirmamos|respondemos|encaminhamos)\b/g,
  /\beu\s+aviso\b/g,
  /\b(?:vou|irei|vamos)\s+(?:te|lhe)\s+(?:mandar|enviar|passar|retornar|avisar|confirmar|responder|atualizar|encaminhar|entregar|dar (?:um )?retorno)\b/g,
  new RegExp(`\\b(?:vou|irei|vamos)\\s+(?:mandar|enviar|passar|encaminhar)\\b[^.!?;]{0,40}?\\b(?:pra|para)\\s+${PESSOA}\\b`, 'g'),
  new RegExp(`\\b(?:mando|envio|passo|encaminho)\\b[^.!?;]{0,40}?\\b(?:pra|para)\\s+${PESSOA}\\b`, 'g'),
  /\b(?:volto\s+a\s+(?:te\s+)?(?:falar|procurar)|volto\s+(?:com|nisso)|(?:te|lhe)\s+dou\s+(?:um\s+)?retorno)\b/g,
];
// só vale com prazo dito no mesmo pedaço da frase ("resolvo hoje", "vou ver isso amanhã", "te ligo amanhã").
// Fora da lista: aviso, retorno e passo sozinhos, que quase sempre são substantivo ("aviso rápido", "sem retorno")
const FRACO = [
  /\b(?:vou|vamos)\s+(?!ver\s+se\b)(?:ver|resolver|fazer|olhar|conferir|corrigir|ajustar|subir|entregar|finalizar|terminar|providenciar|analisar|confirmar|verificar|checar|testar|preparar|montar|organizar|mandar|enviar|passar|retornar|responder)\b/g,
  // "o envio amanhã", "o término": substantivo, não verbo; "te vejo amanhã" é despedida
  new RegExp(`(?<!\\b(?:${DETERMINANTE})\\s)\\b(?:faco|mando|envio|(?<!\\b(?:te|nos|lhe)\\s)vejo|confirmo|resolvo|respondo|subo|corrijo|ajusto|entrego|termino|finalizo)\\b`, 'g'),
  /\b(?:te|lhe)\s+(?:passo|falo|digo|ligo|chamo|mandar|enviar|passar|entregar|retornar|responder|ligar)\b/g,
];
const NEGACAO = /\b(?:nao|nem|nunca|jamais)\s+(?:[^\s,;]+\s+){0,2}$/;
const IMEDIATO_ANTES = /\b(?:ja|jaja|agora|agorinha|logo)\s+(?:[^\s,;]+\s+){0,2}$/;
const IMEDIATO_FRASE = /\b(?:calma\s+(?:que|ai)|pera(?:i|ai)?|so um (?:minuto|minutinho|segundo|instante))\b/;
const IMEDIATO_DEPOIS = /^[^,;]*?\b(?:ja|jaja|agora|agorinha|daqui a pouco|daqui a pouquinho|daqui a \d+ ?min\w*|em seguida|em instantes|em (?:\d+|uns|alguns|poucos|cinco|dez|quinze|trinta) ?(?:min\w*|segundos?)|logo mais|nesse instante|neste instante|neste momento)\b/;
const QUE_DEPOIS = /^\s+que\b/; // "te aviso que..." e "te confirmo que..." contam agora, não prometem
const SAUDA_DEPOIS = /^\s+(?:um\s+|uns\s+|meu\s+)?(?:abraco|abracos|beijo|beijos|bj|bjs|abs|saudacoes)\b/;
const CONDICIONAL = /\b(?:se\s+(?:voce|vc|vcs|quiser|quiserem|precisar|precisarem|tiver|tiverem|puder|puderem|der|for|forem|conseguir|rolar|achar|preferir|topar|gostar|ele|ela|eles|elas|o|a|os|as|tudo|nao|eu|alguem|houver)|caso\s+(?:voce|vc|queira|precise|tenha|possa|seja|ele|ela)|quando\s+(?:voce|vc|tiver|puder|der|for|forem|estiver|precisar|quiser|chegar|sair|receber|ele|ela|eu)|assim que|qualquer coisa|depende|dependendo)\b/;
const INCERTO = /\b(?:acho que|talvez|provavelmente|possivelmente|quem sabe|vou tentar|tento|tentarei)\b/;
const ENTREGA_AGORA = /\b(?:em anexo|anexo|anexei|anexado|anexada|anexados|abaixo|a seguir|segue|seguem|aqui vai|vai aqui|aqui esta|aqui estao)\b|https?:\/\/|www\./;

// O primeiro compromisso válido da frase (n, já sem acento). Forte: vale com ou sem prazo, e com prazo dito
// ("já finalizo e te mando amanhã") o "já" não conta. Fraco (em = quando saiu): só com prazo no mesmo pedaço da
// frase, entre vírgulas ("deixei para hoje, mas vou conferir" não promete nada para hoje).
function compromisso(n, lista, { comPrazo = false, em = null } = {}) {
  let melhor = null;
  for (const re of lista) {
    for (const m of n.matchAll(re)) {
      const antes = n.slice(0, m.index);
      const depois = n.slice(m.index + m[0].length);
      if (NEGACAO.test(antes) || QUE_DEPOIS.test(depois) || SAUDA_DEPOIS.test(depois)) continue;
      // "já te mando", "te mando agora", "calma que te mando": é agora, não promessa
      if (!comPrazo && (IMEDIATO_ANTES.test(antes) || IMEDIATO_DEPOIS.test(depois) || IMEDIATO_FRASE.test(n))) continue;
      let prazo = null;
      if (em != null) {
        const ini = Math.max(antes.lastIndexOf(','), antes.lastIndexOf(';'), antes.lastIndexOf(':'), antes.lastIndexOf(' mas ')) + 1;
        const fim = depois.search(/[,;:]|\bmas\b/);
        prazo = prazoDito(n.slice(ini, fim < 0 ? n.length : m.index + m[0].length + fim), em);
        if (!prazo) continue;
      }
      if (!melhor || m.index < melhor.index) melhor = { index: m.index, texto: m[0], prazo };
      break;
    }
  }
  return melhor;
}

// Uma promessa por mensagem: a primeira frase com compromisso. null = não promete nada.
// temAnexo: a mensagem leva arquivo; sem prazo dito, "te mando o contrato" é a entrega, não promessa.
export function detectarPromessa(texto, { em, temAnexo = false }) {
  for (const original of frases(semCitacao(texto))) {
    if (/\?\s*$/.test(original)) continue; // "te mando o link?" é pergunta
    const n = semAcento(original);
    if (CONDICIONAL.test(n) || INCERTO.test(n)) continue;
    let prazo = prazoDito(n, em);
    let achado = compromisso(n, FORTE, { comPrazo: !!prazo });
    if (!achado) {
      achado = compromisso(n, FRACO, { em });
      prazo = achado?.prazo;
    }
    if (!achado) continue;
    if (!prazo && (temAnexo || ENTREGA_AGORA.test(n))) continue;
    return {
      trecho: original.slice(achado.index, achado.index + achado.texto.length),
      frase: resumo(original, 160),
      prazo: prazo ? prazo.em : em + SEM_PRAZO_HORAS * HORA,
      prazo_dito: prazo ? prazo.dito : null,
    };
  }
  return null;
}

// ---------------------------------------------------------------- rascunho de cobrança

const primeiroNome = (nome) => {
  const n = String(nome || '').trim();
  return /^\p{L}/u.test(n) ? n.split(/\s+/)[0] : null; // "+5511..." não vira nome
};
// Curto e humano; nunca sai sozinho (entra pendente na Central).
export function rascunhoCobranca(item) {
  if (item.destino?.tipo === 'grupo') return 'Oi, pessoal! Conseguiram ver?';
  const nome = primeiroNome(item.destino?.nome);
  const oi = nome ? `Oi, ${nome}!` : 'Oi!';
  if (item.tipo !== 'promessa') return `${oi} Conseguiu ver?`;
  return `${oi} ${/\b(?:mand|envi|pass|encaminh)/i.test(semAcento(item.promessa?.trecho)) ? 'Conseguiu mandar?' : 'Alguma novidade?'}`;
}

// ---------------------------------------------------------------- varredura das promessas

// O que a Central enviou (qualquer canal): promessa do dono. Também roda na hora do envio (despachante).
export function promessaDaCentral({ repo, whatsapp }, m) {
  if (m.status !== 'enviada' || !m.enviado_em) return null;
  const p = detectarPromessa(m.corpo, { em: m.enviado_em, temAnexo: Array.isArray(m.anexos) && m.anexos.length > 0 });
  if (!p) return null;
  // a ponte grava a mesma conversa pelo telefone: o destino fica no mesmo formato da varredura da ponte
  const destino = m.canal === 'whatsapp' && m.destino_id && whatsapp?.canonico ? whatsapp.canonico(m.destino_id) : m.destino_id;
  return repo.registrarPromessa({
    chave: `central:${m.id}`, origem: 'central', sentido: 'minha', canal: m.canal, destino_id: destino,
    destino_nome: m.destino_nome, mensagem_id: m.id, em: m.enviado_em, ...p,
  });
}

// Passada leve (a cada ~10 min): só o que é novo desde a anterior, no máximo 14 dias para trás. Chave = origem + id
// da mensagem, então passar de novo não duplica. A ponte espera 10 min para ver se o arquivo prometido veio logo depois.
export function varrerPromessas({ repo, whatsapp }, agora = Date.now()) {
  const desde = agora - JANELA_DIAS * DIA;
  let novas = 0;
  // a Central primeiro: a mesma mensagem aparece na ponte e fica uma promessa só (a da Central)
  let ate = Math.max(repo.getEstado('acompanhar_central_ate', 0), desde);
  for (const m of repo.enviadasDesdeEm(ate)) {
    ate = Math.max(ate, m.enviado_em);
    if (promessaDaCentral({ repo, whatsapp }, m)) novas++;
  }
  repo.setEstado('acompanhar_central_ate', ate);
  if (!whatsapp?.novasDiretas) return { novas };
  const r = whatsapp.novasDiretas({ depoisDe: repo.getEstado('acompanhar_ponte_rowid', 0), desde, ate: agora - ARQUIVO_LOGO_DEPOIS_MS });
  for (const l of r.linhas) {
    const p = detectarPromessa(l.texto, { em: l.em, temAnexo: !!l.midia });
    if (!p) continue;
    if (!p.prazo_dito && whatsapp.arquivoLogoDepois(l, ARQUIVO_LOGO_DEPOIS_MS)) continue;
    const nome = whatsapp.nome(l.jid);
    // promessa de número sem nome na agenda é robô ou empresa ("vamos te enviar o boleto")
    if (!l.eu && !/^\p{L}/u.test(nome)) continue;
    // a ponte às vezes grava a mesma mensagem na conversa do telefone e na do @lid: a chave usa o telefone
    if (repo.registrarPromessa({
      chave: `whatsapp:${l.jid}:${l.id}`, origem: 'whatsapp', sentido: l.eu ? 'minha' : 'dele', canal: 'whatsapp',
      destino_id: l.jid, destino_nome: nome, mensagem_id: null, em: l.em, ...p,
    })) novas++;
  }
  if (r.cursor != null) repo.setEstado('acompanhar_ponte_rowid', r.cursor);
  return { novas };
}

// ---------------------------------------------------------------- esperando eles

// Conversas do WhatsApp em que a última fala é do dono, com pergunta (ou marcada para acompanhar), e a pessoa não
// respondeu no prazo. "Respondeu" sai da mesma leitura do "só depois que ela responder" (ultimaRecebida).
// Empate conta como resposta: na dúvida, não cobra. Ponte desligada: não diz nada (ela pode ter respondido).
export function esperandoEles({ repo, whatsapp }, agora = Date.now()) {
  const vazio = { itens: [], ultimas: new Map(), aviso: null };
  if (!whatsapp?.minhasRecentes) return vazio;
  const desde = agora - JANELA_DIAS * DIA;
  const { conversas, aviso } = whatsapp.minhasRecentes({ desde });
  if (aviso) return { ...vazio, aviso };
  const ultimas = new Map(conversas.map((c) => [c.jid, c.minhas[0].em]));
  const porJid = new Map(conversas.map((c) => [c.jid, { jid: c.jid, nome: c.nome, grupo: false, minhas: c.minhas, marcada: null }]));
  // marcada para acompanhar (msg add --acompanhar, ou no painel): vale sem pergunta e também em grupo
  for (const m of repo.acompanhadas(desde)) {
    const jid = whatsapp.canonico(m.destino_id);
    const c = porJid.get(jid) || { jid, nome: m.destino_nome, grupo: jid.endsWith('@g.us'), minhas: [], marcada: null };
    if (!c.marcada || c.marcada.em < m.enviado_em) c.marcada = { id: m.id, horas: m.acompanhar, em: m.enviado_em, texto: m.corpo };
    porJid.set(jid, c);
  }
  const itens = [];
  for (const c of porJid.values()) {
    if (!c.marcada && !c.minhas.some((x) => temPergunta(x.texto))) continue;
    const recebida = whatsapp.ultimaRecebida(c.jid, { grupo: c.grupo }) || 0;
    const depois = c.minhas.filter((x) => x.em > recebida); // o que eu mandei depois da última dela
    const marcada = c.marcada && c.marcada.em > recebida ? c.marcada : null;
    const pergunta = depois.find((x) => temPergunta(x.texto));
    if (!marcada && !pergunta) continue;
    const em = Math.max(depois[0]?.em || 0, marcada?.em || 0);
    const prazo = marcada ? marcada.em + marcada.horas * HORA : em + PADRAO_HORAS * HORA;
    if (prazo > agora) continue;
    itens.push({
      chave: `acompanhar:whatsapp:${c.jid}`, tipo: 'esperando', canal: 'whatsapp', conta: 'pessoal',
      destino: { id: c.jid, nome: c.nome, tipo: c.grupo ? 'grupo' : 'contato' },
      em, prazo, texto: resumo(pergunta?.texto ?? marcada.texto), pergunta: !!pergunta,
      marcada: marcada ? { id: marcada.id, horas: marcada.horas } : null,
    });
  }
  return { itens, ultimas, aviso: null };
}

// A aba: esperando eles (calculado acima; o servidor guarda 60 s) + promessas abertas que vencem em até 12 h ou
// venceram há até 7 dias (tudo: todas as abertas). Atrasadas primeiro, depois as mais antigas: ordem do prazo.
export function montarLista({ repo, esperando, agora = Date.now(), tudo = false }) {
  const vistos = repo.vistos();
  const itens = esperando.itens.filter((i) => (vistos.get(i.chave) || 0) < i.em); // "Não preciso" some até mensagem nova
  for (const p of repo.promessasAbertas()) {
    if (!tudo && (p.prazo - agora > AVISO_HORAS * HORA || agora - p.prazo > ATRASO_MAX_DIAS * DIA)) continue;
    const doCelular = p.canal === 'whatsapp' ? esperando.ultimas.get(p.destino_id) || 0 : 0;
    itens.push({
      chave: `promessa:${p.id}`, tipo: 'promessa', canal: p.canal, conta: p.canal === 'whatsapp' ? 'pessoal' : null,
      destino: { id: p.destino_id, nome: p.destino_nome || p.destino_id, tipo: String(p.destino_id || '').endsWith('@g.us') ? 'grupo' : 'contato' },
      em: p.em, prazo: p.prazo, texto: p.frase,
      promessa: { id: p.id, sentido: p.sentido, trecho: p.trecho, prazo_dito: p.prazo_dito, origem: p.origem, mensagem_id: p.mensagem_id },
      minhaUltimaEm: Math.max(doCelular, repo.ultimaEnviadaPara(p.canal, p.destino_id) || 0) || null,
    });
  }
  const cobrancas = repo.respostasPor(itens.map((i) => i.chave), 'acompanhar');
  const lista = itens.map((i) => ({ ...i, atrasada: i.prazo <= agora, cobranca: cobrancas.get(i.chave) || null }))
    .sort((a, b) => a.prazo - b.prazo || a.em - b.em);
  return {
    itens: lista,
    contagem: { total: lista.length, esperando: lista.filter((i) => i.tipo === 'esperando').length, promessas: lista.filter((i) => i.tipo === 'promessa').length },
  };
}
