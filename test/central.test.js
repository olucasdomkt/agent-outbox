process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { inspecionarAnexos } from '../src/anexos.js';
import { abrirDb } from '../src/db.js';
import { iniciarDespachante } from '../src/despachante.js';
import { lint } from '../src/lint.js';
import { criarApp } from '../src/server.js';
import { decidir, erroTransitorio, fatiar, parseQuando, pontuar } from '../src/util.js';

// o linter do despachante sem o cofre de verdade (lista vazia = conferido, só os padrões contam)
const conferir = async (m) => lint(m, { segredos: [], anexos: inspecionarAnexos(m.anexos) });

function canalFalso(comportamento = () => ({ resumo: 'ok' })) {
  const enviados = [];
  return {
    enviados,
    canal: {
      id: 'teste', nome: 'Teste', contaPadrao: 'a', contas: () => [{ id: 'a', nome: 'A' }, { id: 'b', nome: 'B' }],
      saude: async () => ({ ok: true, resumo: 'ok' }),
      buscar: () => [{ id: 'g1', nome: 'Grupo Um', tipo: 'grupo' }],
      resolver: (para) => (para === 'Grupo Um' ? { destino: { id: 'g1', nome: 'Grupo Um', tipo: 'grupo' } }
        : { candidatos: [{ id: 'g1', nome: 'Grupo Um' }, { id: 'g2', nome: 'Grupo Dois' }] }),
      async enviar(m) { enviados.push(m); return comportamento(m); },
    },
  };
}
const cfgTeste = { tickMs: 999999, retentarPorMin: 360 };

test('ciclo completo: criar → aprovar → enviar', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = canalFalso();
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', destino_nome: 'Grupo Um', corpo: 'oi' });
  assert.equal(m.status, 'pendente');
  const d = iniciarDespachante({ conferir, repo, canais: { teste: canal }, config: cfgTeste, log: () => {} });
  await d.tick();
  assert.equal(enviados.length, 0, 'pendente não sai sem aprovação');
  repo.aprovar(m.id);
  await d.tick();
  d.parar();
  assert.equal(enviados.length, 1);
  assert.equal(repo.obter(m.id).status, 'enviada');
  assert.deepEqual(repo.eventos(m.id).map((e) => e.tipo), ['criada', 'aprovada', 'enviada']);
});

test('não aprova sem destino e e-mail exige assunto', () => {
  const repo = abrirDb(':memory:');
  const a = repo.criar({ canal: 'teste', para_pedido: 'x', corpo: 'oi' });
  assert.throws(() => repo.aprovar(a.id), /destino/);
  const b = repo.criar({ canal: 'email', destino_id: 'x@exemplo.com', corpo: 'oi' });
  assert.throws(() => repo.aprovar(b.id), /assunto/);
});

test('falha de conexão volta para a fila; falha definitiva vira erro', async () => {
  const repo = abrirDb(':memory:');
  let modo = 'transitorio';
  const { canal } = canalFalso(() => {
    if (modo === 'transitorio') throw erroTransitorio('ponte fora');
    throw new Error('número inválido');
  });
  const d = iniciarDespachante({ conferir, repo, canais: { teste: canal }, config: cfgTeste, log: () => {} });
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  repo.aprovar(m.id);
  await d.tick();
  let atual = repo.obter(m.id);
  assert.equal(atual.status, 'aprovada');
  assert.match(atual.ultimo_erro, /ponte fora/);
  assert.ok(atual.proxima_tentativa > Date.now(), 'espera antes de tentar de novo');
  repo.db.prepare('UPDATE mensagens SET proxima_tentativa = 0 WHERE id = ?').run(m.id);
  modo = 'definitivo';
  await d.tick();
  d.parar();
  atual = repo.obter(m.id);
  assert.equal(atual.status, 'erro');
  assert.match(atual.ultimo_erro, /inválido/);
});

test('pausa geral segura tudo', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = canalFalso();
  const d = iniciarDespachante({ conferir, repo, canais: { teste: canal }, config: cfgTeste, log: () => {} });
  repo.aprovar(repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' }).id);
  repo.setEstado('pausado', true);
  await d.tick();
  assert.equal(enviados.length, 0);
  repo.setEstado('pausado', false);
  await d.tick();
  d.parar();
  assert.equal(enviados.length, 1);
});

test('intervalo anti-ban de um canal não trava os outros canais', async () => {
  const repo = abrirDb(':memory:');
  const lento = canalFalso();
  lento.canal.pausaEntreEnviosMs = () => 60e3;
  const rapido = canalFalso();
  rapido.canal.id = 'rapido';
  const d = iniciarDespachante({ conferir, repo, canais: { teste: lento.canal, rapido: rapido.canal }, config: cfgTeste, log: () => {} });
  repo.aprovar(repo.criar({ canal: 'teste', destino_id: 'g1', corpo: '1' }).id);
  repo.aprovar(repo.criar({ canal: 'teste', destino_id: 'g1', corpo: '2' }).id);
  repo.aprovar(repo.criar({ canal: 'rapido', destino_id: 'g1', corpo: '3' }).id);
  await d.tick();
  await d.tick();
  await d.tick();
  d.parar();
  assert.equal(lento.enviados.length, 1, 'segunda do canal lento espera o intervalo');
  assert.equal(rapido.enviados.length, 1, 'canal rápido não fica preso atrás');
});

test('envio interrompido não é reenviado sozinho', () => {
  const repo = abrirDb(':memory:');
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  repo.aprovar(m.id);
  repo.marcarEnviando(m.id);
  assert.equal(repo.recuperarInterrompidas(), 1);
  assert.equal(repo.obter(m.id).status, 'erro');
});

test('mesma mensagem para o mesmo destino em 30 min não duplica', () => {
  const repo = abrirDb(':memory:');
  const a = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  const b = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  assert.equal(b.id, a.id);
  assert.equal(b.duplicada, true);
  const c = repo.criar({ canal: 'teste', destino_id: 'g2', corpo: 'oi' });
  assert.notEqual(c.id, a.id);
});

test('edição guarda o texto original e só vale antes de aprovar', () => {
  const repo = abrirDb(':memory:');
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  const e = repo.editar(m.id, { corpo: 'olá' });
  assert.equal(e.corpo, 'olá');
  assert.equal(e.corpo_original, 'oi');
  assert.equal(e.editado, true);
  repo.aprovar(m.id);
  assert.throws(() => repo.editar(m.id, { corpo: 'x' }), /aprovada/);
  repo.desaprovar(m.id);
  assert.equal(repo.editar(m.id, { corpo: 'x' }).corpo, 'x');
});

test('util: pontuar, decidir, fatiar, parseQuando', () => {
  assert.equal(pontuar('DIRETORIA TÉCNICA AURORA', 'diretoria tecnica'), 80);
  assert.equal(pontuar('Farol + Duna Projetos', 'duna projetos'), 60);
  assert.equal(pontuar('Raul Antunes', 'otavio'), 0);
  assert.deepEqual(decidir([{ id: 1, nome: 'A', score: 100 }, { id: 2, nome: 'B', score: 60 }]).destino, { id: 1, nome: 'A' });
  assert.equal(decidir([{ id: 1, score: 60 }, { id: 2, score: 60 }]).candidatos.length, 2);
  const partes = fatiar(`${'a'.repeat(1500)}\n\n${'b'.repeat(1500)}`, 2000);
  assert.equal(partes.length, 2);
  assert.equal(parseQuando('+2h', 0), 7200e3);
  assert.equal(parseQuando(''), null);
  assert.throws(() => parseQuando('amanhã cedo'), /não entendi/);
});

async function subir(app) {
  const s = http.createServer(app);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return s;
}

test('servidor: cria resolvendo destino, bloqueia escrita sem cabeçalho e host estranho', async () => {
  const repo = abrirDb(':memory:');
  const { canal } = canalFalso();
  const s = await subir((req, res) => app(req, res));
  const porta = s.address().port;
  const app = criarApp({ repo, canais: { teste: canal }, porta });
  const base = `http://127.0.0.1:${porta}`;
  const post = (caminho, corpo, cab = { 'x-central': '1' }) =>
    fetch(base + caminho, { method: 'POST', headers: { 'content-type': 'application/json', ...cab }, body: JSON.stringify(corpo) });

  let r = await post('/api/mensagens', { canal: 'teste', para: 'Grupo Um', corpo: 'oi', sessao_nome: 'AURORA - Painel' });
  const m = await r.json();
  assert.equal(r.status, 200);
  assert.equal(m.destino_id, 'g1');
  assert.equal(m.sessao_nome, 'AURORA - Painel');

  r = await post('/api/mensagens', { canal: 'teste', para: 'grupo', corpo: 'oi 2' });
  const amb = await r.json();
  assert.equal(amb.destino_id, null);
  assert.equal(amb.candidatos.length, 2, 'ambíguo vira lista para escolher');

  r = await post('/api/mensagens', { canal: 'teste', para: 'Grupo Um', corpo: 'x' }, {});
  assert.equal(r.status, 403, 'sem x-central não escreve');

  r = await post('/api/mensagens', { canal: 'nada', corpo: 'x' });
  assert.equal(r.status, 400);

  r = await post('/api/mensagens', { canal: 'teste', conta: 'zzz', para: 'Grupo Um', corpo: 'x' });
  assert.equal(r.status, 400, 'conta inexistente é recusada');

  const statusHostEstranho = await new Promise((ok, falha) => {
    http.get({ host: '127.0.0.1', port: porta, path: '/api/resumo', headers: { host: 'evil.com' } }, (resp) => {
      resp.resume();
      ok(resp.statusCode);
    }).on('error', falha);
  });
  assert.equal(statusHostEstranho, 403, 'host estranho recusado (DNS rebinding)');

  r = await post(`/api/mensagens/${m.id}/aprovar`, {});
  assert.equal((await r.json()).status, 'aprovada');
  r = await fetch(`${base}/api/resumo`);
  assert.equal((await r.json()).contagens.aprovada, 1);
  s.closeAllConnections();
  s.close();
});

test('anexo: abre só arquivo da lista da mensagem', async () => {
  const fsm = await import('node:fs'); const os = await import('node:os'); const pth = await import('node:path');
  const arq = pth.join(os.tmpdir(), `anexo-teste-${process.pid}.csv`);
  fsm.writeFileSync(arq, 'a,b\n1,2\n');
  const repo = abrirDb(':memory:');
  const { canal } = canalFalso();
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', destino_nome: 'Grupo Um', corpo: 'oi', anexos: [arq] });
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const porta = s.address().port;
  s.on('request', criarApp({ repo, canais: { teste: canal }, porta }));
  const pegar = (caminho) => new Promise((ok) => http.get({ host: '127.0.0.1', port: porta, path: caminho, headers: { host: `127.0.0.1:${porta}` } },
    (resp) => { let b = ''; resp.on('data', (d) => { b += d; }); resp.on('end', () => ok({ status: resp.statusCode, corpo: b, cab: resp.headers })); }));
  const r = await pegar(`/api/mensagens/${m.id}/anexo/0`);
  assert.equal(r.status, 200);
  assert.equal(r.corpo, 'a,b\n1,2\n');
  assert.match(r.cab['content-disposition'], /^inline/);
  assert.match(r.cab['content-security-policy'], /^sandbox/, 'anexo abre isolado, sem script na origem da Central');
  assert.match((await pegar(`/api/mensagens/${m.id}/anexo/0?baixar=1`)).cab['content-disposition'], /^attachment/);
  assert.equal((await pegar(`/api/mensagens/${m.id}/anexo/1`)).status, 404, 'índice fora da lista');
  assert.equal((await pegar(`/api/mensagens/999/anexo/0`)).status, 404);
  s.close(); fsm.unlinkSync(arq);
});

test('etiqueta da aplicação: a que a sessão mandou ou, sem ela, o repo de onde a mensagem veio', async () => {
  const repo = abrirDb(':memory:');
  const { canal } = canalFalso();
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const porta = s.address().port;
  s.on('request', criarApp({ repo, canais: { teste: canal }, porta }));
  const criar = async (corpo) => (await fetch(`http://127.0.0.1:${porta}/api/mensagens`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-central': '1' }, body: JSON.stringify({ canal: 'teste', para: 'Grupo Um', ...corpo }),
  })).json();
  assert.equal((await criar({ corpo: 'um', origem: { repo: 'loja-aurora', dir: '/tmp/loja-aurora' } })).app, 'loja-aurora');
  assert.equal((await criar({ corpo: 'dois', app: 'Loja', origem: { repo: 'loja-aurora' } })).app, 'Loja');
  assert.equal((await criar({ corpo: 'três' })).app, null);
  s.closeAllConnections();
  s.close();
});
