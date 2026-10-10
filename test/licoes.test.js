// Lições do dono: diferença por palavras, sugestões a partir de correções realistas (trecho tirado, troca, padrões,
// famílias de texto quase igual), lint com lição ativa, API (virar lição, ignorar, editar, disparos e corrigidas),
// msg guia com lições, saúde da cópia de segurança nos 4 estados e o aviso de duplicada que respeita a sequência.
// Banco em memória, canal falso e arquivos no tmp: nada sai de verdade e o estado real da cópia não é lido.
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
import { inspecionarAnexos } from '../src/anexos.js';
import { config } from '../src/config.js';
import { saudeDaCopia } from '../src/copia.js';
import { abrirDb } from '../src/db.js';
import { analisarDescartes, conferirLicoes, diferenca, sugerirLicoes } from '../src/licoes.js';
import { lint } from '../src/lint.js';
import { criarApp } from '../src/server.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-licoes-'));
config.preferencias = path.join(dir, 'config.json');
fs.writeFileSync(config.preferencias, JSON.stringify({ janelaDesfazerMs: 0 }));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const rodar = promisify(execFile);
const OTAVIO = '5511999990001@s.whatsapp.net';
const SEM_COPIA = path.join(dir, 'sem-copia.json'); // nunca o estado real da cópia

// Correções de exemplo: o que a sessão escreveu → o que o dono deixou sair
const CASOS = [
  // "Espero que esteja bem" sai de 3 mensagens diferentes (uma por e-mail)
  { antes: 'Oi Clara, tudo certo? Espero que esteja bem. Segue o painel de setembro com os números da loja.', depois: 'Oi Clara, tudo certo? Segue o painel de setembro com os números da loja.' },
  { canal: 'email', antes: 'Bom dia, Nina! Espero que esteja bem. O formulário novo da Duna já está no ar.', depois: 'Bom dia, Nina! O formulário novo da Duna já está no ar.' },
  { antes: 'Fala, Valter. Espero que esteja bem. Mandei os vídeos do canal novo para você revisar.', depois: 'Fala, Valter. Mandei os vídeos do canal novo para você revisar.' },
  // a mesma troca de palavra em contextos diferentes
  { antes: 'A planilha da campanha de setembro ficou pronta, com 40 pedidos.', depois: 'A tabela da campanha de setembro ficou pronta, com 40 pedidos.' },
  { antes: 'Mandei o relatório: a planilha por região mudou bastante na última semana.', depois: 'Mandei o relatório: a tabela por região mudou bastante na última semana.' },
  // o fecho que ele tira
  { antes: 'Otávio, o painel novo está no ar com os números de outubro. Qualquer dúvida, me chama!', depois: 'Otávio, o painel novo está no ar com os números de outubro.' },
  { antes: 'Mateus, subi a lista nova de contatos no sistema. Qualquer dúvida, me chama!', depois: 'Mateus, subi a lista nova de contatos no sistema.' },
  // o mesmo aviso para dois grupos (família): o corte aparece 2 vezes, mas é uma decisão só
  { antes: 'Pessoal, aviso rápido: fico fora de segunda 13/04 até sexta 17/04. Nesse período o Ivo responde por aqui; o resto fica para a volta.', depois: 'Pessoal, aviso rápido: fico fora de segunda 13/04 até sexta 17/04. O resto fica para a volta.' },
  { antes: 'Pessoal, aviso rápido: fico fora de segunda 13/04 até sexta 17/04. Nesse período o Raul responde por aqui; o resto fica para a volta.', depois: 'Pessoal, aviso rápido: fico fora de segunda 13/04 até sexta 17/04. O resto fica para a volta.' },
  // prazo que mudou não é lição
  { antes: 'Lembrete: a reunião é na quinta 08/10, às 9h.', depois: 'Lembrete: a reunião é na sexta 09/10, às 9h.' },
  { antes: 'Combinado, entrego na quinta, sem falta.', depois: 'Combinado, entrego na sexta 09/10, sem falta.' },
  // formato e emoji
  { antes: 'Resumo: **3 entregas** saíram hoje.', depois: 'Resumo: *3 entregas* saíram hoje.' },
  { antes: 'Otávio, o **painel** está no ar.', depois: 'Otávio, o *painel* está no ar.' },
  { antes: 'Fechado, obrigado 🙏', depois: 'Fechado, obrigado' },
  { antes: 'Subiu a campanha nova 🚀 com as artes do Valter', depois: 'Subiu a campanha nova com as artes do Valter' },
  // saudação que ele acrescenta
  { antes: 'Mateus, a lista de hoje já está no sistema.', depois: 'Mateus, bom dia! A lista de hoje já está no sistema.' },
  { antes: 'Pessoal, subi o relatório da semana.', depois: 'Pessoal, boa tarde! Subi o relatório da semana.' },
];
const comoMensagens = (casos) => casos.map((c, i) => ({ id: i + 1, canal: c.canal || 'whatsapp', sessao_nome: `sessão ${i % 4}`, corpo_original: c.antes, corpo: c.depois }));
const porChave = (sugestoes) => Object.fromEntries(sugestoes.map((s) => [s.chave, s]));

// ---------------------------------------------------------------- extração

test('diferença por palavras: tirado, trocado e acrescentado, sem contar caixa, acento nem pontuação', () => {
  const d = diferenca('Oi Otávio, espero que esteja bem. A planilha ficou com 21 linhas.', 'Oi otavio! A tabela ficou com 21 linhas. Obrigado!');
  assert.deepEqual(d.blocos.map((b) => [b.op, b.antes, b.depois]), [
    ['tirado', 'espero que esteja bem.', ''],
    ['trocado', 'planilha', 'tabela'],
    ['acrescentado', '', 'Obrigado!'],
  ]);
  assert.deepEqual(diferenca('igual, sem mudança', 'Igual sem mudança!').blocos, [], 'pontuação e caixa não contam como edição');
});

test('sugestões: trecho tirado, troca e padrões em 2+ mensagens, com evidência; família, prazo e nome não viram lição', () => {
  const { sugestoes, edicoes } = sugerirLicoes(comoMensagens(CASOS));
  const s = porChave(sugestoes);
  const espero = s['evitar:espero que esteja bem'];
  assert.ok(espero, `faltou "Espero que esteja bem": ${Object.keys(s).join(' | ')}`);
  assert.deepEqual([espero.trecho, espero.contagem, espero.familias, espero.canal], ['Espero que esteja bem', 3, 3, null]);
  assert.equal(espero.texto, 'o dono costuma tirar "Espero que esteja bem" (3×)');
  assert.deepEqual(espero.evidencias.map((e) => e.id), [3, 2, 1], 'evidência das mais novas para as mais velhas');
  assert.match(espero.evidencias[2].antes, /Espero que esteja bem\. Segue o painel/);
  assert.doesNotMatch(espero.evidencias[2].depois, /Espero/);
  assert.ok(!s['evitar:espero que esteja'] && !s['evitar:esteja bem'], 'pedaço do mesmo trecho não vira outra sugestão');

  const troca = s['trocar:planilha>tabela'];
  assert.deepEqual([troca?.trecho, troca?.por, troca?.contagem, troca?.canal], ['planilha', 'tabela', 2, 'whatsapp']);
  assert.equal(troca.texto, 'o dono costuma trocar "planilha" por "tabela" (2×)');
  assert.match(troca.evidencias[0].antes, /a planilha por região/);
  assert.match(troca.evidencias[0].depois, /a tabela por região/);

  for (const padrao of ['fecho_tirado', 'negrito_duplo', 'emoji_tirado', 'saudacao_acrescentada']) {
    assert.equal(s[`regra:${padrao}`]?.contagem, 2, `padrão ${padrao}`);
  }
  assert.match(s['regra:fecho_tirado'].evidencias[0].antes, /Qualquer dúvida, me chama!$/);
  assert.match(s['regra:saudacao_acrescentada'].evidencias[0].depois, /^Pessoal, boa tarde!/);
  assert.ok(s['evitar:qualquer duvida me chama'], 'o fecho repetido também aparece como trecho');

  // o aviso de férias para 2 grupos é uma família: o corte não vira lição; data e dia trocados também não
  assert.ok(!sugestoes.some((x) => /período|\bIvo\b|Raul|quinta|sexta/i.test(`${x.trecho} ${x.por}`)), sugestoes.map((x) => x.texto).join(' | '));
  assert.ok(!sugestoes.some((x) => x.tipo === 'trocar' && x.chave !== 'trocar:planilha>tabela'));

  assert.equal(edicoes.total, CASOS.length);
  assert.ok(edicoes.encurtadas >= 4 && edicoes.encurtadoPct > 15, JSON.stringify(edicoes));
  assert.equal(s['regra:encurtado'].nota, `em média ${edicoes.encurtadoPct}% mais curta; mande só o essencial`);
});

test('sugestões: uma mensagem só não ensina nada; texto igual não conta', () => {
  assert.deepEqual(sugerirLicoes(comoMensagens(CASOS.slice(0, 1))).sugestoes.filter((s) => s.tipo !== 'regra'), []);
  assert.equal(sugerirLicoes([{ id: 1, canal: 'whatsapp', corpo_original: 'oi', corpo: 'oi' }]).edicoes.total, 0);
});

test('descartes: por canal e por sessão, com o motivo (código, escrito ou nenhum) e exemplos do que foi escrito', () => {
  const a = analisarDescartes([
    { canal: 'whatsapp', sessao_nome: 'AURORA', motivo_codigo: 'tom', motivo: null },
    { canal: 'whatsapp', sessao_nome: 'AURORA', motivo_codigo: null, motivo: null },
    { canal: 'whatsapp', sessao_nome: 'AURORA', motivo_codigo: null, motivo: 'descartada pela sessão' },
    { canal: 'email', sessao_nome: 'DUNA', motivo_codigo: null, motivo: 'refeito com o assunto certo' },
    { canal: 'whatsapp', sessao_nome: null, motivo_codigo: 'auto_respondida', motivo: 'sumiu sozinha: você já mandou isso' },
  ]);
  assert.deepEqual([a.total, a.semMotivo], [5, 2]);
  assert.deepEqual(a.porCanal[0], {
    nome: 'whatsapp', n: 4, semMotivo: 2, exemplos: [],
    motivos: [{ codigo: null, n: 2 }, { codigo: 'tom', n: 1 }, { codigo: 'auto_respondida', n: 1 }],
  });
  assert.deepEqual(a.porSessao.map((x) => [x.nome, x.n]), [['AURORA', 3], ['(sem sessão)', 1], ['DUNA', 1]]);
  assert.deepEqual(a.porSessao.find((x) => x.nome === 'DUNA').exemplos, ['refeito com o assunto certo']);
});

// ---------------------------------------------------------------- lint

test('lint: lição ativa vira aviso (nunca bloqueio), sem caixa nem acento, com palavra inteira e no canal certo', () => {
  const licoes = [
    { id: 1, tipo: 'evitar', trecho: 'Espero que esteja bem', contagem: 4 },
    { id: 2, tipo: 'trocar', trecho: 'planilha', por: 'tabela', contagem: 3 },
    { id: 3, tipo: 'regra', trecho: 'Att.', nota: 'sem "Att." no fim: assine com o nome', canal: 'whatsapp' },
    { id: 4, tipo: 'evitar', trecho: 'abraço', canal: 'email', contagem: 2 },
  ];
  const conferir = (corpo, canal = 'whatsapp') => lint({ canal, destino_id: OTAVIO, corpo, assunto: canal === 'email' ? 'oi' : '' },
    { segredos: [], anexos: inspecionarAnexos(null), licoes, agora: Date.parse('2026-10-06T10:00:00-03:00') });
  const r = conferir('Oi! ESPERO QUE ESTEJA BEM. A Planilha subiu. Um abraço. Att. Tobias');
  assert.deepEqual(r.avisos.filter((a) => a.regra === 'licao'), [
    { regra: 'licao', licao: 1, msg: 'o dono costuma tirar "Espero que esteja bem" (4×)' },
    { regra: 'licao', licao: 2, msg: 'o dono costuma trocar "planilha" por "tabela" (3×)' },
    { regra: 'licao', licao: 3, msg: 'sem "Att." no fim: assine com o nome' },
  ], 'a do e-mail não vale no WhatsApp');
  assert.deepEqual(r.bloqueios, []);
  assert.equal(conferir('esperando que estejam bem, as planilhas voltam').avisos.filter((a) => a.regra === 'licao').length, 0, 'palavra inteira');
  assert.deepEqual(conferir('Otávio, segue. Um abraço', 'email').avisos.filter((a) => a.regra === 'licao').map((a) => a.licao), [4]);
});

test('lint: padrões (saudação na primeira do dia, fecho, emoji, **duplo** sem repetir o aviso de formato)', () => {
  const agora = Date.parse('2026-10-06T10:00:00-03:00');
  const licoes = ['saudacao_acrescentada', 'fecho_tirado', 'emoji_tirado', 'negrito_duplo', 'encurtado']
    .map((padrao, i) => ({ id: i + 1, tipo: 'regra', padrao, contagem: 2 }));
  const disparou = (corpo, extra = {}, canal = 'whatsapp') => conferirLicoes({ canal, corpo }, licoes, { agora, ...extra }).map((a) => a.msg);
  assert.deepEqual(disparou('Mateus, a lista está no sistema. Qualquer dúvida, me chama! 🙏'), [
    'o dono costuma abrir com "bom dia" ou "boa tarde" na primeira mensagem do dia (2×)',
    'o dono costuma tirar o fecho ("Qualquer dúvida, me chama!") (2×)',
    'o dono costuma tirar emoji (2×)',
  ]);
  assert.deepEqual(disparou('Mateus, bom dia! A lista está no sistema.'), [], 'com saudação, sem fecho, sem emoji');
  assert.deepEqual(disparou('a lista está no sistema', { ultimaEnviada: agora - 2 * 3600e3 }), [], 'no meio da conversa não pede bom dia');
  assert.deepEqual(disparou('Bom dia! O **painel** saiu', { avisos: [{ regra: 'formato', trecho: '**' }] }), [], 'o formato já avisou');
  assert.deepEqual(disparou('Bom dia! O **painel** saiu', {}, 'discord'), ['o dono costuma tirar o **duplo** (2×)']);
  // lição quebrada não derruba o linter
  assert.deepEqual(conferirLicoes({ canal: 'whatsapp', corpo: 'oi' }, [{ id: 9, tipo: 'regra', padrao: 'nao_existe' }]), []);
});

// ---------------------------------------------------------------- API e CLI

async function subir(opcoes = {}) {
  const s = http.createServer();
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const porta = s.address().port;
  const app = criarApp({ porta, copiaEstado: SEM_COPIA, ...opcoes });
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
    base,
    get: (c) => chamar('GET', c),
    post: (c, b = {}) => chamar('POST', c, b),
    patch: (c, b) => chamar('PATCH', c, b),
    fechar: () => { app.parar(); s.closeAllConnections(); s.close(); },
  };
}

// WhatsApp de mentira: só resolve destino; nada é enviado (nenhum despachante roda)
const zap = {
  id: 'whatsapp', nome: 'WhatsApp', contaPadrao: 'pessoal', contas: () => [{ id: 'pessoal', nome: 'WhatsApp pessoal' }],
  saude: async () => ({ ok: true, resumo: 'ok' }),
  buscar: () => [],
  resolver: () => ({ destino: { id: OTAVIO, nome: 'Otávio Ramos', tipo: 'contato' } }),
  enviar: async () => { throw new Error('teste não envia'); },
};

// o que o dono editou antes de aprovar, gravado como na vida real (criada, editada, aprovada)
function editadas(repo, casos) {
  for (const c of casos) {
    const m = repo.criar({ canal: 'whatsapp', destino_id: OTAVIO, destino_nome: 'Otávio Ramos', corpo: c.antes });
    repo.editar(m.id, { corpo: c.depois });
    repo.aprovar(m.id);
  }
}

test('API: virar lição, ignorar (e desfazer), escrever à mão, editar, desligar; disparos e corrigidas pela sessão', async () => {
  const repo = abrirDb(':memory:');
  editadas(repo, CASOS.filter((c) => !c.canal));
  const srv = await subir({ repo, canais: { whatsapp: zap } });
  try {
    let tela = (await srv.get('/api/licoes')).corpo;
    assert.equal(tela.janelaDias, 90);
    const chave = 'evitar:espero que esteja bem';
    assert.equal(tela.sugestoes.find((s) => s.chave === chave)?.contagem, 2);
    assert.ok(tela.descartes && tela.edicoes.total > 0);

    // virar lição (com a nota que o dono escreveu por cima)
    let r = await srv.post('/api/licoes', { chave, nota: 'vá direto ao assunto' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const licao = r.corpo;
    assert.deepEqual([licao.tipo, licao.trecho, licao.contagem, licao.ativa, licao.disparos], ['evitar', 'Espero que esteja bem', 2, true, 0]);
    assert.equal(licao.texto, 'o dono costuma tirar "Espero que esteja bem" (2×): vá direto ao assunto');
    assert.equal(licao.evidencias.length, 2);
    assert.equal((await srv.post('/api/licoes', { chave })).status, 409, 'a mesma sugestão não vira duas lições');
    tela = (await srv.get('/api/licoes')).corpo;
    assert.ok(!tela.sugestoes.some((s) => s.chave === chave), 'a sugestão sai da lista quando vira lição');

    // ignorar e desfazer
    const troca = 'trocar:planilha>tabela';
    assert.ok(tela.sugestoes.some((s) => s.chave === troca));
    await srv.post('/api/licoes/ignorar', { chave: troca });
    assert.ok(!(await srv.get('/api/licoes')).corpo.sugestoes.some((s) => s.chave === troca));
    await srv.post('/api/licoes/ignorar', { chave: troca, desfazer: true });
    assert.ok((await srv.get('/api/licoes')).corpo.sugestoes.some((s) => s.chave === troca));

    // à mão; e o que falta é recusado com o motivo
    r = await srv.post('/api/licoes', { tipo: 'regra', trecho: 'Att.', nota: 'sem "Att." no fim: assine com o nome' });
    assert.equal(r.corpo.texto, 'sem "Att." no fim: assine com o nome');
    const manual = r.corpo.id;
    assert.match((await srv.post('/api/licoes', { tipo: 'evitar' })).corpo.erro, /falta o trecho/);
    assert.match((await srv.post('/api/licoes', { tipo: 'trocar', trecho: 'x' })).corpo.erro, /falta o "por"/);
    assert.equal((await srv.post('/api/licoes', { tipo: 'regra', nota: 'x', canal: 'telegram' })).status, 400);
    assert.equal((await srv.post('/api/licoes', { chave: 'evitar:nao existe' })).status, 404);

    // a sessão manda com o trecho: aviso no msg add; manda de novo sem ele: conta como corrigida pela sessão
    const nova = (await srv.post('/api/mensagens', { canal: 'whatsapp', para: 'Otávio', corpo: 'Otávio, espero que esteja bem! Segue o painel. Att.' })).corpo;
    assert.deepEqual(nova.lint.avisos.filter((a) => a.regra === 'licao').map((a) => a.licao).sort(), [licao.id, manual].sort());
    const v2 = (await srv.post('/api/mensagens', { canal: 'whatsapp', para: 'Otávio', corpo: 'Otávio, segue o painel.', substitui_id: nova.id })).corpo;
    assert.equal(v2.lint.avisos.filter((a) => a.regra === 'licao').length, 0);
    const lista = (await srv.get('/api/licoes')).corpo.licoes;
    assert.deepEqual(['disparos', 'corrigidas'].map((k) => lista.find((l) => l.id === licao.id)[k]), [1, 1]);

    // editar e desligar: desligada não avisa nem entra no guia
    r = await srv.patch(`/api/licoes/${manual}`, { nota: 'no WhatsApp não tem "Att."' });
    assert.equal(r.corpo.texto, 'no WhatsApp não tem "Att."');
    r = await srv.patch(`/api/licoes/${licao.id}`, { ativa: false });
    assert.equal(r.corpo.ativa, false);
    assert.deepEqual((await srv.get('/api/licoes?ativas=1')).corpo.licoes.map((l) => l.id), [manual]);
    const outra = (await srv.post('/api/mensagens', { canal: 'whatsapp', para: 'Otávio', corpo: 'Espero que esteja bem, viu?', tambem: true })).corpo;
    assert.ok(!outra.lint.avisos.some((a) => a.licao === licao.id));
    assert.equal((await srv.patch('/api/licoes/999', { ativa: false })).status, 404);
  } finally {
    srv.fechar();
  }
});

test('duplicada: pendentes da mesma sequência (ordem entre mensagens) não avisam; fora dela, sim', async () => {
  const repo = abrirDb(':memory:');
  const srv = await subir({ repo, canais: { whatsapp: zap } });
  try {
    const add = (corpo, extra = {}) => srv.post('/api/mensagens', { canal: 'whatsapp', para: 'Otávio', corpo, ...extra }).then((r) => r.corpo);
    const duplicada = (m) => m.lint.avisos.find((a) => a.regra === 'duplicada')?.msg;
    const a = await add('primeiro o painel');
    const b = await add('depois a pauta', { depois_de: a.id });
    const c = await add('e por fim o horário', { depois_de: b.id, espera_resposta: true });
    assert.equal(duplicada(b), undefined, 'b vem depois de a');
    assert.equal(duplicada(c), undefined, 'c, b e a são a mesma sequência');
    const solta = await add('outra coisa, sem ordem', { tambem: true });
    assert.equal(duplicada(solta), `mais 3 pendentes para o mesmo destino: #${a.id}, #${b.id}, #${c.id}`);
    // a conferência de uma da sequência (o aprovar relê) vê só a que está fora dela
    const r = await srv.post('/api/lint', { id: a.id });
    assert.equal(r.corpo.avisos.find((x) => x.regra === 'duplicada')?.msg, `mais 1 pendente para o mesmo destino: #${solta.id}`);
  } finally {
    srv.fechar();
  }
});

test('msg guia: o guia fixo e, no fim, as lições do dono com um exemplo; Central fora do ar não derruba o guia', async () => {
  const repo = abrirDb(':memory:');
  editadas(repo, CASOS.filter((c) => !c.canal));
  const srv = await subir({ repo, canais: { whatsapp: zap } });
  const env = { ...process.env, HOME: dir, CENTRAL_URL: srv.base }; // HOME no tmp: o msg não lê o config.json de quem roda o teste
  delete env.CLAUDE_JOB_DIR;
  const msg = (...args) => rodar(process.execPath, [path.join(raiz, 'bin/msg.js'), ...args], { env }).then((x) => x.stdout);
  try {
    let saida = await msg('guia');
    assert.ok(saida.startsWith(fs.readFileSync(path.join(raiz, 'docs/guia-sessoes.md'), 'utf8')), 'o guia fixo vem antes');
    assert.match(saida, /## Lições do dono\n\nNenhuma lição ativa ainda\./);
    await srv.post('/api/licoes', { chave: 'evitar:espero que esteja bem' });
    await srv.post('/api/licoes', { tipo: 'regra', nota: 'sem "Att." no fim: assine com o nome' });
    saida = await msg('guia');
    assert.match(saida, /## Lições do dono\n\nO que ele sempre corrige\./);
    assert.match(saida, /- o dono costuma tirar "Espero que esteja bem" \(2×\)\n {2}ex\.: #\d+ "[^"]*Espero que esteja bem[^"]*" → "[^"]*"/);
    assert.match(saida, /- sem "Att\." no fim: assine com o nome$/m);

    const fora = await rodar(process.execPath, [path.join(raiz, 'bin/msg.js'), 'guia'], { env: { ...env, CENTRAL_URL: 'http://127.0.0.1:9' } });
    assert.match(fora.stdout, /## Lições do dono\n\n\(a Central não respondeu agora/);
  } finally {
    srv.fechar();
  }
});

// ---------------------------------------------------------------- saúde da cópia de segurança

test('cópia de segurança: ainda não ligada, em dia, falhou e atrasada; execução de teste (seco) não conta', () => {
  const agora = Date.parse('2026-10-06T09:00:00-03:00');
  const ok = Date.parse('2026-10-06T03:41:00-03:00');
  const arq = path.join(dir, 'estado-copia.json');
  const com = (estado) => { fs.writeFileSync(arq, JSON.stringify(estado)); return saudeDaCopia(arq, agora); };
  const base = { duracao_s: 312, fases: { drive: 'ok' }, projetos_em: null };

  assert.deepEqual(saudeDaCopia(path.join(dir, 'nao-existe.json'), agora), { estado: 'desligada', ok: true, aviso: false, resumo: 'Cópia de segurança: ainda não ligada' });
  assert.equal(com({ ...base, quando: ok, ok: true, seco: true, erro: null, ultimo_ok: null }).estado, 'desligada', 'só teste: nunca teve ok de verdade');

  let s = com({ ...base, quando: ok, ok: true, seco: false, erro: null, ultimo_ok: ok });
  assert.deepEqual([s.estado, s.aviso, s.resumo], ['ok', false, 'Cópia de segurança: hoje 03h41']);
  s = com({ ...base, quando: agora - 3600e3, ok: false, seco: true, erro: 'teste', ultimo_ok: ok });
  assert.deepEqual([s.estado, s.resumo], ['ok', 'Cópia de segurança: hoje 03h41'], 'o seco que falhou não conta');
  s = saudeDaCopia(arq, Date.parse('2026-10-07T09:00:00-03:00'));
  assert.equal(s.resumo, 'Cópia de segurança: ontem 03h41');

  s = com({ ...base, quando: ok, ok: false, seco: false, erro: 'rclone: sem rede', ultimo_ok: ok - 86400e3 });
  assert.deepEqual([s.estado, s.aviso, s.erro, s.resumo], ['falhou', true, 'rclone: sem rede', 'Cópia de segurança: falhou hoje 03h41: rclone: sem rede']);

  s = com({ ...base, quando: agora - 40 * 3600e3, ok: true, seco: false, erro: null, ultimo_ok: agora - 40 * 3600e3 });
  assert.deepEqual([s.estado, s.aviso, s.resumo], ['atrasada', true, 'Cópia de segurança: a última que deu certo foi 04/10 17h00 (mais de 36 h)']);

  fs.writeFileSync(arq, '{ quebrado');
  assert.deepEqual([saudeDaCopia(arq, agora).estado, saudeDaCopia(arq, agora).aviso], ['falhou', true], 'estado ilegível avisa');
});

test('cópia de segurança: /api/saude e msg saude mostram; o caminho vem de CENTRAL_BACKUP_ESTADO', async () => {
  const arq = path.join(dir, 'estado-saude.json');
  fs.writeFileSync(arq, JSON.stringify({ quando: Date.now() - 60e3, ok: true, seco: false, erro: null, ultimo_ok: Date.now() - 60e3 }));
  const srv = await subir({ repo: abrirDb(':memory:'), canais: { whatsapp: zap }, copiaEstado: arq });
  try {
    const s = (await srv.get('/api/saude')).corpo;
    assert.equal(s.copia.estado, 'ok');
    assert.ok(s.whatsapp.ok, 'os canais continuam no mesmo objeto');
    const env = { ...process.env, HOME: dir, CENTRAL_URL: srv.base }; // HOME no tmp: o msg não lê o config.json de quem roda o teste
    const { stdout } = await rodar(process.execPath, [path.join(raiz, 'bin/msg.js'), 'saude'], { env });
    assert.match(stdout, /^● whatsapp: ok$/m);
    assert.match(stdout, /^● Cópia de segurança: (hoje|ontem) \d\dh\d\d$/m);
    assert.doesNotMatch(stdout, /copia:/, 'a cópia não sai como se fosse canal');
  } finally {
    srv.fechar();
  }
  const { stdout } = await rodar(process.execPath, ['--input-type=module', '-e', "import { config } from './src/config.js'; console.log(config.backupEstado)"],
    { cwd: raiz, env: { ...process.env, CENTRAL_BACKUP_ESTADO: '/tmp/estado-de-teste.json' } });
  assert.equal(stdout.trim(), '/tmp/estado-de-teste.json');
});

test('nome de propriedade do protótipo não passa: padrão "constructor" e ação "toString" voltam 400, a leitura das lições segue', () => {
  const repo = abrirDb(':memory:');
  for (const padrao of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => repo.criarLicao({ tipo: 'regra', padrao, nota: 'x' }), (e) => e.status === 400, `padrão ${padrao}`);
  }
  const p = repo.registrarPromessa({ chave: 'p:1', origem: 'whatsapp', sentido: 'minha', canal: 'whatsapp', destino_id: '5511999990001@s.whatsapp.net',
    trecho: 'te mando', frase: 'te mando amanhã', em: 1, prazo: 2 });
  for (const acao of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => repo.fecharPromessa(p.id, acao), (e) => e.status === 400, `ação ${acao}`);
  }
  assert.equal(repo.fecharPromessa(p.id, 'cumpri').status, 'cumprida');
});
