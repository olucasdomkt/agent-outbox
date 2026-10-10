// E-mail pelas contas Google que você já autenticou no workspace-mcp (config.json → email.contas).
// A Central sobe o workspace-mcp sob demanda numa porta própria e chama send_gmail_message;
// os tokens ficam com ele (~/.google_workspace_mcp), a Central nunca os lê.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { lerValidado, validarAnexos } from '../anexos.js';
import { config } from '../config.js';
import { lerPreferencias } from '../preferencias.js';
import { segredo } from '../segredos.js';
import { EMAIL, erroTransitorio, infoAnexo } from '../util.js';

const cfg = config.email;
const URL_MCP = `http://127.0.0.1:${cfg.mcpPorta}/mcp`;
const OCIOSO_MS = 10 * 60e3;

let proc = null;
let ultimoUso = 0;
let subindo = null;

async function noAr() {
  try {
    await fetch(`http://127.0.0.1:${cfg.mcpPorta}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function garantirServidor() {
  ultimoUso = Date.now();
  if (await noAr()) return;
  subindo ||= (async () => {
    // sem o PORT de quem subiu a Central (modo prévia, gerenciador de processos): o workspace-mcp obedece PORT antes de
    // WORKSPACE_MCP_PORT e subiria na porta errada, e a Central esperaria 90 s por ele na porta certa
    const { PORT: _porta, ...ambiente } = process.env;
    proc = spawn(cfg.uvx, ['workspace-mcp', '--transport', 'streamable-http', '--tools', 'gmail', '--single-user'], {
      env: {
        ...ambiente,
        PATH: `${path.dirname(cfg.uvx)}:${process.env.PATH || '/usr/bin:/bin'}`,
        WORKSPACE_MCP_PORT: String(cfg.mcpPorta),
        GOOGLE_OAUTH_CLIENT_ID: segredo(cfg.clientIdSecret),
        GOOGLE_OAUTH_CLIENT_SECRET: segredo(cfg.clientSecretSecret),
        OAUTHLIB_INSECURE_TRANSPORT: '1',
      },
      stdio: 'ignore',
    });
    proc.on('exit', () => { proc = null; });
    for (let i = 0; i < 90; i++) {
      if (await noAr()) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw erroTransitorio('servidor de e-mail (workspace-mcp) não subiu em 90s');
  })().finally(() => { subindo = null; });
  return subindo;
}

// desliga o servidor de e-mail quando fica parado, para não pesar na máquina
setInterval(() => {
  if (proc && Date.now() - ultimoUso > OCIOSO_MS) { proc.kill('SIGTERM'); proc = null; }
}, 60e3).unref();
process.on('exit', () => proc?.kill('SIGTERM'));

async function rpc(body, sessao) {
  let r;
  try {
    r = await fetch(URL_MCP, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessao ? { 'mcp-session-id': sessao } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    throw erroTransitorio(`servidor de e-mail fora do ar (${e.cause?.code || e.message})`);
  }
  const sid = r.headers.get('mcp-session-id');
  const txt = await r.text();
  let dados = null;
  const linhas = txt.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  for (const l of linhas.length ? linhas : [txt]) {
    try { const j = JSON.parse(l); if (j.id === body.id || j.result || j.error) dados = j; } catch { /* não é json */ }
  }
  return { dados, sid };
}

async function chamarFerramenta(nome, args) {
  await garantirServidor();
  const { sid } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'central-mensagens', version: '0.1' } } });
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, sid);
  const { dados } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: nome, arguments: args } }, sid);
  ultimoUso = Date.now();
  if (!dados) throw erroTransitorio('servidor de e-mail não respondeu');
  if (dados.error) throw new Error(`workspace-mcp: ${dados.error.message}`);
  const texto = (dados.result?.content || []).map((c) => c.text || '').join('\n');
  return { texto, erro: !!dados.result?.isError };
}

// conta cujo login no Google venceu (o workspace-mcp responde "Authentication Needed"): sem isso a Entrada
// fica vazia calada e a saúde diz que está tudo bem até o primeiro envio falhar
const semLogin = new Map();
function anotarLogin(conta, { texto, erro }) {
  if (erro && /Authentication Needed/i.test(texto)) semLogin.set(conta, Date.now());
  else if (!erro) semLogin.delete(conta);
}
const avisoLogin = () => {
  const contas = [...semLogin.keys()];
  return contas.length ? `${contas.join(' e ')} ${contas.length > 1 ? 'pedem' : 'pede'} login de novo no Google` : null;
};

const listaEmails = (s) => String(s || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

// a busca do workspace-mcp responde em texto; cada achado vira um bloco assim
const BLOCO = /Message ID:\s*(\S+)[\s\S]*?Subject:\s*(.*)\n\s*From:\s*(.*)\n\s*Date:\s*(.*)\n[\s\S]*?Thread ID:\s*(\S+)/g;
function parsearBusca(texto) {
  const itens = [];
  for (const [bloco, id, assunto, de, data, thread] of texto.matchAll(BLOCO)) {
    // o Gmail não manda dois From: o segundo é um Subject com quebra de linha dentro se passando por remetente
    const repetido = (bloco.match(/^\s*From:/gm) || []).length > 1;
    itens.push({ id, assunto: assunto.trim(), de: de.trim(), em: Date.parse(data.trim()) || 0, thread, ...(repetido ? { suspeito: 'o cabeçalho From aparece duas vezes' } : {}) });
  }
  return itens;
}
// O remetente como o Gmail entende: o endereço é o de fora das aspas ("Nome <nome@a>" <outro@b> é outro@b,
// e o nome com endereço dentro não vale). From com dois endereços não é normal: estranho.
function remetente(de) {
  const lista = enderecos(de);
  if (lista.length === 1) return lista[0];
  return { nome: String(de || '').replace(/<[^>]*>|"/g, '').trim(), email: '', estranho: lista.length > 1 };
}
const soEmail = (de) => remetente(de).email;
const soNome = (de) => { const r = remetente(de); return r.nome || r.email || String(de || '').trim(); };

// ---- o e-mail que chegou, como ele é: o workspace-mcp responde em texto e estes parsers devolvem remetente,
// para/cc, o que a pessoa escreveu, o histórico que veio citado embaixo e os anexos

// "Nome <a@exemplo.com>, "Sobrenome, Nome" <b@exemplo.com>, c@exemplo.com" → [{ nome, email }]
export function enderecos(lista) {
  return [...String(lista || '').matchAll(/(?:"([^"]*)"|([^,<"]*?))\s*<([^<>\s]+@[^<>\s]+)>|([^\s,;<>"]+@[^\s,;<>"]+)/g)]
    .map(([, aspas, solto, comNome, sozinho]) => ({ nome: (aspas || solto || '').trim(), email: (comNome || sozinho).toLowerCase() }))
    // "<a@exemplo.com,b@exemplo.com>" não é um endereço: num "responder a todos" viraria dois destinatários
    .filter((e) => EMAIL.test(e.email))
    .map((e) => (e.nome.includes('@') ? { ...e, nome: '' } : e));
}

const INVISIVEL = /[­͏​-‏⁠﻿]/g; // enchimento de e-mail de marketing
const COMECO_DE_ITEM = /^\s*(?:[-*•·>|]|\d{1,2}[.)]\s|(?:De|From|Para|To|Cc|Cco|Bcc|Data|Date|Enviad[ao](?: em)?|Sent|Assunto|Subject|Reply-To):\s)/i;

// O texto simples chega com CRLF e quebrado à força perto da coluna 76. Junta de volta a linha que o programa
// de e-mail quebrou (a primeira palavra da seguinte não cabia nela); a quebra que a pessoa fez (linha curta,
// item de lista, assinatura, cabeçalho de encaminhada) fica como está.
export function limparCorpo(corpo) {
  const linhas = String(corpo || '').replace(/\r\n?/g, '\n').replace(INVISIVEL, '').split('\n').map((l) => l.replace(/[ \t ]+$/, ''));
  const saida = [];
  let anterior = 0; // tamanho da linha de cima como ela veio
  for (const l of linhas) {
    const palavra = l.trimStart().split(/\s/)[0].length;
    if (anterior > 0 && anterior <= 80 && l && !COMECO_DE_ITEM.test(l) && anterior + 1 + palavra > 72) {
      // "Fulano <" + "fulano@exemplo.com> escreveu:" volta a ser um endereço só
      saida[saida.length - 1] += `${saida[saida.length - 1].endsWith('<') ? '' : ' '}${l.trimStart()}`;
    } else saida.push(l);
    anterior = l.length;
  }
  return saida.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// onde começa o histórico citado: "Em seg., 5 de out. ... escreveu:" (pode ocupar até três linhas), o bloco
// De/Enviado/Para do Outlook, "-----Mensagem original-----" ou um resto de mensagem só com linhas de ">"
const ATRIBUICAO = /^(?:Em|On|El|Le|Am)\s[^\n]{4,200}(?:\n(?!>)[^\n]{0,200}){0,2}?[ \t]*(?:escreveu|wrote|escribió|a écrit|schrieb)\s*:[ \t]*$/m;
const OUTLOOK = /^(?:De|From):[ \t]+\S[^\n]*\n(?:Enviad[ao](?: em)?|Sent|Data|Date):[ \t]+[^\n]+\n(?:Para|To):[ \t]+/im;
const ORIGINAL = /^[ \t]*-{2,}[ \t]*(?:Original Message|Mensagem original)[ \t]*-{2,}[ \t]*$/im;
const ENCAMINHADA = /^[ \t]*(?:-{5,}[ \t]*(?:Forwarded message|Mensagem encaminhada)[ \t]*-{5,}|Begin forwarded message:|In[ií]cio da mensagem encaminhada:)[ \t]*$/im;

function citacaoNoFim(t) {
  const linhas = t.split('\n');
  let k = linhas.length;
  let citadas = 0;
  while (k > 0 && (!linhas[k - 1].trim() || linhas[k - 1].startsWith('>'))) {
    k--;
    if (linhas[k].startsWith('>')) citadas++;
  }
  while (k < linhas.length && !linhas[k].startsWith('>')) k++; // não leva junto as linhas em branco de cima
  return citadas >= 2 ? linhas.slice(0, k).join('\n').length + (k ? 1 : 0) : -1;
}

// Separa o que a pessoa escreveu do histórico citado. Mensagem encaminhada não é histórico (é o conteúdo), e
// resposta escrita só no meio da citação fica inteira: melhor texto demais do que esconder a resposta.
export function separarCitacao(corpo, { encaminhado = false } = {}) {
  const t = String(corpo || '').replace(/\r\n?/g, '\n');
  const cortes = [ATRIBUICAO, OUTLOOK, ORIGINAL].map((re) => re.exec(t)?.index ?? -1).concat(citacaoNoFim(t)).filter((i) => i >= 0);
  const corte = cortes.length ? Math.min(...cortes) : -1;
  const encaminhada = ENCAMINHADA.exec(t)?.index ?? -1;
  if (corte < 0 || encaminhado || (encaminhada >= 0 && encaminhada < corte) || !t.slice(0, corte).trim()) return { texto: t, citado: '' };
  return { texto: t.slice(0, corte), citado: t.slice(corte) };
}

const MAX_TEXTO = 8000;
const MAX_CITADO = 6000;
const SEM_VALOR = /^\[not present/i;
const cab = (cabecalhos, nome) => {
  const v = cabecalhos.match(new RegExp(`^${nome}:[ \\t]*(.*)$`, 'mi'))?.[1]?.trim() || '';
  return SEM_VALOR.test(v) ? '' : v;
};

// "1. proposta.pdf (application/pdf, 12.3 KB)" e, embaixo, o id do anexo (que não interessa aqui)
function parsearAnexos(secao) {
  return [...String(secao || '').matchAll(/^[ \t]*\d+\.[ \t]+(.+?)(?:[ \t]\(([^()]*),[ \t]*([\d.,]+[ \t]?[KMGT]?B)\))?[ \t]*$/gm)]
    .map(([, nome, tipo, tamanho]) => ({ nome: nome.trim(), tipo: tipo?.trim() || '', tamanho: tamanho?.trim() || '' }));
}

// O workspace-mcp escreve cada cabeçalho uma vez, um por linha. Dois iguais = o valor de um deles trouxe uma
// quebra de linha para se passar por outro (um From falso dentro do Subject): não dá para saber qual vale.
const UMA_VEZ = ['From', 'Reply-To', 'To', 'Cc', 'Date', 'Subject'];

function lerMensagem(cabecalhos, corpo, anexos, assuntoDoFio = '') {
  const de = cab(cabecalhos, 'From');
  const quem = remetente(de);
  const repetido = UMA_VEZ.find((n) => (cabecalhos.match(new RegExp(`^${n}:`, 'gmi')) || []).length > 1);
  const assunto = cab(cabecalhos, 'Subject') || assuntoDoFio;
  const { texto, citado } = separarCitacao(corpo, { encaminhado: /^\s*(?:fwd?|enc|fw|tr|rv)\s*:/i.test(assunto) });
  const limpo = limparCorpo(texto);
  return {
    de: soNome(de), email: quem.email, em: Date.parse(cab(cabecalhos, 'Date')) || null, assunto,
    ...(repetido || quem.estranho ? { suspeito: repetido ? `o cabeçalho ${repetido} aparece duas vezes` : 'o remetente tem mais de um endereço' } : {}),
    para: enderecos(cab(cabecalhos, 'To')), cc: enderecos(cab(cabecalhos, 'Cc')),
    responderPara: enderecos(cab(cabecalhos, 'Reply-To'))[0]?.email || '',
    // lista de discussão, notificação e marketing se anunciam no cabeçalho
    lista: /^(?:List-Id|List-Unsubscribe):|^Precedence:[ \t]*(?:bulk|list|junk)/mi.test(cabecalhos),
    texto: limpo.slice(0, MAX_TEXTO), cortado: limpo.length > MAX_TEXTO,
    // o histórico vem com ">" na frente de cada linha: tira um nível (a citação da citação segue marcada)
    citado: limparCorpo(citado.split('\n').map((l) => l.replace(/^> ?/, '')).join('\n')).slice(0, MAX_CITADO),
    anexos: parsearAnexos(anexos),
    trecho: limpo.replace(/\s+/g, ' ').slice(0, 300),
  };
}

// O workspace-mcp responde em texto, e o texto do e-mail (de quem quer que tenha escrito) vem no meio das marcas
// dele ("Message ID:", "--- BODY ---", "=== Message N ==="). Um e-mail pode trazer essas marcas no corpo para
// se passar por outra mensagem: as funções abaixo só aceitam a marca que bate com o que foi pedido.

// A seção de anexos de verdade é a última e cita o id da mensagem (que quem escreveu o e-mail não sabe);
// no fio o id não aparece no cabeçalho, então vale a última seção.
function separarAnexos(resto, id) {
  const ultima = [...resto.matchAll(/^--- ATTACHMENTS ---$/gm)].at(-1);
  if (!ultima || (id && !resto.slice(ultima.index).includes(`message_id='${id}'`))) return [resto, ''];
  return [resto.slice(0, ultima.index), resto.slice(ultima.index + ultima[0].length)];
}

// get_gmail_messages_content_batch: um bloco por mensagem (cabeçalhos, "--- BODY ---", corpo e anexos), na
// ordem pedida. Só abre bloco o id que foi pedido; um id que aparece duas vezes (o corpo de um imitando o
// começo de outro) deixa o lote ambíguo, e quem chamou lê um e-mail por vez.
export function parsearLote(texto, ids) {
  const t = String(texto || '').replace(/\r\n?/g, '\n');
  const pedidos = new Set(ids);
  const inicios = [...t.matchAll(/^(?:Message ID: (\S+)\nSubject: |⚠️ Message ([\w-]+):)/gm)]
    .map((m) => ({ id: m[1] || m[2], pos: m.index, erro: !m[1] }))
    .filter((x) => pedidos.has(x.id));
  const mensagens = new Map();
  if (new Set(inicios.map((x) => x.id)).size < inicios.length) return { mensagens, ambiguo: true };
  inicios.forEach((x, k) => {
    if (x.erro) return; // "⚠️ Message ...": o Gmail não devolveu esta
    const bloco = t.slice(x.pos, k + 1 < inicios.length ? inicios[k + 1].pos : t.length);
    const corte = bloco.search(/^--- BODY ---$/m);
    if (corte < 0) return;
    const [corpo, anexos] = separarAnexos(bloco.slice(corte).replace(/^--- BODY ---\n?/, '').replace(/\n+---\n*$/, ''), x.id);
    mensagens.set(x.id, lerMensagem(bloco.slice(0, corte), corpo, anexos));
  });
  return { mensagens, ambiguo: false };
}

// get_gmail_thread_content: "Messages: N", e então "=== Message k ===", cabeçalhos, linha em branco e o corpo.
// Só separa quando as marcas são exatamente 1..N, na ordem: uma linha "=== Message 7 ===" no corpo de um
// e-mail, com From e Date embaixo, apareceria como mensagem de outra pessoa no fio. Ambíguo = sem mensagens.
export function lerFio(texto) {
  const t = String(texto || '').replace(/\r\n?/g, '\n');
  const marcas = [...t.matchAll(/^=== Message (\d+) ===$/gm)];
  const topo = marcas.length ? t.slice(0, marcas[0].index) : t;
  const assunto = topo.match(/^Subject: (.*)$/m)?.[1]?.trim() || '';
  // o último "Messages:" do topo é o do workspace-mcp (um Subject com quebra de linha viria antes dele)
  const total = Number([...topo.matchAll(/^Messages: (\d+)$/gm)].at(-1)?.[1] || 0);
  if (!marcas.length) return { assunto, mensagens: [], ambiguo: false };
  if (marcas.length !== total || marcas.some((m, k) => Number(m[1]) !== k + 1)) return { assunto, mensagens: [], ambiguo: true };
  const mensagens = marcas.map((m, k) => {
    const bloco = t.slice(m.index + m[0].length, k + 1 < marcas.length ? marcas[k + 1].index : t.length).replace(/^\n+/, '');
    const corte = bloco.search(/\n[ \t]*\n/);
    const cabecalhos = corte < 0 ? bloco : bloco.slice(0, corte);
    const [corpo, anexos] = separarAnexos(corte < 0 ? '' : bloco.slice(corte).replace(/^\n[ \t]*\n/, ''));
    return lerMensagem(cabecalhos, corpo, anexos, assunto);
  });
  return { assunto, mensagens, ambiguo: false };
}

// o fio resumido, para a prévia da resposta
export function parsearThread(texto) {
  return lerFio(texto).mensagens.map(({ de, em, trecho }) => ({ de, em, trecho }));
}

const escaparHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const MIME_EMAIL = {
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv', '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.txt': 'text/plain', '.zip': 'application/zip', '.html': 'text/html',
};

// Monta os argumentos do send_gmail_message com o mesmo código que serve a prévia. A assinatura da conta
// (config.json → assinaturas) entra no fim do corpo; sem assinatura, o corpo vai como está.
// Os anexos saem daqui descritos (nome e tipo); o conteúdo só é lido no envio (lerAnexos).
export function montar(m) {
  const conta = m.conta || cfg.contas[0];
  const extra = m.extra || {};
  const html = !!extra.html;
  const assinatura = String(lerPreferencias().assinaturas[conta] || '').trim();
  const body = !assinatura ? m.corpo
    : html ? `${m.corpo}<br><br>${escaparHtml(assinatura).replace(/\n/g, '<br>')}`
      : `${m.corpo}\n\n${assinatura}`;
  const envio = {
    user_google_email: conta,
    to: m.destino_id,
    subject: m.assunto,
    body,
    body_format: html ? 'html' : 'plain',
    ...(extra.cc ? { cc: extra.cc } : {}),
    ...(extra.bcc ? { bcc: extra.bcc } : {}),
    ...(extra.thread_id ? { thread_id: extra.thread_id } : {}),
  };
  const anexos = (Array.isArray(m.anexos) ? m.anexos : []).map((caminho) => ({
    caminho, filename: path.basename(String(caminho)), mime_type: MIME_EMAIL[path.extname(String(caminho)).toLowerCase()] || 'application/octet-stream',
  }));
  return { conta, assinatura, envio, anexos };
}

// O texto de um e-mail em HTML como ele aparece: sem tag e com as entidades trocadas ("ghp_<b></b>..." e
// "ghp&#95;..." aparecem como "ghp_..."). Cada tag com limite, para "<<<<..." sem ">" não ler o resto a cada "<".
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function textoDoHtml(html) {
  return String(html).replace(/<[^<>]{0,2000}>/g, '').replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (e, c) => {
    if (c[0] !== '#') return ENTIDADES[c.toLowerCase()] ?? e;
    const n = /x/i.test(c[1]) ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : e;
  });
}

// O workspace-mcp só lê arquivo de pastas permitidas (anexo numa pasta temporária falha com
// "No valid attachments"): a Central lê o arquivo e manda o conteúdo em base64. Como a trava de pasta do
// workspace-mcp deixou de valer, a validação de src/anexos.js roda de novo aqui, na hora de ler: credencial,
// symlink, compactado e mais de 20 MB não saem. O base64 sai do descritor conferido (lerValidado), não do caminho.
export function lerAnexos(anexos) {
  const validados = validarAnexos(anexos.map((a) => a.caminho));
  return anexos.map((a, i) => ({ filename: a.filename, content: lerValidado(validados[i]).toString('base64'), mime_type: a.mime_type }));
}

// O texto de cada e-mail da Entrada, guardado pelo id (não muda depois de entregue): a busca só traz assunto e
// remetente, então o texto vem num pedido só por conta, e só do que ainda não foi lido.
// A chave é conta + id: o id do Gmail é de cada caixa, e duas contas podem ter o mesmo.
const corpos = new Map();
async function lerCorpos(conta, ids) {
  const faltam = ids.filter((id) => !corpos.has(`${conta}:${id}`));
  if (!faltam.length) return;
  // lote ambíguo (um corpo imitando o começo de outro e-mail): lê de novo, um e-mail por pedido
  const lotes = [faltam];
  for (const lote of lotes) {
    try {
      const { texto, erro } = await chamarFerramenta('get_gmail_messages_content_batch', { user_google_email: conta, message_ids: lote, format: 'full' });
      if (erro) continue;
      const { mensagens, ambiguo } = parsearLote(texto, lote);
      if (ambiguo && lote.length > 1) lotes.push(...lote.map((id) => [id]));
      if (ambiguo) continue;
      for (const [id, m] of mensagens) corpos.set(`${conta}:${id}`, m);
    } catch { /* a Entrada segue sem o texto destes; a próxima leitura tenta de novo */ }
  }
  while (corpos.size > 400) corpos.delete(corpos.keys().next().value);
}

// mesmo domínio ou subdomínio um do outro (noreply@exemplo.com e contato@mail.exemplo.com)
const dominio = (e) => String(e).split('@')[1] || '';
const mesmoDominio = (a, b) => {
  const [x, y] = [dominio(a), dominio(b)];
  return !!x && !!y && (x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`));
};

export const email = {
  id: 'email',
  nome: 'E-mail',
  contas: () => cfg.contas.map((c) => ({ id: c, nome: c })),
  get contaPadrao() { return cfg.contas[0]; },

  async saude() {
    const aviso = avisoLogin();
    if (aviso) return { ok: false, resumo: aviso, acao: 'faça de novo o login da conta no workspace-mcp (README, seção E-mail)' };
    if (await noAr()) return { ok: true, resumo: 'servidor de e-mail no ar' };
    return { ok: true, resumo: 'pronto: o servidor de e-mail liga sozinho no primeiro envio' };
  },

  buscar(q) {
    const emails = listaEmails(q).filter((e) => EMAIL.test(e));
    return emails.length ? [{ id: emails.join(', '), nome: emails.join(', '), tipo: 'email' }] : [];
  },

  resolver(para) {
    const emails = listaEmails(para);
    if (emails.length && emails.every((e) => EMAIL.test(e))) {
      return { destino: { id: emails.join(', '), nome: emails.join(', '), tipo: 'email' } };
    }
    return { candidatos: [] };
  },

  // não lidos da caixa de entrada das contas
  async entrada({ dias = 2, limite = 25 } = {}) {
    const itens = [];
    for (const conta of cfg.contas) {
      // duas buscas: o que foi endereçado a ele (pede resposta) e o resto da caixa (cópia, lista)
      const base = `in:inbox is:unread category:primary -from:me newer_than:${dias}d`;
      const diretos = new Set();
      const direta = await chamarFerramenta('search_gmail_messages', {
        user_google_email: conta, query: `${base} to:me`, page_size: 10, include_headers: true,
      });
      anotarLogin(conta, direta);
      if (semLogin.has(conta)) continue;
      for (const m of parsearBusca(direta.texto)) diretos.add(m.id);
      const { texto, erro } = await chamarFerramenta('search_gmail_messages', {
        // só a aba Principal: promoção e rede social não são coisa para responder
        user_google_email: conta, query: base, page_size: 12, include_headers: true,
      });
      if (erro) continue;
      const achados = parsearBusca(texto);
      await lerCorpos(conta, achados.map((m) => m.id));
      for (const m of achados) {
        const c = corpos.get(`${conta}:${m.id}`); // sem ele (o Gmail não devolveu o texto) o item ainda aparece, com assunto e remetente
        const quem = remetente(m.de);
        const endereco = quem.email;
        const suspeito = m.suspeito || c?.suspeito || (quem.estranho ? 'o remetente tem mais de um endereço' : '');
        const automatico = !!c?.lista || /(^|[.@_-])(no-?reply|nao-?responda|notifica|mailer|bounce|newsletter|updates?|news|marketing)/.test(endereco);
        const direto = diretos.has(m.id);
        // Reply-To do mesmo domínio (noreply@x → contato@x, lista) vale. De outro domínio é o jeito clássico de
        // desviar a resposta (From parecido com o de um cliente, Reply-To de golpe): a resposta fica com quem
        // assinou e o painel oferece o outro endereço, com aviso.
        const pedido = !suspeito && EMAIL.test(c?.responderPara || '') && c.responderPara !== endereco ? c.responderPara : '';
        const responderPara = pedido && mesmoDominio(pedido, endereco) ? pedido : endereco;
        const pedeRespostaEm = pedido && pedido !== responderPara ? pedido : '';
        const outros = [...(c?.para || []), ...(c?.cc || [])]
          .filter((e, k, todos) => !cfg.contas.includes(e.email) && e.email !== responderPara && e.email !== pedeRespostaEm && todos.findIndex((x) => x.email === e.email) === k);
        itens.push({
          precisa: direto && !automatico && !suspeito,
          motivo: suspeito ? `confira no Gmail: ${suspeito}`
            : automatico ? 'remetente automático'
              : `${direto ? 'endereçado a você' : 'cópia ou lista'}${pedeRespostaEm ? `, pede resposta em ${pedeRespostaEm}` : ''}`,
          chave: `email:${conta}:${m.id}`,
          canal: 'email', conta,
          titulo: m.assunto || '(sem assunto)',
          de: soNome(m.de),
          texto: c?.texto || '',
          ...(c?.citado ? { citado: c.citado } : {}),
          // o que o cartão mostra além do texto; `outros` é quem mais recebeu (quem entra num "responder a todos")
          email: {
            de: endereco, para: c?.para || [], cc: c?.cc || [], outros, anexos: c?.anexos || [], cortado: !!c?.cortado, lido: !!c,
            ...(pedeRespostaEm ? { pedeRespostaEm } : {}), ...(suspeito ? { suspeito } : {}),
          },
          em: m.em,
          destino: { id: responderPara, nome: soNome(m.de), tipo: 'email' },
          extra: { thread_id: m.thread, assunto: /^re:/i.test(m.assunto) ? m.assunto : `Re: ${m.assunto}` },
          link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(conta)}#all/${m.id}`,
        });
      }
    }
    // o mesmo e-mail cai em mais de uma conta dele: mostra uma vez só
    const semRepetir = new Map();
    for (const i of itens.sort((a, b) => b.em - a.em)) {
      const chave = `${i.titulo}|${i.destino.id}|${i.em}`;
      if (!semRepetir.has(chave)) semRepetir.set(chave, i);
    }
    return { itens: [...semRepetir.values()].slice(0, limite), aviso: avisoLogin() };
  },

  // busca livre no Gmail (ou o conteúdo de uma thread pelo id), para a sessão ler sem print
  async ler(alvo, n = 10, conta = cfg.contas[0]) {
    if (!cfg.contas.includes(conta)) throw new Error(`conta não autenticada: ${conta}`);
    if (/^[0-9a-f]{12,20}$/i.test(String(alvo))) {
      const { texto } = await chamarFerramenta('get_gmail_thread_content', { user_google_email: conta, thread_id: alvo });
      const fio = lerFio(texto);
      if (fio.ambiguo) {
        return {
          conversa: { id: alvo, nome: `${fio.assunto || `thread ${alvo}`} (${conta})` },
          mensagens: [],
          aviso: 'Um e-mail deste fio tem no texto uma linha que imita a separação de mensagens. Para não mostrar mensagem forjada, a conversa não foi separada: abra no Gmail.',
        };
      }
      // resposta que não é um fio (erro, conta sem login): devolve como veio
      if (!fio.mensagens.length) return { conversa: { id: alvo, nome: `thread ${alvo} (${conta})` }, mensagens: [{ em: '', de: conta, texto }] };
      return {
        conversa: { id: alvo, nome: `${fio.assunto || `thread ${alvo}`} (${conta})` },
        mensagens: fio.mensagens.slice(-Number(n)).map((m) => ({
          em: m.em ? new Date(m.em).toISOString() : '', de: m.de, texto: m.texto,
          email: m.email, para: m.para, cc: m.cc, citado: m.citado, anexos: m.anexos, cortado: m.cortado,
        })),
      };
    }
    const { texto } = await chamarFerramenta('search_gmail_messages', {
      user_google_email: conta, query: alvo || 'in:inbox newer_than:7d', page_size: Number(n), include_headers: true,
    });
    return {
      conversa: { id: conta, nome: `Gmail ${conta}: ${alvo || 'caixa de entrada'}` },
      mensagens: parsearBusca(texto).map((m) => ({
        em: m.em ? new Date(m.em).toISOString() : '', de: soNome(m.de), texto: `${m.assunto}  ·  thread ${m.thread}`,
      })),
    };
  },

  async enviar(m) {
    const { conta, envio, anexos } = montar(m);
    if (!cfg.contas.includes(conta)) throw new Error(`conta de e-mail não autenticada: ${conta}`);
    // o linter já barra; aqui de novo porque é o último ponto antes do Gmail
    for (const [campo, lista] of [['para', envio.to], ['cópia', envio.cc], ['cópia oculta', envio.bcc]]) {
      const ruins = String(lista || '').split(',').map((e) => e.trim()).filter((e) => e && !EMAIL.test(e));
      if (ruins.length) throw new Error(`endereço inválido em ${campo}: ${ruins.join(', ')}`);
    }
    const { texto, erro } = await chamarFerramenta('send_gmail_message', {
      ...envio,
      ...(anexos.length ? { attachments: lerAnexos(anexos) } : {}),
    });
    anotarLogin(conta, { texto, erro });
    if (/ACTION REQUIRED|authoriz|autentica|start_google_auth|reauth/i.test(texto)) {
      throw new Error(`a conta ${conta} precisa logar de novo no workspace-mcp (README, seção E-mail)`);
    }
    const confirmou = /message id/i.test(texto) || /^email sent/i.test(texto.trim());
    if (erro || !confirmou) throw new Error(`Gmail não confirmou o envio: ${texto.slice(0, 300)}`);
    const id = texto.match(/message id[:\s]+([\w-]+)/i)?.[1];
    return { resumo: `enviado de ${conta} para ${m.destino_id}`, gmail_id: id || null };
  },

  // Tudo o que sai em texto, do mesmo montar() do envio, para o linter (src/lint.js): assunto, corpo com a
  // assinatura (e, em HTML, também como ele aparece), destinatários e o nome de cada anexo
  saida(m) {
    const { assinatura, envio, anexos } = montar(m);
    const lista = [];
    if (envio.subject) lista.push({ texto: String(envio.subject), onde: 'no assunto', nome: 'assunto' });
    const comAssinatura = assinatura ? ' (com a assinatura)' : '';
    lista.push({ texto: String(envio.body || ''), onde: `no texto${comAssinatura}`, nome: 'texto' });
    if (envio.body_format === 'html') {
      lista.push({ texto: textoDoHtml(envio.body), onde: `no texto como aparece no e-mail${comAssinatura}`, nome: 'texto' });
    }
    for (const campo of ['to', 'cc', 'bcc']) {
      if (envio[campo]) lista.push({ texto: String(envio[campo]), onde: 'no destinatário', nome: 'destinatário' });
    }
    anexos.forEach((a, k) => lista.push({ texto: a.filename, onde: `no nome do anexo ${k + 1}`, nome: `nome do anexo ${k + 1}` }));
    return lista;
  },

  // a mensagem como vai sair (a assinatura vai junto) e, se for resposta, o fio da conversa
  async previa(m) {
    const { conta, assinatura, envio, anexos } = montar(m);
    const p = {
      canal: 'email',
      conta: { id: conta, email: conta },
      para: envio.to,
      cc: envio.cc || null,
      bcc: envio.bcc || null,
      assunto: envio.subject || '',
      corpo: m.corpo,
      assinatura,
      html: envio.body_format === 'html',
      // mime é o que vai no e-mail (o mesmo do envio)
      anexos: anexos.map((a, i) => ({ ...infoAnexo(a.caminho, i, m.id), mime: a.mime_type, enviado: true })),
      thread: null,
    };
    if (!envio.thread_id) return p;
    // só lê o fio com o servidor de e-mail no ar; senão liga em segundo plano (fora do modo prévia) e avisa
    if (!(await noAr())) {
      if (config.modo !== 'previa') garantirServidor().catch(() => {});
      return { ...p, threadAviso: config.modo === 'previa' ? 'servidor de e-mail desligado (o modo prévia não liga)'
        : 'ligando o servidor de e-mail; o fio da conversa aparece em alguns segundos' };
    }
    try {
      const { texto } = await chamarFerramenta('get_gmail_thread_content', { user_google_email: conta, thread_id: envio.thread_id });
      return { ...p, thread: parsearThread(texto) };
    } catch (e) {
      return { ...p, threadAviso: `não consegui ler o fio: ${e.message}` };
    }
  },
};
