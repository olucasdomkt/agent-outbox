// Fila v2: janela de desfazer, versões, motivo de descarte, agenda e busca (núcleo, sem HTTP).
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspecionarAnexos } from '../src/anexos.js';
import { abrirDb, MOTIVOS } from '../src/db.js';
import { iniciarDespachante } from '../src/despachante.js';
import { lint } from '../src/lint.js';

const cfgTeste = { tickMs: 999999, retentarPorMin: 360 };
// o linter do despachante sem o cofre de verdade (lista vazia = conferido, só os padrões contam)
const conferir = async (m) => lint(m, { segredos: [], anexos: inspecionarAnexos(m.anexos) });

// relógio controlado pelo teste, o mesmo para o repo e para o despachante
function relogio(inicio = 1_800_000_000_000) {
  let t = inicio;
  return { agora: () => t, andar: (ms) => { t += ms; } };
}

function canalFalso(enviar = async () => ({ resumo: 'ok' })) {
  const enviados = [];
  return {
    enviados,
    canal: {
      id: 'teste', nome: 'Teste', contaPadrao: 'a', contas: () => [{ id: 'a', nome: 'A' }],
      async enviar(m) { enviados.push(m); return enviar(m); },
    },
  };
}

test('desfazer em 9,9 s ganha do despachante em 10 s: nunca envia', async () => {
  const r = relogio();
  const repo = abrirDb(':memory:', { agora: r.agora });
  const { canal, enviados } = canalFalso();
  const d = iniciarDespachante({ conferir, repo, canais: { teste: canal }, config: cfgTeste, log: () => {}, agora: r.agora });
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  const aprovada = repo.aprovar(m.id, null, { janelaMs: 10_000 });
  assert.equal(aprovada.liberar_em, r.agora() + 10_000);

  r.andar(5_000);
  await d.tick();
  assert.equal(enviados.length, 0, 'dentro da janela o despachante não pega');

  r.andar(4_900); // 9,9 s
  assert.equal(repo.desfazer(m.id).status, 'pendente');
  r.andar(100); // 10 s
  await d.tick();
  r.andar(60_000);
  await d.tick();
  d.parar();
  assert.equal(enviados.length, 0, 'desfeita não sai nunca');
  assert.equal(repo.obter(m.id).status, 'pendente');
  assert.equal(repo.obter(m.id).liberar_em, null);
});

test('janela vencida: sai em 10 s; depois de "enviando", desfazer dá 409 ja_saiu', async () => {
  const r = relogio();
  const repo = abrirDb(':memory:', { agora: r.agora });
  let soltar;
  const segura = new Promise((ok) => { soltar = ok; });
  const { canal, enviados } = canalFalso(async () => { await segura; return { resumo: 'ok' }; });
  const d = iniciarDespachante({ conferir, repo, canais: { teste: canal }, config: cfgTeste, log: () => {}, agora: r.agora });
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  repo.aprovar(m.id, null, { janelaMs: 10_000 });

  r.andar(9_999);
  await d.tick();
  assert.equal(enviados.length, 0, '1 ms antes da janela ainda não sai');

  r.andar(1);
  const envio = d.tick();
  assert.equal(repo.obter(m.id).status, 'enviando');
  assert.throws(() => repo.desfazer(m.id), (e) => e.status === 409 && e.message === 'ja_saiu' && e.dados.status === 'enviando');
  soltar();
  await envio;
  d.parar();
  assert.equal(enviados.length, 1);
  assert.equal(repo.obter(m.id).status, 'enviada');
  assert.throws(() => repo.desfazer(m.id), (e) => e.status === 409 && e.dados.status === 'enviada');
});

test('trava no SQL: marcarEnviando recusa aprovada com janela aberta e agendada para depois', () => {
  const r = relogio();
  const repo = abrirDb(':memory:', { agora: r.agora });
  const a = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'a' });
  repo.aprovar(a.id, null, { janelaMs: 10_000 });
  assert.equal(repo.marcarEnviando(a.id), false, 'janela aberta');
  r.andar(10_000);
  assert.equal(repo.marcarEnviando(a.id), true);
  assert.equal(repo.marcarEnviando(a.id), false, 'só um pega');

  const b = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'b' });
  repo.aprovar(b.id, r.agora() + 3_600e3);
  assert.equal(repo.proximaParaEnviar(r.agora()), undefined, 'agendada não aparece antes da hora');
  assert.equal(repo.marcarEnviando(b.id), false);
  r.andar(3_600e3);
  assert.equal(repo.proximaParaEnviar(r.agora()).id, b.id);
});

test('despachante envia o texto relido do banco, não o que leu antes da trava', async () => {
  const repo = abrirDb(':memory:');
  const { canal, enviados } = canalFalso();
  const d = iniciarDespachante({ conferir, repo, canais: { teste: canal }, config: cfgTeste, log: () => {} });
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'versão 1' });
  repo.aprovar(m.id);
  const original = repo.marcarEnviando.bind(repo);
  // simula outra escrita entre a leitura e a trava (o que o UPDATE condicional permite)
  repo.marcarEnviando = (id) => {
    repo.db.prepare("UPDATE mensagens SET corpo = 'versão 2' WHERE id = ?").run(id);
    return original(id);
  };
  await d.tick();
  d.parar();
  assert.equal(enviados[0].corpo, 'versão 2');
});

test('editar aprovada que ainda não saiu volta para pendente; enviando não deixa editar', () => {
  const r = relogio();
  const repo = abrirDb(':memory:', { agora: r.agora });
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  repo.aprovar(m.id, null, { janelaMs: 10_000 });
  assert.throws(() => repo.editar(m.id, { corpo: 'x' }), /aprovada/, 'sem reabrir vale a regra antiga');
  const e = repo.editar(m.id, { corpo: 'olá' }, { reabrir: true });
  assert.equal(e.status, 'pendente');
  assert.equal(e.corpo, 'olá');
  assert.equal(e.liberar_em, null);
  assert.equal(e.aprovado_em, null);
  assert.deepEqual(repo.eventos(m.id).map((x) => x.tipo).slice(-2), ['editada', 'desaprovada']);

  repo.aprovar(m.id);
  repo.marcarEnviando(m.id);
  assert.throws(() => repo.editar(m.id, { corpo: 'tarde demais' }, { reabrir: true }), (x) => x.status === 409);
});

test('descartar grava motivo_codigo e motivo; código inválido é recusado; restaurar limpa', () => {
  const repo = abrirDb(':memory:');
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  assert.throws(() => repo.descartar(m.id, null, 'chato'), (e) => e.status === 400);
  const d = repo.descartar(m.id, 'já falei com ele por telefone', 'ja_mandei');
  assert.equal(d.status, 'descartada');
  assert.equal(d.motivo_codigo, 'ja_mandei');
  assert.equal(d.motivo, 'já falei com ele por telefone');
  const r = repo.restaurar(m.id);
  assert.equal(r.motivo_codigo, null);
  assert.equal(r.motivo, null);
  // Enter sem motivo
  assert.equal(repo.descartar(m.id).motivo_codigo, null);
  assert.ok(MOTIVOS.includes('auto_respondida'));
});

test('agendar só grava o horário; em aprovada reprograma e null manda sair já', () => {
  const r = relogio();
  const repo = abrirDb(':memory:', { agora: r.agora });
  const m = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  const amanha = r.agora() + 86400e3;
  const a = repo.agendar(m.id, amanha);
  assert.equal(a.status, 'pendente', 'agendar não aprova');
  assert.equal(a.agendar_para, amanha);
  const ap = repo.aprovar(m.id, a.agendar_para, { janelaMs: 10_000 });
  assert.equal(ap.agendar_para, amanha);
  assert.equal(repo.agendar(m.id, null).proxima_tentativa, r.agora());
  r.andar(10_000);
  assert.equal(repo.proximaParaEnviar(r.agora()).id, m.id, 'sem horário, sai depois da janela');
});

test('nova versão: a anterior pendente ou aprovada vira substituida; enviada deixa aviso', () => {
  const repo = abrirDb(':memory:');
  const v1 = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'versão 1', sessao_nome: 'S1' });
  const v2 = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'versão 2', substitui_id: v1.id, sessao_nome: 'S1' });
  assert.equal(repo.obter(v1.id).status, 'substituida');
  assert.equal(v2.substitui_id, v1.id);
  repo.aprovar(v2.id, null, { janelaMs: 10_000 });
  const v3 = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'versão 3', substitui_id: v2.id });
  assert.equal(repo.obter(v2.id).status, 'substituida', 'aprovada esperando a janela também sai da fila');
  const cadeia = repo.versoes(v2.id);
  assert.deepEqual(cadeia.map((x) => x.id), [v1.id, v2.id, v3.id]);
  assert.deepEqual(Object.keys(cadeia[0]).sort(), ['corpo', 'criado_em', 'id', 'sessao_nome', 'status']);
  assert.deepEqual(repo.versoes(v1.id).map((x) => x.id), [v1.id, v2.id, v3.id]);

  repo.aprovar(v3.id);
  repo.marcarEnviando(v3.id);
  repo.marcarEnviada(v3.id, { resumo: 'ok' });
  const v4 = repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'versão 4', substitui_id: v3.id });
  assert.equal(repo.obter(v3.id).status, 'enviada');
  assert.ok(repo.eventos(v4.id).some((e) => e.tipo === 'aviso' && /já foi enviada/.test(e.detalhe)));
  assert.throws(() => repo.criar({ canal: 'teste', destino_id: 'g1', corpo: 'x', substitui_id: 9999 }), (e) => e.status === 404);
  assert.equal(repo.contagens().substituida, 2);
});

test('a mesma sessão manda de novo para o mesmo destino: a anterior que não saiu é substituída sozinha', () => {
  const repo = abrirDb(':memory:');
  const da = (sid, extra) => ({ canal: 'teste', destino_id: 'g1', sessao_nome: 'S1', origem: { sessao_id: sid }, ...extra });
  const v1 = repo.criar(da('A', { corpo: 'versão 1' }));
  const v2 = repo.criar(da('A', { corpo: 'versão 2' }));
  assert.equal(repo.obter(v1.id).status, 'substituida');
  assert.equal(v2.substitui_id, v1.id);
  assert.ok(repo.eventos(v1.id).some((e) => e.tipo === 'substituida' && /mesma sessão/.test(e.detalhe)));

  // outra sessão para o mesmo destino, duas mensagens de propósito (tambem) e outro destino: nada some
  const outra = repo.criar(da('B', { corpo: 'outra sessão' }));
  const tambem = repo.criar(da('A', { corpo: 'outro assunto, de propósito', tambem: true }));
  const g2 = repo.criar(da('A', { destino_id: 'g2', corpo: 'para o g2' }));
  assert.equal(repo.obter(v2.id).status, 'pendente');
  assert.deepEqual([outra.substitui_id, tambem.substitui_id, g2.substitui_id], [null, null, null]);

  // a que deu erro sai da fila (e a nova pede para conferir se ela saiu); a que o dono aprovou não some sozinha
  const e1 = repo.criar(da('A', { destino_id: 'g3', corpo: 'vai dar erro' }));
  repo.aprovar(e1.id);
  repo.marcarEnviando(e1.id);
  repo.marcarFalha(e1.id, 'número sem WhatsApp');
  const e2 = repo.criar(da('A', { destino_id: 'g3', corpo: 'número corrigido' }));
  assert.equal(repo.obter(e1.id).status, 'substituida');
  assert.ok(repo.eventos(e2.id).some((e) => e.tipo === 'aviso' && /deu erro/.test(e.detalhe)));
  const a1 = repo.criar(da('A', { destino_id: 'g4', corpo: 'aprovada' }));
  repo.aprovar(a1.id, null, { janelaMs: 10_000 });
  assert.equal(repo.criar(da('A', { destino_id: 'g4', corpo: 'depois de aprovada' })).substitui_id, null);
  assert.equal(repo.obter(a1.id).status, 'aprovada');

  // destino ainda a escolher: vale o que a sessão pediu; sem id de sessão (painel), nada é automático
  const u1 = repo.criar({ canal: 'teste', para_pedido: 'Valter', corpo: 'sem destino 1', origem: { sessao_id: 'A' } });
  assert.equal(repo.criar({ canal: 'teste', para_pedido: 'Valter', corpo: 'sem destino 2', origem: { sessao_id: 'A' } }).substitui_id, u1.id);
  const p1 = repo.criar({ canal: 'teste', destino_id: 'g5', corpo: 'painel 1', sessao_nome: 'painel' });
  repo.criar({ canal: 'teste', destino_id: 'g5', corpo: 'painel 2', sessao_nome: 'painel' });
  assert.equal(repo.obter(p1.id).status, 'pendente');
});

test('busca sem acento e filtro de cliente na lista', () => {
  const repo = abrirDb(':memory:');
  repo.criar({ canal: 'teste', destino_id: 'g1', destino_nome: 'Otávio Ramos', corpo: 'Relatório do trimestre', cliente: 'aurora' });
  repo.criar({ canal: 'teste', destino_id: 'g2', destino_nome: 'Lívia', corpo: 'Banner do evento', cliente: 'Duna', responder_a: 'Lívia: cadê o banner?' });
  repo.criar({ canal: 'teste', destino_id: 'g3', destino_nome: 'Outro', corpo: '50% de desconto', sessao_nome: 'DUNA - Revisão' });
  assert.deepEqual(repo.listar({ q: 'otavio' }).map((m) => m.destino_nome), ['Otávio Ramos']);
  assert.deepEqual(repo.listar({ q: 'relatorio trimestre' }).length, 0, 'busca é por trecho, não por palavras soltas');
  assert.equal(repo.listar({ q: 'cade o banner' }).length, 1, 'acha em responder_a');
  assert.equal(repo.listar({ q: 'revisao' }).length, 1, 'acha em sessao_nome');
  assert.equal(repo.listar({ q: '50%' }).length, 1, '% é literal');
  assert.equal(repo.listar({ q: '%' }).length, 1);
  assert.equal(repo.listar({ cliente: 'Aurora' }).length, 1, 'cliente sem diferenciar maiúscula');
  assert.equal(repo.listar({ cliente: 'duna', status: 'pendente' }).length, 1);
});

test('migração v2 é idempotente e copia o motivo antigo dos descartes uma vez só', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const arq = path.join(os.tmpdir(), `central-migracao-${process.pid}.db`);
  for (const s of ['', '-wal', '-shm']) fs.rmSync(arq + s, { force: true });
  const r1 = abrirDb(arq);
  const a = r1.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi' });
  const b = r1.criar({ canal: 'teste', destino_id: 'g1', corpo: 'oi 2' });
  // simula descarte de antes da v2: só o evento tem o motivo
  r1.db.prepare("UPDATE mensagens SET status = 'descartada' WHERE id IN (?, ?)").run(a.id, b.id);
  r1.evento(a.id, 'descartada', 'sumiu sozinha: você já mandou isso para Fulano');
  r1.evento(b.id, 'descartada', 'destino errado');
  r1.db.prepare("DELETE FROM estado WHERE chave = 'migracao_motivos_v2'").run();
  r1.db.close();
  const r2 = abrirDb(arq);
  assert.equal(r2.obter(a.id).motivo_codigo, 'auto_respondida');
  assert.equal(r2.obter(b.id).motivo, 'destino errado');
  assert.equal(r2.obter(b.id).motivo_codigo, null, 'motivo em texto livre não vira código por chute');
  r2.db.prepare('UPDATE mensagens SET motivo = NULL WHERE id = ?').run(b.id);
  r2.db.close();
  const r3 = abrirDb(arq);
  assert.equal(r3.obter(b.id).motivo, null, 'a cópia do motivo roda uma vez só');
  r3.db.close();
  for (const s of ['', '-wal', '-shm']) fs.rmSync(arq + s, { force: true });
});
