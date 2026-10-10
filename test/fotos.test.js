// Foto de perfil do WhatsApp: o que a Central guarda, o que ela se recusa a baixar e quem pode pedir pela rota.
// Rede, relógio e pasta são do teste; nada pergunta à ponte de verdade.
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { abrirDb } from '../src/db.js';
import { criarFotos } from '../src/fotos.js';
import { criarApp } from '../src/server.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'central-fotos-'));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('foto de mentira')]);
const CLARA = '5511999990001@s.whatsapp.net';
const GRUPO = '120363000000000001@g.us';
const DIA = 24 * 3600e3;
const CDN = 'https://pps.whatsapp.net/v/t61/1.jpg?oh=x&oe=y';

// rede de mentira: `ponte(jid)` diz o que a ponte responde e `cdn(url)` o que o download devolve
function montar({ ponte, cdn = () => new Response(JPG, { headers: { 'content-type': 'image/jpeg' } }) }) {
  const dir = fs.mkdtempSync(path.join(base, 'f-'));
  const pedidos = [];
  let hora = Date.parse('2026-10-05T12:00:00Z');
  const fotos = criarFotos({
    dir,
    ponte: 'http://ponte.teste',
    intervaloMs: 0,
    agora: () => hora,
    rede: async (url) => {
      const u = String(url);
      pedidos.push(u);
      if (u.startsWith('http://ponte.teste/api/avatar?jid=')) {
        const r = ponte(decodeURIComponent(u.split('jid=')[1]));
        return new Response(JSON.stringify(r.json ?? r), { status: r.status || 200, headers: { 'content-type': 'application/json' } });
      }
      return cdn(u);
    },
  });
  const passar = (ms) => { hora += ms; };
  const pronta = async (jid) => { await fotos.foto(jid); await fotos.quieta(); return fotos.foto(jid); };
  return { fotos, dir, pedidos, passar, pronta };
}
const naPonte = (p) => p.pedidos.filter((u) => u.includes('/api/avatar')).length;

test('foto que existe: a primeira tela dispara a busca, a miniatura fica guardada e ninguém pergunta de novo', async () => {
  const t = montar({ ponte: () => ({ success: true, found: true, url: CDN, id: '1' }) });
  assert.equal((await t.fotos.foto(CLARA)).estado, 'buscando');
  await t.fotos.quieta();
  const f = await t.fotos.foto(CLARA);
  assert.equal(f.estado, 'tem');
  assert.deepEqual(fs.readFileSync(f.arquivo), JPG);
  await t.fotos.foto(CLARA);
  await t.fotos.foto(CLARA);
  assert.equal(naPonte(t), 1, 'uma pergunta só');
  assert.equal((await t.pronta(GRUPO)).estado, 'tem', 'grupo também tem foto');
});

test('com a fila curta, quem espera um instante já recebe a foto; pedidos iguais no meio viram uma pergunta só', async () => {
  const t = montar({ ponte: () => ({ success: true, found: true, url: CDN }) });
  const [a, b] = await Promise.all([t.fotos.foto(CLARA, { esperarMs: 2000 }), t.fotos.foto(CLARA, { esperarMs: 2000 })]);
  assert.equal(a.estado, 'tem');
  assert.equal(b.estado, 'tem');
  assert.equal(naPonte(t), 1);
});

test('quem não tem foto (ou esconde) fica marcado por um dia; depois a Central pergunta de novo', async () => {
  let tem = false;
  const t = montar({ ponte: () => ({ success: true, found: tem, url: CDN }) });
  assert.deepEqual(await t.pronta(CLARA), { estado: 'sem' });
  await t.pronta(CLARA);
  assert.equal(naPonte(t), 1, 'dentro do dia não pergunta de novo');
  t.passar(DIA + 60e3);
  tem = true;
  assert.equal((await t.pronta(CLARA)).estado, 'tem', 'a pessoa pôs foto: no dia seguinte aparece');
  assert.equal(naPonte(t), 2);
});

test('foto guardada há mais de 7 dias continua valendo e renova por trás; quem tirou a foto volta para as iniciais', async () => {
  let tem = true;
  const t = montar({ ponte: () => ({ success: true, found: tem, url: CDN }) });
  await t.pronta(CLARA);
  t.passar(8 * DIA);
  assert.equal((await t.fotos.foto(CLARA)).estado, 'tem', 'a antiga serve enquanto a nova não chega');
  await t.fotos.quieta();
  assert.equal(naPonte(t), 2, 'renovou');
  t.passar(8 * DIA);
  tem = false;
  await t.fotos.foto(CLARA);
  await t.fotos.quieta();
  assert.deepEqual(await t.fotos.foto(CLARA), { estado: 'sem' });
});

test('ponte fora do ar não vira "sem foto": fica incerto, sem insistir por 5 minutos', async () => {
  let fora = true;
  const t = montar({ ponte: () => (fora ? { status: 503, json: { success: false, message: 'Not connected to WhatsApp' } } : { success: true, found: true, url: CDN }) });
  assert.deepEqual(await t.pronta(CLARA), { estado: 'sem', incerto: true });
  await t.pronta(CLARA);
  assert.equal(naPonte(t), 1, 'não martela a ponte caída');
  assert.equal(fs.existsSync(path.join(t.dir, `${CLARA}.sem`)), false, 'não marcou como sem foto');
  fora = false;
  t.passar(6 * 60e3);
  assert.equal((await t.pronta(CLARA)).estado, 'tem');
});

test('só baixa JPEG pequeno, por https, do CDN do WhatsApp e sem seguir redirecionamento', async () => {
  const casos = [
    ['outro site', { url: 'https://exemplo.com/a.jpg' }],
    ['sem https', { url: 'http://pps.whatsapp.net/a.jpg' }],
    ['domínio parecido', { url: 'https://pps.whatsapp.net.exemplo.com/a.jpg' }],
    ['rede interna', { url: 'https://127.0.0.1/a.jpg' }],
    ['não é URL', { url: 'javascript:alert(1)' }],
  ];
  for (const [nome, extra] of casos) {
    const t = montar({ ponte: () => ({ success: true, found: true, ...extra }) });
    assert.deepEqual(await t.pronta(CLARA), { estado: 'sem', incerto: true }, nome);
    assert.equal(t.pedidos.length, 1, `${nome}: nada foi baixado`);
  }
  const opcoes = [];
  const html = montar({
    ponte: () => ({ success: true, found: true, url: CDN }),
    cdn: (u) => new Response('<html>entre com sua senha</html>', { headers: { 'content-type': 'image/jpeg' } }),
  });
  assert.deepEqual(await html.pronta(CLARA), { estado: 'sem', incerto: true }, 'o conteúdo manda, não o cabeçalho');
  assert.deepEqual(fs.readdirSync(html.dir).filter((f) => f.endsWith('.jpg')), []);
  const grande = montar({
    ponte: () => ({ success: true, found: true, url: CDN }),
    cdn: () => new Response(Buffer.concat([JPG, Buffer.alloc(600 * 1024)])),
  });
  assert.deepEqual(await grande.pronta(CLARA), { estado: 'sem', incerto: true }, 'grande demais');
  const redir = criarFotos({
    dir: fs.mkdtempSync(path.join(base, 'r-')),
    ponte: 'http://ponte.teste',
    intervaloMs: 0,
    rede: async (url, o = {}) => {
      if (String(url).includes('/api/avatar')) return new Response(JSON.stringify({ success: true, found: true, url: CDN }));
      opcoes.push(o);
      return new Response(JPG);
    },
  });
  await redir.foto(CLARA);
  await redir.quieta();
  assert.equal(opcoes[0].redirect, 'error', 'o download não segue redirecionamento');
});

test('destino que não é do WhatsApp não vira arquivo nem pergunta', async () => {
  const t = montar({ ponte: () => ({ success: true, found: true, url: CDN }) });
  for (const jid of ['../../etc/passwd@s.whatsapp.net', 'abc@s.whatsapp.net', '5511999990001', '5511999990001@exemplo.com', '', 'a/b@g.us', '5511999990001@s.whatsapp.net/../x']) {
    assert.deepEqual(await t.fotos.foto(jid), { estado: 'invalido' }, jid);
  }
  assert.equal(t.pedidos.length, 0);
  assert.deepEqual(fs.readdirSync(t.dir), []);
});

// ---------------------------------------------------------------- a rota

async function subir({ fotos, conhecido = () => true, repo = abrirDb(':memory:') }) {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const porta = s.address().port;
  const canal = {
    id: 'whatsapp', nome: 'WhatsApp', contaPadrao: 'pessoal', contas: () => [{ id: 'pessoal', nome: 'WhatsApp pessoal' }],
    saude: async () => ({ ok: true, resumo: 'ok' }), buscar: () => [], conhecido,
    resolver: (p) => ({ destino: { id: p, nome: p, tipo: 'contato' } }),
  };
  const app = criarApp({ porta, repo, canais: { whatsapp: canal }, fotos });
  s.on('request', app);
  const pedir = (jid, cab = {}) => fetch(`http://127.0.0.1:${porta}/api/fotos/whatsapp/${jid}`, { headers: cab });
  return { pedir, repo, porta, fechar: () => { app.parar(); s.closeAllConnections(); s.close(); } };
}

test('rota: 200 com a miniatura, 204 sem foto, 202 enquanto pergunta; o navegador só guarda a resposta certa', async () => {
  const arq = path.join(base, 'rota.jpg');
  fs.writeFileSync(arq, JPG);
  let resposta = { estado: 'tem', arquivo: arq };
  const srv = await subir({ fotos: { foto: async () => resposta } });
  try {
    let r = await srv.pedir(encodeURIComponent(CLARA), { 'sec-fetch-site': 'same-origin' });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('cache-control'), /private, max-age=/);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), JPG);

    resposta = { estado: 'sem' };
    r = await srv.pedir(CLARA);
    assert.equal(r.status, 204);
    assert.match(r.headers.get('cache-control'), /max-age=/, 'sem foto de verdade pode ficar guardado');

    resposta = { estado: 'sem', incerto: true };
    r = await srv.pedir(CLARA);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('cache-control'), 'no-store', 'ponte caída não fica guardada como "sem foto"');

    resposta = { estado: 'buscando', pronto: Promise.resolve() };
    r = await srv.pedir(CLARA);
    assert.equal(r.status, 202);
    assert.equal(r.headers.get('cache-control'), 'no-store');

    resposta = { estado: 'tem', arquivo: path.join(base, 'apagada.jpg') };
    r = await srv.pedir(CLARA);
    assert.equal(r.status, 204, 'arquivo que sumiu no meio não derruba a rota');
  } finally { srv.fechar(); }
});

test('rota: só a própria interface pede, e só de quem o WhatsApp do dono conhece ou é destino da fila', async () => {
  const pedidos = [];
  const fotos = { foto: async (jid) => { pedidos.push(jid); return { estado: 'sem' }; } };
  const srv = await subir({ fotos, conhecido: (jid) => jid === CLARA });
  try {
    for (const origem of ['cross-site', 'same-site']) {
      const r = await srv.pedir(CLARA, { 'sec-fetch-site': origem });
      assert.equal(r.status, 403, `página de outro lugar (${origem}) não sonda número pela Central`);
    }
    assert.equal(pedidos.length, 0);

    const estranho = '5511999990061@s.whatsapp.net';
    let r = await srv.pedir(estranho);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(pedidos.length, 0, 'número desconhecido não gera pergunta ao WhatsApp');

    srv.repo.criar({ canal: 'whatsapp', destino_id: estranho, destino_nome: 'Número novo', corpo: 'oi', origem: {} });
    await srv.pedir(estranho);
    assert.deepEqual(pedidos, [estranho], 'destino de mensagem da fila pode');

    await srv.pedir(CLARA, { 'sec-fetch-site': 'none' });
    assert.deepEqual(pedidos, [estranho, CLARA]);

    for (const torto of ['abc', encodeURIComponent('../../x@s.whatsapp.net'), '%E0%A4%A', encodeURIComponent('5511999990001@exemplo.com')]) {
      r = await srv.pedir(torto);
      assert.equal(r.status, 400, torto);
    }
    assert.equal(pedidos.length, 2);
  } finally { srv.fechar(); }
});

test('rota: sem o serviço de fotos (testes, ponte nunca configurada) responde "sem foto" e não quebra', async () => {
  const srv = await subir({ fotos: null });
  try {
    const r = await srv.pedir(CLARA);
    assert.equal(r.status, 204);
  } finally { srv.fechar(); }
});
