// Leitura do cofre para o linter, com um cofre falso (script no tmp no lugar do helper de verdade). O estado é
// explícito ({ valores, carregadoEm, ok, falhas, erro, total }): qualquer erro deixa ok=false; o linter bloqueia
// sem valores ou com qualquer nome sem leitura que sirva; a recarga que falha depois de um sucesso usa a leitura
// anterior só até 1 h; a lista de nomes é relida a cada recarga. Nunca toca o cofre de verdade.
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { esquecerCofre, resumoDoCofre, valoresDoCofre } from '../src/segredos.js';
import { lint } from '../src/lint.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-cofre-falso-'));
const bin = path.join(dir, 'secret');
const arq = (nome) => path.join(dir, nome);
// list: os nomes de nomes.txt (fora com lista-fora); get: "valor-de-teste-<NOME>", menos o nome de
// falha-uma-vez.txt (falha só na primeira leitura) e os de falha-sempre.txt; fora-do-ar derruba tudo
fs.writeFileSync(bin, `#!/bin/sh
D='${dir}'
[ -f "$D/fora-do-ar" ] && exit 1
case "$1" in
  list) [ -f "$D/lista-fora" ] && exit 1; cat "$D/nomes.txt" ;;
  get)
    if [ -f "$D/falha-uma-vez.txt" ] && [ "$(cat "$D/falha-uma-vez.txt")" = "$2" ]; then rm "$D/falha-uma-vez.txt"; exit 1; fi
    if [ -f "$D/falha-sempre.txt" ] && grep -qx "$2" "$D/falha-sempre.txt"; then exit 1; fi
    printf 'valor-de-teste-%s\\n' "$2" ;;
esac
`, { mode: 0o755 });
process.env.CENTRAL_SECRET_BIN = bin;
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// cada teste começa com o cofre no ar e nada em memória
function cofre(nomes, { falhaSempre = [], falhaUmaVez = null } = {}) {
  esquecerCofre();
  for (const f of ['fora-do-ar', 'lista-fora', 'falha-sempre.txt', 'falha-uma-vez.txt']) fs.rmSync(arq(f), { force: true });
  fs.writeFileSync(arq('nomes.txt'), nomes.map((n) => `${n}\n`).join(''));
  if (falhaSempre.length) fs.writeFileSync(arq('falha-sempre.txt'), falhaSempre.map((n) => `${n}\n`).join(''));
  if (falhaUmaVez) fs.writeFileSync(arq('falha-uma-vez.txt'), falhaUmaVez);
}
const TERCA_10H = new Date(2026, 9, 6, 10, 0).getTime();
const MIN = 60e3;
// o linter com o estado do cofre, do jeito que o servidor passa (src/server.js, conferir)
const conferir = (texto, r) => lint({ canal: 'whatsapp', destino_id: 'x', destino_nome: 'Grupo', corpo: texto },
  { segredos: r.valores, cofreErro: r.erro, cofreFalhas: r.falhas, cofreTotal: r.total, agora: TERCA_10H });
const bloqueios = (texto, r) => conferir(texto, r).bloqueios.map((b) => b.msg);
// espera a recarga que corre por trás terminar
async function semRecarga() {
  for (let k = 0; k < 300 && resumoDoCofre().lendo; k++) await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(resumoDoCofre().lendo, false, 'a recarga terminou');
}

test('cofre: o valor que falhou no lote é lido de novo; leitura completa = ok, sem falhas, e o linter confere', async () => {
  cofre(['A_SENHA', 'B_TOKEN', 'C_KEY', 'EMAIL_LOGIN_URL'], { falhaUmaVez: 'A_SENHA' });
  const r = await valoresDoCofre();
  assert.equal(r.ok, true);
  assert.equal(r.erro, null);
  assert.deepEqual(r.falhas, []);
  assert.equal(r.total, 3, 'identificador (_URL) fica de fora');
  assert.deepEqual(r.valores.map((x) => x.nome).sort(), ['A_SENHA', 'B_TOKEN', 'C_KEY']);
  assert.ok(!fs.existsSync(arq('falha-uma-vez.txt')), 'falhou uma vez e foi relido');
  assert.equal(typeof r.carregadoEm, 'number');
  assert.deepEqual(bloqueios('bom dia', r), []);
  assert.deepEqual(bloqueios('a chave: valor-de-teste-B_TOKEN', r).filter((m) => /B_TOKEN/.test(m)), ['valor do cofre B_TOKEN no texto (senha de página do cliente? libere em config.json → senhasDeCliente)']);
});

test('cofre falhando na 1ª carga bloqueia: fora do ar, lista vazia e nenhum valor lido (e tenta de novo só depois de 1 min)', async () => {
  cofre(['A_SENHA', 'B_TOKEN']);
  fs.writeFileSync(arq('fora-do-ar'), '');
  const t0 = Date.now();
  const r = await valoresDoCofre({ agora: t0 });
  assert.equal(r.ok, false);
  assert.equal(r.valores, null, 'nada lido não vira lista vazia');
  assert.match(r.erro, /^não consegui listar o cofre/);
  assert.deepEqual(conferir('bom dia', r).bloqueios.map((b) => [b.msg, b.naoChecou]), [[`não consegui verificar segredos: ${r.erro}`, true]]);
  // o cofre volta: antes de 1 min continua o estado ruim (não martela o cofre); depois relê
  fs.rmSync(arq('fora-do-ar'));
  assert.equal((await valoresDoCofre({ agora: t0 + 30e3 })).valores, null);
  const volta = await valoresDoCofre({ agora: t0 + 61e3 });
  assert.equal(volta.ok, true);
  assert.deepEqual(bloqueios('bom dia', volta), []);

  cofre([]); // o cofre respondeu, mas sem nome nenhum: não é "nada a conferir"
  const vazio = await valoresDoCofre();
  assert.equal(vazio.valores, null);
  assert.deepEqual(bloqueios('bom dia', vazio), ['não consegui verificar segredos: o cofre não listou nenhum nome']);

  cofre(['A_SENHA', 'B_TOKEN'], { falhaSempre: ['A_SENHA', 'B_TOKEN'] }); // lista veio, nenhum valor (cofre trancado)
  const trancado = await valoresDoCofre();
  assert.equal(trancado.ok, false);
  assert.deepEqual(trancado.falhas, ['A_SENHA', 'B_TOKEN']);
  assert.match(trancado.erro, /nenhum dos 2 valores/);
  assert.deepEqual(bloqueios('bom dia', trancado), ['não consegui verificar segredos (2 de 2 não lidos: A_SENHA, B_TOKEN)']);
});

test('falha parcial bloqueia, e o que foi lido continua conferido', async () => {
  cofre(['A_SENHA', 'B_TOKEN', 'C_KEY'], { falhaSempre: ['B_TOKEN'] });
  const r = await valoresDoCofre();
  assert.equal(r.ok, false);
  assert.deepEqual(r.falhas, ['B_TOKEN']);
  assert.equal(r.erro, 'não consegui ler 1 de 3 valores do cofre (B_TOKEN)');
  assert.deepEqual(r.valores.map((x) => x.nome).sort(), ['A_SENHA', 'C_KEY']);
  assert.deepEqual(bloqueios('bom dia', r), ['não consegui verificar segredos (1 de 3 não lidos: B_TOKEN)']);
  const comValor = bloqueios('entra com valor-de-teste-A_SENHA', r);
  assert.equal(comValor.length, 2);
  assert.match(comValor[1], /^valor do cofre A_SENHA/);
});

test('segredo adicionado ao cofre depois da 1ª carga é detectado na recarga seguinte (sem reiniciar)', async () => {
  cofre(['A_SENHA']);
  const r = await valoresDoCofre();
  const t0 = r.carregadoEm;
  fs.writeFileSync(arq('nomes.txt'), 'A_SENHA\nD_NOVA_SENHA\n');
  const texto = 'o acesso novo é valor-de-teste-D_NOVA_SENHA';
  assert.deepEqual(bloqueios(texto, r), [], 'antes da recarga o nome novo não existia');
  // 11 min: responde na hora com o que tem e relê por trás (a lista de nomes também)
  const velha = await valoresDoCofre({ agora: t0 + 11 * MIN });
  assert.equal(velha.total, 1);
  await semRecarga();
  const nova = await valoresDoCofre({ agora: t0 + 11 * MIN + 1000 });
  assert.equal(nova.ok, true);
  assert.equal(nova.total, 2);
  assert.deepEqual(bloqueios(texto, nova), ['valor do cofre D_NOVA_SENHA no texto (senha de página do cliente? libere em config.json → senhasDeCliente)']);
  // nome que sai do cofre sai da conferência
  fs.writeFileSync(arq('nomes.txt'), 'D_NOVA_SENHA\n');
  await valoresDoCofre({ agora: t0 + 22 * MIN });
  await semRecarga();
  const semA = await valoresDoCofre({ agora: t0 + 22 * MIN + 1000 });
  assert.deepEqual(semA.valores.map((x) => x.nome), ['D_NOVA_SENHA']);
});

test('recarga que falha depois de um sucesso: leitura anterior vale até 1 h (nome NOVO sem leitura bloqueia); depois disso, bloqueia', async () => {
  cofre(['A_SENHA', 'B_TOKEN']);
  const r = await valoresDoCofre();
  const t0 = r.carregadoEm;
  // a lista some aos 11 min: ok=false, mas a leitura de 11 min cobre tudo e o linter confere com ela
  fs.writeFileSync(arq('lista-fora'), '');
  await valoresDoCofre({ agora: t0 + 11 * MIN });
  await semRecarga();
  const degradado = await valoresDoCofre({ agora: t0 + 11 * MIN + 1000 });
  assert.equal(degradado.ok, false);
  assert.match(degradado.erro, /^não consegui listar o cofre/);
  assert.deepEqual(degradado.falhas, []);
  assert.deepEqual(bloqueios('bom dia', degradado), []);
  assert.match(bloqueios('valor-de-teste-B_TOKEN', degradado)[0], /^valor do cofre B_TOKEN/);
  assert.deepEqual(resumoDoCofre({ agora: t0 + 11 * MIN + 1000 }),
    { ok: false, idadeMin: 11, total: 2, falhas: [], erro: degradado.erro, bloqueia: false, lendo: false });
  // 61 min: a última lista boa passou de 1 h → bloqueia com o motivo
  const vencido = await valoresDoCofre({ agora: t0 + 61 * MIN });
  assert.equal(vencido.valores, null);
  assert.match(bloqueios('bom dia', vencido)[0], /^não consegui verificar segredos: não consegui listar o cofre .*; a última lista boa do cofre tem 61 min \(o máximo é 60\)$/);
  assert.equal(resumoDoCofre({ agora: t0 + 61 * MIN }).bloqueia, true);

  // lista no ar, mas um valor velho que não relê e um nome NOVO que não lê
  cofre(['A_SENHA', 'B_TOKEN']);
  const r2 = await valoresDoCofre();
  const t1 = r2.carregadoEm;
  fs.writeFileSync(arq('nomes.txt'), 'A_SENHA\nB_TOKEN\nC_NOVA_SENHA\n');
  fs.writeFileSync(arq('falha-sempre.txt'), 'B_TOKEN\nC_NOVA_SENHA\n');
  await valoresDoCofre({ agora: t1 + 11 * MIN });
  await semRecarga();
  const novo = await valoresDoCofre({ agora: t1 + 11 * MIN + 1000 });
  assert.equal(novo.ok, false);
  assert.deepEqual(novo.falhas, ['C_NOVA_SENHA'], 'B_TOKEN segue coberto pela leitura de 11 min atrás');
  assert.deepEqual(bloqueios('bom dia', novo), ['não consegui verificar segredos (1 de 3 não lidos: C_NOVA_SENHA)']);
  assert.equal(resumoDoCofre({ agora: t1 + 11 * MIN + 1000 }).idadeMin, 11, 'a idade é a da leitura mais velha em uso');
  // aos 61 min a leitura de B_TOKEN também não vale mais
  const velho = await valoresDoCofre({ agora: t1 + 61 * MIN });
  assert.deepEqual(velho.falhas, ['B_TOKEN', 'C_NOVA_SENHA']);
  assert.deepEqual(bloqueios('bom dia', velho), ['não consegui verificar segredos (2 de 3 não lidos: B_TOKEN, C_NOVA_SENHA)']);
});

test('o resumo para /api/saude não leva valor nenhum', async () => {
  cofre(['A_SENHA', 'B_TOKEN'], { falhaSempre: ['B_TOKEN'] });
  await valoresDoCofre();
  const resumo = resumoDoCofre();
  assert.deepEqual(Object.keys(resumo).sort(), ['bloqueia', 'erro', 'falhas', 'idadeMin', 'lendo', 'ok', 'total']);
  assert.deepEqual([resumo.ok, resumo.total, resumo.falhas, resumo.bloqueia, resumo.idadeMin], [false, 2, ['B_TOKEN'], true, 0]);
  assert.ok(!JSON.stringify(resumo).includes('valor-de-teste'));
});
