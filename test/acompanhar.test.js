// Aba Acompanhar: detector de promessa (frases do dia a dia e falsos positivos), prazo no fuso de São Paulo, "esperando eles"
// com telefone e @lid, "Não preciso", Cobrar (pendente, nunca envia), varredura sem duplicar, API e CLI.
// Banco em memória ou no tmp, ponte falsa, canal que não envia: nada sai de verdade.
process.env.NODE_ENV = 'test';
process.env.TZ = 'UTC'; // o processo em UTC: os prazos têm de sair no horário de São Paulo mesmo assim
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { inspecionarAnexos } from '../src/anexos.js';
import { config } from '../src/config.js';
import { abrirDb } from '../src/db.js';
import { iniciarDespachante } from '../src/despachante.js';
import { lint } from '../src/lint.js';
import { criarApp } from '../src/server.js';
import { whatsapp } from '../src/canais/whatsapp.js';
import { detectarPromessa, esperandoEles, montarLista, rascunhoCobranca, temPergunta, varrerPromessas } from '../src/acompanhar.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-acompanhar-'));
config.preferencias = path.join(dir, 'config.json');
fs.writeFileSync(config.preferencias, JSON.stringify({ janelaDesfazerMs: 0 }));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const H = 3600e3;
const sp = (s) => Date.parse(`${s.replace(' ', 'T')}:00-03:00`); // "2026-10-06 14:00" em São Paulo
const conferir = async (m) => lint(m, { segredos: [], anexos: inspecionarAnexos(m.anexos) });
const cfgTeste = { tickMs: 999999, retentarPorMin: 360 };

// ---------------------------------------------------------------- detector

test('promessa: frases do dia a dia viram promessa, com o trecho e a frase em volta', () => {
  const em = sp('2026-10-06 09:00'); // terça
  const casos = [
    ['Amanhã cedo te mando', 'te mando', 'amanha cedo'],
    ['ok, vou te enviar amanhã a planilha', 'vou te enviar', 'amanha'],
    ['Fechado. Resolvo hoje e te falo.', 'Resolvo', 'hoje'],
    ['Te mando no dia 08 a lista e o prazo de cada item.', 'Te mando', 'dia 08'],
    ['Estou na rua agora, chegando vejo e te retorno', 'te retorno', null],
    ['Vou mandar ele pra vc', 'Vou mandar ele pra vc', null],
    ['Ficam prontas hoje e eu aviso quando publicar.', 'eu aviso', 'hoje'],
    ['Na quinta vejo e separo tudo', 'vejo', 'na quinta'],
    ['Pedi o extrato pra Lara, ela me mandando amanhã já finalizo e te mando', 'te mando', 'amanha'],
  ];
  for (const [texto, trecho, dito] of casos) {
    const p = detectarPromessa(texto, { em });
    assert.ok(p, `deveria achar promessa em: ${texto}`);
    assert.equal(p.trecho, trecho, texto);
    assert.equal(p.prazo_dito, dito, texto);
  }
  // a primeira frase com compromisso, e a frase curta em volta
  const p = detectarPromessa('Bom dia, Otávio! Vi o painel. Te mando o contrato até sexta. Abs', { em });
  assert.deepEqual([p.trecho, p.frase, p.prazo_dito], ['Te mando', 'Te mando o contrato até sexta.', 'ate sexta']);
});

test('promessa: falsos positivos não entram (pergunta, terceira pessoa, citação, substantivo, agora, anexo, condição)', () => {
  const em = sp('2026-10-06 09:00');
  const nao = [
    'o prazo é até sexta',
    'te mando o link?',
    'ele disse que te manda amanhã',
    'Ele falou: "te mando amanhã"',
    '> te mando amanhã\nok, combinado',
    'Aviso rápido: fico fora de segunda 13/04 até sexta 17/04.',
    'Sem retorno, a nota sai amanhã às 9h',
    'O próximo passo a passo fica pra amanhã',
    'Já crio e te mando',
    'te mando agora',
    'calma que te mando o link',
    'segue em anexo, te mando também o resumo',
    'se você quiser te mando amanhã',
    'qualquer coisa me chama aqui e eu vejo a noite',
    'acho que te mando amanhã',
    'não vou te mandar isso hoje',
    'te vejo amanhã!',
    'te mando um abraço',
    'te aviso que amanhã não tem reunião',
    'Vou fazer a troca do plantão de sexta-feira para sábado',
    'Deixei o alarme para tocar hoje ao meio dia, mas vou conferir se tocou',
    'o envio amanhã depende da transportadora',
  ];
  for (const texto of nao) assert.equal(detectarPromessa(texto, { em }), null, `não é promessa: ${texto}`);
  // a mensagem leva o arquivo: "te mando o contrato" é a entrega; com prazo dito, é o resto que vem depois
  assert.equal(detectarPromessa('te mando o contrato', { em, temAnexo: true }), null);
  assert.equal(detectarPromessa('te mando o resto amanhã', { em, temAnexo: true }).prazo_dito, 'amanha');
});

test('prazo: hoje, amanhã, dia da semana, data, semana que vem e sem prazo, no fuso de São Paulo com virada de dia, mês e ano', () => {
  assert.equal(process.env.TZ, 'UTC');
  const prazo = (texto, quando) => detectarPromessa(texto, { em: sp(quando) })?.prazo;
  // depois das 18h, "hoje" vai até 23h59; "amanhã" vira o mês
  assert.equal(prazo('te mando hoje', '2026-10-31 20:00'), sp('2026-10-31 23:59'));
  assert.equal(prazo('te mando hoje', '2026-10-31 09:00'), sp('2026-10-31 18:00'));
  assert.equal(prazo('te mando até o fim do dia', '2026-10-31 09:00'), sp('2026-10-31 18:00'));
  assert.equal(prazo('te mando amanhã', '2026-10-31 20:00'), sp('2026-11-01 18:00'));
  assert.equal(prazo('te mando amanhã cedo', '2026-10-31 20:00'), sp('2026-11-01 10:00'));
  // 23h30 em São Paulo já é o dia seguinte em UTC: amanhã continua sendo o dia seguinte daqui (e vira o ano)
  assert.equal(prazo('te mando amanhã', '2026-12-31 23:30'), sp('2027-01-01 18:00'));
  assert.equal(prazo('te mando de manhã', '2026-10-06 15:00'), sp('2026-10-07 10:00'));
  assert.equal(prazo('te mando de manhã', '2026-10-06 07:00'), sp('2026-10-06 10:00'));
  // dia da semana: o próximo (sexta dita numa sexta é a da semana que vem)
  assert.equal(prazo('te mando na sexta', '2026-10-06 09:00'), sp('2026-10-09 18:00'));
  assert.equal(prazo('te mando na sexta', '2026-10-09 09:00'), sp('2026-10-16 18:00'));
  assert.equal(prazo('te mando segunda-feira', '2026-10-06 09:00'), sp('2026-10-12 18:00'));
  assert.equal(prazo('te mando semana que vem', '2026-10-06 09:00'), sp('2026-10-12 18:00'));
  assert.equal(prazo('te mando até 10/10', '2026-10-06 09:00'), sp('2026-10-10 18:00'));
  assert.equal(prazo('te mando no dia 2', '2026-09-25 09:00'), sp('2026-10-02 18:00'));
  assert.equal(prazo('te mando às 15h', '2026-10-06 09:00'), sp('2026-10-06 18:00'));
  // sem prazo dito: 48 h depois da mensagem
  assert.equal(prazo('te retorno', '2026-10-06 09:00'), sp('2026-10-08 09:00'));
});

test('pergunta: "tudo bem?", link e citação não contam; pergunta de verdade conta', () => {
  assert.equal(temPergunta('Bom dia, tudo bem?'), false);
  assert.equal(temPergunta('Oi! Tudo bem? Conseguiu ver o contrato?'), true);
  assert.equal(temPergunta('segue: https://exemplo.com/a?b=1'), false);
  assert.equal(temPergunta('ele perguntou "quando sai?" e eu respondi'), false);
  assert.equal(temPergunta('Fazemos sim, o que precisa?'), true);
});

test('rascunho da cobrança: curto, com o primeiro nome; grupo e número sem nome', () => {
  const contato = (nome) => ({ destino: { nome, tipo: 'contato' } });
  assert.equal(rascunhoCobranca({ tipo: 'esperando', ...contato('Otávio Ramos Pires') }), 'Oi, Otávio! Conseguiu ver?');
  assert.equal(rascunhoCobranca({ tipo: 'esperando', ...contato('+5511999990001') }), 'Oi! Conseguiu ver?');
  assert.equal(rascunhoCobranca({ tipo: 'esperando', destino: { nome: 'Equipe Aurora', tipo: 'grupo' } }), 'Oi, pessoal! Conseguiram ver?');
  assert.equal(rascunhoCobranca({ tipo: 'promessa', promessa: { trecho: 'te mando' }, ...contato('Valter') }), 'Oi, Valter! Conseguiu mandar?');
  assert.equal(rascunhoCobranca({ tipo: 'promessa', promessa: { trecho: 'te retorno' }, ...contato('Valter') }), 'Oi, Valter! Alguma novidade?');
});

// ---------------------------------------------------------------- ponte falsa

// telefone e @lid da mesma pessoa; o meu número (anotações) nunca entra
const OTAVIO = '5511999990001@s.whatsapp.net';
const OTAVIO_LID = '900000000000001@lid';
const CLARA = '5511999990002@s.whatsapp.net';
const CLARA_LID = '900000000000002@lid';
const PIETRA = '5511999990003@s.whatsapp.net';
const MATEUS = '5511999990004@s.whatsapp.net';
const OLGA = '5511999990005@s.whatsapp.net';
const EU = '5511999990099@s.whatsapp.net';
const EU_LID = '900000000000009@lid';
const GRUPO = '120363000000000001@g.us';
const AGORA = Date.now();
// a ponte grava a hora de São Paulo com o fuso no fim
const ts = (ms) => `${new Date(ms - 3 * H).toISOString().slice(0, 19).replace('T', ' ')}-03:00`;

const arqMsgs = path.join(dir, 'messages.db');
const arqSessao = path.join(dir, 'whatsapp.db');
const ponte = new Database(arqMsgs);
ponte.exec(`CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT, last_message_time TIMESTAMP);
  CREATE TABLE messages (id TEXT, chat_jid TEXT, sender TEXT, content TEXT, timestamp TIMESTAMP, is_from_me BOOLEAN, media_type TEXT,
    PRIMARY KEY (id, chat_jid));`);
const inserir = ponte.prepare('INSERT OR REPLACE INTO messages (id, chat_jid, sender, content, timestamp, is_from_me, media_type) VALUES (?,?,?,?,?,?,?)');
const fala = (id, chat, eu, texto, ms, midia = null) => inserir.run(id, chat, eu ? '' : chat.split('@')[0], texto, ts(ms), eu ? 1 : 0, midia);
{
  const s = new Database(arqSessao);
  s.exec(`CREATE TABLE whatsmeow_device (jid TEXT PRIMARY KEY, lid TEXT);
    CREATE TABLE whatsmeow_lid_map (lid TEXT PRIMARY KEY, pn TEXT UNIQUE NOT NULL);
    CREATE TABLE whatsmeow_contacts (our_jid TEXT, their_jid TEXT, first_name TEXT, full_name TEXT, push_name TEXT, PRIMARY KEY (our_jid, their_jid));`);
  s.prepare('INSERT INTO whatsmeow_device VALUES (?, ?)').run('5511999990099:5@s.whatsapp.net', '900000000000009:5@lid');
  const lid = s.prepare('INSERT INTO whatsmeow_lid_map VALUES (?,?)');
  lid.run('900000000000001', '5511999990001');
  lid.run('900000000000002', '5511999990002');
  lid.run('900000000000009', '5511999990099');
  const agenda = s.prepare("INSERT INTO whatsmeow_contacts VALUES ('eu', ?, ?, ?, ?)");
  for (const [jid, nome] of [[OTAVIO, 'Otávio Ramos'], [CLARA, 'Clara Mendes'], [PIETRA, 'Pietra'], [MATEUS, 'Mateus'], [OLGA, 'Olga']]) agenda.run(jid, nome.split(' ')[0], nome, nome);
  s.close();
}
Object.assign(config.whatsapp, { messagesDb: arqMsgs, sessaoDb: arqSessao, ponte: 'http://ponte.teste' });

// Otávio: pergunta minha há 30 h no telefone; a última dele (no @lid) é de antes
fala('F1', OTAVIO_LID, false, 'oi Tobias, mandei o painel', AGORA - 40 * H);
fala('F2', OTAVIO, true, 'Conseguiu ver o contrato?', AGORA - 30 * H);
fala('F3', OTAVIO, true, 'Abs', AGORA - 30 * H + 60e3);
// Clara respondeu pelo @lid depois da minha pergunta
fala('A1', CLARA, true, 'Fechamos às 15h?', AGORA - 30 * H);
fala('A2', CLARA_LID, false, 'fechado', AGORA - 29 * H);
// Pietra: só "tudo bem?"; Mateus: pergunta de 2 h atrás (ainda no prazo)
fala('B1', PIETRA, true, 'Bom dia, tudo bem?', AGORA - 30 * H);
fala('C1', MATEUS, true, 'Você consegue amanhã?', AGORA - 2 * H);
// eu comigo mesmo, pelo telefone e pelo @lid; grupo; e uma pergunta de 15 dias atrás
fala('E1', EU, true, 'lembrar: ligar pro banco?', AGORA - 30 * H);
fala('E2', EU_LID, true, 'e o boleto?', AGORA - 30 * H);
fala('G1', GRUPO, true, 'Pessoal, alguém viu o relatório?', AGORA - 30 * H);
fala('V1', OLGA, true, 'Olga, recebeu o PDF?', AGORA - 15 * 24 * H);
fala('Z1', '5511999990061@s.whatsapp.net', false, 'ponte gravando', AGORA - 5 * 60e3);

test('esperando eles: pergunta minha sem resposta no prazo, juntando telefone e @lid; fora: respondida, "tudo bem?", no prazo, eu mesmo, grupo e velha', () => {
  const repo = abrirDb(':memory:');
  const r = esperandoEles({ repo, whatsapp }, AGORA);
  assert.equal(r.aviso, null);
  assert.deepEqual(r.itens.map((i) => i.destino.id), [OTAVIO]);
  const [f] = r.itens;
  assert.deepEqual([f.chave, f.destino.nome, f.texto, f.pergunta, f.marcada], [`acompanhar:whatsapp:${OTAVIO}`, 'Otávio Ramos', 'Conseguiu ver o contrato?', true, null]);
  assert.equal(f.em, Date.parse(ts(AGORA - 30 * H + 60e3)), 'a hora é a da minha última (o "Abs")');
  assert.equal(f.prazo, f.em + 24 * H);
  // 30 h depois o Mateus passa do prazo
  assert.deepEqual(esperandoEles({ repo, whatsapp }, AGORA + 30 * H).itens.map((i) => i.destino.id).sort(), [MATEUS, OTAVIO].sort());
  // ponte parada: não diz nada (ela pode ter respondido)
  assert.match(esperandoEles({ repo, whatsapp: { ...whatsapp, minhasRecentes: () => ({ conversas: [], aviso: 'a ponte parou' }) } }, AGORA).aviso, /parou/);
});

test('marcada para acompanhar: vale sem pergunta e em grupo, com as horas dela', () => {
  const repo = abrirDb(':memory:');
  const enviar = (d, horasAtras) => {
    const m = repo.criar({ canal: 'whatsapp', ...d });
    repo.aprovar(m.id);
    repo.marcarEnviando(m.id);
    repo.marcarEnviada(m.id, { resumo: 'ok' });
    repo.db.prepare('UPDATE mensagens SET enviado_em = ? WHERE id = ?').run(AGORA - horasAtras * H, m.id);
    return m.id;
  };
  const g = enviar({ destino_id: GRUPO, destino_nome: 'Equipe Aurora', corpo: 'Segue o relatório de setembro.', acompanhar: true }, 26);
  const d = enviar({ destino_id: OLGA, destino_nome: 'Olga', corpo: 'Olga, segue o PDF da proposta.', acompanhar: '72h' }, 30);
  let itens = esperandoEles({ repo, whatsapp }, AGORA).itens;
  const doGrupo = itens.find((i) => i.destino.id === GRUPO);
  assert.deepEqual([doGrupo.marcada, doGrupo.destino.tipo, doGrupo.pergunta], [{ id: g, horas: 24 }, 'grupo', false]);
  assert.equal(itens.some((i) => i.destino.id === OLGA), false, '72 h ainda não passaram');
  itens = esperandoEles({ repo, whatsapp }, AGORA + 48 * H).itens;
  assert.deepEqual(itens.find((i) => i.destino.id === OLGA).marcada, { id: d, horas: 72 });
  // alguém falou no grupo depois: respondido
  fala('G2', GRUPO, false, 'vi sim', AGORA - 20 * H);
  assert.equal(esperandoEles({ repo, whatsapp }, AGORA).itens.some((i) => i.destino.id === GRUPO), false);
  ponte.prepare("DELETE FROM messages WHERE id = 'G2'").run();
});

test('"Não preciso" some até chegar mensagem nova na conversa', () => {
  const repo = abrirDb(':memory:');
  const lista = () => montarLista({ repo, esperando: esperandoEles({ repo, whatsapp }, AGORA), agora: AGORA });
  const [f] = lista().itens;
  repo.marcarVisto(f.chave, f.em);
  assert.equal(lista().itens.length, 0);
  // o dono pergunta de novo (mensagem nova): volta quando o prazo dela passar
  fala('F4', OTAVIO, true, 'E aí, conseguiu?', AGORA - 25 * H);
  const [volta] = lista().itens;
  assert.deepEqual([volta.chave, volta.texto], [f.chave, 'E aí, conseguiu?']);
  ponte.prepare("DELETE FROM messages WHERE id = 'F4'").run();
});

test('varredura: a Central e a ponte, sem duplicar (de novo, do zero, telefone e @lid, Central e celular); arquivo logo depois não é promessa', () => {
  const repo = abrirDb(':memory:', { agora: () => AGORA });
  // a Central mandou e a ponte gravou a mesma mensagem (no telefone e no @lid)
  const m = repo.criar({ canal: 'whatsapp', destino_id: OTAVIO, destino_nome: 'Otávio Ramos', corpo: 'Otávio, te mando a planilha amanhã.' });
  repo.aprovar(m.id);
  repo.marcarEnviando(m.id);
  repo.marcarEnviada(m.id, { resumo: 'ok' });
  fala('P1', OTAVIO, true, 'Otávio, te mando a planilha amanhã.', AGORA - 60e3);
  fala('P1', OTAVIO_LID, true, 'Otávio, te mando a planilha amanhã.', AGORA - 60e3);
  // promessa da Clara para mim, duas vezes na ponte (telefone e @lid)
  fala('P2', CLARA, false, 'Te envio o contrato até sexta', AGORA - 3 * H);
  fala('P2', CLARA_LID, false, 'Te envio o contrato até sexta', AGORA - 3 * H);
  // "te mando o contrato" e o PDF em seguida: entregou
  fala('P3', MATEUS, true, 'te mando o contrato', AGORA - 2 * H);
  fala('P4', MATEUS, true, '', AGORA - 2 * H + 30e3, 'document');
  // número sem nome na agenda (robô) prometendo: fora
  fala('P5', '5511999990062@s.whatsapp.net', false, 'Vamos te enviar o boleto amanhã', AGORA - 3 * H);
  const r1 = varrerPromessas({ repo, whatsapp }, AGORA + 15 * 60e3);
  const todas = () => repo.db.prepare('SELECT origem, sentido, destino_id, trecho FROM promessas ORDER BY id').all();
  assert.deepEqual(todas(), [
    { origem: 'central', sentido: 'minha', destino_id: OTAVIO, trecho: 'te mando' },
    { origem: 'whatsapp', sentido: 'dele', destino_id: CLARA, trecho: 'Te envio' },
  ]);
  assert.equal(r1.novas, 2);
  assert.equal(varrerPromessas({ repo, whatsapp }, AGORA + 20 * 60e3).novas, 0, 'de novo: nada novo');
  repo.setEstado('acompanhar_ponte_rowid', 0);
  repo.setEstado('acompanhar_central_ate', 0);
  varrerPromessas({ repo, whatsapp }, AGORA + 25 * 60e3);
  assert.equal(todas().length, 2, 'do zero: a chave não duplica');
  // o que chegou há menos de 10 min espera a próxima passada (o arquivo pode vir logo depois)
  fala('P6', OLGA, false, 'Amanhã te mando as fotos', AGORA + 26 * 60e3);
  varrerPromessas({ repo, whatsapp }, AGORA + 30 * 60e3);
  assert.equal(todas().length, 2);
  varrerPromessas({ repo, whatsapp }, AGORA + 40 * 60e3);
  assert.deepEqual(todas().at(-1), { origem: 'whatsapp', sentido: 'dele', destino_id: OLGA, trecho: 'te mando' });
  for (const id of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6']) ponte.prepare('DELETE FROM messages WHERE id = ?').run(id);
});

test('lista: promessa aparece com 12 h para vencer e sai uma semana depois de vencida; ações e o sentido certo', () => {
  const repo = abrirDb(':memory:', { agora: () => AGORA });
  const registrar = (chave, sentido, prazo) => repo.registrarPromessa({
    chave, origem: 'whatsapp', sentido, canal: 'whatsapp', destino_id: OTAVIO, destino_nome: 'Otávio Ramos', trecho: 'te mando', frase: 'te mando amanhã', em: AGORA - H, prazo, prazo_dito: 'amanha',
  });
  const longe = registrar('w:1', 'minha', AGORA + 20 * H);
  const perto = registrar('w:2', 'dele', AGORA + 10 * H);
  const velha = registrar('w:3', 'minha', AGORA - 8 * 24 * H);
  const atrasada = registrar('w:4', 'minha', AGORA - 2 * H);
  const vazio = { itens: [], ultimas: new Map([[OTAVIO, AGORA - 3 * H]]) };
  const lista = (tudo = false) => montarLista({ repo, esperando: vazio, agora: AGORA, tudo });
  assert.deepEqual(lista().itens.map((i) => i.promessa.id), [atrasada.id, perto.id], 'atrasada primeiro; a de 20 h e a de 8 dias ficam fora');
  assert.deepEqual(lista(true).itens.map((i) => i.promessa.id), [velha.id, atrasada.id, perto.id, longe.id]);
  assert.equal(lista().itens[0].minhaUltimaEm, AGORA - 3 * H, 'última mensagem sua para ele');
  assert.deepEqual([lista().itens[0].atrasada, lista().itens[1].atrasada], [true, false]);
  assert.throws(() => repo.fecharPromessa(perto.id, 'cumpri'), /feita a você: use Recebi/);
  assert.throws(() => repo.fecharPromessa(atrasada.id, 'recebi'), /é sua: use Cumpri/);
  assert.equal(repo.adiarPromessa(atrasada.id).prazo, AGORA + 24 * H, 'adiar a atrasada conta de agora');
  assert.equal(repo.fecharPromessa(perto.id, 'recebi').status, 'recebida');
  assert.deepEqual(lista().itens.map((i) => i.promessa.id), []);
  assert.equal(repo.fecharPromessa(perto.id, 'reabrir').status, 'aberta');
  assert.equal(repo.registrarPromessa({ chave: 'w:2', origem: 'whatsapp', sentido: 'dele', canal: 'whatsapp', destino_id: OTAVIO, trecho: 'x', frase: 'x', em: 1, prazo: 1 }), null, 'mesma chave: não grava');
});

test('acompanhar a resposta (--acompanhar): horas, padrão 24, só WhatsApp, PATCH tira e põe sem reabrir, a correção herda', () => {
  const repo = abrirDb(':memory:');
  const daSessao = { sessao_nome: 'S1', origem: { sessao_id: 'A' } };
  assert.equal(repo.criar({ canal: 'whatsapp', destino_id: OTAVIO, corpo: 'a', acompanhar: true }).acompanhar, 24);
  const m = repo.criar({ canal: 'whatsapp', destino_id: CLARA, corpo: 'b', acompanhar: '48h', ...daSessao });
  assert.equal(m.acompanhar, 48);
  assert.equal(repo.eventos(m.id).find((e) => e.tipo === 'acompanhar').detalhe, 'avisa na aba Acompanhar se não responder em 48 h');
  assert.throws(() => repo.criar({ canal: 'email', destino_id: 'f@exemplo.com', assunto: 'oi', corpo: 'c', acompanhar: true }), (e) => e.status === 400 && /só vale para WhatsApp: esta é e-mail/.test(e.message));
  assert.throws(() => repo.criar({ canal: 'whatsapp', destino_id: OTAVIO, corpo: 'd', acompanhar: 0 }), /acompanhar inválido/);
  // a correção da mesma sessão continua acompanhada
  const m2 = repo.criar({ canal: 'whatsapp', destino_id: CLARA, corpo: 'b corrigida', ...daSessao });
  assert.deepEqual([m2.substitui_id, m2.acompanhar], [m.id, 48]);
  repo.aprovar(m2.id);
  // marcar depois de aprovada não devolve para revisão; e vale para a que já saiu
  assert.equal(repo.marcarAcompanhar(m2.id, null).status, 'aprovada');
  repo.marcarEnviando(m2.id);
  repo.marcarEnviada(m2.id, { resumo: 'ok' });
  assert.equal(repo.marcarAcompanhar(m2.id, 12).acompanhar, 12);
});

test('migração: banco sem a coluna acompanhar e sem a tabela de promessas abre sem mexer nas linhas antigas', () => {
  const arq = path.join(dir, 'migracao-acompanhar.db');
  const r1 = abrirDb(arq);
  const m = r1.criar({ canal: 'whatsapp', destino_id: OTAVIO, corpo: 'mensagem antiga' });
  r1.db.exec('DROP TABLE promessas; ALTER TABLE mensagens DROP COLUMN acompanhar;');
  r1.db.close();
  const r2 = abrirDb(arq);
  assert.deepEqual([r2.obter(m.id).acompanhar, r2.obter(m.id).corpo], [null, 'mensagem antiga']);
  assert.deepEqual(r2.promessasAbertas(), []);
  r2.db.close();
  abrirDb(arq).db.close();
});

// ---------------------------------------------------------------- API, despachante e CLI

async function subir(opcoes = {}) {
  const s = http.createServer();
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const porta = s.address().port;
  const app = criarApp({ porta, ...opcoes });
  s.on('request', app);
  const base = `http://127.0.0.1:${porta}`;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: metodo === 'GET' ? {} : { 'content-type': 'application/json', 'x-central': '1' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    return { status: r.status, corpo: await r.json() };
  };
  return {
    app, base,
    get: (c) => chamar('GET', c),
    post: (c, b = {}) => chamar('POST', c, b),
    patch: (c, b) => chamar('PATCH', c, b),
    fechar: () => { app.parar(); s.closeAllConnections(); s.close(); },
  };
}

// a ponte falsa de verdade para ler; o envio é de mentira e só guarda o que "saiu"
function zapQueGuarda() {
  const enviados = [];
  return { enviados, canal: { ...whatsapp, enviar: async (m) => { enviados.push(m.id); return { resumo: 'ok' }; } } };
}

test('API: lista, Cobrar cria pendente (nunca envia, não duplica), Não preciso, ações da promessa e PATCH acompanhar', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = zapQueGuarda();
  const srv = await subir({ repo, canais: { whatsapp: canal } });
  const d = iniciarDespachante({ repo, canais: { whatsapp: canal }, config: cfgTeste, log: () => {}, conferir: srv.app.conferir });
  try {
    let r = await srv.get('/api/acompanhar');
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.contagem, { total: 1, esperando: 1, promessas: 0 });
    const [f] = r.corpo.itens;
    assert.deepEqual([f.tipo, f.destino.id, f.atrasada, f.cobranca], ['esperando', OTAVIO, true, null]);

    r = await srv.post('/api/acompanhar/cobrar', { chave: f.chave });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const cobranca = r.corpo;
    assert.deepEqual([cobranca.status, cobranca.corpo, cobranca.destino_id, cobranca.extra.acompanhar, cobranca.sessao_nome],
      ['pendente', 'Oi, Otávio! Conseguiu ver?', OTAVIO, f.chave, 'painel']);
    await d.tick();
    assert.deepEqual(enviados, [], 'Cobrar nunca envia sozinho');
    assert.equal(repo.obter(cobranca.id).status, 'pendente');
    r = await srv.post('/api/acompanhar/cobrar', { chave: f.chave });
    assert.deepEqual([r.corpo.id, r.corpo.ja], [cobranca.id, true], 'Cobrar de novo devolve a mesma');
    assert.deepEqual((await srv.get('/api/acompanhar')).corpo.itens[0].cobranca, { id: cobranca.id, status: 'pendente' });
    assert.equal((await srv.post('/api/acompanhar/cobrar', { chave: 'acompanhar:whatsapp:999@s.whatsapp.net' })).status, 404);

    // "Não preciso" é o mesmo visto da Entrada
    assert.equal((await srv.post('/api/entrada/visto', { chave: f.chave, em: f.em })).status, 200);
    assert.equal((await srv.get('/api/acompanhar')).corpo.contagem.esperando, 0);

    // promessa feita a mim: Cobrar ("Conseguiu mandar?") e Recebi; a minha: Cumpri, Adiar, e Cobrar recusa
    const dele = repo.registrarPromessa({ chave: 't:1', origem: 'whatsapp', sentido: 'dele', canal: 'whatsapp', destino_id: CLARA, destino_nome: 'Clara Mendes', trecho: 'te mando', frase: 'te mando amanhã', em: AGORA - 30 * H, prazo: AGORA - H, prazo_dito: 'amanha' });
    const minha = repo.registrarPromessa({ chave: 't:2', origem: 'central', sentido: 'minha', canal: 'whatsapp', destino_id: PIETRA, destino_nome: 'Pietra', trecho: 'te retorno', frase: 'te retorno', em: AGORA - 50 * H, prazo: AGORA - 2 * H });
    r = await srv.post('/api/acompanhar/cobrar', { chave: `promessa:${dele.id}` });
    assert.equal(r.corpo.corpo, 'Oi, Clara! Conseguiu mandar?');
    assert.equal(repo.promessa(dele.id).cobranca_id, r.corpo.id);
    assert.match((await srv.post('/api/acompanhar/cobrar', { chave: `promessa:${minha.id}` })).corpo.erro, /promessa sua não se cobra/);
    const adiada = (await srv.post(`/api/promessas/${minha.id}/adiar`)).corpo;
    assert.ok(Math.abs(adiada.prazo - (Date.now() + 24 * H)) < 5000, 'atrasada: adiar dá 1 dia a partir de agora');
    assert.equal((await srv.post(`/api/promessas/${minha.id}/adiar`, { horas: 0 })).status, 400);
    assert.equal((await srv.post(`/api/promessas/${minha.id}/cumpri`)).corpo.status, 'cumprida');
    assert.equal((await srv.post(`/api/promessas/${dele.id}/recebi`)).corpo.status, 'recebida');
    assert.equal((await srv.post(`/api/promessas/${dele.id}/cumpri`)).status, 400);
    assert.equal((await srv.post('/api/promessas/999/dispensar')).status, 404);

    // PATCH acompanhar: só a marca, não reabre; e-mail recusa
    const nova = (await srv.post('/api/mensagens', { canal: 'whatsapp', destino_id: OLGA, destino_nome: 'Olga', corpo: 'Olga, viu a proposta?' })).corpo;
    await srv.post(`/api/mensagens/${nova.id}/aprovar`);
    r = await srv.patch(`/api/mensagens/${nova.id}`, { acompanhar: 48 });
    assert.deepEqual([r.status, r.corpo.status, r.corpo.acompanhar], [200, 'aprovada', 48]);
    r = await srv.patch(`/api/mensagens/${nova.id}`, { acompanhar: null });
    assert.equal(r.corpo.acompanhar, null);
  } finally {
    d.parar();
    srv.fechar();
  }
});

test('despachante: o que a Central acabou de enviar já vira promessa (aoEnviar)', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = zapQueGuarda();
  const srv = await subir({ repo, canais: { whatsapp: canal } });
  const d = iniciarDespachante({ repo, canais: { whatsapp: canal }, config: cfgTeste, log: () => {}, conferir: srv.app.conferir, aoEnviar: srv.app.aoEnviar });
  try {
    const m = repo.criar({ canal: 'whatsapp', destino_id: MATEUS, destino_nome: 'Mateus', corpo: 'Mateus, te mando o orçamento na sexta.' });
    repo.aprovar(m.id);
    await d.tick();
    assert.deepEqual(enviados, [m.id]);
    const [p] = repo.promessasAbertas();
    assert.deepEqual([p.chave, p.sentido, p.trecho, p.prazo_dito, p.mensagem_id], [`central:${m.id}`, 'minha', 'te mando', 'na sexta', m.id]);
  } finally {
    d.parar();
    srv.fechar();
  }
});

const rodar = promisify(execFile);
test('CLI: msg add --acompanhar [horas] e msg acompanhar', async () => {
  const repo = abrirDb(':memory:');
  const { canal } = zapQueGuarda();
  const srv = await subir({ repo, canais: { whatsapp: canal } });
  const cwd = fs.mkdtempSync(path.join(dir, 'cli-'));
  const env = { ...process.env, HOME: dir, CENTRAL_URL: srv.base, CLAUDE_CODE_SESSION_ID: 'sessao-cli', CLAUDE_SESSION_NAME: 'teste da CLI' };
  delete env.CLAUDE_JOB_DIR;
  const msg = (...args) => rodar(process.execPath, [path.join(raiz, 'bin/msg.js'), ...args], { env, cwd }).then((r) => r.stdout);
  try {
    let saida = await msg('add', '-c', 'whatsapp', '-p', OTAVIO, '--acompanhar', '48', '-t', 'Otávio, viu o painel?');
    assert.match(saida, /↳ acompanhando: se não responder em 48 h depois de sair, aparece na aba Acompanhar/);
    saida = await msg('add', '-c', 'whatsapp', '-p', CLARA, '--acompanhar', '-t', 'Clara, viu a proposta?');
    assert.match(saida, /em 24 h/);
    assert.deepEqual(repo.listar({}).map((m) => m.acompanhar).sort(), [24, 48]);
    await assert.rejects(msg('add', '-c', 'whatsapp', '-p', MATEUS, '--acompanhar', '0', '-t', 'Mateus?'), (e) => e.code === 1 && /acompanhar inválido/.test(e.stderr));

    repo.registrarPromessa({ chave: 'c:1', origem: 'whatsapp', sentido: 'dele', canal: 'whatsapp', destino_id: CLARA, destino_nome: 'Clara Mendes', trecho: 'te mando', frase: 'te mando amanhã', em: AGORA - 30 * H, prazo: AGORA - H, prazo_dito: 'amanha' });
    saida = await msg('acompanhar');
    assert.match(saida, /^Esperando resposta \(1\)\n {2}Otávio Ramos · sua última .* · venceu /m);
    assert.match(saida, /Promessas \(1\)\n {2}Clara Mendes → você · "te mando" · venceu .* \(disse "amanha"\)/);
  } finally {
    srv.fechar();
  }
});
