// Canais com a rede falsa: a prévia sai do mesmo montar() do envio, e o que vai para a ponte, o Gmail
// e o Discord é exatamente o que a prévia mostrou. Nenhum teste toca rede ou banco de verdade.
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../src/config.js';
import { abrirDb } from '../src/db.js';
import { semearSegredo } from '../src/segredos.js';
import { CANAIS, canaisLigados, canaisSemEnvio, criarApp } from '../src/server.js';
import { whatsapp } from '../src/canais/whatsapp.js';
import { email, enderecos, lerFio, limparCorpo, parsearLote, parsearThread, separarCitacao } from '../src/canais/email.js';
import { discord } from '../src/canais/discord.js';
import { fatiar } from '../src/util.js';
import { lint } from '../src/lint.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-canais-'));
// as contas de e-mail do dono, como viriam do config.json (sem elas o canal fica desligado)
config.email.contas = ['tobias@exemplo.com', 'tobias@exemplo.com.br'];
const arquivo = (nome, conteudo) => { const p = path.join(dir, nome); fs.writeFileSync(p, conteudo); return p; };

// fetch falso: cada teste diz o que responder; o que não for dele passa para o fetch de verdade (servidor local do teste)
const fetchOriginal = globalThis.fetch;
let rede = null;
const chamadas = [];
globalThis.fetch = async (url, opcoes = {}) => {
  const u = String(url);
  const r = rede ? rede(u, opcoes) : undefined;
  if (r === undefined) {
    if (u.startsWith('http://127.0.0.1:') && !u.includes(':8792')) return fetchOriginal(url, opcoes);
    throw new Error(`rede de verdade no teste: ${u}`);
  }
  chamadas.push({ url: u, metodo: opcoes.method || 'GET', corpo: opcoes.body ? JSON.parse(opcoes.body) : null });
  const { status = 200, json = {}, cab = {} } = await r;
  return new Response(json === null ? null : JSON.stringify(json), { status, headers: { 'content-type': 'application/json', ...cab } });
};
test.after(() => {
  globalThis.fetch = fetchOriginal;
  fs.rmSync(dir, { recursive: true, force: true });
  // a pasta das cópias de envio do WhatsApp neste processo (cada cópia já se apaga; a pasta fica)
  fs.rmSync(path.join(os.tmpdir(), `central-envio-teste-${process.pid}`), { recursive: true, force: true });
});

// ---------------------------------------------------------------- WhatsApp: banco da ponte de mentira

const NOEMI = '5511999990001';
const ELISA = '5511999990002';
const GRUPO = '120363000000000001@g.us';
const quando = (minAtras) => new Date(Date.now() - minAtras * 60e3).toISOString().slice(0, 19).replace('T', ' ');
{
  const msgs = new Database(path.join(dir, 'messages.db'));
  msgs.exec(`CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT, last_message_time TIMESTAMP);
    CREATE TABLE messages (id TEXT, chat_jid TEXT, sender TEXT, content TEXT, timestamp TIMESTAMP, is_from_me BOOLEAN, media_type TEXT,
      PRIMARY KEY (id, chat_jid));`);
  msgs.prepare('INSERT INTO chats VALUES (?,?,?)').run(GRUPO, 'Equipe Teste', quando(1));
  const ins = msgs.prepare('INSERT INTO messages (id, chat_jid, sender, content, timestamp, is_from_me, media_type) VALUES (?,?,?,?,?,?,?)');
  ins.run('T1', GRUPO, ELISA, 'bom dia, gente', quando(120), 0, null);
  ins.run('M1', GRUPO, NOEMI, 'conseguem ver o relatório?', quando(90), 0, null);
  ins.run('EU1', GRUPO, '', 'vou ver agora', quando(80), 1, null);
  ins.run('T2', GRUPO, ELISA, '', quando(70), 0, 'image');
  ins.run('EU2', GRUPO, '', 'achei, já mando', quando(60), 1, null);
  ins.run('T3', GRUPO, ELISA, 'valeu', quando(50), 0, null);
  ins.run('M2', GRUPO, NOEMI, 'e o link?', quando(40), 0, null);
  // conversa gravada só no @lid, com o "nome" igual ao número do lid
  msgs.prepare('INSERT INTO chats VALUES (?,?,?)').run('900000000000001@lid', '900000000000001', quando(30));
  msgs.close();
  const sessao = new Database(path.join(dir, 'whatsapp.db'));
  sessao.exec(`CREATE TABLE whatsmeow_device (jid TEXT PRIMARY KEY);
    CREATE TABLE whatsmeow_lid_map (lid TEXT PRIMARY KEY, pn TEXT UNIQUE NOT NULL);
    CREATE TABLE whatsmeow_contacts (our_jid TEXT, their_jid TEXT, first_name TEXT, full_name TEXT, push_name TEXT, PRIMARY KEY (our_jid, their_jid));`);
  sessao.prepare('INSERT INTO whatsmeow_device VALUES (?)').run('5511999990099:1@s.whatsapp.net');
  const ct = sessao.prepare('INSERT INTO whatsmeow_contacts VALUES (?,?,?,?,?)');
  ct.run('eu', `${NOEMI}@s.whatsapp.net`, 'Noemi', 'Noemi Barros', 'Noemi');
  ct.run('eu', `${ELISA}@s.whatsapp.net`, 'Elisa', 'Elisa Campos', 'Eli');
  // o nome dela só existe na agenda (no telefone) e no perfil (no @lid)
  sessao.prepare('INSERT INTO whatsmeow_lid_map VALUES (?,?)').run('900000000000001', '551199990041');
  ct.run('eu', '551199990041@s.whatsapp.net', '', 'Helena Duarte', '');
  ct.run('eu', '900000000000001@lid', '', '', 'Helena Duarte');
  ct.run('eu', '5511999990065@s.whatsapp.net', 'Valter', 'Valter Agenda', ''); // salvo no celular, sem conversa
  ct.run('eu', '5511999990064@s.whatsapp.net', '', '', 'Fulano Perfil'); // só o perfil, de um grupo: não é contato dele
  sessao.close();
  Object.assign(config.whatsapp, {
    messagesDb: path.join(dir, 'messages.db'), sessaoDb: path.join(dir, 'whatsapp.db'), ponte: 'http://ponte.teste',
  });
}

async function subir(opcoes) {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const porta = s.address().port;
  const app = criarApp({ porta, ...opcoes });
  s.on('request', app);
  return {
    get: async (caminho) => { const r = await fetch(`http://127.0.0.1:${porta}${caminho}`); return { status: r.status, corpo: await r.json() }; },
    fechar: () => { app.parar(); s.closeAllConnections(); s.close(); },
  };
}

test('WhatsApp: o contato certo pelo nome da agenda e pelo número com ou sem o 9; número que não existe avisa', async () => {
  // a conversa está no @lid com o "nome" igual ao número: o nome vem da agenda e o destino é o telefone
  assert.deepEqual(whatsapp.buscar('Helena Duarte').map((d) => [d.id, d.nome]), [['551199990041@s.whatsapp.net', 'Helena Duarte']]);
  // salvo no celular e sem conversa na ponte também é destino; só o perfil (gente de grupo), não
  assert.deepEqual(whatsapp.buscar('Valter Agenda').map((d) => d.id), ['5511999990065@s.whatsapp.net']);
  assert.deepEqual(whatsapp.buscar('Fulano Perfil'), []);
  // o número com o 9 (como se digita hoje), sem ele e sem o 55 dão no mesmo contato
  for (const fone of ['+55 11 99999-0041', '+551199990041', '11 9999-0041']) {
    assert.deepEqual(whatsapp.resolver(fone).destino, { id: '551199990041@s.whatsapp.net', nome: 'Helena Duarte', tipo: 'contato' }, fone);
  }
  assert.deepEqual(whatsapp.buscar('9999-0041').map((d) => d.nome), ['Helena Duarte']);

  // número com dígito trocado não vira a Helena: vai como veio e o linter avisa antes de aprovar
  const errado = whatsapp.resolver('+5511999990014').destino;
  assert.equal(errado.id, '5511999990014@s.whatsapp.net');
  assert.equal(whatsapp.conhecido(errado.id), false);
  assert.equal(whatsapp.conhecido('551199990041@s.whatsapp.net'), true, 'conversa só no @lid conta');
  assert.equal(whatsapp.conhecido(GRUPO), true);
  const m = { canal: 'whatsapp', conta: 'pessoal', destino_id: errado.id, destino_nome: errado.nome, corpo: 'Oi! Tudo certo por aí?' };
  const r = lint(m, { segredos: [], destinoConhecido: whatsapp.conhecido(errado.id) });
  assert.ok(r.avisos.some((a) => /fora da agenda/.test(a.msg)), JSON.stringify(r.avisos));
  assert.ok(!lint(m, { segredos: [], destinoConhecido: true }).avisos.some((a) => /fora da agenda/.test(a.msg)));

  // a ponte recusa número sem conta: o erro diz isso, não "a ponte não respondeu"
  rede = () => ({ status: 500, json: { success: false, message: 'Error sending message: no LID found for 5511999990014@s.whatsapp.net from server' } });
  await assert.rejects(whatsapp.enviar({ id: 31, canal: 'whatsapp', destino_id: errado.id, destino_nome: errado.nome, corpo: 'oi', anexos: [] }), /número sem WhatsApp: 5511999990014/);
  rede = null;
});

test('WhatsApp: a prévia (pela API) é exatamente o JSON que vai para a ponte', async () => {
  const repo = abrirDb(':memory:');
  const pdf = arquivo('relatorio.pdf', '%PDF-1.4 teste');
  const png = arquivo('print.png', 'png');
  const m = repo.criar({
    canal: 'whatsapp', conta: 'pessoal', destino_id: GRUPO, destino_nome: 'Equipe Teste',
    corpo: 'Noemi, segue o link. @Eli confere também?', anexos: [pdf, png],
  });
  const srv = await subir({ repo, canais: { whatsapp } });
  let resposta;
  try { resposta = await srv.get(`/api/mensagens/${m.id}/previa`); } finally { srv.fechar(); }
  const { status, corpo: p } = resposta;
  assert.equal(status, 200, JSON.stringify(p));

  let enviado = null;
  let lidoPelaPonte = null;
  rede = (url, op) => {
    if (url !== 'http://ponte.teste/api/send') return undefined;
    enviado = JSON.parse(op.body);
    lidoPelaPonte = fs.readFileSync(enviado.media_path, 'utf8'); // a ponte lê o arquivo durante o pedido
    return { json: { success: true } };
  };
  const r = await whatsapp.enviar(repo.obter(m.id));
  rede = null;

  assert.equal(enviado.recipient, p.para.id);
  assert.equal(enviado.message, p.corpo);
  assert.equal(p.corpo, `@${NOEMI}, segue o link. @${ELISA} confere também?`, 'abre marcando quem é respondido e troca @Eli pelo número');
  assert.deepEqual(enviado.mentions, p.mencoes.map((x) => x.jid));
  assert.deepEqual(p.mencoes.map((x) => x.nome), ['Noemi Barros', 'Elisa Campos']);
  assert.equal(enviado.reply_to_id, 'M2', 'cita a última mensagem da Noemi');
  assert.deepEqual(p.citar, { id: 'M2', sender: NOEMI, de: 'Noemi Barros', texto: 'e o link?', automatica: true });
  assert.equal(enviado.reply_to_sender, p.citar.sender);
  assert.equal(enviado.reply_to_text, p.citar.texto);
  // a ponte recebe uma cópia conferida do primeiro anexo (mesmo nome, pasta de envio própria), apagada depois
  assert.notEqual(enviado.media_path, pdf);
  assert.equal(path.basename(enviado.media_path), 'relatorio.pdf');
  assert.ok(enviado.media_path.startsWith(path.join(os.tmpdir(), `central-envio-teste-${process.pid}`) + path.sep));
  assert.equal(lidoPelaPonte, '%PDF-1.4 teste');
  assert.equal(fs.existsSync(enviado.media_path), false, 'a cópia some depois da resposta da ponte');
  assert.deepEqual(p.anexos.map((a) => [a.nome, a.enviado, a.bytes, a.mime]),
    [['relatorio.pdf', true, 14, 'application/pdf'], ['print.png', false, 3, 'image/png']], 'só o primeiro anexo vai');
  assert.equal(p.anexos[0].url, `/api/mensagens/${m.id}/anexo/0`);
  assert.equal(p.para.tipo, 'grupo');
  assert.deepEqual(p.para.participantes.map((x) => x.nome).sort(), ['Elisa Campos', 'Noemi Barros']);
  assert.equal(p.contexto.length, 6, 'as 6 últimas falas');
  assert.deepEqual(p.contexto.map((x) => x.id), ['M1', 'EU1', 'T2', 'EU2', 'T3', 'M2'], 'da mais antiga para a mais nova');
  assert.deepEqual(p.contexto[1], { id: 'EU1', sender: null, de: 'Você', eu: true, texto: 'vou ver agora', em: p.contexto[1].em });
  // com o nome do dono no config.json, a fala dele sai com o nome
  config.dono.nome = 'Tobias Arruda';
  assert.equal(whatsapp.previa(repo.obter(m.id)).contexto[1].de, 'Tobias Arruda');
  config.dono.nome = '';
  assert.equal(p.contexto[2].midia, 'image');
  assert.match(r.resumo, /citando.*marcando 2/);

  // citação escolhida no painel (extra.citar) vale no lugar da automática, na prévia e no envio
  const manual = { ...repo.obter(m.id), extra: { citar: { id: 'M1', sender: NOEMI, texto: 'conseguem ver o relatório?', de: 'Noemi Barros' } } };
  const pm = whatsapp.previa(manual);
  rede = (url, op) => (url === 'http://ponte.teste/api/send' ? (enviado = JSON.parse(op.body), { json: { success: true } }) : undefined);
  await whatsapp.enviar(manual);
  rede = null;
  assert.equal(pm.citar.automatica, false);
  assert.equal(enviado.reply_to_id, 'M1');
  assert.equal(enviado.message, pm.corpo);
  assert.equal(pm.corpo, `Noemi, segue o link. @${ELISA} confere também?`, 'sem citação automática, não marca no começo');
});

// ---------------------------------------------------------------- e-mail: workspace-mcp falso

function mcpFalso(responder = () => ({ result: { content: [{ type: 'text', text: 'Email sent! Message ID: 18f00ab' }] } })) {
  const ferramentas = [];
  rede = (url, op) => {
    if (url === 'http://127.0.0.1:8792/') return { json: {} };
    if (url !== 'http://127.0.0.1:8792/mcp') return undefined;
    const j = JSON.parse(op.body);
    if (j.method === 'initialize') return { json: { jsonrpc: '2.0', id: j.id, result: {} }, cab: { 'mcp-session-id': 's1' } };
    if (j.method === 'notifications/initialized') return { status: 202, json: null };
    ferramentas.push(j.params);
    return { json: { jsonrpc: '2.0', id: j.id, ...responder(j.params) } };
  };
  return ferramentas;
}

test('e-mail: anexo vai como conteúdo base64 (não caminho), assinatura da conta entra no fim, prévia igual', async () => {
  config.preferencias = path.join(dir, 'config.json');
  fs.writeFileSync(config.preferencias, JSON.stringify({ assinaturas: { 'tobias@exemplo.com': 'Tobias Arruda\nFarol' } }));
  const pdf = arquivo('proposta.pdf', '%PDF-1.4 proposta');
  const xlsx = arquivo('base.xlsx', 'PK planilha');
  const outro = arquivo('dados.bin', Buffer.from([0, 1, 2, 3]));
  const m = {
    id: 7, canal: 'email', conta: 'tobias@exemplo.com', destino_id: 'cliente@exemplo.org', assunto: 'Proposta',
    corpo: 'Oi, segue a proposta.', anexos: [pdf, xlsx, outro], extra: { cc: 'debora@exemplo.org' },
  };
  const ferramentas = mcpFalso();
  const p = await email.previa(m);
  const r = await email.enviar(m);
  rede = null;
  const args = ferramentas.find((f) => f.name === 'send_gmail_message').arguments;
  assert.equal(args.body, 'Oi, segue a proposta.\n\nTobias Arruda\nFarol');
  assert.equal(args.body, `${p.corpo}\n\n${p.assinatura}`, 'prévia e envio montam o mesmo corpo');
  assert.equal(args.cc, p.cc);
  assert.equal(args.to, p.para);
  assert.equal(args.subject, p.assunto);
  assert.deepEqual(args.attachments, [
    { filename: 'proposta.pdf', content: Buffer.from('%PDF-1.4 proposta').toString('base64'), mime_type: 'application/pdf' },
    { filename: 'base.xlsx', content: Buffer.from('PK planilha').toString('base64'), mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    { filename: 'dados.bin', content: Buffer.from([0, 1, 2, 3]).toString('base64'), mime_type: 'application/octet-stream' },
  ]);
  assert.ok(args.attachments.every((a) => !('path' in a)), 'o workspace-mcp não lê arquivo de fora das pastas dele');
  assert.deepEqual(p.anexos.map((a) => a.mime), args.attachments.map((a) => a.mime_type));
  assert.equal(r.gmail_id, '18f00ab');

  // HTML: assinatura escapada e com <br>
  fs.writeFileSync(config.preferencias, JSON.stringify({ assinaturas: { 'tobias@exemplo.com': 'Tobias <Farol>' } }));
  const html = await email.previa({ ...m, anexos: null, extra: { html: true } });
  assert.equal(html.html, true);
  const f2 = mcpFalso();
  await email.enviar({ ...m, anexos: null, extra: { html: true } });
  rede = null;
  assert.equal(f2[0].arguments.body, 'Oi, segue a proposta.<br><br>Tobias &lt;Farol&gt;');
  assert.equal(f2[0].arguments.attachments, undefined);
});

test('e-mail: mais de 20 MB de anexo é recusado antes de chamar o Gmail; fio da conversa entra na prévia', async () => {
  const grande = path.join(dir, 'video.mp4');
  fs.writeFileSync(grande, '');
  fs.truncateSync(grande, 21 * 1024 * 1024);
  const ferramentas = mcpFalso();
  await assert.rejects(email.enviar({ id: 8, canal: 'email', conta: 'tobias@exemplo.com', destino_id: 'a@exemplo.com', assunto: 'x', corpo: 'y', anexos: [grande] }),
    /21,0 MB; o limite é 20 MB por mensagem/);
  assert.equal(ferramentas.length, 0, 'nem chamou o Gmail');
  await assert.rejects(email.enviar({ id: 9, canal: 'email', conta: 'tobias@exemplo.com', destino_id: 'a@exemplo.com', assunto: 'x', corpo: 'y', anexos: [path.join(dir, 'sumiu.pdf')] }),
    /anexo não encontrado: .*sumiu\.pdf/);
  rede = null;

  const fio = `Thread ID: 18f\nSubject: Proposta\nMessages: 2\n\n=== Message 1 ===\nFrom: "Debora" <debora@exemplo.org>\nDate: Thu, 1 Oct 2026 10:00:00 -0300\nTo: tobias@exemplo.com\nCc: [not present in Gmail response]\n\nPode mandar a proposta?\nObrigada\n\n=== Message 2 ===\nFrom: Tobias <tobias@exemplo.com>\nDate: Thu, 1 Oct 2026 11:00:00 -0300\nTo: debora@exemplo.org\n\nMando hoje.\n\n--- ATTACHMENTS ---\n1. x.pdf\n`;
  assert.deepEqual(parsearThread(fio), [
    { de: 'Debora', em: Date.parse('Thu, 1 Oct 2026 10:00:00 -0300'), trecho: 'Pode mandar a proposta? Obrigada' },
    { de: 'Tobias', em: Date.parse('Thu, 1 Oct 2026 11:00:00 -0300'), trecho: 'Mando hoje.' },
  ]);
  mcpFalso(() => ({ result: { content: [{ type: 'text', text: fio }] } }));
  const p = await email.previa({ id: 10, canal: 'email', conta: 'tobias@exemplo.com', destino_id: 'debora@exemplo.org', assunto: 'Re: Proposta', corpo: 'ok', extra: { thread_id: '18f' } });
  rede = null;
  assert.equal(p.thread.length, 2);
  assert.equal(p.thread[0].de, 'Debora');
});

test('e-mail que chega: parágrafo de volta, histórico citado à parte, encaminhada inteira', () => {
  // o Gmail quebra a linha perto da coluna 76: a quebra dele some, a da pessoa (linha curta, lista, assinatura) fica
  const cru = 'Oi, Tobias. Vocês conseguem ver esse e-mail? Preciso confirmar o valor de\r\ncobrança antes de pagar.\r\n\r\n- primeiro item da lista que é comprido o bastante para o Gmail quebrar a\r\nlinha no meio\r\n- segundo\r\n\r\n\r\n\r\nAbraço,\r\nIvo​\r\n';
  assert.equal(limparCorpo(cru), [
    'Oi, Tobias. Vocês conseguem ver esse e-mail? Preciso confirmar o valor de cobrança antes de pagar.', '',
    '- primeiro item da lista que é comprido o bastante para o Gmail quebrar a linha no meio', '- segundo', '', 'Abraço,', 'Ivo',
  ].join('\n'));
  // cabeçalho de encaminhada não gruda no de baixo, por mais comprido que seja
  const cabecalhos = 'De: Faturamento da Plataforma de Anúncios <no-reply@faturas.exemplo.net>\nDate: seg., 5 de out. de 2026 às 08:00';
  assert.equal(limparCorpo(cabecalhos), cabecalhos);

  // "Em ... escreveu:" numa linha, em duas (o endereço embaixo) e com o "escreveu:" sozinho na de baixo
  for (const atribuicao of [
    'Em seg., 5 de out. de 2026 às 08:12, Clara Mendes <clara@exemplo.org> escreveu:',
    'Em seg., 5 de out. de 2026 às 08:12, Clara Mendes <\nclara@exemplo.org> escreveu:',
    'Em seg., 5 de out. de 2026 às 08:12, Clara Mendes <clara@exemplo.org>\nescreveu:',
    'On Mon, Oct 5, 2026 at 8:12 AM Clara Mendes <clara@exemplo.org> wrote:',
  ]) {
    const r = separarCitacao(`Fechado, pode seguir.\r\n\r\nAbs\r\n\r\n${atribuicao}\r\n\r\n> Oi, Tobias\r\n> Segue a proposta.\r\n`);
    assert.equal(r.texto.trim(), 'Fechado, pode seguir.\n\nAbs', atribuicao);
    assert.ok(r.citado.startsWith(atribuicao.slice(0, 30)), atribuicao);
  }
  // Outlook e resto de mensagem só com ">"
  assert.equal(separarCitacao('De acordo.\n\nDe: Clara Mendes <clara@exemplo.org>\nEnviada em: segunda-feira, 5 de outubro de 2026 08:12\nPara: Tobias\nAssunto: Proposta\n\nOi').texto.trim(), 'De acordo.');
  assert.deepEqual(separarCitacao('Vi agora.\n\n> linha um\n> linha dois\n'), { texto: 'Vi agora.\n\n', citado: '> linha um\n> linha dois\n' });
  // encaminhada é o conteúdo, não histórico; resposta escrita no meio da citação aparece inteira
  const encaminhada = 'Segue para você.\n\n---------- Forwarded message ---------\nDe: Avisos <no-reply@exemplo.net>\nDate: seg., 5 de out. de 2026 às 08:00\nSubject: extrato\nTo: <ivo@exemplo.com>\n\nEm 1 de out. alguém escreveu:\n> velho';
  assert.deepEqual(separarCitacao(encaminhada), { texto: encaminhada, citado: '' });
  const noMeio = 'Em seg., 5 de out. de 2026 às 08:12, Clara <clara@exemplo.org> escreveu:\n\n> Pode ser às 10h?\n\nPode.\n';
  assert.deepEqual(separarCitacao(noMeio), { texto: noMeio, citado: '' });

  assert.deepEqual(enderecos('Tobias <tobias@exemplo.com>, "Mendes, Clara" <clara@exemplo.org>, PIETRA@exemplo.org'), [
    { nome: 'Tobias', email: 'tobias@exemplo.com' }, { nome: 'Mendes, Clara', email: 'clara@exemplo.org' }, { nome: '', email: 'pietra@exemplo.org' },
  ]);
  assert.deepEqual(enderecos('undisclosed-recipients:;'), []);
});

// o que o workspace-mcp devolve no lote de mensagens: um bloco por e-mail, separados por "---"
const blocoDoLote = ({ id, assunto, de, para, cc = '[not present in Gmail response]', extra = [], corpo, anexos = '' }) => [
  `Message ID: ${id}`, `Subject: ${assunto}`, `From: ${de}`, 'Date: Mon, 5 Oct 2026 10:12:00 -0300', 'Message-ID: <x@mail>', ...extra,
  `To: ${para}`, `Cc: ${cc}`, `Web Link: https://mail.google.com/mail/u/0/#all/${id}`, '', '--- BODY ---', corpo, ...(anexos ? ['', '--- ATTACHMENTS ---', anexos] : []),
].join('\n');
const LOTE = {
  '19bb01': blocoDoLote({
    id: '19bb01', assunto: 'Proposta Estrela', de: 'Clara Mendes <clara@exemplo.org>',
    para: 'Tobias <tobias@exemplo.com>, "Sales, Pietra" <pietra@exemplo.org>', cc: 'mateus@exemplo.org, tobias@exemplo.com.br',
    corpo: 'Oi, Tobias.\r\n\r\nPode mandar a proposta até sexta? Preciso levar para a diretoria na segunda de\r\nmanhã.\r\n\r\nEm sex., 2 de out. de 2026 às 17:40, Tobias <tobias@exemplo.com>\r\nescreveu:\r\n\r\n> Clara, fechamos o escopo.\r\n>> antes disso\r\n',
    anexos: "1. escopo (v2).pdf (application/pdf, 84.2 KB)\n   Attachment ID: ANGjd\n   Use get_gmail_attachment_content(message_id='19bb01', attachment_id='ANGjd') to download",
  }),
  '19bb02': blocoDoLote({
    id: '19bb02', assunto: '[repo] PR #12', de: 'Mateus <mateus@exemplo.net>', para: 'repo <repo@noreply.exemplo.net>',
    extra: ['Reply-To: repo <reply+abc@reply.exemplo.net>', 'List-Id: repo.exemplo.net'], corpo: 'Merged #12.',
  }),
};

test('e-mail na Entrada: o texto do e-mail, quem estava em cópia, Reply-To e o fio em "Ler a conversa"', async () => {
  const achado = (id, assunto, de, thread) => `  1. Message ID: ${id}\n     Subject: ${assunto}\n     From: ${de}\n     Date: Mon, 5 Oct 2026 10:12:00 -0300\n     Web Link: https://mail.google.com/x\n     Thread ID: ${thread}\n     Thread Link: https://mail.google.com/y\n`;
  const fio = `Thread ID: 19bb0000000000aa\nSubject: Proposta Estrela\nMessages: 2\n\n=== Message 1 ===\nFrom: Tobias <tobias@exemplo.com>\nDate: Fri, 2 Oct 2026 17:40:00 -0300\nTo: clara@exemplo.org\nCc: [not present in Gmail response]\nMessage-ID: <a@mail>\n\nClara, fechamos o escopo.\n\n=== Message 2 ===\n${LOTE['19bb01'].split('\n').slice(2, 8).join('\n')}\n\n${LOTE['19bb01'].split('--- BODY ---\n')[1]}\n`;
  const ferramentas = mcpFalso((p) => {
    const a = p.arguments;
    let texto = '';
    if (p.name === 'search_gmail_messages') {
      texto = a.user_google_email !== 'tobias@exemplo.com' ? 'No messages found'
        : `Found messages\n\n📧 MESSAGES:\n${achado('19bb01', 'Proposta Estrela', 'Clara Mendes <clara@exemplo.org>', '19bb0000000000aa')}\n${a.query.includes('to:me') ? '' : achado('19bb02', '[repo] PR #12', 'Mateus <mateus@exemplo.net>', '19bb09')}`;
    } else if (p.name === 'get_gmail_messages_content_batch') {
      texto = `Retrieved ${a.message_ids.length} messages:\n\n${a.message_ids.map((id) => LOTE[id]).join('\n\n---\n\n')}\n`;
    } else if (p.name === 'get_gmail_thread_content') texto = fio;
    return { result: { content: [{ type: 'text', text: texto }] } };
  });
  const { itens, aviso } = await email.entrada({});
  assert.equal(aviso, null);
  assert.deepEqual(itens.map((i) => i.chave), ['email:tobias@exemplo.com:19bb01', 'email:tobias@exemplo.com:19bb02']);
  const [clara, repo] = itens;
  assert.equal(clara.texto, 'Oi, Tobias.\n\nPode mandar a proposta até sexta? Preciso levar para a diretoria na segunda de manhã.', 'o texto do e-mail, com o parágrafo inteiro');
  assert.equal(clara.citado, 'Em sex., 2 de out. de 2026 às 17:40, Tobias <tobias@exemplo.com> escreveu:\n\nClara, fechamos o escopo.\n> antes disso');
  assert.equal(clara.precisa, true);
  assert.deepEqual(clara.destino, { id: 'clara@exemplo.org', nome: 'Clara Mendes', tipo: 'email' });
  assert.deepEqual(clara.email.outros.map((e) => e.email), ['pietra@exemplo.org', 'mateus@exemplo.org'], 'quem mais recebeu, sem as contas dele e sem a própria Clara');
  assert.deepEqual(clara.email.anexos, [{ nome: 'escopo (v2).pdf', tipo: 'application/pdf', tamanho: '84.2 KB' }]);
  assert.equal(clara.email.lido, true);
  assert.equal(clara.extra.cc, undefined, 'a cópia só entra no envio se ele pedir para responder a todos');
  assert.match(clara.link, /authuser=tobias%40exemplo\.com#all\/19bb01$/);
  // lista e notificação se anunciam no cabeçalho; a resposta vai para o Reply-To
  assert.equal(repo.precisa, false);
  assert.equal(repo.motivo, 'remetente automático');
  assert.equal(repo.destino.id, 'reply+abc@reply.exemplo.net');
  assert.equal(repo.texto, 'Merged #12.');

  // o texto de cada e-mail é pedido uma vez só
  await email.entrada({});
  assert.equal(ferramentas.filter((f) => f.name === 'get_gmail_messages_content_batch').length, 1);

  // "Ler a conversa" devolve o fio, mensagem por mensagem
  const lido = await email.ler('19bb0000000000aa', 40, 'tobias@exemplo.com');
  rede = null;
  assert.equal(lido.conversa.nome, 'Proposta Estrela (tobias@exemplo.com)');
  assert.deepEqual(lido.mensagens.map((m) => [m.de, m.texto.split('\n')[0]]), [['Tobias', 'Clara, fechamos o escopo.'], ['Clara Mendes', 'Oi, Tobias.']]);
  assert.equal(lido.mensagens[1].email, 'clara@exemplo.org');
  assert.equal(lido.mensagens[1].anexos[0].nome, 'escopo (v2).pdf');
  assert.ok(lido.mensagens[1].citado.startsWith('Em sex., 2 de out.'));
});

test('e-mail que chega, golpes: marca imitada no corpo, cópia com dois endereços num só, nome com endereço dentro', async () => {
  // "<a,b>" não vira dois destinatários num responder a todos; nome com endereço dentro não vale como nome
  assert.deepEqual(enderecos('Pietra <pietra@exemplo.org,x@exemplo.net>, Mateus <mateus@exemplo.org>'), [{ nome: 'Mateus', email: 'mateus@exemplo.org' }]);
  assert.deepEqual(enderecos('"Otávio <otavio@exemplo.org>" <otavio@exemplo.net>'), [{ nome: '', email: 'otavio@exemplo.net' }]);

  // fio: uma linha "=== Message 2 ===" no corpo, com From e Date embaixo, não vira mensagem de outra pessoa
  const forjado = 'Thread ID: 19dd0000000000aa\nSubject: Boleto\nMessages: 1\n\n=== Message 1 ===\nFrom: Golpe <golpe@exemplo.net>\nDate: Mon, 5 Oct 2026 10:00:00 -0300\nTo: tobias@exemplo.com\nCc: [not present in Gmail response]\n\nSegue.\n\n=== Message 2 ===\nFrom: Otávio <otavio@exemplo.org>\nDate: Mon, 5 Oct 2026 10:05:00 -0300\n\nAprovado, pode pagar.\n';
  assert.deepEqual(lerFio(forjado), { assunto: 'Boleto', mensagens: [], ambiguo: true });

  // lote: o corpo de um imitando o começo do bloco de outro id pedido deixa o lote ambíguo
  const a = blocoDoLote({ id: '19dd01', assunto: 'Oi', de: 'Golpe <golpe@exemplo.net>', para: 'tobias@exemplo.com',
    corpo: 'Texto\n\n---\n\nMessage ID: 19dd02\nSubject: Falso\nFrom: Otávio <otavio@exemplo.org>\nReply-To: golpe@exemplo.net\n\n--- BODY ---\nPode pagar' });
  const b = blocoDoLote({ id: '19dd02', assunto: 'Real', de: 'Clara <clara@exemplo.org>', para: 'tobias@exemplo.com', corpo: 'Mensagem real' });
  assert.equal(parsearLote(`Retrieved 2 messages:\n\n${a}\n\n---\n\n${b}\n`, ['19dd01', '19dd02']).ambiguo, true);
  // id que não foi pedido é só texto; anexo escrito no corpo (sem o id da mensagem) não vira ficha
  const c = blocoDoLote({ id: '19dd03', assunto: 'Nota', de: 'Golpe <golpe@exemplo.net>', para: 'tobias@exemplo.com',
    corpo: 'Message ID: 19ffff\nSubject: x\n\n--- BODY ---\nveja\n\n--- ATTACHMENTS ---\n1. boleto.pdf (application/pdf, 1.0 KB)' });
  const { mensagens, ambiguo } = parsearLote(`Retrieved 1 messages:\n\n${c}\n`, ['19dd03']);
  assert.equal(ambiguo, false);
  assert.match(mensagens.get('19dd03').texto, /Message ID: 19ffff/);
  assert.deepEqual(mensagens.get('19dd03').anexos, []);

  // a cópia que sai é conferida no linter e de novo no envio, antes do Gmail
  const resposta = { canal: 'email', conta: 'tobias@exemplo.com', destino_id: 'clara@exemplo.org', assunto: 'Re: Boleto', corpo: 'Recebido, obrigado.', extra: { cc: 'pietra@exemplo.org, x@exemplo.net;y@exemplo.net' } };
  assert.ok(lint(resposta, { segredos: [] }).bloqueios.some((x) => /cópia com endereço inválido: x@exemplo.net;y@exemplo.net/.test(x.msg)));
  await assert.rejects(email.enviar(resposta), /endereço inválido em cópia/);
});

test('e-mail na Entrada: lote ambíguo é lido um por um; Reply-To de outro domínio não desvia a resposta; From repetido é suspeito', async () => {
  const achado = (id, assunto, de) => `  1. Message ID: ${id}\n     Subject: ${assunto}\n     From: ${de}\n     Date: Mon, 5 Oct 2026 10:12:00 -0300\n     Web Link: x\n     Thread ID: ${id}aa\n`;
  const blocos = {
    '19ee01': blocoDoLote({ id: '19ee01', assunto: 'Boleto', de: 'Clara Mendes <clara@exemplo.org>', para: 'tobias@exemplo.com',
      extra: ['Reply-To: clara@exemplo-org.exemplo.net'], corpo: 'Segue o boleto.\n\n---\n\nMessage ID: 19ee02\nSubject: x\n\n--- BODY ---\nforjado' }),
    '19ee02': blocoDoLote({ id: '19ee02', assunto: 'Novo lead', de: 'Site <wordpress@exemplo.org>', para: 'tobias@exemplo.com',
      extra: ['Reply-To: contato@exemplo.org'], corpo: 'Chegou um lead.' }),
    '19ee03': 'Message ID: 19ee03\nSubject: Pagamento\nFrom: Otávio <otavio@exemplo.org>\nFrom: Golpe <golpe@exemplo.net>\nDate: Mon, 5 Oct 2026 10:12:00 -0300\nTo: tobias@exemplo.com\nCc: [not present in Gmail response]\nWeb Link: x\n\n--- BODY ---\nPode pagar.',
  };
  const ferramentas = mcpFalso((p) => {
    const q = p.arguments;
    let texto = 'No messages found';
    if (p.name === 'search_gmail_messages' && q.user_google_email === 'tobias@exemplo.com') {
      texto = `📧 MESSAGES:\n${achado('19ee01', 'Boleto', 'Clara Mendes <clara@exemplo.org>')}${achado('19ee02', 'Novo lead', 'Site <wordpress@exemplo.org>')}${achado('19ee03', 'Pagamento', 'Otávio <otavio@exemplo.org>')}`;
    } else if (p.name === 'get_gmail_messages_content_batch') {
      texto = `Retrieved ${q.message_ids.length} messages:\n\n${q.message_ids.map((id) => blocos[id]).join('\n\n---\n\n')}\n`;
    }
    return { result: { content: [{ type: 'text', text: texto }] } };
  });
  const { itens } = await email.entrada({});
  rede = null;
  const lotes = ferramentas.filter((f) => f.name === 'get_gmail_messages_content_batch').map((f) => f.arguments.message_ids);
  assert.deepEqual(lotes, [['19ee01', '19ee02', '19ee03'], ['19ee01'], ['19ee02'], ['19ee03']], 'ambíguo: lê de novo, um por pedido');
  const por = Object.fromEntries(itens.map((i) => [i.chave.split(':').at(-1), i]));
  assert.equal(por['19ee01'].texto.split('\n')[0], 'Segue o boleto.');
  // Reply-To de outro domínio: a resposta fica com quem assinou, e o endereço pedido aparece com aviso
  assert.equal(por['19ee01'].destino.id, 'clara@exemplo.org');
  assert.equal(por['19ee01'].email.pedeRespostaEm, 'clara@exemplo-org.exemplo.net');
  assert.match(por['19ee01'].motivo, /pede resposta em clara@exemplo-org\.exemplo\.net/);
  // do mesmo domínio vale (formulário do site que responde no contato)
  assert.equal(por['19ee02'].destino.id, 'contato@exemplo.org');
  assert.equal(por['19ee02'].email.pedeRespostaEm, undefined);
  // From repetido: não pede resposta e diz por quê
  assert.equal(por['19ee03'].precisa, false);
  assert.match(por['19ee03'].motivo, /confira no Gmail: o cabeçalho From aparece duas vezes/);
});

test('e-mail na Entrada: sem o texto (o Gmail não devolveu) o item aparece do mesmo jeito', async () => {
  mcpFalso((p) => {
    const texto = p.name === 'search_gmail_messages' && p.arguments.user_google_email === 'tobias@exemplo.com'
      ? '📧 MESSAGES:\n  1. Message ID: 19cc01\n     Subject: Sem corpo\n     From: Clara <clara@exemplo.org>\n     Date: Mon, 5 Oct 2026 10:12:00 -0300\n     Web Link: x\n     Thread ID: 19cc00\n'
      : p.name === 'get_gmail_messages_content_batch' ? 'Retrieved 1 messages:\n\n⚠️ Message 19cc01: HttpError 500\n' : 'No messages found';
    return { result: { content: [{ type: 'text', text: texto }] } };
  });
  const { itens } = await email.entrada({});
  rede = null;
  assert.equal(itens.length, 1);
  assert.equal(itens[0].texto, '');
  assert.equal(itens[0].email.lido, false);
  assert.equal(itens[0].destino.id, 'clara@exemplo.org');
});

// ---------------------------------------------------------------- Discord

test('envio: e-mail e WhatsApp validam o anexo de novo (credencial, symlink, compactado) antes de tocar a rede', async () => {
  const env = arquivo('.env', 'SENHA_DO_TESTE=x');
  const zip = arquivo('fotos.zip', 'PK');
  const ok = arquivo('ok.pdf', '%PDF-1.4');
  const link = path.join(dir, 'parece-pdf.pdf');
  fs.symlinkSync(env, link);
  const ferramentas = mcpFalso();
  for (const anexos of [[env], [link], [ok, zip]]) {
    await assert.rejects(email.enviar({ id: 20, canal: 'email', conta: 'tobias@exemplo.com', destino_id: 'a@exemplo.com', assunto: 'x', corpo: 'y', anexos }),
      (e) => /^anexo (recusado|compactado recusado)/.test(e.message) && !e.message.includes('SENHA_DO_TESTE'));
  }
  assert.equal(ferramentas.length, 0, 'nem chamou o Gmail');
  const ponte = [];
  rede = (u) => { ponte.push(u); return { json: { success: true } }; };
  for (const anexos of [[env], [link], [zip]]) {
    await assert.rejects(whatsapp.enviar({ id: 21, canal: 'whatsapp', destino_id: GRUPO, destino_nome: 'Equipe Teste', corpo: 'segue', anexos }),
      (e) => /^anexo (recusado|compactado recusado)/.test(e.message));
  }
  rede = null;
  assert.deepEqual(ponte, [], 'nem chamou a ponte');

  // trocar o anexo por um atalho para uma chave enquanto a ponte trabalha não muda o que ela lê
  const original = arquivo('troca-no-envio.pdf', '%PDF-1.4 conteudo conferido');
  const chave = arquivo('chave-no-envio.txt', '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n');
  let lido = null;
  rede = (url, op) => {
    if (url !== 'http://ponte.teste/api/send') return undefined;
    fs.rmSync(original);
    fs.symlinkSync(chave, original);
    lido = fs.readFileSync(JSON.parse(op.body).media_path, 'utf8');
    return { json: { success: true } };
  };
  await whatsapp.enviar({ id: 22, canal: 'whatsapp', destino_id: GRUPO, destino_nome: 'Equipe Teste', corpo: 'segue', anexos: [original] });
  rede = null;
  assert.equal(lido, '%PDF-1.4 conteudo conferido');
});

test('Discord: as partes da prévia são as mensagens que o bot posta', async () => {
  semearSegredo('DISCORD_BOT_TOKEN', 'token-de-teste');
  const postadas = [];
  rede = (url, op) => {
    if (url.endsWith('/users/@me/guilds')) return { json: [{ id: 'G1', name: 'Farol' }] };
    if (url.endsWith('/guilds/G1/channels')) return { json: [{ id: '111111111111111111', name: 'geral', type: 0, position: 0, parent_id: null, last_message_id: null }] };
    if (url.endsWith('/channels/111111111111111111/messages') && op.method === 'POST') {
      postadas.push(JSON.parse(op.body));
      return { json: { id: `M${postadas.length}` } };
    }
    return undefined;
  };
  const corpo = `${'a'.repeat(1500)}\n\n${'b'.repeat(1500)}\n\n${'c'.repeat(1200)}`;
  const m = { id: 1, canal: 'discord', destino_id: '111111111111111111', destino_nome: '#geral', corpo };
  const p = await discord.previa(m);
  const r = await discord.enviar(m);
  rede = null;
  assert.deepEqual(p.partes, fatiar(corpo, 1990));
  assert.equal(p.partes.length, 3);
  assert.deepEqual(postadas.map((x) => x.content), p.partes);
  assert.ok(postadas.every((x) => x.allowed_mentions.parse.length === 0), 'o bot não marca @everyone');
  assert.deepEqual(p.alvo, { id: '111111111111111111', nome: '#geral', tipo: 'canal', servidor: 'Farol' });
  assert.match(r.resumo, /3 partes/);
  assert.deepEqual((await discord.previa({ ...m, destino_id: 'dm:42', destino_nome: 'Ivo' })).alvo, { id: 'dm:42', nome: 'Ivo', tipo: 'dm' });
});

test('canais ligados: só o WhatsApp até o config.json ligar o e-mail e o Discord', () => {
  const contas = config.email.contas;
  config.email.contas = [];
  assert.deepEqual(Object.keys(canaisLigados()), ['whatsapp']);
  config.email.contas = ['tobias@exemplo.com'];
  assert.deepEqual(Object.keys(canaisLigados()), ['whatsapp', 'email']);
  config.discord.ligado = true;
  assert.deepEqual(Object.keys(canaisLigados()), ['whatsapp', 'email', 'discord']);
  config.discord.ligado = false;
  config.email.contas = contas;
  // sem conta nenhuma o e-mail não tem conta padrão (e não quebra)
  assert.equal(email.contaPadrao, 'tobias@exemplo.com');
});

test('modo prévia: nenhum canal de verdade envia, e nada sai para a rede', async () => {
  const travados = canaisSemEnvio(CANAIS);
  const antes = chamadas.length;
  rede = () => ({ json: { success: true } });
  for (const [id, c] of Object.entries(travados)) {
    await assert.rejects(c.enviar({ id: 1, canal: id, destino_id: 'x', corpo: 'oi' }), /modo prévia: envio desligado/);
    assert.equal(typeof c.contas, 'function', 'o resto do canal continua igual');
  }
  rede = null;
  assert.equal(chamadas.length, antes);
  assert.notEqual(travados.whatsapp.enviar, whatsapp.enviar, 'não mexe no canal original');
});

test('o linter confere o que o canal manda (saida = o mesmo montar do envio): citação automática, menção, assinatura, HTML, anexo e parte', async () => {
  const tok = ['ghp_', 'A1b2'.repeat(9)].join(''); // token do GitHub de mentira, montado em pedaços
  const motivos = (m, dados = {}) => lint(m, { segredos: [], agora: Date.now(), ...dados }).bloqueios.map((b) => b.msg);
  const peloCanal = (m, canal) => motivos(m, { saida: canal.saida(m) });

  // WhatsApp: a citação automática é a última fala da Noemi neste grupo e tem o token; ela vai junto no envio
  const GRUPO2 = '120363000000000002@g.us';
  const db = new Database(path.join(dir, 'messages.db'));
  db.prepare('INSERT INTO chats VALUES (?,?,?)').run(GRUPO2, 'Equipe Dois', quando(1));
  db.prepare('INSERT INTO messages (id, chat_jid, sender, content, timestamp, is_from_me, media_type) VALUES (?,?,?,?,?,?,?)')
    .run('Z1', GRUPO2, NOEMI, `testa com ${tok}`, quando(5), 0, null);
  db.close();
  const zap = { canal: 'whatsapp', conta: 'pessoal', destino_id: GRUPO2, destino_nome: 'Equipe Dois', corpo: 'Noemi, não manda isso no grupo', anexos: [] };
  const saida = whatsapp.saida(zap);
  assert.deepEqual(saida.map((s) => s.onde), ['no texto', 'na citação']);
  assert.equal(saida[1].texto, whatsapp.previa(zap).citar.texto, 'o mesmo montar da prévia e do envio');
  assert.deepEqual(peloCanal(zap, whatsapp), ['parece token do GitHub na citação']);
  assert.deepEqual(motivos(zap), [], 'pelos campos da linha a citação automática não aparece: escaparia');
  // corpo com a menção trocada pelo número e o nome do primeiro anexo (só ele vai)
  const comAnexo = { ...zap, destino_id: GRUPO, corpo: '@Eli segue', anexos: [`/tmp/${tok}.pdf`, '/tmp/b.pdf'] };
  assert.deepEqual(whatsapp.saida(comAnexo).map((s) => [s.onde, s.texto]),
    [['no texto', `@${ELISA} segue`], ['no nome do anexo', `${tok}.pdf`]]);

  // e-mail: a assinatura da conta (config.json) só existe no que sai; HTML é conferido também como aparece
  config.preferencias = path.join(dir, 'config-saida.json');
  fs.writeFileSync(config.preferencias, JSON.stringify({ assinaturas: { 'tobias@exemplo.com': `Tobias\nchave ${tok}` } }));
  const mail = { canal: 'email', conta: 'tobias@exemplo.com', destino_id: 'cliente@exemplo.org', assunto: 'Relatório', corpo: 'segue', extra: { bcc: 'copia@exemplo.org' } };
  assert.deepEqual(email.saida(mail).map((s) => s.onde), ['no assunto', 'no texto (com a assinatura)', 'no destinatário', 'no destinatário']);
  assert.deepEqual(peloCanal(mail, email), ['parece token do GitHub no texto (com a assinatura)']);
  assert.deepEqual(motivos(mail), []);
  fs.writeFileSync(config.preferencias, JSON.stringify({ assinaturas: { 'tobias@exemplo.com': 'Tobias' } }));
  for (const corpo of [`<p>ghp_<b></b>${'A1b2'.repeat(9)}</p>`, `<p>ghp&#95;${'A1b2'.repeat(9)}</p>`]) {
    const html = { ...mail, corpo, extra: { html: true } };
    assert.deepEqual(peloCanal(html, email), ['parece token do GitHub no texto como aparece no e-mail (com a assinatura)'], corpo);
  }
  const anexos = email.saida({ ...mail, anexos: ['/tmp/a.pdf', `/tmp/${tok}.csv`] }).filter((s) => s.nome.startsWith('nome do anexo'));
  assert.deepEqual(anexos.map((s) => [s.onde, s.texto]), [['no nome do anexo 1', 'a.pdf'], ['no nome do anexo 2', `${tok}.csv`]]);

  // Discord: no texto inteiro o token vem colado no "a" (não parece token); o corte dos 1.990 põe ele no começo da parte 2
  const longo = { canal: 'discord', destino_id: '123', corpo: `${'a'.repeat(1990)}${tok}` };
  assert.deepEqual(discord.saida(longo).map((s) => s.onde), ['no texto', 'na parte 1 do Discord', 'na parte 2 do Discord']);
  assert.deepEqual(peloCanal(longo, discord), ['parece token do GitHub na parte 2 do Discord']);
  assert.deepEqual(motivos(longo), []);
});
