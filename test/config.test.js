// config.json do dono: sem arquivo a Central sobe neutra (só o WhatsApp, sem nome, sem cofre, sem cliente); com
// arquivo, o nome dele entra nos textos, os canais ligam e os caminhos com "~" valem a pasta do usuário.
// Tudo em pasta temporária: o config.json de quem roda os testes nunca é lido.
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { carregarConfig, config, dono } from '../src/config.js';
import { textoDaLicao } from '../src/licoes.js';
import { canaisLigados } from '../src/server.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-config-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const rodar = promisify(execFile);
const gravar = (nome, conteudo) => {
  const arquivo = path.join(dir, nome);
  fs.writeFileSync(arquivo, typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo));
  return arquivo;
};
// variável de ambiente ganha do arquivo: aqui o que vale é o arquivo
for (const v of ['CENTRAL_SECRET_BIN', 'CENTRAL_PONTE_STORE', 'CENTRAL_PONTE']) delete process.env[v];

test('sem config.json (ou com ele quebrado) a Central fica neutra: só o WhatsApp, sem nome, sem cofre', () => {
  for (const arquivo of [path.join(dir, 'nao-existe.json'), gravar('quebrado.json', '{ isto não é json'), gravar('lista.json', [1, 2])]) {
    carregarConfig(arquivo);
    assert.deepEqual(config.dono, { nome: '', whatsapp: '' });
    assert.deepEqual(config.clientes, []);
    assert.equal(config.cofre, null);
    assert.deepEqual(config.email.contas, []);
    assert.equal(config.discord.ligado, false);
    assert.deepEqual(Object.keys(canaisLigados()), ['whatsapp']);
    assert.equal(dono(), 'dono');
    assert.equal(textoDaLicao({ tipo: 'evitar', trecho: 'fico à disposição', contagem: 3 }), 'o dono costuma tirar "fico à disposição" (3×)');
  }
});

test('com config.json: nome nos textos, número só com dígitos, clientes, cofre, ponte e os canais ligados', () => {
  carregarConfig(gravar('completo.json', {
    dono: { nome: ' Tobias Arruda ', whatsapp: '+55 11 99999-0099' },
    clientes: [{ nome: 'Aurora', termos: ['Grupo Aurora', ' ', 7] }, { nome: 'Boreal', familia: 'Aurora' }, { termos: ['sem nome'] }, null],
    cofre: { helper: '~/bin/meu-cofre' },
    whatsapp: { store: '~/ponte/store', ponte: 'http://127.0.0.1:8099' },
    email: { contas: [' Tobias@Exemplo.com ', '', null] },
    discord: { donoId: '123456789012345678' },
    janelaDesfazerMs: 5000, // o que o painel grava mora no mesmo arquivo e não atrapalha
  }));
  assert.deepEqual(config.dono, { nome: 'Tobias Arruda', whatsapp: '5511999990099' });
  assert.equal(dono(), 'Tobias');
  assert.equal(textoDaLicao({ tipo: 'trocar', trecho: 'planilha', por: 'tabela', contagem: 2 }), 'o Tobias costuma trocar "planilha" por "tabela" (2×)');
  assert.deepEqual(config.clientes, [
    { nome: 'Aurora', familia: '', termos: ['Grupo Aurora'] },
    { nome: 'Boreal', familia: 'Aurora', termos: [] },
  ]);
  // "~" num caminho escrito à mão vale a pasta do usuário
  assert.equal(config.cofre, path.join(os.homedir(), 'bin/meu-cofre'));
  assert.equal(config.whatsapp.messagesDb, path.join(os.homedir(), 'ponte/store/messages.db'));
  assert.equal(config.whatsapp.sessaoDb, path.join(os.homedir(), 'ponte/store/whatsapp.db'));
  assert.equal(config.whatsapp.ponte, 'http://127.0.0.1:8099');
  assert.deepEqual(config.email.contas, ['tobias@exemplo.com']);
  assert.equal(config.discord.ligado, true);
  assert.equal(config.discord.donoId, '123456789012345678');
  assert.deepEqual(Object.keys(canaisLigados()), ['whatsapp', 'email', 'discord']);

  // só o Discord: o e-mail continua desligado
  carregarConfig(gravar('so-discord.json', { discord: {} }));
  assert.deepEqual(Object.keys(canaisLigados()), ['whatsapp', 'discord']);
  assert.equal(config.cofre, null);
});

test('msg: sem nome fala "o dono"; com nome no config.json da pasta do usuário, usa o primeiro nome', async () => {
  const casa = path.join(dir, 'casa');
  fs.mkdirSync(path.join(casa, '.central-mensagens'), { recursive: true });
  const env = { ...process.env, HOME: casa, CENTRAL_URL: 'http://127.0.0.1:9' }; // porta 9: nenhuma Central responde
  delete env.CENTRAL_DB;
  const msg = (...args) => rodar(process.execPath, [path.join(raiz, 'bin/msg.js'), ...args], { env }).then((r) => r.stdout);

  let guia = await msg('guia');
  assert.match(guia, /A sessão enfileira e o dono lê, edita e aprova/);
  assert.match(guia, /## Lições do dono\n/);
  assert.match(await msg('--help'), /O dono edita, aprova e a Central envia/);

  fs.writeFileSync(path.join(casa, '.central-mensagens/config.json'), JSON.stringify({ dono: { nome: 'Tobias Arruda' } }));
  guia = await msg('guia');
  assert.match(guia, /A sessão enfileira e o Tobias lê, edita e aprova/);
  assert.match(guia, /## Lições do Tobias\n/);
  assert.doesNotMatch(guia, /\bdono\b/);
  assert.match(await msg('--help'), /O Tobias edita, aprova e a Central envia/);
});
