// Linter: o que bloqueia, o que só avisa e o que não pode virar falso positivo.
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lint, acharPessoa, proximoHorarioUtil } from '../src/lint.js';
import { nomeEhSegredo } from '../src/segredos.js';

// terça, 10h (horário útil): os testes não dependem do dia em que rodam
const TERCA_10H = new Date(2026, 9, 6, 10, 0).getTime();
const SENHA_AURORA = 'Bri5as#Cometa5120';
const cofre = [{ nome: 'AURORA_PAINEL_SENHA', valor: SENHA_AURORA }, { nome: 'CURTO', valor: 'abc123' }];
// os clientes como viriam do config.json: Boreal é do mesmo grupo de Aurora (mesma família); os outros, não
const clientes = [
  { nome: 'Aurora' },
  { nome: 'Boreal', familia: 'Aurora' },
  { nome: 'Cedro', termos: ['Grupo Cedro'] },
  { nome: 'Duna' },
  { nome: 'Estrela' },
];
// o diretório como viria do pessoas.json
const pessoas = [
  { nome: 'Ivo Tavares', cliente: null, apelidos: [], emails: ['ivo@exemplo.com'] },
  { nome: 'Ingrid', cliente: 'Aurora', apelidos: [] },
  { nome: 'Otávio Ramos Pires', cliente: 'Aurora', apelidos: ['Otávio'] },
  { nome: 'Otávio Ramos Pires', cliente: 'Boreal', apelidos: [] },
  { nome: 'Lara', cliente: 'Duna', apelidos: [] },
  { nome: 'Lara', cliente: 'Estrela', apelidos: [] },
];
const msg = (corpo, extra = {}) => ({ canal: 'whatsapp', destino_id: 'x@s.whatsapp.net', destino_nome: 'Grupo', corpo, ...extra });
const regras = (r) => ({ b: r.bloqueios.map((x) => x.regra), a: r.avisos.map((x) => x.regra) });
// cofre lido e sem nenhum valor que importe: só os padrões contam (sem `segredos`, o linter falha fechado)
const L = (m, dados = {}) => lint(m, { segredos: [], agora: TERCA_10H, ...dados });

test('senha de um cliente indo para o destino de outro é barrada e avisa cliente cruzado', () => {
  const m = msg(`Oi Nina! Segue o acesso do painel da Aurora: usuário painel@exemplo.com, senha: ${SENHA_AURORA}`, {
    destino_nome: 'Nina Cedro', cliente: 'aurora',
  });
  const r = lint(m, { segredos: cofre, pessoas, clientes, agora: TERCA_10H });
  const seg = r.bloqueios.filter((b) => b.regra === 'segredo');
  assert.ok(seg.some((b) => /AURORA_PAINEL_SENHA/.test(b.msg)), 'pega o valor do cofre');
  assert.ok(seg.some((b) => /senha/.test(b.msg) && !/cofre/.test(b.msg)), 'pega o padrão "senha:"');
  assert.ok(r.avisos.some((a) => a.regra === 'cliente_cruzado' && /Cedro/.test(a.msg) && /Aurora/.test(a.msg)));
  assert.equal(r.cofre, true);
  assert.ok(!JSON.stringify(r).includes(SENHA_AURORA), 'o valor nunca aparece no resultado');
  assert.ok(!JSON.stringify(r).includes('Cometa5120'), 'nem pedaço dele');

  // liberar a senha para a Aurora não libera para a Cedro
  const liberada = lint(m, { segredos: cofre, pessoas, clientes, agora: TERCA_10H, senhasDeCliente: { AURORA_PAINEL_SENHA: 'Aurora' } });
  assert.ok(liberada.bloqueios.some((b) => /senha de Aurora .* indo para Cedro/.test(b.msg)));
  // sem cofre configurado (semCofre), o resultado diz que só os padrões foram conferidos
  assert.equal(lint(m, { segredos: [], semCofre: true, agora: TERCA_10H }).cofre, false);
});

test('senha de página liberada para o próprio cliente vira aviso (e o "senha:" do mesmo valor também)', () => {
  const m = msg(`Relatório no ar: https://exemplo.com/rel · senha: ${SENHA_AURORA}`, { destino_nome: 'Ingrid - AURORA' });
  const r = lint(m, { segredos: cofre, pessoas, clientes, agora: TERCA_10H, senhasDeCliente: { AURORA_PAINEL_SENHA: 'Aurora' } });
  assert.deepEqual(r.bloqueios, []);
  assert.ok(r.avisos.some((a) => a.regra === 'segredo' && /liberada/.test(a.msg)));
  const semLiberar = lint(m, { segredos: cofre, pessoas, clientes, agora: TERCA_10H });
  assert.equal(semLiberar.bloqueios.filter((b) => b.regra === 'segredo').length, 2);
});

test('padrões de segredo bloqueiam; texto que só fala de token ou senha não', () => {
  const casos = [
    `chave sk-ant-api03-${'a'.repeat(30)}`,
    `token ghp_${'A1b2'.repeat(9)}`,
    `github_pat_${'x'.repeat(30)}`,
    'xoxb-1234567890-abcdefghij',
    'AKIAABCDEFGHIJKLMNOP',
    `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.${'s'.repeat(20)}`,
    '-----BEGIN RSA PRIVATE KEY-----\nMIIE...',
    'Senha: Brisas5120',
    'a senha é Br#isas!x9',
    'password=hunter2hunter2',
  ];
  for (const c of casos) assert.ok(L(msg(c)).bloqueios.some((b) => b.regra === 'segredo'), `deveria bloquear: ${c.slice(0, 30)}`);
  const inocentes = [
    'o token de acesso expirou, gera outro e me avisa',
    'a senha é a mesma de sempre',
    'token: expirou ontem',
    'Senha: pede para a Ingrid',
    'troquei a senha do painel hoje',
    'o sk-learn é uma biblioteca',
    'tudo num lugar só, com senha: https://paginas.exemplo.com.br/resumo (a senha te mando separado)',
  ];
  for (const c of inocentes) assert.deepEqual(L(msg(c)).bloqueios, [], `não deveria bloquear: ${c}`);
});

test('valor do cofre só casa como palavra inteira e valor curto é ignorado', () => {
  assert.deepEqual(lint(msg(`codigo x${SENHA_AURORA}y`), { segredos: cofre, agora: TERCA_10H }).bloqueios, []);
  assert.deepEqual(lint(msg('o pin é abc123 mesmo'), { segredos: cofre, agora: TERCA_10H }).bloqueios, []);
  assert.equal(lint(msg(`(${SENHA_AURORA})`), { segredos: cofre, agora: TERCA_10H }).bloqueios.length, 1);
});

test('falha fechado: cofre fora do ar, valor do cofre que não leu e anexo não conferido bloqueiam, nunca avisam', () => {
  for (const dados of [{}, { segredos: null, cofreErro: 'cofre indisponível (ETIMEDOUT)' }]) {
    const r = lint(msg('oi, tudo certo por aí?'), { agora: TERCA_10H, ...dados });
    assert.equal(r.cofre, false);
    assert.equal(r.bloqueios.length, 1);
    assert.equal(r.bloqueios[0].regra, 'segredo');
    assert.equal(r.bloqueios[0].naoChecou, true);
    assert.match(r.bloqueios[0].msg, /^não consegui verificar segredos: /);
  }
  assert.match(lint(msg('oi'), { segredos: null, cofreErro: 'cofre trancado', agora: TERCA_10H }).bloqueios[0].msg, /cofre trancado/);
  // um valor que o cofre não leu já basta: bloqueia com o nome (antes era só aviso)
  const parcial = L(msg('oi'), { cofreFalhas: ['A_SENHA', 'B_TOKEN'], cofreTotal: 340 });
  assert.equal(parcial.bloqueios.length, 1);
  assert.equal(parcial.bloqueios[0].naoChecou, true);
  assert.equal(parcial.bloqueios[0].msg, 'não consegui verificar segredos (2 de 340 não lidos: A_SENHA, B_TOKEN)');
  assert.ok(!parcial.avisos.some((a) => a.regra === 'segredo'));
  // com a lista parcial, o valor que foi lido continua sendo conferido (os dois motivos aparecem)
  const parcialComSenha = lint(msg(`a senha é ${SENHA_AURORA}`), { segredos: cofre, cofreFalhas: ['B_TOKEN'], cofreTotal: 3, agora: TERCA_10H });
  assert.ok(parcialComSenha.bloqueios.some((b) => b.msg === 'não consegui verificar segredos (1 de 3 não lidos: B_TOKEN)'));
  assert.ok(parcialComSenha.bloqueios.some((b) => /valor do cofre AURORA_PAINEL_SENHA/.test(b.msg)));
  // anexo sem a inspeção do servidor: não dá para saber o que tem nele
  const semInfo = L(msg('segue', { anexos: ['/tmp/base.csv'] }));
  assert.ok(semInfo.bloqueios.some((b) => b.naoChecou && b.msg === 'não consegui verificar segredos: os anexos não foram conferidos'));
});

test('sem desvio: superconjunto de senha liberada, mesmo valor em dois nomes, citação e anexo também barram', () => {
  const liberar = { AURORA_PAINEL_SENHA: 'Aurora' };
  const aurora = { destino_nome: 'Ingrid - AURORA' };
  // a senha liberada não perdoa outra credencial que só começa igual
  const maior = lint(msg(`senha da página: ${SENHA_AURORA}. Admin: token: ${SENHA_AURORA}-adm-77`, aurora),
    { segredos: cofre, clientes, senhasDeCliente: liberar, agora: TERCA_10H });
  assert.ok(maior.bloqueios.some((b) => b.msg === 'parece token no texto'), 'o "token:" com valor maior continua barrado');
  // o mesmo valor guardado com outro nome que NÃO está liberado: barra
  const dois = lint(msg(`senha: ${SENHA_AURORA}`, aurora), {
    segredos: [...cofre, { nome: 'AURORA_ADMIN_SENHA', valor: SENHA_AURORA }], clientes, senhasDeCliente: liberar, agora: TERCA_10H,
  });
  assert.ok(dois.bloqueios.some((b) => /valor do cofre AURORA_ADMIN_SENHA/.test(b.msg)));
  // a citação vai no balão de resposta do WhatsApp: também é conferida
  const citacao = lint(msg('pode usar essa', { extra: { citar: { id: 'x', texto: `a senha é ${SENHA_AURORA}` } } }), { segredos: cofre, agora: TERCA_10H });
  assert.ok(citacao.bloqueios.some((b) => /na citação/.test(b.msg)));
  // anexo de texto (o servidor inspeciona com src/anexos.js e manda em dados.anexos)
  const anexo = lint(msg('segue', { anexos: ['/tmp/relatorio.csv'] }), {
    segredos: cofre, agora: TERCA_10H,
    anexos: [{ caminho: '/tmp/relatorio.csv', nome: 'relatorio.csv', bytes: 30, texto: `linha,${SENHA_AURORA}\n` }],
  });
  assert.ok(anexo.bloqueios.some((b) => /no anexo relatorio\.csv/.test(b.msg)));
  assert.ok(!JSON.stringify(anexo).includes(SENHA_AURORA));
  // cópia oculta aparece como aviso de destino
  assert.ok(L({ canal: 'email', destino_id: 'a@exemplo.com', assunto: 'x', corpo: 'oi', extra: { bcc: 'c@exemplo.com' } }).avisos
    .some((a) => a.regra === 'destino' && /c@exemplo\.com/.test(a.msg)));
});

test('anexos: a recusa da validação bloqueia, texto que não deu para varrer bloqueia, binário só avisa', () => {
  const com = (canal, info) => L({ canal, destino_id: 'x', destino_nome: 'Grupo', assunto: 'a', corpo: 'segue', anexos: info.map((a) => a.caminho) },
    { anexos: info });
  const a = (nome, extra = {}) => ({ caminho: `/x/${nome}`, nome, bytes: 1000, ...extra });
  const credencial = com('email', [a('.env', { bytes: null, recusa: { codigo: 'sensivel', msg: 'anexo recusado, nome de arquivo de credencial (.env): /x/.env' } })]);
  assert.deepEqual(regras(credencial).b, ['segredo']);
  assert.match(credencial.bloqueios[0].msg, /anexo recusado.*\.env/);
  assert.deepEqual(regras(com('email', [a('fotos.zip', { recusa: { codigo: 'compactado', msg: 'anexo compactado recusado: /x/fotos.zip' } })])).b, ['segredo']);
  // texto grande demais ou ilegível: "não pôde ser checado"
  const naoLido = com('email', [a('base.csv', { bytes: 6e6, naoLido: 'tem 5,7 MB e a varredura lê até 5,0 MB' })]);
  assert.deepEqual(regras(naoLido).b, ['segredo']);
  assert.match(naoLido.bloqueios[0].msg, /^anexo base\.csv não pôde ser checado: tem 5,7 MB/);
  // PDF, imagem, planilha: sai, mas com o aviso de que ninguém leu
  const pdf = com('email', [a('proposta.pdf', { binario: true })]);
  assert.deepEqual(pdf.bloqueios, []);
  assert.ok(pdf.avisos.some((x) => x.regra === 'anexo' && /^anexo binário não verificado: proposta\.pdf/.test(x.msg)));
  // sumiu: só barra se vai sair (o WhatsApp manda só o primeiro)
  const sumiu = { bytes: null, recusa: { codigo: 'sumiu', msg: 'anexo não encontrado: /x/b.pdf' } };
  assert.deepEqual(regras(com('whatsapp', [a('a.pdf', { binario: true }), a('b.pdf', sumiu)])).b, []);
  assert.deepEqual(regras(com('whatsapp', [a('b.pdf', sumiu)])).b, ['anexo']);
  // 20 MB por mensagem, em qualquer canal
  const grande = com('whatsapp', [a('video.mp4', { bytes: 21 * 1048576, binario: true })]);
  assert.ok(grande.bloqueios.some((b) => b.regra === 'anexo' && /21,0 MB; o limite é 20 MB por mensagem/.test(b.msg)));
});

test('link não é isento: padrão, valor do cofre, usuário:senha e parâmetro secreto dentro de URL bloqueiam', () => {
  const jwt = `eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.${'s'.repeat(30)}`;
  const comChave = `dados: https://api.exemplo.com/rest/v1/leads?select=*&apikey=${jwt}`;
  const r = L(msg(comChave));
  assert.ok(r.bloqueios.some((b) => b.msg === 'parece token JWT no texto'));
  assert.ok(r.bloqueios.some((b) => b.msg === 'parece apikey num link no texto' && b.trecho === 'apikey=••••'));
  assert.ok(!JSON.stringify(r).includes('eyJhbGciOiJIUzI1NiJ9'), 'o token não aparece no resultado');
  const casos = [
    'banco: postgresql://postgres:Xy7pQ2mK9w@db.exemplo.com:5432/postgres',
    'https://admin:segredo123@exemplo.com/admin',
    'https://storage.googleapis.com/b/rel.pdf?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=a1b2c3d4e5f6a7b8c9d0',
    'https://bucket.s3.amazonaws.com/rel.pdf?X-Amz-Expires=600&X-Amz-Signature=0123456789abcdef0123',
    'https://app.exemplo.com/callback#access_token=ya29a0AfH6SMBxyz&expires_in=3599',
    'https://api.exemplo.com/v1/export?formato=csv&token=9f8e7d6c5b4a3210',
    'https://exemplo.com/oauth?code=4-0AX4XfWhabcdefgh',
    'https://maps.googleapis.com/maps/api/js?key=AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q',
    `https://discord.com/api/webhooks/123456789012345678/${'AbCd'.repeat(10)}`,
    // chave de JSON, como num arquivo de credencial colado
    '{"access_token": "ya29.a0AfH6SMBx-abc123", "expires_in": 3599}',
  ];
  for (const c of casos) assert.ok(L(msg(c)).bloqueios.some((b) => b.regra === 'segredo'), `deveria bloquear: ${c.slice(0, 60)}`);
  // valor do cofre dentro do link, sem rótulo nenhum
  const doCofre = lint(msg(`https://painel.exemplo.com/entrar?p=${encodeURIComponent('x')}&s=${SENHA_AURORA}`), { segredos: cofre, agora: TERCA_10H });
  assert.ok(doCofre.bloqueios.some((b) => /AURORA_PAINEL_SENHA/.test(b.msg)));
  // link comum passa: o parâmetro não é de chave (lista de permitidos não foi preciso)
  const comuns = [
    'olha a conversa: https://atendimento.exemplo.com/conversas?id=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    'relatório: https://claude.ai/artifact/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    'chama no https://wa.me/5511999990041?text=Oi%20quero%20saber%20mais%20sobre%20o%20pedido',
    'planilha: https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?usp=sharing#gid=123456789',
    'cupom: https://loja.exemplo.com/?code=PROMO10',
    'https://exemplo.com/ajuda?q=como+trocar+a+senha&page=2',
    'perfil: https://exemplo.com/@fulano e fulano@exemplo.com',
    'local: http://localhost:4912/fila e http://127.0.0.1:8080/api/send',
  ];
  for (const c of comuns) assert.deepEqual(L(msg(c)).bloqueios, [], `não deveria bloquear: ${c}`);
});

test('desempenho: 50 mil caracteres maliciosos e anexo de texto de 2 MB, lint completo em menos de 300 ms', () => {
  const N = 50000;
  const rep = (s, n = N) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  // cofre grande (340 nomes): cada valor é um indexOf sobre o texto
  const cofreGrande = Array.from({ length: 340 }, (_, i) => ({ nome: `S${i}_SENHA`, valor: `Valor${i}-${(i * 7919).toString(36)}Xyz` }));
  const b64 = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0NTY3ODkrL2FiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6';
  // os da revisão de segurança primeiro, depois os que já travaram uma versão anterior
  const casos = [rep('a'), rep(b64), rep('='), 'senha:'.repeat(8000), rep('https://x.co/?token='), `eyJ${'A'.repeat(N)}`,
    rep('eyJ-'), rep('\n'), rep('['), `senha: ${rep('.')}a`, rep(' '), rep('sk-'), rep('`'), rep('não é x, '), rep('@'),
    rep('a@'), `-----BEGIN ${rep('A')}`, rep('PRIVATE KEY'), `da${rep(' ')}x`, rep(' \n'), rep('*a'), rep('a.'), rep('a://'),
    `https://${rep('a:')}`, rep('?token='), `https://x/?token=${rep('a')}`, rep('a_'), `senha${rep(' ')}:x`,
    rep('"access_token": "'), rep('EAA'), rep('senha: https://a '), rep('*Senha*: '), rep('token e '), rep('[a](b')];
  // o melhor de 3: a máquina pode estar ocupada e uma pausa do coletor não é o linter
  const ms = (f) => Math.min(...[0, 1, 2].map(() => {
    const t0 = performance.now();
    f();
    return performance.now() - t0;
  }));
  for (const corpo of casos) {
    for (const canal of ['whatsapp', 'email']) {
      const t = ms(() => L({ canal, destino_id: 'x', destino_nome: 'Grupo', assunto: 'a', corpo }, { segredos: cofreGrande }));
      // uma versão anterior levava 56 s com um anexo de 2 MB de "https://x.co/?token="; antes dela, ~5 s em 50 mil
      assert.ok(t < 300, `${canal} "${corpo.slice(0, 12)}…": ${t.toFixed(0)} ms`);
    }
  }
  const MB2 = 2 * 1024 * 1024;
  const anexos = [rep(b64, MB2), rep('https://x.co/?token=', MB2), rep('senha:https://a', MB2), rep('eyJ-', MB2), rep('senha:', MB2),
    rep('nome,email,telefone,senha\nFulano,fulano@exemplo.com,11999990050,trocar\n', MB2), rep('a', MB2)];
  for (const texto of anexos) {
    const t = ms(() => L({ canal: 'email', destino_id: 'x', destino_nome: 'G', assunto: 'a', corpo: 'segue', anexos: ['/x/a.txt'] },
      { segredos: cofreGrande, anexos: [{ caminho: '/x/a.txt', nome: 'a.txt', bytes: texto.length, texto }] }));
    assert.ok(t < 300, `anexo de 2 MB "${texto.slice(0, 12)}…": ${t.toFixed(0)} ms`);
  }
});

test('texto ou citação acima de 200 mil caracteres barra sem varrer (falha fechado, sem tentar de novo)', () => {
  const grande = L(msg(`${'a'.repeat(199990)} senha: Xy7pQ2mK9w ${'b'.repeat(20)}`));
  assert.deepEqual(grande.bloqueios, [{ regra: 'segredo', msg: 'texto grande demais para checar: 200.029 caracteres (o limite é 200 mil)' }]);
  assert.ok(!grande.avisos.some((a) => ['acento', 'ia', 'formato', 'cliente_cruzado'].includes(a.regra)), 'nada que leia o texto inteiro roda');
  // o assunto conta junto (assunto + quebra + corpo)
  const email = L({ canal: 'email', destino_id: 'a@exemplo.com', assunto: 'x'.repeat(10), corpo: 'a'.repeat(199990) });
  assert.match(email.bloqueios[0].msg, /^texto grande demais para checar: 200\.001 caracteres/);
  // no limite, varre normalmente (e acha o segredo)
  const noLimite = L(msg(`${'a'.repeat(200000 - 18)} senha: Xy7pQ2mK9w`));
  assert.equal(noLimite.bloqueios[0].msg, 'parece senha no texto');
  const citacao = L(msg('pode usar essa', { extra: { citar: { id: 'x', texto: 'c'.repeat(200001) } } }));
  assert.deepEqual(citacao.bloqueios.map((b) => b.msg), ['citação grande demais para checar: 200.001 caracteres (o limite é 200 mil)']);
  // 5 MB não chegam a ser lidos
  const t0 = performance.now();
  L(msg('a'.repeat(5e6)));
  assert.ok(performance.now() - t0 < 300);
});

test('o texto é varrido como o destinatário lê: invisível no meio, largura total e homógrafo não escondem o segredo', () => {
  const tok = ['ghp_', 'A1b2'.repeat(9)].join(''); // token do GitHub de mentira, montado em pedaços
  const noMeio = (c) => `${tok.slice(0, 10)}${c}${tok.slice(10)}`;
  for (const c of ['​', '‌', '‍', '⁠', '﻿', '­', '‮', '\u{E0041}', '️', 'ㅤ']) {
    const r = L(msg(`segue ${noMeio(c)} ok`));
    assert.ok(r.bloqueios.some((b) => b.msg === 'parece token do GitHub no texto'), `U+${c.codePointAt(0).toString(16).toUpperCase()} no meio`);
  }
  const larguraTotal = [...tok].map((ch) => String.fromCodePoint(ch.codePointAt(0) + 0xFEE0)).join('');
  assert.ok(L(msg(`chave ${larguraTotal}`)).bloqueios.some((b) => b.msg === 'parece token do GitHub no texto'));
  assert.ok(L(msg(`chave gһp_${'A1b2'.repeat(9)}`)).bloqueios.some((b) => b.msg === 'parece token do GitHub no texto'), 'һ cirílico');
  // rótulo com dois-pontos de largura total e espaço sem quebra
  assert.ok(L(msg('senha： Xy7pQ2mK9w')).bloqueios.some((b) => b.msg === 'parece senha no texto'));
  // valor do cofre com invisível no meio
  const zw = lint(msg(`entra com ${SENHA_AURORA.slice(0, 5)}​${SENHA_AURORA.slice(5)}`), { segredos: cofre, agora: TERCA_10H });
  assert.ok(zw.bloqueios.some((b) => /^valor do cofre AURORA_PAINEL_SENHA no texto/.test(b.msg)));
});

test('tudo o que sai é conferido: segredo só no assunto, só na citação, só no nome do anexo ou só na saída do canal bloqueia', () => {
  const tok = ['ghp_', 'A1b2'.repeat(9)].join('');
  const assunto = L({ canal: 'email', destino_id: 'a@exemplo.com', assunto: `acesso ${tok}`, corpo: 'segue o combinado' });
  assert.deepEqual(assunto.bloqueios.map((b) => b.msg), ['parece token do GitHub no assunto']);
  const citado = L(msg('pode usar essa', { extra: { citar: { id: 'x', texto: `a chave é ${tok}` } } }));
  assert.deepEqual(citado.bloqueios.map((b) => b.msg), ['parece token do GitHub na citação']);
  const caminho = `/tmp/${tok}.pdf`;
  const anexo = L(msg('segue', { anexos: [caminho] }), { anexos: [{ caminho, nome: `${tok}.pdf`, bytes: 10, binario: true }] });
  assert.deepEqual(anexo.bloqueios.map((b) => b.msg), ['parece token do GitHub no nome do anexo 1']);
  // nem pelos outros motivos: o aviso de anexo binário e o de markdown no e-mail ("*ghp_...*") escondem o valor
  const negrito = L({ canal: 'email', destino_id: 'a@exemplo.com', assunto: 'x', corpo: `veja *${tok}*` });
  assert.ok(negrito.avisos.some((a) => a.regra === 'formato'));
  for (const r of [assunto, citado, anexo, negrito]) assert.ok(!JSON.stringify(r).includes(tok.slice(4, 24)), 'o valor não volta');
  // com a saída do canal (src/server.js manda o montar() dele), é ela que vale: a assinatura que só existe lá barra
  const saida = [{ texto: 'oi', onde: 'no texto', nome: 'texto' }, { texto: `Tobias\nchave ${tok}`, onde: 'na assinatura', nome: 'assinatura' }];
  assert.deepEqual(L(msg('oi'), { saida }).bloqueios.map((b) => b.msg), ['parece token do GitHub na assinatura']);
  assert.deepEqual(L(msg('oi')).bloqueios, [], 'pelos campos da linha a assinatura não aparece');
  // pedaço da saída acima do limite barra sem varrer
  const parte = [{ texto: 'x'.repeat(200001), onde: 'na parte 2 do Discord', nome: 'parte 2' }];
  assert.deepEqual(L(msg('oi'), { saida: parte }).bloqueios.map((b) => b.msg), ['parte 2 grande demais para checar: 200.001 caracteres (o limite é 200 mil)']);
});

test('valor do cofre escrito separado (espaço, quebra, pontuação a cada caractere) bloqueia; parecido com outra pontuação não', () => {
  const tem = (texto, segredos = cofre) => lint(msg(texto), { segredos, agora: TERCA_10H }).bloqueios.map((b) => b.msg)
    .filter((m) => m.startsWith('valor do cofre'));
  const separado = (s, sep) => [...s].join(sep);
  for (const [nome, texto] of [
    ['espaço entre os caracteres', `entra com ${separado(SENHA_AURORA, ' ')} amanhã`],
    ['quebra entre os caracteres', `entra com\n${separado(SENHA_AURORA, '\n')}\namanhã`],
    ['ponto entre os caracteres', `entra com ${separado(SENHA_AURORA, '.')} amanhã`],
    ['um espaço no meio', `entra com ${SENHA_AURORA.slice(0, 6)} ${SENHA_AURORA.slice(6)} amanhã`],
  ]) assert.deepEqual(tem(texto), ['valor do cofre AURORA_PAINEL_SENHA no texto (senha de página do cliente? libere em config.json → senhasDeCliente)'], nome);
  // o que só tem as mesmas letras e números com outra pontuação é texto comum (falso positivo conhecido)
  const parecidos = [{ nome: 'LOTE_SENHA', valor: 'Brisas@5120!' }, { nome: 'PAINEL_SENHA', valor: 'Lago.Cometa.5120' }];
  for (const texto of ['o lote Brisas 5120 chega segunda', 'post com #Brisas5120 no fim', 'baixa o Lago-Cometa-5120.pdf', 'xBri5as#Cometa5120y']) {
    assert.deepEqual(tem(texto, [...cofre, ...parecidos]), [], texto);
  }
  assert.deepEqual(tem('a senha é Lago.Cometa.5120', parecidos), ['valor do cofre PAINEL_SENHA no texto (senha de página do cliente? libere em config.json → senhasDeCliente)']);
  // o trecho que localiza o achado não mostra nenhum pedaço do valor separado (nem de outro achado antes dele)
  const tok = ['ghp_', 'A1b2'.repeat(9)].join('');
  const r = lint(msg(`de novo: ${separado(SENHA_AURORA, ' ')} ok ${separado(SENHA_AURORA, ' ')} ${tok}`), { segredos: cofre, agora: TERCA_10H });
  assert.equal(r.bloqueios.length, 2);
  for (const b of r.bloqueios) assert.ok(!/(?:^|\s)[A-Za-z0-9#](?:\s[A-Za-z0-9#]){2}/.test(b.trecho), `trecho "${b.trecho}"`);
});

test('destino vazio ou ambíguo e e-mail sem assunto bloqueiam', () => {
  assert.deepEqual(regras(L({ canal: 'whatsapp', corpo: 'oi' })).b, ['destino']);
  const amb = L({ canal: 'whatsapp', corpo: 'oi', candidatos: [{}, {}] });
  assert.match(amb.bloqueios[0].msg, /ambíguo: 2/);
  assert.deepEqual(regras(L({ canal: 'email', destino_id: 'a@exemplo.com', corpo: 'oi' })).b, ['assunto']);
});

test('avisos: duplicada, acento, formato, tamanho, IA', () => {
  assert.ok(regras(lint(msg('oi'), { outrasPendentes: [7, 9], agora: TERCA_10H })).a.includes('duplicada'));
  const ac = lint(msg('nao sei se voce viu, mas já mandei https://site.com/nao-e-video'), { agora: TERCA_10H }).avisos.find((a) => a.regra === 'acento');
  assert.match(ac.msg, /nao, voce$/, 'link e palavra com acento ficam de fora');
  assert.equal(lint(msg('Não sei se você viu'), { agora: TERCA_10H }).avisos.length, 0);

  const fmt = (c, canal = 'whatsapp') => lint(msg(c, { canal, assunto: 'x' }), { agora: TERCA_10H }).avisos.filter((a) => a.regra === 'formato').length;
  assert.equal(fmt('isso é **importante**'), 1);
  assert.equal(fmt('# Título\n> citação'), 2);
  assert.equal(fmt('isso é *importante*'), 0, 'um asterisco é o negrito do WhatsApp');
  assert.equal(fmt('isso é *importante*', 'email'), 1, 'no e-mail o asterisco aparece cru');
  assert.equal(fmt('veja [aqui](https://x.com)', 'email'), 1);
  assert.equal(fmt('**x**', 'discord'), 0);

  const tam = (n, canal = 'whatsapp') => lint(msg('a'.repeat(n), { canal }), { agora: TERCA_10H }).avisos.find((a) => a.regra === 'tamanho')?.msg;
  assert.equal(tam(600), undefined);
  assert.match(tam(700), /^longa/);
  assert.match(tam(1200), /^muito longa/);
  assert.match(tam(2500, 'discord'), /2 partes/);
  assert.equal(tam(2500, 'email'), undefined);

  const ia = lint(msg('Além disso, fico à disposição — vamos viabilizar'), { agora: TERCA_10H }).avisos.find((a) => a.regra === 'ia');
  assert.match(ia.msg, /além disso/);
  assert.match(ia.msg, /fico à disposição/);
  assert.equal(lint(msg('Não é fácil, e o cliente pediu ontem'), { agora: TERCA_10H }).avisos.length, 0, '"e" conjunção não é "é"');
  assert.ok(lint(msg('Não é custo, é investimento'), { agora: TERCA_10H }).avisos.some((a) => a.regra === 'ia'));
});

test('horário: madrugada e fim de semana sugerem o próximo dia útil às 8h', () => {
  const sab = new Date(2026, 9, 3, 15, 0).getTime();
  const h = lint(msg('oi'), { agora: sab }).avisos.find((a) => a.regra === 'horario');
  assert.match(h.msg, /fim de semana/);
  assert.equal(h.sugestao, new Date(2026, 9, 5, 8, 0).getTime(), 'segunda 8h');
  const madrugada = lint(msg('oi'), { agora: new Date(2026, 9, 6, 23, 30).getTime() }).avisos.find((a) => a.regra === 'horario');
  assert.equal(madrugada.sugestao, new Date(2026, 9, 7, 8, 0).getTime(), 'dia seguinte 8h');
  assert.equal(proximoHorarioUtil(new Date(2026, 9, 6, 3, 0).getTime()), new Date(2026, 9, 6, 8, 0).getTime());
  assert.equal(lint(msg('oi'), { agora: TERCA_10H }).avisos.length, 0);
  assert.equal(lint(msg('oi', { agendar_para: TERCA_10H }), { agora: sab }).avisos.length, 0, 'vale o horário agendado');
});

test('cliente cruzado pelos clientes do config.json e pelo diretório de pessoas; sem dados, não avisa nada', () => {
  const cruzado = (texto, extra) => lint(msg(texto, extra), { segredos: [], pessoas, clientes, agora: TERCA_10H })
    .avisos.filter((a) => a.regra === 'cliente_cruzado');
  // o destino é de um cliente (pelo nome do grupo) e o texto fala de outro
  assert.equal(cruzado('o relatório da Cedro sai amanhã', { destino_nome: 'Ingrid - AURORA' })[0].msg, 'o destino é Aurora e a mensagem fala de Cedro');
  // termo cadastrado vale como o nome
  assert.equal(cruzado('o Grupo Cedro pediu de novo', { destino_nome: 'EQUIPE AURORA' }).length, 1);
  // mesma família (clientes do mesmo grupo): um pode aparecer na conversa do outro
  assert.deepEqual(cruzado('a Boreal fechou', { destino_nome: 'Otávio' }), []);
  assert.deepEqual(cruzado('a Boreal fechou com a Aurora', { destino_nome: 'EQUIPE BOREAL' }), []);
  // palavra inteira: "auroras" não é o cliente
  assert.deepEqual(cruzado('vimos duas auroras boreais', { destino_nome: 'Grupo Cedro' }), []);
  // o cliente que a sessão declarou também conta
  assert.equal(cruzado('segue o combinado', { destino_nome: 'Ingrid - AURORA', cliente: 'Cedro' }).length, 1);
  // pelo diretório: a pessoa é de um cliente
  assert.equal(cruzado('a Duna mandou a base', { destino_nome: 'Ingrid' }).length, 1);
  // destino sem cliente conhecido: silêncio
  assert.deepEqual(cruzado('a Aurora e a Cedro fecharam', { destino_nome: 'Grupo da Família' }), []);
  // sem clientes nem pessoas (como a Central começa), o linter não tem de quem desconfiar
  assert.deepEqual(L(msg('a Aurora e a Cedro fecharam', { destino_nome: 'Ingrid - AURORA' })).avisos, []);
});

test('acharPessoa: e-mail, nome completo, apelido e primeiro nome só quando não é ambíguo', () => {
  assert.equal(acharPessoa('ivo@exemplo.com', pessoas)?.nome, 'Ivo Tavares');
  assert.equal(acharPessoa('Ivo Tavares - Trabalho', pessoas)?.nome, 'Ivo Tavares');
  assert.equal(acharPessoa('Ivo', pessoas)?.nome, 'Ivo Tavares');
  assert.equal(acharPessoa('Otávio - AURORA', pessoas, clientes)?.cliente, 'Aurora', 'a mesma pessoa em dois clientes da mesma família é uma só');
  assert.equal(acharPessoa('Otávio', pessoas), null, 'sem a família no config.json são dois clientes: ambíguo');
  assert.equal(acharPessoa('Lara', pessoas, clientes), null, 'duas Laras de clientes diferentes');
  assert.equal(acharPessoa('Grupo da Família', pessoas, clientes), null);
});

test('nomes do cofre: identificador e chave pública ficam de fora do linter', () => {
  // identificador (URL, ID, e-mail, telefone, host, usuário, banco) e chave pública: não são segredo
  for (const n of ['LOJA_API_URL', 'ANALYTICS_MEDIDA_ID', 'CONTATO_EMAIL_PRINCIPAL', 'SUPORTE_PHONE', 'SMTP_HOST',
    'SMTP_USER', 'RELATORIO_ID_SITE', 'CRM_PUBLIC_TOKEN_AURORA', 'CRM_AURORA_TOKEN_PUBLICO',
    'BANCO_DUNA_PUBLISHABLE_KEY', 'SMS_ACCOUNT_SID_DUNA', 'SISTEMA_PG_DB']) assert.equal(nomeEhSegredo(n), false, n);
  // senha, token e chave; identificador que também é senha; e o que não dá para saber conta como segredo
  for (const n of ['SMTP_PASS', 'BANCO_DB_PASSWORD', 'OPENAI_API_KEY', 'PORTAL_AURORA_SENHA',
    'GITHUB_PAT_DADOS', 'CONTATO_EMAIL_PASSWORD', 'SESSAO_SALT', 'PORTAL_BASIC']) assert.equal(nomeEhSegredo(n), true, n);
});
