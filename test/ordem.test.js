// Ordem entre mensagens: "sai depois da #N" e "só depois que a pessoa responder" (núcleo, despachante, API, CLI
// e a fonte de respostas da ponte). Banco em memória ou no tmp, canais e ponte falsos: nada sai de verdade.
process.env.NODE_ENV = 'test';
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

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-ordem-'));
// janela de desfazer zero: o despachante pega na hora
config.preferencias = path.join(dir, 'config.json');
fs.writeFileSync(config.preferencias, JSON.stringify({ janelaDesfazerMs: 0 }));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const cfgTeste = { tickMs: 999999, retentarPorMin: 360 };
const conferir = async (m) => lint(m, { segredos: [], anexos: inspecionarAnexos(m.anexos) });
const OTAVIO = '5511999990001@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';

function relogio(inicio = 1_800_000_000_000) {
  let t = inicio;
  return { agora: () => t, andar: (ms) => { t += ms; } };
}

// WhatsApp de mentira: guarda o que "saiu"; falhar(m) decide se o envio dá erro
function zapFalso(falhar = () => null) {
  const enviados = [];
  return {
    enviados,
    canal: {
      id: 'whatsapp', nome: 'WhatsApp', contaPadrao: 'pessoal', contas: () => [{ id: 'pessoal', nome: 'WhatsApp pessoal' }],
      saude: async () => ({ ok: true, resumo: 'ok' }),
      buscar: () => [],
      resolver: (p) => (p === 'Otávio' ? { destino: { id: OTAVIO, nome: 'Otávio Ramos', tipo: 'contato' } } : { destino: { id: p, nome: p, tipo: 'grupo' } }),
      async enviar(m) {
        const e = falhar(m);
        if (e) throw new Error(e);
        enviados.push(m.id);
        return { resumo: 'ok' };
      },
    },
  };
}
const paraOtavio = (corpo, extra = {}) => ({ canal: 'whatsapp', destino_id: OTAVIO, destino_nome: 'Otávio Ramos', corpo, ...extra });
const tipos = (repo, id) => repo.eventos(id).map((e) => e.tipo);
const ultimo = (repo, id, tipo) => repo.eventos(id).filter((e) => e.tipo === tipo).pop()?.detalhe;

// ---------------------------------------------------------------- núcleo e despachante

test('a de depois espera a anterior sair, mesmo aprovada antes; depois sai na ordem', async () => {
  const r = relogio();
  const repo = abrirDb(':memory:', { agora: r.agora });
  const { canal, enviados } = zapFalso();
  const d = iniciarDespachante({ conferir, repo, canais: { whatsapp: canal }, config: cfgTeste, log: () => {}, agora: r.agora });
  const a = repo.criar(paraOtavio('primeiro o painel'));
  const b = repo.criar(paraOtavio('depois a pauta', { depois_de: a.id }));
  assert.deepEqual(b.aguardando, { id: a.id, status: 'pendente', quem: 'Otávio Ramos', motivo: 'anterior' });
  assert.equal(ultimo(repo, b.id, 'marcada'), `sai depois da #${a.id}`);

  // o dono aprova a de depois primeiro: ela fica aprovada, esperando
  repo.aprovar(b.id);
  await d.tick();
  assert.deepEqual(enviados, [], 'a anterior nem foi aprovada');
  assert.equal(repo.marcarEnviando(b.id), false, 'a trava no SQL também segura');
  r.andar(60_000);
  repo.aprovar(a.id);
  await d.tick();
  assert.deepEqual(enviados, [a.id], 'sai a anterior, mesmo a outra aprovada antes');
  assert.equal(repo.obter(b.id).aguardando, null);
  assert.equal(ultimo(repo, b.id, 'liberada'), `a #${a.id} saiu: liberada`);
  await d.tick();
  d.parar();
  assert.deepEqual(enviados, [a.id, b.id]);
});

test('só depois que a pessoa responder: a fonte injetada libera; resposta de antes da saída não conta; vale com a pausa', async () => {
  const r = relogio();
  const repo = abrirDb(':memory:', { agora: r.agora });
  const { canal, enviados } = zapFalso();
  let resposta = null;
  const perguntas = [];
  const respostas = (a) => { perguntas.push(a); return resposta; };
  const d = iniciarDespachante({ conferir, repo, canais: { whatsapp: canal }, config: cfgTeste, log: () => {}, agora: r.agora, respostas });
  const a = repo.criar(paraOtavio('Otávio, posso te ligar às 10h?'));
  const b = repo.criar(paraOtavio('segue a pauta da conversa', { depois_de: `#${a.id}`, espera_resposta: true }));
  assert.equal(ultimo(repo, b.id, 'marcada'), `sai só depois que Otávio responder à #${a.id}`);
  repo.aprovar(a.id);
  repo.aprovar(b.id);
  await d.tick();
  assert.deepEqual(enviados, [a.id]);
  const enviadoEm = repo.obter(a.id).enviado_em;
  assert.equal(repo.obter(b.id).aguardando.motivo, 'resposta');
  assert.equal(ultimo(repo, b.id, 'ordem'), `a #${a.id} saiu; agora espera Otávio responder`);

  resposta = enviadoEm - 60_000; // a última dele é de antes da pergunta
  r.andar(30_000);
  await d.tick();
  assert.deepEqual(enviados, [a.id], 'resposta antiga não libera');
  assert.deepEqual(perguntas.at(-1), { canal: 'whatsapp', destino_id: OTAVIO, enviado_em: enviadoEm }, 'a fonte recebe o destino e a hora da anterior');

  // ele respondeu com os envios pausados: o painel já mostra liberada, mas nada sai até retomar
  repo.setEstado('pausado', true);
  resposta = enviadoEm + 5_000;
  await d.tick();
  assert.equal(repo.obter(b.id).aguardando, null);
  assert.equal(repo.obter(b.id).respondida_em, enviadoEm + 5_000);
  assert.equal(ultimo(repo, b.id, 'liberada'), `Otávio respondeu à #${a.id}: liberada`);
  assert.deepEqual(enviados, [a.id]);
  repo.setEstado('pausado', false);
  await d.tick();
  await d.tick();
  d.parar();
  assert.deepEqual(enviados, [a.id, b.id]);
  assert.equal(tipos(repo, b.id).filter((t) => t === 'liberada').length, 1, 'libera uma vez só');
});

test('versão nova da anterior: a de depois passa a esperar por ela (troca explícita, da mesma sessão e herdada)', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = zapFalso();
  const d = iniciarDespachante({ conferir, repo, canais: { whatsapp: canal }, config: cfgTeste, log: () => {} });
  const daSessao = (corpo, extra = {}) => paraOtavio(corpo, { sessao_nome: 'S1', origem: { sessao_id: 'A' }, ...extra });
  const a = repo.criar(daSessao('X: o painel'));
  // "manda X e depois Y" da mesma sessão: Y não substitui X
  const b = repo.criar(daSessao('Y: a pauta', { depois_de: a.id }));
  assert.equal(b.substitui_id, null);
  assert.equal(repo.obter(a.id).status, 'pendente');

  const a2 = repo.criar(daSessao('X corrigido', { substitui_id: a.id }));
  assert.equal(repo.obter(a.id).status, 'substituida');
  assert.equal(repo.obter(b.id).depois_de, a2.id);
  assert.equal(ultimo(repo, b.id, 'ordem'), `a #${a.id} ganhou versão nova (#${a2.id}): esta sai depois dela`);
  // a sessão manda X de novo sem --substitui: troca a última dela para o Otávio (a #a2), e Y segue junto
  const a3 = repo.criar(daSessao('X corrigido de novo'));
  assert.equal(a3.substitui_id, a2.id);
  assert.equal(repo.obter(b.id).depois_de, a3.id);
  // Y corrigido com o mesmo --depois (pela #a, que já ganhou versões): troca Y, não o X
  const b2 = repo.criar(daSessao('Y corrigido', { depois_de: a.id }));
  assert.equal(b2.substitui_id, b.id);
  assert.equal(b2.depois_de, a3.id, 'a anterior pedida vira a versão viva');
  assert.equal(repo.obter(a3.id).status, 'pendente');
  // versão nova sem --depois mantém o lugar na sequência
  const b3 = repo.criar(daSessao('Y, versão 3', { substitui_id: b2.id }));
  assert.equal(b3.depois_de, a3.id);
  assert.equal(ultimo(repo, b3.id, 'ordem'), `mantém a sequência da #${b2.id}: sai depois da #${a3.id}`);
  // a versão nova não pode sair depois da versão que ela substitui
  assert.throws(() => repo.criar(daSessao('X de novo', { substitui_id: a3.id, depois_de: a3.id })), (e) => e.status === 400 && /si mesma/.test(e.message));
  // nem de quem espera por ela (fecharia um ciclo)
  assert.throws(() => repo.criar(daSessao('X outra vez', { substitui_id: a3.id, depois_de: b3.id })), (e) => e.status === 400 && /uma pela outra/.test(e.message));

  // a de depois que estava descartada também acompanha: restaurada, espera a versão viva
  const c = repo.criar(paraOtavio('Z: a proposta', { depois_de: a3.id }));
  repo.descartar(c.id);
  const a4 = repo.criar(daSessao('X, versão 4', { substitui_id: a3.id }));
  repo.restaurar(c.id);
  assert.deepEqual([repo.obter(c.id).depois_de, repo.obter(c.id).aguardando.motivo], [a4.id, 'anterior']);

  repo.aprovar(b3.id);
  repo.aprovar(a4.id);
  await d.tick();
  await d.tick();
  d.parar();
  assert.deepEqual(enviados, [a4.id, b3.id]);
});

test('anterior descartada ou com erro: a de depois fica bloqueada e nunca sai sozinha; tentar de novo e restaurar voltam a esperar', async () => {
  const r = relogio();
  const repo = abrirDb(':memory:', { agora: r.agora });
  const { canal, enviados } = zapFalso((m) => (m.corpo.startsWith('quebra') ? 'número sem WhatsApp' : null));
  const d = iniciarDespachante({ conferir, repo, canais: { whatsapp: canal }, config: cfgTeste, log: () => {}, agora: r.agora });
  const a = repo.criar(paraOtavio('a anterior'));
  const b = repo.criar(paraOtavio('a de depois', { depois_de: a.id }));
  repo.aprovar(b.id);
  repo.descartar(a.id, 'mudou o plano', 'desatualizada');
  assert.deepEqual(repo.obter(b.id).aguardando, { id: a.id, status: 'descartada', quem: 'Otávio Ramos', motivo: 'bloqueada' });
  assert.equal(ultimo(repo, b.id, 'bloqueada'), `a #${a.id} foi descartada; esta esperava por ela`);
  for (let i = 0; i < 5; i++) { r.andar(3_600e3); await d.tick(); }
  assert.deepEqual(enviados, [], 'bloqueada não sai, nem horas depois');
  assert.equal(repo.obter(b.id).status, 'aprovada');
  repo.restaurar(a.id);
  assert.equal(repo.obter(b.id).aguardando.motivo, 'anterior', 'restaurada, volta a esperar a anterior');

  // erro definitivo bloqueia do mesmo jeito; "tentar de novo" volta a esperar
  const c = repo.criar(paraOtavio('quebra: número errado'));
  const e = repo.criar(paraOtavio('depende da que quebra', { depois_de: c.id }));
  repo.aprovar(c.id);
  repo.aprovar(e.id);
  await d.tick();
  assert.equal(repo.obter(c.id).status, 'erro');
  assert.equal(repo.obter(e.id).aguardando.motivo, 'bloqueada');
  assert.equal(repo.obter(e.id).aguardando.status, 'erro');
  assert.equal(ultimo(repo, e.id, 'bloqueada'), `a #${c.id} deu erro; esta esperava por ela`);
  await d.tick();
  assert.deepEqual(enviados, []);
  const antes = repo.obter(e.id).atualizado_em;
  repo.editar(c.id, { corpo: 'número certo agora' });
  repo.aprovar(c.id);
  assert.ok(repo.obter(e.id).atualizado_em > antes, 'quem espera muda de versão (o painel relê o estado)');
  assert.equal(repo.obter(e.id).aguardando.motivo, 'anterior');
  await d.tick();
  await d.tick();
  d.parar();
  assert.deepEqual(enviados, [c.id, e.id]);
});

test('soltar: tira a ordem, fica no histórico e a aprovada sai', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = zapFalso();
  const d = iniciarDespachante({ conferir, repo, canais: { whatsapp: canal }, config: cfgTeste, log: () => {} });
  const a = repo.criar(paraOtavio('a anterior'));
  const b = repo.criar(paraOtavio('a de depois', { depois_de: a.id, espera_resposta: true }));
  repo.aprovar(b.id);
  repo.descartar(a.id);
  await d.tick();
  assert.deepEqual(enviados, []);
  const solta = repo.definirDepois(b.id, { depois_de: null });
  assert.equal(solta.status, 'aprovada', 'soltar não devolve para revisão');
  assert.deepEqual([solta.depois_de, solta.espera_resposta, solta.aguardando], [null, 0, null]);
  assert.equal(ultimo(repo, b.id, 'solta'), `saiu da sequência: não espera mais a #${a.id}`);
  assert.equal(repo.definirDepois(b.id, { depois_de: null }).id, b.id, 'soltar de novo não é erro');
  assert.equal(tipos(repo, b.id).filter((t) => t === 'solta').length, 1);
  await d.tick();
  d.parar();
  assert.deepEqual(enviados, [b.id]);
});

test('validação: não existe, a própria, ciclo (direto e indireto), descartada, e esperar resposta fora de conversa direta', () => {
  const repo = abrirDb(':memory:');
  const a = repo.criar(paraOtavio('a'));
  const b = repo.criar(paraOtavio('b', { depois_de: a.id }));
  const c = repo.criar(paraOtavio('c', { depois_de: b.id }));
  const recusa = (fn, status, re) => assert.throws(fn, (e) => e.status === status && re.test(e.message), String(re));
  recusa(() => repo.definirDepois(a.id, { depois_de: a.id }), 400, /não sai depois de si mesma \(#\d+\)/);
  recusa(() => repo.definirDepois(a.id, { depois_de: b.id }), 400, new RegExp(`a #${b.id} já sai depois da #${a.id}`));
  recusa(() => repo.definirDepois(a.id, { depois_de: c.id }), 400, /ficariam esperando uma pela outra/);
  recusa(() => repo.definirDepois(a.id, { depois_de: 9999 }), 404, /a #9999 \(a anterior\) não existe/);
  recusa(() => repo.definirDepois(a.id, { depois_de: 'amanhã' }), 400, /depois_de inválido/);
  recusa(() => repo.criar(paraOtavio('sem anterior', { depois_de: 9999 })), 404, /não existe/);
  const x = repo.criar(paraOtavio('descartada'));
  repo.descartar(x.id);
  recusa(() => repo.definirDepois(a.id, { depois_de: x.id }), 400, /foi descartada/);
  recusa(() => repo.criar(paraOtavio('depois da descartada', { depois_de: x.id })), 400, /foi descartada/);
  // esperar resposta: só WhatsApp em conversa direta, e precisa de uma anterior
  const g = repo.criar({ canal: 'whatsapp', destino_id: GRUPO, destino_nome: 'Equipe Aurora', corpo: 'no grupo' });
  const em = repo.criar({ canal: 'email', destino_id: 'f@exemplo.com', assunto: 'oi', corpo: 'por e-mail' });
  const sem = repo.criar({ canal: 'whatsapp', para_pedido: 'Valter', corpo: 'sem destino' });
  recusa(() => repo.definirDepois(a.id, { depois_de: g.id, espera_resposta: true }), 400, /conversa direta: a #\d+ vai para um grupo \(Equipe Aurora\)/);
  recusa(() => repo.definirDepois(a.id, { depois_de: em.id, espera_resposta: true }), 400, /a #\d+ é e-mail/);
  recusa(() => repo.definirDepois(a.id, { depois_de: sem.id, espera_resposta: true }), 400, /ainda não tem destino/);
  recusa(() => repo.definirDepois(a.id, { espera_resposta: true }), 400, /precisa de uma anterior/);
  recusa(() => repo.criar(paraOtavio('só espera', { espera_resposta: true })), 400, /precisa de uma anterior/);
  // sem esperar resposta, qualquer canal serve; e quem já saiu não muda de ordem
  assert.equal(repo.definirDepois(a.id, { depois_de: g.id }).depois_de, g.id);
  repo.aprovar(em.id);
  repo.marcarEnviando(em.id);
  repo.marcarEnviada(em.id, { resumo: 'ok' });
  recusa(() => repo.definirDepois(em.id, { depois_de: a.id }), 409, /enviada/);
  // anterior que já saiu: a ordem vale e já está liberada
  const z = repo.definirDepois(b.id, { depois_de: em.id });
  assert.equal(z.aguardando, null);
  assert.equal(ultimo(repo, b.id, 'marcada'), `sai depois da #${em.id} (a #${em.id} já saiu: está liberada)`);
});

test('migração: banco sem as colunas da ordem ganha elas sem mexer nas linhas antigas', () => {
  const arq = path.join(dir, 'migracao-ordem.db');
  const r1 = abrirDb(arq);
  const m = r1.criar(paraOtavio('mensagem antiga'));
  r1.db.exec(`DROP INDEX idx_msg_depois; ALTER TABLE mensagens DROP COLUMN depois_de;
    ALTER TABLE mensagens DROP COLUMN espera_resposta; ALTER TABLE mensagens DROP COLUMN respondida_em;`);
  r1.db.close();
  const r2 = abrirDb(arq);
  const velha = r2.obter(m.id);
  assert.deepEqual([velha.depois_de, velha.espera_resposta, velha.respondida_em, velha.aguardando, velha.corpo], [null, 0, null, null, 'mensagem antiga']);
  const nova = r2.criar(paraOtavio('nova', { depois_de: m.id }));
  assert.equal(nova.aguardando.motivo, 'anterior');
  r2.db.close();
  abrirDb(arq).db.close(); // de novo: nada a criar, nada quebra
});

// ---------------------------------------------------------------- API

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
    put: (c, b) => chamar('PUT', c, b),
    patch: (c, b) => chamar('PATCH', c, b),
    fechar: () => { app.parar(); s.closeAllConnections(); s.close(); },
  };
}

test('API: POST e PUT/PATCH aceitam a ordem, null solta; lista e detalhe trazem aguardando; erros claros; lote na ordem certa', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = zapFalso();
  const srv = await subir({ repo, canais: { whatsapp: canal } });
  const d = iniciarDespachante({ repo, canais: { whatsapp: canal }, config: cfgTeste, log: () => {}, conferir: srv.app.conferir });
  try {
    const criar = async (corpo, extra = {}) => {
      const r = await srv.post('/api/mensagens', { canal: 'whatsapp', para: 'Otávio', corpo, ...extra });
      assert.equal(r.status, 200, JSON.stringify(r.corpo));
      return r.corpo;
    };
    const a = await criar('Otávio, segue o painel.');
    const b = await criar('E aqui a pauta.', { depois_de: a.id, espera_resposta: true });
    assert.deepEqual([b.depois_de, b.espera_resposta, b.aguardando.motivo, b.aguardando.id], [a.id, 1, 'anterior', a.id]);
    const lista = (await srv.get('/api/mensagens?status=pendente')).corpo;
    assert.deepEqual(lista.find((m) => m.id === b.id).aguardando, { id: a.id, status: 'pendente', quem: 'Otávio Ramos', motivo: 'anterior' });
    assert.equal(lista.find((m) => m.id === a.id).aguardando, null);
    assert.ok((await srv.get(`/api/mensagens/${b.id}`)).corpo.eventos.some((e) => e.tipo === 'marcada'));

    // PUT solta, PATCH marca de novo (os dois são a mesma rota); só a ordem não reabre a aprovada
    let r = await srv.put(`/api/mensagens/${b.id}`, { depois_de: null });
    assert.deepEqual([r.status, r.corpo.depois_de, r.corpo.espera_resposta, r.corpo.aguardando], [200, null, 0, null]);
    assert.equal((await srv.post(`/api/mensagens/${b.id}/aprovar`)).corpo.status, 'aprovada');
    r = await srv.patch(`/api/mensagens/${b.id}`, { depois_de: `#${a.id}` });
    assert.deepEqual([r.status, r.corpo.status, r.corpo.depois_de, r.corpo.espera_resposta], [200, 'aprovada', a.id, 0]);
    r = await srv.put(`/api/mensagens/${b.id}`, { espera_resposta: true });
    assert.deepEqual([r.corpo.depois_de, r.corpo.espera_resposta], [a.id, 1], 'só espera_resposta mantém a anterior');

    // erros: ciclo, a própria, não existe, grupo, sem anterior, já enviada
    const erro = async (p, status, re) => {
      assert.equal(p.status, status, JSON.stringify(p.corpo));
      assert.match(p.corpo.erro, re);
    };
    await erro(await srv.put(`/api/mensagens/${a.id}`, { depois_de: b.id }), 400, /^as duas ficariam esperando uma pela outra/);
    await erro(await srv.put(`/api/mensagens/${a.id}`, { depois_de: a.id }), 400, /si mesma/);
    await erro(await srv.put(`/api/mensagens/${a.id}`, { depois_de: 777 }), 404, /a #777 \(a anterior\) não existe/);
    await erro(await srv.post('/api/mensagens', { canal: 'whatsapp', para: 'Otávio', corpo: 'sem anterior', espera_resposta: true }), 400, /precisa de uma anterior/);
    const g = await criar('para o grupo', { para: GRUPO });
    await erro(await srv.post('/api/mensagens', { canal: 'whatsapp', para: 'Otávio', corpo: 'depois do grupo', depois_de: g.id, espera_resposta: true }), 400,
      /só vale para WhatsApp em conversa direta: a #\d+ vai para um grupo/);
    assert.equal(repo.contagens().pendente, 2, 'a recusada não foi criada');

    // aprovar em lote, na ordem errada: o despachante manda a anterior primeiro e segura a outra até ela sair
    assert.equal((await srv.post(`/api/mensagens/${b.id}/desfazer`)).corpo.status, 'pendente');
    r = await srv.post('/api/lote', { acao: 'aprovar', ids: [b.id, a.id] });
    assert.ok(r.corpo.resultados.every((x) => x.ok));
    await d.tick();
    await d.tick();
    assert.deepEqual(enviados, [a.id], 'a de depois espera a resposta do Otávio');
    assert.equal((await srv.get(`/api/mensagens/${b.id}`)).corpo.aguardando.motivo, 'resposta');
    await erro(await srv.put(`/api/mensagens/${a.id}`, { depois_de: null }), 409, /enviada/);
  } finally {
    d.parar();
    srv.fechar();
  }
});

// ---------------------------------------------------------------- CLI

const rodar = promisify(execFile);
test('CLI: msg add --depois e --depois-da-resposta, msg depois (marcar, --resposta, --solta) e msg list mostram a ordem', async () => {
  const repo = abrirDb(':memory:');
  const { canal } = zapFalso();
  const srv = await subir({ repo, canais: { whatsapp: canal } });
  const cwd = fs.mkdtempSync(path.join(dir, 'cli-'));
  // mesma sessão do Claude em todas: o "substitui sozinho" não pode trocar X por Y
  const env = { ...process.env, HOME: dir, CENTRAL_URL: srv.base, CLAUDE_CODE_SESSION_ID: 'sessao-cli', CLAUDE_SESSION_NAME: 'teste da CLI' };
  delete env.CLAUDE_JOB_DIR;
  const msg = (...args) => rodar(process.execPath, [path.join(raiz, 'bin/msg.js'), ...args], { env, cwd }).then((r) => r.stdout);
  const idDe = (saida) => Number(saida.match(/✓ #(\d+)/)[1]);
  try {
    const x = idDe(await msg('add', '-c', 'whatsapp', '-p', 'Otávio', '-t', 'Primeiro o painel.'));
    let saida = await msg('add', '-c', 'whatsapp', '-p', 'Otávio', '--depois', `#${x}`, '-t', 'Depois a pauta.');
    const y = idDe(saida);
    assert.match(saida, new RegExp(`↳ depois da #${x}\\n`));
    assert.doesNotMatch(saida, /substituiu/);
    saida = await msg('add', '-c', 'whatsapp', '-p', 'Otávio', '--depois-da-resposta', String(y), '-t', 'Por último, a consultoria.');
    const z = idDe(saida);
    assert.match(saida, new RegExp(`↳ depois da #${y} e da resposta de Otávio Ramos`));
    assert.deepEqual([x, y, z].map((i) => repo.obter(i).status), ['pendente', 'pendente', 'pendente']);

    saida = await msg('depois', String(z), String(x), '--resposta');
    assert.match(saida, new RegExp(`^✓ #${z} \\[pendente\\] whatsapp/pessoal → Otávio Ramos · depois da #${x} e da resposta de Otávio Ramos`));
    saida = await msg('list');
    assert.match(saida, new RegExp(`#${y} \\[pendente\\] .* · depois da #${x}`));
    saida = await msg('depois', String(z), '--solta');
    assert.equal(saida.trim(), `✓ #${z} [pendente] whatsapp/pessoal → Otávio Ramos`);
    repo.descartar(x);
    assert.match(await msg('status', String(y)), new RegExp(`BLOQUEADA: a #${x} foi descartada; o dono solta ou descarta`));

    // erro da Central chega claro, com código de saída
    await assert.rejects(msg('depois', String(y), String(y)), (e) => e.code === 1 && /Central recusou: uma mensagem não sai depois de si mesma/.test(e.stderr));
    await assert.rejects(msg('depois', String(y)), (e) => e.code === 1 && /uso: msg depois/.test(e.stderr));
    await assert.rejects(msg('add', '-c', 'whatsapp', '-p', 'Otávio', '--depois', '1', '--depois-da-resposta', '2', '-t', 'x'), (e) => /não os dois/.test(e.stderr));
  } finally {
    srv.fechar();
  }
});

// ---------------------------------------------------------------- fonte da ponte (só leitura)

test('ponte: a última mensagem recebida na conversa direta, pelo telefone ou pelo @lid; minha e de grupo não contam', () => {
  const quando = (s) => `2026-10-06 ${s}-03:00`;
  const msgs = new Database(path.join(dir, 'messages.db'));
  msgs.exec(`CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT, last_message_time TIMESTAMP);
    CREATE TABLE messages (id TEXT, chat_jid TEXT, sender TEXT, content TEXT, timestamp TIMESTAMP, is_from_me BOOLEAN, media_type TEXT,
      PRIMARY KEY (id, chat_jid));`);
  const ins = msgs.prepare('INSERT INTO messages (id, chat_jid, sender, content, timestamp, is_from_me, media_type) VALUES (?,?,?,?,?,?,?)');
  ins.run('F1', '5511999990001@s.whatsapp.net', '5511999990001', 'bom dia', quando('09:00:00'), 0, null);
  ins.run('EU', '5511999990001@s.whatsapp.net', '', 'posso ligar às 10h?', quando('09:30:00'), 1, null);
  ins.run('F2', '900000000000001@lid', '900000000000001', '', quando('09:41:07'), 0, 'audio'); // respondeu por áudio, no @lid
  ins.run('G1', GRUPO, '5511999990001', 'no grupo', quando('11:00:00'), 0, null);
  msgs.close();
  const sessao = new Database(path.join(dir, 'whatsapp.db'));
  sessao.exec('CREATE TABLE whatsmeow_lid_map (lid TEXT PRIMARY KEY, pn TEXT UNIQUE NOT NULL);');
  sessao.prepare('INSERT INTO whatsmeow_lid_map VALUES (?,?)').run('900000000000001', '5511999990001');
  sessao.close();
  Object.assign(config.whatsapp, { messagesDb: path.join(dir, 'messages.db'), sessaoDb: path.join(dir, 'whatsapp.db') });

  const audio = Date.parse('2026-10-06T09:41:07-03:00');
  assert.equal(whatsapp.ultimaRecebida(OTAVIO), audio, 'achou a do @lid pelo telefone');
  assert.equal(whatsapp.ultimaRecebida('900000000000001@lid'), audio);
  assert.equal(whatsapp.ultimaRecebida(GRUPO), null, 'grupo não é conversa direta');
  assert.equal(whatsapp.ultimaRecebida('5511999990063@s.whatsapp.net'), null);

  // de ponta a ponta no repo: a pergunta saiu às 09:30, o áudio das 09:41 libera
  const repo = abrirDb(':memory:');
  const a = repo.criar(paraOtavio('posso ligar às 10h?'));
  const b = repo.criar(paraOtavio('segue a pauta', { depois_de: a.id, espera_resposta: true }));
  repo.aprovar(a.id);
  repo.marcarEnviando(a.id);
  repo.marcarEnviada(a.id, { resumo: 'ok' });
  repo.db.prepare('UPDATE mensagens SET enviado_em = ? WHERE id = ?').run(Date.parse('2026-10-06T09:30:00-03:00'), a.id);
  const fonte = (x) => (x.canal === 'whatsapp' ? whatsapp.ultimaRecebida(x.destino_id) : null);
  assert.deepEqual(repo.conferirRespostas(fonte), [b.id]);
  assert.equal(repo.obter(b.id).respondida_em, audio);
  assert.deepEqual(repo.conferirRespostas(fonte), [], 'uma vez só');
});
