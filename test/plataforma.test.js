// Plataforma pela API (HTTP de verdade, banco em memória ou no tmp, canal falso): a trava do linter em todo
// caminho até o envio, falha fechado, corrida de versão, lote, anexo durável, config, pessoas e versões,
// tempo real (SSE), estático com CSP e modo prévia. Nenhum teste toca o banco, o cofre ou o config.json reais.
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { abrirDb } from '../src/db.js';
import { iniciarDespachante } from '../src/despachante.js';
import { CABECALHOS_SEGUROS, checarModo, criarApp } from '../src/server.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-plataforma-'));
// preferências num config.json do teste, com janela de desfazer zero (o despachante pega na hora)
config.preferencias = path.join(dir, 'config.json');
fs.writeFileSync(config.preferencias, JSON.stringify({ janelaDesfazerMs: 0 }));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const SEG = `ghp_${'A1b2'.repeat(9)}`; // token do GitHub de mentira
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%'), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]), Buffer.from('\n1 0 obj\n<<>>\nendobj\n')]);
const arquivo = (nome, conteudo) => {
  const p = path.join(dir, nome);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, conteudo);
  return p;
};
const esperar = async (cond, ms = 3000) => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((ok) => setTimeout(ok, 10));
  return cond();
};

function canalFalso() {
  const enviados = [];
  return {
    enviados,
    canal: {
      id: 'teste', nome: 'Teste', contaPadrao: 'a', contas: () => [{ id: 'a', nome: 'A' }],
      saude: async () => ({ ok: true, resumo: 'ok' }),
      buscar: () => [],
      resolver: (p) => ({ destino: { id: p, nome: p, tipo: 'grupo' } }),
      async enviar(m) { enviados.push(m); return { resumo: 'ok' }; },
    },
  };
}

async function subir(opcoes = {}) {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const porta = s.address().port;
  const app = criarApp({ porta, canais: { teste: canalFalso().canal }, ...opcoes });
  s.on('request', app);
  const base = `http://127.0.0.1:${porta}`;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: metodo === 'GET' ? {} : { 'content-type': 'application/json', 'x-central': '1' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      redirect: 'manual',
    });
    const texto = await r.text();
    let j = texto;
    try { j = JSON.parse(texto); } catch { /* html ou texto */ }
    return { status: r.status, corpo: j, cab: r.headers };
  };
  return {
    app, porta, base,
    get: (c) => chamar('GET', c),
    post: (c, b = {}) => chamar('POST', c, b),
    patch: (c, b) => chamar('PATCH', c, b),
    put: (c, b) => chamar('PUT', c, b),
    fechar: () => { app.parar(); s.closeAllConnections(); s.close(); },
  };
}
const criar = async (srv, corpo, extra = {}) => {
  const r = await srv.post('/api/mensagens', { canal: 'teste', destino_id: 'g1', destino_nome: 'Grupo', corpo, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  return r.corpo;
};

// ---------------------------------------------------------------- trava do linter

test('aprovar: 422 com o motivo e sem o segredo; nenhum parâmetro pula a trava; o linter lê o corpo do banco', async () => {
  const repo = abrirDb(':memory:');
  const srv = await subir({ repo });
  try {
    const m = await criar(srv, `a chave é ${SEG}`);
    assert.ok(m.lint.bloqueios.some((b) => b.regra === 'segredo'), 'o linter roda já na criação');
    const truques = [{}, { forcar: true }, { ignorar_lint: true }, { lint: { bloqueios: [], avisos: [] } }, { corpo: 'texto limpo' },
      { force: 1, skip_lint: true, bloqueios: [] }];
    for (const truque of truques) {
      const r = await srv.post(`/api/mensagens/${m.id}/aprovar`, truque);
      assert.equal(r.status, 422, JSON.stringify(truque));
      assert.equal(r.corpo.erro, 'bloqueada');
      assert.ok(r.corpo.bloqueios.some((b) => b.msg === 'parece token do GitHub no texto'));
      assert.ok(!JSON.stringify(r.corpo).includes(SEG.slice(4)), 'o valor nunca volta na resposta');
    }
    assert.equal(repo.obter(m.id).status, 'pendente');
    assert.equal(repo.obter(m.id).corpo, `a chave é ${SEG}`, 'o corpo do pedido de aprovar não troca o texto');
  } finally {
    srv.fechar();
  }
});

test('todo caminho até o envio passa pelo linter: lote, PATCH de aprovada, erro, restaurar, agendar e o despachante', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = canalFalso();
  const srv = await subir({ repo, canais: { teste: canal } });
  const desp = iniciarDespachante({ repo, canais: { teste: canal }, config: { tickMs: 999999, retentarPorMin: 360 }, log: () => {}, conferir: srv.app.conferir });
  try {
    const sujo = await criar(srv, `token: ${SEG}`);
    const limpo = await criar(srv, 'oi, tudo certo por aí?');
    // lote
    let r = await srv.post('/api/lote', { acao: 'aprovar', ids: [sujo.id, limpo.id, 9999] });
    assert.deepEqual(r.corpo.resultados.map((x) => [x.id, x.ok, x.status ?? x.erro]),
      [[sujo.id, false, 'bloqueada'], [limpo.id, true, 'aprovada'], [9999, false, 'mensagem #9999 não existe']]);
    assert.ok(r.corpo.resultados[0].bloqueios.some((b) => b.regra === 'segredo'));
    // PATCH numa aprovada volta para revisão e o linter confere o texto novo
    r = await srv.patch(`/api/mensagens/${limpo.id}`, { corpo: `segue o acesso: ${SEG}` });
    assert.equal(r.corpo.status, 'pendente');
    assert.ok(r.corpo.lint.bloqueios.some((b) => b.regra === 'segredo'));
    assert.equal((await srv.post(`/api/mensagens/${limpo.id}/aprovar`)).status, 422);
    // "tentar de novo" de uma que deu erro passa pelo mesmo aprovar
    repo.db.prepare("UPDATE mensagens SET status = 'erro' WHERE id = ?").run(sujo.id);
    assert.equal((await srv.post(`/api/mensagens/${sujo.id}/aprovar`)).status, 422);
    // restaurar uma descartada devolve para revisão com o linter rodado
    assert.equal((await srv.post(`/api/mensagens/${sujo.id}/descartar`, { motivo_codigo: 'outro' })).status, 200);
    r = await srv.post(`/api/mensagens/${sujo.id}/restaurar`);
    assert.equal(r.corpo.status, 'pendente');
    assert.ok(r.corpo.lint.bloqueios.some((b) => b.regra === 'segredo'));
    assert.equal((await srv.post(`/api/mensagens/${sujo.id}/aprovar`)).status, 422);
    // agendar só grava o horário (não aprova); a aprovada adulterada direto no banco é barrada na hora de enviar
    const ok = await criar(srv, 'mensagem limpa para agendar');
    r = await srv.post(`/api/mensagens/${ok.id}/agendar`, { quando: '+1h' });
    assert.equal(r.corpo.status, 'pendente');
    assert.equal((await srv.post(`/api/mensagens/${ok.id}/aprovar`)).corpo.status, 'aprovada');
    await srv.post(`/api/mensagens/${ok.id}/agendar`, { quando: null });
    repo.db.prepare('UPDATE mensagens SET corpo = ? WHERE id = ?').run(`vazou ${SEG}`, ok.id);
    await desp.tick();
    assert.equal(enviados.length, 0, 'nada saiu');
    const depois = repo.obter(ok.id);
    assert.equal(depois.status, 'erro');
    assert.match(depois.ultimo_erro, /^barrada pelo linter na hora de enviar: parece token do GitHub no texto/);
    assert.ok(depois.lint.bloqueios.length, 'o resultado do linter fica na linha para o painel');
  } finally {
    desp.parar();
    srv.fechar();
  }
});

test('o aprovar e o despachante conferem o que o canal manda (canal.saida), não só os campos da linha', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = canalFalso();
  let assinatura = `Tobias · ${SEG}`;
  canal.saida = (m) => [{ texto: m.corpo, onde: 'no texto', nome: 'texto' }, { texto: assinatura, onde: 'na assinatura', nome: 'assinatura' }];
  const srv = await subir({ repo, canais: { teste: canal } });
  const desp = iniciarDespachante({ repo, canais: { teste: canal }, config: { tickMs: 999999, retentarPorMin: 360 }, log: () => {}, conferir: srv.app.conferir });
  try {
    const m = await criar(srv, 'bom dia, segue o combinado');
    const r = await srv.post(`/api/mensagens/${m.id}/aprovar`);
    assert.equal(r.status, 422);
    assert.deepEqual(r.corpo.bloqueios.map((b) => b.msg), ['parece token do GitHub na assinatura']);
    assinatura = 'Tobias';
    assert.equal((await srv.post(`/api/mensagens/${m.id}/aprovar`)).corpo.status, 'aprovada');
    // o que o canal manda muda depois de aprovada: o despachante confere pelo mesmo caminho e barra
    assinatura = `Tobias · ${SEG}`;
    await desp.tick();
    assert.equal(enviados.length, 0, 'nada saiu');
    assert.match(repo.obter(m.id).ultimo_erro, /^barrada pelo linter na hora de enviar: parece token do GitHub na assinatura/);
  } finally {
    desp.parar();
    srv.fechar();
  }
});

test('cofre fora do ar na hora de enviar: volta para a fila e tenta de novo; com o cofre de volta, sai', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = canalFalso();
  let cofreNoAr = true;
  const srv = await subir({
    repo, canais: { teste: canal },
    segredosDoCofre: async () => (cofreNoAr ? { valores: [], ok: true, erro: null, falhas: [], total: 0 } : { valores: null, ok: false, erro: 'cofre trancado', falhas: [], total: 0 }),
  });
  const desp = iniciarDespachante({ repo, canais: { teste: canal }, config: { tickMs: 999999, retentarPorMin: 360 }, log: () => {}, conferir: srv.app.conferir });
  try {
    const m = await criar(srv, 'bom dia, segue o combinado');
    assert.equal((await srv.post(`/api/mensagens/${m.id}/aprovar`)).corpo.status, 'aprovada');
    cofreNoAr = false;
    await desp.tick();
    let agora = repo.obter(m.id);
    assert.equal(agora.status, 'aprovada', 'passageiro: continua na fila');
    assert.match(agora.ultimo_erro, /não consegui verificar segredos: cofre trancado/);
    assert.equal(enviados.length, 0);
    cofreNoAr = true;
    repo.db.prepare('UPDATE mensagens SET proxima_tentativa = 0 WHERE id = ?').run(m.id);
    await desp.tick();
    agora = repo.obter(m.id);
    assert.equal(agora.status, 'enviada');
    assert.equal(enviados.length, 1);
  } finally {
    desp.parar();
    srv.fechar();
  }
});

test('falha fechado no servidor: cofre fora, com erro, lento, valor que não leu e erro no linter → 422 "não consegui verificar segredos"', async () => {
  const casos = [
    [{ segredosDoCofre: async () => ({ valores: null, ok: false, erro: 'cofre indisponível (ETIMEDOUT)', falhas: [], total: 0 }) }, /cofre indisponível \(ETIMEDOUT\)/],
    [{ segredosDoCofre: async () => { throw new Error('execFile quebrou'); } }, /execFile quebrou/],
    [{ segredosDoCofre: () => new Promise(() => {}), cofreMs: 50 }, /o cofre não respondeu em 0\.05 s/],
    [{ segredosDoCofre: async () => ({ valores: [], ok: false, erro: 'não consegui ler 1 de 340 valores do cofre (X_TOKEN)', falhas: ['X_TOKEN'], total: 340 }) },
      /^não consegui verificar segredos \(1 de 340 não lidos: X_TOKEN\)$/],
    [{ pessoasDe: () => { throw new Error('pessoas.json quebrado'); } }, /erro no linter \(pessoas\.json quebrado\)/],
  ];
  for (const [opcoes, motivo] of casos) {
    const repo = abrirDb(':memory:');
    const srv = await subir({ repo, ...opcoes });
    try {
      const m = await criar(srv, 'texto comum, sem nada demais');
      const r = await srv.post(`/api/mensagens/${m.id}/aprovar`);
      assert.equal(r.status, 422, String(motivo));
      assert.equal(r.corpo.bloqueios.length, 1);
      assert.equal(r.corpo.bloqueios[0].regra, 'segredo');
      assert.equal(r.corpo.bloqueios[0].naoChecou, true);
      assert.match(r.corpo.bloqueios[0].msg, /^não consegui verificar segredos[: ]/);
      assert.match(r.corpo.bloqueios[0].msg, motivo);
      assert.equal(repo.obter(m.id).status, 'pendente');
    } finally {
      srv.fechar();
    }
  }
});

test('cofre com a recarga falhando e tudo coberto pela leitura anterior (até 1 h): confere com ela; /api/saude mostra o estado sem valores', async () => {
  const repo = abrirDb(':memory:');
  const VALOR = 'Qx7-valor-do-cofre';
  const resumo = { ok: false, idadeMin: 12, total: 340, falhas: [], erro: 'não consegui listar o cofre (ETIMEDOUT)', bloqueia: false, lendo: false };
  const srv = await subir({
    repo,
    segredosDoCofre: async () => ({ valores: [{ nome: 'PAINEL_SENHA', valor: VALOR }], ok: false, erro: resumo.erro, falhas: [], total: 340 }),
    resumoCofre: () => resumo,
  });
  try {
    const limpa = await criar(srv, 'bom dia, segue o combinado');
    assert.equal((await srv.post(`/api/mensagens/${limpa.id}/aprovar`)).corpo.status, 'aprovada', 'ok=false com tudo coberto não barra');
    const comValor = await criar(srv, `entra com ${VALOR}`);
    const r = await srv.post(`/api/mensagens/${comValor.id}/aprovar`);
    assert.equal(r.status, 422);
    assert.match(r.corpo.bloqueios[0].msg, /valor do cofre PAINEL_SENHA/, 'a leitura anterior continua conferida');
    const s = await srv.get('/api/saude');
    const { resumo: frase, ...estado } = s.corpo.segredos;
    assert.deepEqual(estado, resumo);
    assert.match(frase, /^340 nomes do cofre conferidos/, 'a saúde traz a frase pronta (o msg antigo imprime resumo)');
    assert.ok(s.corpo.teste, 'os canais continuam no mesmo objeto');
    assert.ok(!JSON.stringify(s.corpo).includes(VALOR));
  } finally {
    srv.fechar();
  }
});

test('sem cofre configurado: a saúde diz isso sem alarme, o linter confere só os padrões e nada fica barrado à toa', async () => {
  const repo = abrirDb(':memory:');
  const srv = await subir({
    repo,
    segredosDoCofre: async () => ({ valores: [], ok: true, erro: null, falhas: [], total: 0, desligado: true }),
    resumoCofre: () => ({ ok: true, idadeMin: null, total: 0, falhas: [], erro: null, bloqueia: false, lendo: false, desligado: true }),
  });
  try {
    const limpa = await criar(srv, 'bom dia, segue o combinado');
    assert.equal(limpa.lint.cofre, false, 'o resultado diz que nenhum valor de cofre entrou na conferência');
    assert.deepEqual(limpa.lint.bloqueios, []);
    assert.equal((await srv.post(`/api/mensagens/${limpa.id}/aprovar`)).corpo.status, 'aprovada');
    const comToken = await criar(srv, `a chave é ${SEG}`);
    assert.equal((await srv.post(`/api/mensagens/${comToken.id}/aprovar`)).status, 422, 'o padrão de texto continua barrando');
    const s = (await srv.get('/api/saude')).corpo.segredos;
    assert.equal(s.bloqueia, false);
    assert.equal(s.desligado, true);
    assert.match(s.resumo, /^sem cofre configurado: o linter confere só os padrões de texto/);
  } finally {
    srv.fechar();
  }
});

test('corrida: texto trocado enquanto o linter conferia (mesmo milissegundo) → o aprovar relê e barra', async () => {
  const repo = abrirDb(':memory:', { agora: () => 1_800_000_000_000 }); // relógio parado
  let armadilha = null;
  const srv = await subir({
    repo,
    segredosDoCofre: async () => {
      if (armadilha) { const f = armadilha; armadilha = null; f(); }
      return { valores: [], ok: true, erro: null, falhas: [], total: 0 };
    },
  });
  try {
    const m = await criar(srv, 'versão limpa');
    armadilha = () => repo.editar(m.id, { corpo: `versão nova: ${SEG}` });
    const r = await srv.post(`/api/mensagens/${m.id}/aprovar`);
    assert.equal(r.status, 422, 'a versão que o linter leu não é a do banco: relê e barra');
    assert.equal(repo.obter(m.id).status, 'pendente');
  } finally {
    srv.fechar();
  }
});

test('lote: resultado por mensagem, descartar e desfazer em lote, limites', async () => {
  const repo = abrirDb(':memory:');
  const srv = await subir({ repo });
  try {
    const a = await criar(srv, 'primeira do lote');
    const b = await criar(srv, 'segunda do lote');
    let r = await srv.post('/api/lote', { acao: 'aprovar', ids: [a.id, b.id, a.id] });
    assert.deepEqual(r.corpo.resultados.map((x) => [x.id, x.status]), [[a.id, 'aprovada'], [b.id, 'aprovada']], 'id repetido conta uma vez');
    r = await srv.post('/api/lote', { acao: 'desfazer', ids: [a.id] });
    assert.deepEqual(r.corpo.resultados, [{ id: a.id, ok: true, status: 'pendente' }]);
    r = await srv.post('/api/lote', { acao: 'descartar', ids: [a.id, b.id], motivo_codigo: 'desatualizada', motivo: 'perdeu o prazo' });
    assert.ok(r.corpo.resultados.every((x) => x.ok && x.status === 'descartada'));
    assert.equal(repo.obter(b.id).motivo_codigo, 'desatualizada');
    r = await srv.post('/api/lote', { acao: 'aprovar', ids: [a.id] });
    assert.deepEqual(r.corpo.resultados.map((x) => [x.ok, x.status]), [[false, 'descartada']], 'descartada não aprova');
    assert.equal((await srv.post('/api/lote', { acao: 'apagar', ids: [a.id] })).status, 400);
    assert.equal((await srv.post('/api/lote', { acao: 'aprovar', ids: [] })).status, 400);
    assert.equal((await srv.post('/api/lote', { acao: 'aprovar', ids: Array.from({ length: 201 }, (_, i) => i + 1) })).status, 400);
  } finally {
    srv.fechar();
  }
});

test('PATCH: extra é mesclado (null apaga a chave) e conta inválida é recusada', async () => {
  const repo = abrirDb(':memory:');
  const srv = await subir({ repo });
  try {
    const m = await criar(srv, 'com extra', { extra: { citar: { id: 'M1', texto: 'oi' }, prazo: 'hoje' } });
    const r = await srv.patch(`/api/mensagens/${m.id}`, { extra: { prazo: null, thread_id: 't1' } });
    assert.deepEqual(r.corpo.extra, { citar: { id: 'M1', texto: 'oi' }, thread_id: 't1' });
    assert.equal((await srv.patch(`/api/mensagens/${m.id}`, { conta: 'zzz' })).status, 400);
  } finally {
    srv.fechar();
  }
});

// ---------------------------------------------------------------- anexos pela API

test('anexo pela API: cópia durável, recusa de credencial (nome, ~/.ssh por symlink, conteúdo) e aprovação barrada', async () => {
  const repo = abrirDb(':memory:');
  const dirAnexos = path.join(dir, 'anexos-api');
  const srv = await subir({ repo, dirAnexos });
  const homeOriginal = process.env.HOME;
  try {
    const orig = arquivo('origem/proposta.pdf', PDF);
    const m = await criar(srv, 'segue a proposta', { anexos: [orig] });
    assert.equal(m.anexos[0], path.join(dirAnexos, String(m.id), 'proposta.pdf'));
    assert.deepEqual(fs.readFileSync(m.anexos[0]), PDF);
    assert.deepEqual(m.lint.bloqueios, [], 'PDF comum não barra (o aviso de binário é só para canal que manda anexo)');
    // o original some (tmp do job apagado) e o anexo continua servindo, com a CSP do anexo
    fs.rmSync(orig);
    const baixar = await fetch(`${srv.base}/api/mensagens/${m.id}/anexo/0`);
    assert.equal(baixar.status, 200);
    assert.deepEqual(Buffer.from(await baixar.arrayBuffer()), PDF);
    // anexo novo no PATCH também vira cópia (nome repetido ganha "(2)")
    const outro = arquivo('outra-pasta/proposta.pdf', PDF);
    let r = await srv.patch(`/api/mensagens/${m.id}`, { anexos: [m.anexos[0], outro] });
    assert.deepEqual(r.corpo.anexos, [m.anexos[0], path.join(dirAnexos, String(m.id), 'proposta (2).pdf')]);
    assert.equal((await srv.post(`/api/mensagens/${m.id}/aprovar`)).status, 200, 'PDF normal aprova');
    // sumiu: 400 com o caminho; nada é gravado
    const antes = repo.contagens();
    const sumido = path.join(dir, 'nao-existe.pdf');
    r = await srv.post('/api/mensagens', { canal: 'teste', destino_id: 'g1', corpo: 'sem arquivo', anexos: [sumido] });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro, `anexo não encontrado: ${sumido}`);
    // nome de credencial e chave dentro de um PDF: 400 já na criação
    r = await srv.post('/api/mensagens', { canal: 'teste', destino_id: 'g1', corpo: 'env', anexos: [arquivo('cfg/.env', 'A=1')] });
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro, /^anexo recusado, nome de arquivo de credencial \(\.env\)/);
    const pem = arquivo('cfg/contrato.pdf', Buffer.concat([PDF, Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n')]));
    r = await srv.post('/api/mensagens', { canal: 'teste', destino_id: 'g1', corpo: 'pem', anexos: [pem] });
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro, /^anexo recusado, tem chave privada dentro: /);
    // symlink para ~/.ssh (home falsa do teste): 400 e nenhuma cópia feita
    const homeFalsa = path.join(dir, 'home-falsa');
    arquivo('home-falsa/.ssh/config', 'Host x');
    const link = path.join(dir, 'origem/relatorio.pdf');
    fs.symlinkSync(path.join(homeFalsa, '.ssh/config'), link);
    process.env.HOME = homeFalsa;
    r = await srv.post('/api/mensagens', { canal: 'teste', destino_id: 'g1', corpo: 'link', anexos: [link] });
    process.env.HOME = homeOriginal;
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro, /^anexo recusado, está em ~\/\.ssh \(chaves SSH\)/);
    assert.deepEqual(repo.contagens(), antes, 'nada foi criado');
    // CSV com valor do cofre: cria (a validação não conhece o cofre), mas a aprovação é barrada
    const srvCofre = await subir({ repo, dirAnexos, segredosDoCofre: async () => ({ valores: [{ nome: 'PAINEL_SENHA', valor: 'Qx7-valor-do-cofre' }], ok: true, erro: null, falhas: [], total: 1 }) });
    try {
      const csv = arquivo('origem/acessos.csv', 'sistema,codigo\npainel,Qx7-valor-do-cofre\n');
      const c = await criar(srvCofre, 'segue a planilha', { anexos: [csv] });
      r = await srvCofre.post(`/api/mensagens/${c.id}/aprovar`);
      assert.equal(r.status, 422);
      assert.ok(r.corpo.bloqueios.some((b) => b.msg.startsWith('valor do cofre PAINEL_SENHA no anexo acessos.csv')));
      assert.ok(!JSON.stringify(r.corpo).includes('Qx7-valor-do-cofre'));
    } finally {
      srvCofre.fechar();
    }
    // mensagem antiga que aponta para credencial não vira download
    const velha = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'antiga', anexos: [arquivo('cfg/id_rsa', 'x')] });
    const proibido = await srv.get(`/api/mensagens/${velha.id}/anexo/0`);
    assert.equal(proibido.status, 403);
    assert.match(proibido.corpo.erro, /^anexo recusado, nome de arquivo de credencial/);
  } finally {
    process.env.HOME = homeOriginal;
    srv.fechar();
  }
});

// ---------------------------------------------------------------- config, pessoas, versões, filtros

test('config: GET, PUT e POST num config.json do teste; senhasDeCliente só leitura; a janela vale no aprovar', async () => {
  const anterior = config.preferencias;
  config.preferencias = path.join(dir, 'config-teste-api.json');
  fs.writeFileSync(config.preferencias, JSON.stringify({ outraChave: 1, senhasDeCliente: { X_SENHA: 'Aurora' } }));
  const repo = abrirDb(':memory:');
  const email = { id: 'email', nome: 'E-mail', contaPadrao: 'tobias@exemplo.com', contas: () => [{ id: 'tobias@exemplo.com', nome: 'x' }] };
  const srv = await subir({ repo, canais: { teste: canalFalso().canal, email } });
  try {
    let r = await srv.get('/api/config');
    assert.deepEqual(r.corpo, { sumirRespondidas: true, janelaDesfazerMs: 10000, assinaturas: {}, senhasDeCliente: { X_SENHA: 'Aurora' } });
    r = await srv.put('/api/config', { janelaDesfazerMs: 3000, assinaturas: { 'tobias@exemplo.com': 'Tobias\nFarol' }, senhasDeCliente: { Y: 'Cedro' } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.janelaDesfazerMs, 3000);
    assert.deepEqual(r.corpo.senhasDeCliente, { X_SENHA: 'Aurora' }, 'senha de cliente não se libera por clique');
    const gravado = JSON.parse(fs.readFileSync(config.preferencias, 'utf8'));
    assert.equal(gravado.outraChave, 1, 'chave desconhecida fica');
    assert.equal(gravado.assinaturas['tobias@exemplo.com'], 'Tobias\nFarol');
    assert.equal((await srv.put('/api/config', { janelaDesfazerMs: 999999 })).status, 400);
    assert.equal((await srv.put('/api/config', { assinaturas: { 'outra@exemplo.org': 'a' } })).status, 400);
    r = await srv.post('/api/config', { sumirRespondidas: false });
    assert.equal(r.corpo.sumirRespondidas, false);
    const m = await criar(srv, 'aprovar com janela de 3 s');
    const a = (await srv.post(`/api/mensagens/${m.id}/aprovar`)).corpo;
    assert.equal(a.liberar_em - a.aprovado_em, 3000);
  } finally {
    srv.fechar();
    config.preferencias = anterior;
  }
});

test('mesma sessão, quase o mesmo texto, outro destino: a resposta traz a parecida (destino corrigido?)', async () => {
  const repo = abrirDb(':memory:');
  const srv = await subir({ repo });
  try {
    const texto = 'Oi! O Otávio confirmou que o relatório do trimestre sai hoje, preciso da planilha final em xlsx antes do envio.';
    const origem = { sessao_id: 'sessao-A' };
    const errada = await criar(srv, texto, { destino_id: '5511999990014@s.whatsapp.net', destino_nome: '+5511999990014', origem });
    const certa = await criar(srv, `${texto} Obrigado!`, { destino_id: '551199990041@s.whatsapp.net', destino_nome: 'Helena Duarte', origem });
    assert.deepEqual(certa.parecidas, [{ id: errada.id, destino_nome: '+5511999990014', status: 'pendente' }]);
    assert.equal(repo.obter(errada.id).status, 'pendente', 'outro destino não some sozinho: pode ser o mesmo aviso para várias pessoas');
    // de outra sessão não conta
    const outra = await criar(srv, `${texto} Até já.`, { destino_id: 'g9', origem: { sessao_id: 'sessao-B' } });
    assert.equal(outra.parecidas, undefined);
  } finally {
    srv.fechar();
  }
});

test('pessoas, versões e substitui pela API; filtros e busca da lista', async () => {
  const repo = abrirDb(':memory:');
  const pessoas = [{ nome: 'Ivo Tavares', cliente: 'Aurora', apelidos: [], emails: ['ivo@exemplo.com'] }];
  const srv = await subir({ repo, pessoasDe: () => pessoas });
  try {
    assert.deepEqual((await srv.get('/api/pessoas')).corpo, pessoas);
    const v1 = await criar(srv, 'primeira versão', { cliente: 'aurora', sessao_nome: 'AURORA - Painel' });
    const v2 = await criar(srv, 'segunda versão', { substitui_id: v1.id, cliente: 'aurora' });
    assert.equal(repo.obter(v1.id).status, 'substituida');
    const versoes = (await srv.get(`/api/mensagens/${v1.id}/versoes`)).corpo;
    assert.deepEqual(versoes.map((x) => [x.id, x.status]), [[v1.id, 'substituida'], [v2.id, 'pendente']]);
    assert.deepEqual((await srv.get(`/api/mensagens/${v2.id}/versoes`)).corpo.map((x) => x.id), [v1.id, v2.id]);
    assert.equal((await srv.post('/api/mensagens', { canal: 'teste', destino_id: 'g1', corpo: 'x', substitui_id: 999 })).status, 404);
    await criar(srv, 'Otávio pediu o relatório', { cliente: 'Cedro', destino_id: 'g2' });
    const lista = async (q) => (await srv.get(`/api/mensagens?${q}`)).corpo.map((x) => x.corpo);
    assert.deepEqual(await lista('status=pendente&cliente=Aurora'), ['segunda versão']);
    assert.deepEqual(await lista('q=otavio'), ['Otávio pediu o relatório'], 'busca sem acento');
    assert.deepEqual(await lista('q=painel'), ['primeira versão'], 'busca pelo nome da sessão');
    assert.deepEqual(await lista('status=substituida,pendente&canal=teste&limite=1').then((x) => x.length), 1);
  } finally {
    srv.fechar();
  }
});

// ---------------------------------------------------------------- Entrada com parte do canal fora

test('Entrada: canal que leu só parte (conta sem login) mostra o que leu e diz o porquê do resto', async () => {
  const repo = abrirDb(':memory:');
  const item = (chave, em) => ({ chave, canal: 'teste', titulo: chave, em, destino: { id: 'x', nome: 'X' } });
  const lista = { ...canalFalso().canal, id: 'lista', entrada: async () => [item('lista:1', 2)] };
  const parcial = { ...canalFalso().canal, id: 'parcial', entrada: async () => ({ itens: [item('parcial:1', 1)], aviso: 'a@exemplo.com pede login de novo no Google' }) };
  const srv = await subir({ repo, canais: { lista, parcial }, sse: { saudeMs: 1e6, entradaMs: 1e6 } });
  try {
    const r = await srv.get('/api/entrada');
    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.itens.map((i) => i.chave), ['lista:1', 'parcial:1']);
    assert.deepEqual(r.corpo.erros, { parcial: 'a@exemplo.com pede login de novo no Google' });
  } finally {
    srv.fechar();
  }
});

test('Entrada: pedidos ao mesmo tempo (painel e stream) leem o canal uma vez só', async () => {
  let leituras = 0;
  const lento = { ...canalFalso().canal, id: 'lento', entrada: async () => { leituras++; await new Promise((ok) => setTimeout(ok, 50)); return []; } };
  const srv = await subir({ repo: abrirDb(':memory:'), canais: { lento }, sse: { saudeMs: 1e6, entradaMs: 1e6 } });
  try {
    const rs = await Promise.all([srv.get('/api/entrada'), srv.get('/api/entrada'), srv.get('/api/entrada?canal=lento')]);
    assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
    assert.equal(leituras, 1);
  } finally {
    srv.fechar();
  }
});

// ---------------------------------------------------------------- tempo real

test('SSE: escrita de OUTRA conexão do banco vira evento; a própria também; ping; nada fica ligado depois', async () => {
  const arq = path.join(dir, 'sse.db');
  const repo = abrirDb(arq);
  const srv = await subir({ repo, sse: { pollMs: 20, pingMs: 60, saudeMs: 1e6, entradaMs: 1e6 } });
  const ac = new AbortController();
  let buf = '';
  try {
    const r = await fetch(`${srv.base}/api/stream`, { signal: ac.signal });
    assert.equal(r.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const leitor = r.body.getReader();
    const dec = new TextDecoder();
    (async () => {
      try {
        for (;;) {
          const { value, done } = await leitor.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
        }
      } catch { /* fim do teste */ }
    })();
    assert.ok(await esperar(() => buf.includes('event: resumo')), 'resumo logo ao conectar');
    assert.deepEqual(srv.app.ouvindo(), { ouvintes: 1, timers: 4 });
    // outra conexão (outro processo faria o mesmo): o servidor só fica sabendo pelo data_version
    const outra = abrirDb(arq);
    outra.criar({ canal: 'teste', destino_id: 'g9', destino_nome: 'Outra conexão', corpo: 'veio de fora do servidor' });
    assert.ok(await esperar(() => /event: mensagem\ndata: .*veio de fora do servidor/.test(buf)), 'evento da outra conexão');
    outra.db.close();
    repo.criar({ canal: 'teste', destino_id: 'g8', destino_nome: 'Mesma conexão', corpo: 'gravada pelo próprio servidor' });
    assert.ok(await esperar(() => buf.includes('gravada pelo próprio servidor')), 'evento da própria conexão');
    assert.ok(await esperar(() => buf.includes(': ping')), 'ping');
    const vezes = buf.split('veio de fora do servidor').length - 1;
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(buf.split('veio de fora do servidor').length - 1, vezes, 'a mesma versão não é mandada de novo');
  } finally {
    ac.abort();
    assert.ok(await esperar(() => srv.app.ouvindo().ouvintes === 0), 'quem saiu deixa de ouvir');
    assert.deepEqual(srv.app.ouvindo(), { ouvintes: 0, timers: 0 }, 'sem ouvinte, nenhum timer ligado');
    srv.fechar();
  }
});

// ---------------------------------------------------------------- estático

test('estático: web/dist com fallback de SPA, /assets/ imutável e CSP; sem o build, a página diz o comando; nada fora da raiz', async () => {
  const webDist = path.join(dir, 'dist');
  arquivo('dist/index.html', '<!doctype html><div id="app">nova</div><script type="module" src="/assets/app-abc123.js"></script>');
  arquivo('dist/assets/app-abc123.js', 'console.log(1)');
  const repo = abrirDb(':memory:');
  const srv = await subir({ repo, webDist });
  const cru = (caminho) => new Promise((ok, falha) => {
    http.get({ host: '127.0.0.1', port: srv.porta, path: caminho, headers: { host: `127.0.0.1:${srv.porta}` } }, (resp) => {
      let b = '';
      resp.on('data', (d) => { b += d; });
      resp.on('end', () => ok({ status: resp.statusCode, corpo: b }));
    }).on('error', falha);
  });
  try {
    let r = await srv.get('/');
    assert.equal(r.status, 200);
    assert.match(r.corpo, /nova/);
    for (const [k, v] of Object.entries(CABECALHOS_SEGUROS)) assert.equal(r.cab.get(k), v, k);
    assert.match(r.cab.get('content-security-policy'), /script-src 'self'; .*frame-ancestors 'none'/);
    assert.equal(r.cab.get('cache-control'), 'no-cache');
    r = await srv.get('/assets/app-abc123.js');
    assert.equal(r.cab.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(r.cab.get('content-type'), 'text/javascript; charset=utf-8');
    assert.match((await srv.get('/fila/123')).corpo, /nova/, 'rota do app cai no index');
    assert.equal((await srv.get('/nao-existe.js')).status, 404);
    for (const caminho of ['/..%2f..%2fpackage.json', '/assets/..%2f..%2f..%2fsrc%2fserver.js', '/%00']) {
      assert.equal((await cru(caminho)).status, 404, caminho);
    }
  } finally {
    srv.fechar();
  }
  // sem o build do painel (web/dist não vai no repositório): a página diz o comando e a API segue no ar
  const semDist = await subir({ repo, webDist: path.join(dir, 'sem-dist') });
  try {
    for (const caminho of ['/', '/fila/123']) {
      const r = await semDist.get(caminho);
      assert.equal(r.status, 503, caminho);
      assert.match(r.corpo, /O painel ainda não foi construído/);
      assert.match(r.corpo, /npm run build:web/);
      assert.equal(r.cab.get('content-security-policy'), CABECALHOS_SEGUROS['content-security-policy']);
    }
    assert.equal((await semDist.get('/assets/app.js')).status, 404);
    assert.equal((await semDist.get('/api/resumo')).status, 200);
  } finally {
    semDist.fechar();
  }
});

// ---------------------------------------------------------------- modo prévia

test('modo prévia: recusa o banco real (mesmo arquivo, symlink, hardlink), a pasta dele, sem PORT e a porta 4912', () => {
  const dbReal = path.join(dir, 'real/.central-mensagens/central.db');
  arquivo('real/.central-mensagens/central.db', 'x');
  const op = { dbReal, portaProducao: 4912 };
  const copia = arquivo('copia/central.db', 'x');
  const recusa = (env, re) => assert.throws(() => checarModo(env, op), re);
  assert.deepEqual(checarModo({}, op), { modo: 'normal' });
  assert.deepEqual(checarModo({ CENTRAL_MODO: 'previa', CENTRAL_DB: copia, PORT: '4999' }, op), { modo: 'previa' });
  recusa({ CENTRAL_MODO: 'teste' }, /CENTRAL_MODO inválido/);
  recusa({ CENTRAL_MODO: 'previa', PORT: '4999' }, /exige CENTRAL_DB/);
  recusa({ CENTRAL_MODO: 'previa', CENTRAL_DB: dbReal, PORT: '4999' }, /é o banco real/);
  const link = path.join(dir, 'copia/atalho.db');
  fs.symlinkSync(dbReal, link);
  recusa({ CENTRAL_MODO: 'previa', CENTRAL_DB: link, PORT: '4999' }, /é o banco real/);
  const duro = path.join(dir, 'copia/duro.db');
  fs.linkSync(dbReal, duro);
  recusa({ CENTRAL_MODO: 'previa', CENTRAL_DB: duro, PORT: '4999' }, /é o banco real/);
  recusa({ CENTRAL_MODO: 'previa', CENTRAL_DB: path.join(path.dirname(dbReal), 'copia.db'), PORT: '4999' }, /não pode ficar em/);
  recusa({ CENTRAL_MODO: 'previa', CENTRAL_DB: copia }, /exige PORT/);
  recusa({ CENTRAL_MODO: 'previa', CENTRAL_DB: copia, PORT: 'abc' }, /exige PORT/);
  recusa({ CENTRAL_MODO: 'previa', CENTRAL_DB: copia, PORT: '4912' }, /porta 4912 é a da Central de verdade/);
});

const portaLivre = () => new Promise((ok) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
});
function rodarServidor(env) {
  const filho = spawn(process.execPath, [path.join(raiz, 'src/server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const saida = { out: '', err: '', fim: null };
  filho.stdout.on('data', (d) => { saida.out += d; });
  filho.stderr.on('data', (d) => { saida.err += d; });
  filho.on('exit', (codigo) => { saida.fim = codigo; });
  return { filho, saida };
}

test('modo prévia de ponta a ponta: o processo recusa o banco real e sobe na cópia sem despachante e sem envio', async () => {
  const home = path.join(dir, 'home-previa');
  arquivo('home-previa/.central-mensagens/central.db', '');
  const { NODE_ENV, CENTRAL_DB, CENTRAL_MODO, CENTRAL_PESSOAS, CENTRAL_SECRET_BIN, CENTRAL_PONTE_STORE, PORT, ...resto } = process.env;
  const env = { ...resto, HOME: home, CENTRAL_NOTIFICAR: '0' };
  // apontando para o banco "real" (desta home): nem abre o banco
  const recusado = rodarServidor({ ...env, CENTRAL_MODO: 'previa', CENTRAL_DB: path.join(home, '.central-mensagens/central.db'), PORT: '4997' });
  assert.ok(await esperar(() => recusado.saida.fim !== null, 10000), 'saiu');
  assert.equal(recusado.saida.fim, 1);
  assert.match(recusado.saida.err, /modo prévia recusado: CENTRAL_DB é o banco real/);
  // na cópia, numa porta livre: sobe em modo prévia
  const porta = await portaLivre();
  const copia = path.join(dir, 'copia-previa/central.db');
  const ok = rodarServidor({ ...env, CENTRAL_MODO: 'previa', CENTRAL_DB: copia, PORT: String(porta) });
  try {
    assert.ok(await esperar(() => ok.saida.out.includes('MODO PRÉVIA') || ok.saida.fim !== null, 15000), ok.saida.err);
    assert.match(ok.saida.out, /banco .*copia-previa\/central\.db · canais: whatsapp · MODO PRÉVIA: sem despachante, sem notificação, sem envio/);
    const resumo = await (await fetch(`http://127.0.0.1:${porta}/api/resumo`)).json();
    assert.equal(resumo.modo, 'previa');
    // do zero (home vazia, sem config.json): só o WhatsApp, sem nome de dono, sem cofre
    assert.deepEqual(resumo.canais.map((c) => c.id), ['whatsapp']);
    assert.equal(resumo.dono, null);
    const postar = (p, caminho, corpo) => fetch(`http://127.0.0.1:${p}${caminho}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-central': '1' }, body: JSON.stringify(corpo ?? {}),
    });
    const nova = { canal: 'whatsapp', destino_id: '5511999990001@s.whatsapp.net', destino_nome: 'Contato de teste', corpo: 'oi' };
    assert.equal((await postar(porta, '/api/mensagens', { ...nova, canal: 'discord' })).status, 400, 'canal desligado não recebe mensagem');
    const criada = await (await postar(porta, '/api/mensagens', nova)).json();
    assert.equal(criada.lint.cofre, false, 'sem cofre: só os padrões de texto');
    const aprovar = await postar(porta, `/api/mensagens/${criada.id}/aprovar`);
    assert.equal(aprovar.status, 200, 'sem cofre configurado nada fica barrado à toa');
    assert.equal((await aprovar.json()).status, 'aprovada');
    // com um helper de cofre configurado que não responde, o linter falha fechado também no processo de verdade
    const portaCofre = await portaLivre();
    const comCofre = rodarServidor({ ...env, CENTRAL_MODO: 'previa', CENTRAL_DB: path.join(dir, 'copia-previa-3/central.db'), PORT: String(portaCofre),
      CENTRAL_SECRET_BIN: path.join(dir, 'helper-que-nao-existe') });
    try {
      assert.ok(await esperar(() => comCofre.saida.out.includes('MODO PRÉVIA') || comCofre.saida.fim !== null, 15000), comCofre.saida.err);
      const barrada = await (await postar(portaCofre, '/api/mensagens', nova)).json();
      const recusa = await postar(portaCofre, `/api/mensagens/${barrada.id}/aprovar`);
      assert.equal(recusa.status, 422);
      assert.match(JSON.stringify(await recusa.json()), /não consegui verificar segredos/);
    } finally {
      comCofre.filho.kill('SIGTERM');
      await esperar(() => comCofre.saida.fim !== null, 5000);
    }
    // segunda Central na mesma porta: sai dizendo o porquê, antes de mexer na fila
    const segunda = rodarServidor({ ...env, CENTRAL_MODO: 'previa', CENTRAL_DB: path.join(dir, 'copia-previa-2/central.db'), PORT: String(porta) });
    assert.ok(await esperar(() => segunda.saida.fim !== null, 10000), 'a segunda saiu');
    assert.equal(segunda.saida.fim, 1);
    assert.match(segunda.saida.err, /não subiu: a porta \d+ já está em uso .*a fila não foi tocada/);
    assert.doesNotMatch(segunda.saida.out, /no ar em/);
  } finally {
    ok.filho.kill('SIGTERM');
    await esperar(() => ok.saida.fim !== null, 5000);
  }
});
