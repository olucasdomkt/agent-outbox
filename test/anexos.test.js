// Anexos: a validação de anexo (src/anexos.js). Tudo numa home falsa no tmp: nada aqui toca ~/.ssh de verdade.
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardarAnexos, inspecionarAnexos, lerValidado, lerValidados, validarAnexo, validarAnexos } from '../src/anexos.js';
import { lint } from '../src/lint.js';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'central-anexos-'));
const home = path.join(base, 'home');
const fora = path.join(base, 'fora');
fs.mkdirSync(fora, { recursive: true });
test.after(() => fs.rmSync(base, { recursive: true, force: true }));
const opcoes = { home };
const criar = (arquivo, conteudo = 'x') => {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, conteudo);
  return arquivo;
};
const recusa = (fn, codigo, re) => assert.throws(fn, (e) => e.status === 400 && e.codigo === codigo && (!re || re.test(e.message)));
const TERCA_10H = new Date(2026, 9, 6, 10, 0).getTime();
const lintCom = (caminhos) => lint({ canal: 'email', destino_id: 'a@exemplo.com', assunto: 'x', corpo: 'segue', anexos: caminhos },
  { segredos: [], agora: TERCA_10H, anexos: inspecionarAnexos(caminhos, opcoes) });
const regrasDe = (r) => r.bloqueios.map((b) => b.regra);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%'), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]), Buffer.from('\n1 0 obj\n<< /Type /Catalog >>\nendobj\n')]);
const CHAVE = `sk-ant-api03-${'AbC1'.repeat(8)}`;
const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUtZmFrZS10ZXN0ZQ==\n-----END OPENSSH PRIVATE KEY-----\n';

test('symlink que aponta para ~/.ssh é negado pelo caminho real, sem ler o conteúdo', () => {
  criar(path.join(home, '.ssh/config'), 'Host segredo-do-teste');
  criar(path.join(home, '.ssh/id_ed25519'), PEM);
  const link = path.join(fora, 'relatorio.pdf');
  fs.symlinkSync(path.join(home, '.ssh/config'), link);
  recusa(() => validarAnexo(link, opcoes), 'sensivel', /^anexo recusado, está em ~\/\.ssh \(chaves SSH\): .*relatorio\.pdf → .*\.ssh\/config$/);
  assert.throws(() => validarAnexo(link, opcoes), (e) => !e.message.includes('segredo-do-teste'), 'nunca mostra o conteúdo');
  // pasta inteira por symlink e o nome da chave pelo alvo
  const pasta = path.join(fora, 'docs');
  fs.symlinkSync(path.join(home, '.ssh'), pasta);
  recusa(() => validarAnexo(path.join(pasta, 'config'), opcoes), 'sensivel', /~\/\.ssh/);
  const outro = path.join(fora, 'foto.png');
  fs.symlinkSync(path.join(home, '.ssh/id_ed25519'), outro);
  recusa(() => validarAnexos([outro], opcoes), 'sensivel');
  // "../" não escapa
  recusa(() => validarAnexo(path.join(home, 'Documents/../.ssh/config'), opcoes), 'sensivel');
});

test('caixa e Unicode: ~/.SSH em outra caixa e home com acento em outra forma são negados; a pasta é por segmento', () => {
  // a pasta foi criada em MAIÚSCULAS no disco: o caminho real volta como está e a comparação é sem caixa
  const h = path.join(base, 'home-caixa');
  criar(path.join(h, '.SSH/id_teste'), 'x');
  recusa(() => validarAnexo(path.join(h, '.SSH/id_teste'), { home: h }), 'sensivel', /~\/\.ssh/);
  // no disco do Mac (sem diferença de caixa), o mesmo arquivo pedido em minúsculas também cai
  if (fs.existsSync(path.join(h, '.ssh/id_teste'))) recusa(() => validarAnexo(path.join(h, '.ssh/id_teste'), { home: h }), 'sensivel');
  // "ação" composto (NFC) no disco e a home dada decomposta (NFD), e o contrário
  const nfc = path.join(base, 'ação');
  criar(path.join(nfc, '.aws/credentials'), 'x');
  recusa(() => validarAnexo(path.join(nfc, '.aws/credentials'), { home: path.join(base, 'ação') }), 'sensivel', /~\/\.aws/);
  recusa(() => validarAnexo(path.join(base, 'ação', '.aws/credentials'), { home: nfc }), 'sensivel', /~\/\.aws/);
  // ".sshx" não é ".ssh", e "home-caixa-2" não está dentro de "home-caixa"
  assert.equal(validarAnexo(criar(path.join(h, '.sshx/notas.txt')), { home: h }).tipo, 'texto');
  assert.equal(validarAnexo(criar(path.join(base, 'home-caixa-2', '.ssh', 'notas.txt')), { home: h }).tipo, 'texto');
});

test('pastas e nomes de credencial da lista são negados; o resto da home passa', () => {
  const pastas = ['.gnupg/pubring.kbx', '.kube/config', '.aws/credentials', '.config/gcloud/application_default_credentials.json',
    '.docker/config.json', '.netrc', '.git-credentials', '.npmrc', '.pypirc', '.google_workspace_mcp/credentials/tobias.json',
    '.workspace-mcp/credentials.json', '.claude/.credentials.json', '.claude-x/.credentials.json', '.claude.json',
    '.claude.json.backup', '.claude.json.tmp.123.abc', 'Library/Keychains/login.keychain-db',
    '.central-mensagens/central.db', '.central-mensagens/central.db-wal'];
  for (const rel of pastas) recusa(() => validarAnexo(criar(path.join(home, rel)), opcoes), 'sensivel', undefined);
  const nomes = ['.env', '.env.local', '.envrc', 'producao.env', 'chave.pem', 'apresentacao.key', 'cert.p12', 'cert.pfx',
    'senhas.kdbx', 'id_rsa', 'id_rsa.pub', 'id_ed25519', 'credentials.json', 'client_secret_123.apps.googleusercontent.com.json',
    'service-account-prod.json', 'CREDENTIALS.JSON'];
  for (const nome of nomes) {
    recusa(() => validarAnexo(criar(path.join(fora, nome)), opcoes), 'sensivel', /^anexo recusado, nome de arquivo de credencial/);
  }
  recusa(() => validarAnexo(path.join(fora, 'apresentacao.key'), opcoes), 'sensivel', /se for Keynote, exporte em PDF/);
  // o link com nome de credencial também cai, mesmo apontando para arquivo comum
  const env = path.join(fora, 'links/.env');
  fs.mkdirSync(path.dirname(env), { recursive: true });
  fs.symlinkSync(criar(path.join(fora, 'notas.txt'), 'oi'), env);
  recusa(() => validarAnexo(env, opcoes), 'sensivel');
  // cópia durável, documentos e o resto da home: passam
  for (const rel of ['.central-mensagens/anexos/12/proposta.pdf', '.central-mensagens/config.json', 'Documents/relatorio.pdf',
    '.claude/notas/aurora-plano.md', '.sshconfig-notas.txt']) {
    assert.equal(validarAnexo(criar(path.join(home, rel)), opcoes).real, fs.realpathSync.native(path.join(home, rel)), rel);
  }
});

test('conteúdo: chave privada ou token dentro de qualquer arquivo é recusado (PDF, hardlink, PEM depois dos 2 MB)', () => {
  // "contrato.pdf" com uma chave OpenSSH no meio dos bytes do PDF
  const contrato = criar(path.join(fora, 'contrato.pdf'), Buffer.concat([PDF, Buffer.from(PEM), PDF]));
  recusa(() => validarAnexo(contrato, opcoes), 'conteudo', /^anexo recusado, tem chave privada dentro: .*contrato\.pdf$/);
  assert.throws(() => validarAnexo(contrato, opcoes), (e) => !e.message.includes('b3BlbnNzaC1rZXkt'), 'nunca mostra o conteúdo');
  assert.ok(lintCom([contrato]).bloqueios.some((b) => b.regra === 'segredo' && b.msg.startsWith('anexo recusado, tem chave privada dentro')));
  // hardlink da chave de ~/.ssh com nome inocente: o caminho não denuncia, o conteúdo sim
  const duro = path.join(fora, 'proposta-final.pdf');
  fs.linkSync(path.join(home, '.ssh/id_ed25519'), duro);
  recusa(() => validarAnexo(duro, opcoes), 'conteudo');
  recusa(() => validarAnexo(criar(path.join(fora, 'chave-pgp.txt'), '-----BEGIN PGP PRIVATE KEY BLOCK-----\nx\n'), opcoes), 'conteudo');
  recusa(() => validarAnexo(criar(path.join(fora, 'planilha.xlsx'), Buffer.concat([PDF, Buffer.from(` ${CHAVE} `)])), opcoes), 'conteudo',
    /tem chave de API \(sk-…\) dentro/);
  // depois dos 2 MB a validação não vê, mas o que é lido para sair (envio, cópia durável) é conferido inteiro
  const longe = path.join(fora, 'relatorio-grande.pdf');
  fs.writeFileSync(longe, Buffer.concat([Buffer.alloc(2.5 * 1048576, 0x20), Buffer.from(PEM)]));
  const v = validarAnexo(longe, opcoes);
  recusa(() => lerValidado(v), 'conteudo');
  recusa(() => lerValidados(validarAnexos([longe], opcoes)), 'conteudo');
});

test('trocar o arquivo depois de validar não vaza: symlink, outro arquivo, mesmo arquivo reescrito e fifo', () => {
  const p = criar(path.join(fora, 'troca.pdf'), PDF);
  const sai = (v) => { try { return lerValidado(v); } catch (e) { return e; } };
  // symlink para a chave no lugar do arquivo conferido: abrir sem seguir symlink recusa
  let v = validarAnexo(p, opcoes);
  fs.rmSync(p);
  fs.symlinkSync(path.join(home, '.ssh/id_ed25519'), p);
  let r = sai(v);
  assert.ok(r instanceof Error && r.codigo === 'mudou', String(r));
  assert.ok(!r.message.includes('OPENSSH'));
  // outro arquivo comum renomeado por cima (mesmo tamanho): o inode não é o conferido
  fs.rmSync(p);
  criar(p, PDF);
  v = validarAnexo(p, opcoes);
  const outro = criar(path.join(fora, 'outro.pdf'), Buffer.from(PDF).fill(0x41, 20));
  fs.renameSync(outro, p);
  r = sai(v);
  assert.ok(r instanceof Error && r.codigo === 'mudou', String(r));
  // o mesmo arquivo reescrito no lugar com uma chave do mesmo tamanho: o conteúdo lido é conferido de novo
  v = validarAnexo(p, opcoes);
  const chave = Buffer.alloc(PDF.length, 0x20);
  Buffer.from(PEM.slice(0, 36)).copy(chave);
  fs.writeFileSync(p, chave);
  r = sai(v);
  assert.ok(r instanceof Error && r.codigo === 'conteudo', String(r));
  // fifo no lugar: não trava esperando quem escreva, e é recusado
  fs.rmSync(p);
  criar(p, PDF);
  v = validarAnexo(p, opcoes);
  fs.rmSync(p);
  execFileSync('mkfifo', [p]);
  r = sai(v);
  assert.ok(r instanceof Error && r.codigo === 'mudou', String(r));
  fs.rmSync(p);
});

test('compactado, pasta, caminho relativo, sumiu e mais de 20 MB por mensagem são recusados com o motivo', () => {
  for (const nome of ['fotos.zip', 'base.tar.gz', 'x.tgz', 'x.7z', 'x.rar', 'x.tar', 'x.bz2', 'x.xz']) {
    const c = criar(path.join(fora, nome));
    assert.equal(validarAnexo(c, opcoes).tipo, 'compactado');
    recusa(() => validarAnexos([c], opcoes), 'compactado', /zip, rar, 7z, tar e gz escondem qualquer coisa/);
  }
  recusa(() => validarAnexo(fora, opcoes), 'nao_arquivo', /não é um arquivo comum/);
  recusa(() => validarAnexo('relativo/proposta.pdf', opcoes), 'caminho', /caminho absoluto/);
  recusa(() => validarAnexos('/x/a.pdf', opcoes), 'caminho', /lista/);
  const sumiu = path.join(fora, 'sumiu.pdf');
  recusa(() => validarAnexo(sumiu, opcoes), 'sumiu', new RegExp(`^anexo não encontrado: ${sumiu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  const a = path.join(fora, 'a.mp4');
  const b = path.join(fora, 'b.mp4');
  for (const c of [a, b]) { fs.writeFileSync(c, ''); fs.truncateSync(c, 11 * 1048576); }
  assert.equal(validarAnexos([a], opcoes).length, 1);
  recusa(() => validarAnexos([a, b], opcoes), 'grande', /^anexos somam 22,0 MB; o limite é 20 MB por mensagem: mande por link$/);
});

test('PDF normal passa como binário (só avisa); texto disfarçado de PDF e UTF-16 vão para o linter inteiro', () => {
  const pdf = criar(path.join(fora, 'proposta.pdf'), PDF);
  const [v] = validarAnexos([pdf], opcoes);
  assert.equal(v.tipo, 'binario');
  assert.equal(v.bytes, PDF.length);
  const r = lintCom([pdf]);
  assert.deepEqual(r.bloqueios, []);
  assert.ok(r.avisos.some((x) => x.regra === 'anexo' && x.msg.startsWith('anexo binário não verificado: proposta.pdf')));
  const png = criar(path.join(fora, 'print.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
  assert.equal(inspecionarAnexos([png], opcoes)[0].binario, true);
  // texto com extensão de PDF: o linter lê inteiro ("senha: X" não é padrão de token, é regra do linter)
  const falso = criar(path.join(fora, 'disfarcado.pdf'), 'acesso do painel, senha: Bri5as#Cometa5120\n');
  assert.ok(lintCom([falso]).bloqueios.some((x) => x.msg === 'parece senha no anexo disfarcado.pdf'));
  // UTF-16 com BOM (exportação "Texto Unicode" do Excel): o token cai na validação, o "senha:" no linter
  const utf16 = (nome, t) => criar(path.join(fora, nome), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]));
  recusa(() => validarAnexo(utf16('export.txt', `token,${CHAVE}\n`), opcoes), 'conteudo');
  assert.ok(lintCom([utf16('export2.txt', 'senha: Bri5as#Cometa5120\n')]).bloqueios.some((x) => x.msg === 'parece senha no anexo export2.txt'));
});

test('CSV com token sk-... é recusado; CSV com valor do cofre bloqueia a aprovação; CSV limpo passa', () => {
  const sujo = criar(path.join(fora, 'leads.csv'), `nome,email,chave\nFulano,f@exemplo.com,${CHAVE}\n`);
  recusa(() => validarAnexos([sujo], opcoes), 'conteudo', /^anexo recusado, tem chave de API \(sk-…\) dentro: .*leads\.csv$/);
  const r = lintCom([sujo]);
  assert.ok(r.bloqueios.some((x) => x.regra === 'segredo' && x.msg.startsWith('anexo recusado, tem chave de API (sk-…) dentro')));
  assert.ok(!JSON.stringify(r).includes(CHAVE.slice(8)));
  const limpo = criar(path.join(fora, 'leads-limpo.csv'), 'nome,email\nFulano,f@exemplo.com\n');
  assert.deepEqual(lintCom([limpo]).bloqueios, []);
  // valor do cofre dentro de anexo de texto: a validação não conhece o cofre, o linter sim
  const comValor = criar(path.join(fora, 'acessos.csv'), 'sistema,codigo\npainel,Qx7-valor-do-cofre\n');
  const doCofre = lint({ canal: 'email', destino_id: 'a@exemplo.com', assunto: 'x', corpo: 'segue', anexos: [comValor] },
    { segredos: [{ nome: 'X_TOKEN', valor: 'Qx7-valor-do-cofre' }], agora: TERCA_10H, anexos: inspecionarAnexos([comValor], opcoes) });
  assert.ok(doCofre.bloqueios.some((x) => x.msg.startsWith('valor do cofre X_TOKEN no anexo acessos.csv')));
});

test('texto que não dá para varrer (grande demais ou ilegível) não pôde ser checado: bloqueia', () => {
  const grande = path.join(fora, 'base-grande.csv');
  fs.writeFileSync(grande, '');
  fs.truncateSync(grande, 21 * 1048576);
  const [g] = inspecionarAnexos([grande], opcoes);
  assert.match(g.naoLido, /^tem 21,0 MB e a varredura lê até 20,0 MB$/);
  assert.ok(lintCom([grande]).bloqueios.some((x) => x.msg.startsWith('anexo base-grande.csv não pôde ser checado: tem 21,0 MB')));
  // sem permissão de leitura: a validação já não consegue conferir o conteúdo
  const trancado = criar(path.join(fora, 'trancado.txt'), 'oi');
  const trancadoPdf = criar(path.join(fora, 'trancado.pdf'), PDF);
  fs.chmodSync(trancado, 0o000);
  fs.chmodSync(trancadoPdf, 0o000);
  try {
    for (const c of [trancado, trancadoPdf]) {
      const [i] = inspecionarAnexos([c], opcoes);
      assert.equal(i.recusa.codigo, 'ilegivel');
      assert.match(i.recusa.msg, /^anexo não pôde ser checado \(não consegui ler: EACCES\): /);
    }
    assert.equal(regrasDe(lintCom([trancado, trancadoPdf])).join(','), 'segredo,segredo');
  } finally {
    fs.chmodSync(trancado, 0o600);
    fs.chmodSync(trancadoPdf, 0o600);
  }
});

test('cópia durável sai do conteúdo conferido: symlink vira arquivo comum, nome repetido ganha (2)', () => {
  const real = criar(path.join(fora, 'real.pdf'), PDF);
  const link = path.join(fora, 'apelido.pdf');
  fs.symlinkSync(real, link);
  const dir = path.join(base, 'anexos');
  const guardar = (caminhos) => guardarAnexos(dir, 5, lerValidados(validarAnexos(caminhos, opcoes)));
  const [copia] = guardar([link]);
  assert.equal(copia, path.join(dir, '5', 'apelido.pdf'));
  assert.ok(fs.lstatSync(copia).isFile(), 'cópia é arquivo, não symlink');
  assert.deepEqual(fs.readFileSync(copia), PDF);
  assert.equal(fs.statSync(copia).mode & 0o777, 0o600);
  const [segunda] = guardar([link]);
  assert.equal(path.basename(segunda), 'apelido (2).pdf');
  assert.deepEqual(guardar([copia]), [copia], 'a cópia desta mensagem fica como está');
  // o symlink que muda de alvo para a chave é recusado na próxima validação
  fs.rmSync(link);
  fs.symlinkSync(criar(path.join(home, '.ssh/outra'), 'chave'), link);
  recusa(() => validarAnexos([link], opcoes), 'sensivel');
});

test('nenhum outro caminho em src/ lê, copia ou grava arquivo sem passar pelo validador', () => {
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  // cada leitura/gravação de arquivo em src/ e por que é segura; linha nova que bate aqui obriga a revisar
  const permitidas = [
    ['anexos.js', /fs\.openSync\(a\.real, fs\.constants\.O_RDONLY \| fs\.constants\.O_NOFOLLOW \| fs\.constants\.O_NONBLOCK\)/], // abrir: o validado
    ['anexos.js', /fs\.readSync\(fd, buf, lidos, n - lidos, lidos\)/], // lerDoDescritor: só com o fd de abrir()
    ['anexos.js', /fs\.writeFileSync\(destino, a\.dados, \{ flag: 'wx', mode: 0o600 \}\)/], // cópia durável: dados de lerValidado
    ['anexos.js', /fs\.writeFileSync\(caminho, dados, \{ flag: 'wx', mode: 0o600 \}\)/], // cópia de envio: dados de lerValidado
    ['server.js', /fs\.createReadStream\(arq, \{ fd \}\)/], // download do anexo: fd de abrirValidado
    ['server.js', /fs\.createReadStream\(alvo\)/], // estático de web/dist, contido na raiz
    ['config.js', /fs\.readFileSync\(arquivo, 'utf8'\)/], // config.json do dono, lido na subida
    ['config.js', /fs\.readFileSync\(config\.whatsapp\.ponteTokenFile, 'utf8'\)/], // token da ponte: caminho fixo (store/bridge.token), sem input do usuário
    ['pessoas.js', /fs\.readFileSync\(arquivo, 'utf8'\)/], // pessoas.json
    ['preferencias.js', /fs\.readFileSync\(arquivo, 'utf8'\)/], // config.json
    ['preferencias.js', /fs\.writeFileSync\(tmp, /], // config.json (gravação atômica)
    ['fotos.js', /fs\.writeFileSync\(tmp, bytes, \{ flag: 'wx', mode: 0o600 \}\)/], // foto de perfil: arquivo novo na pasta das fotos, nome = jid conferido
    ['server.js', /fs\.readFileSync\(f\.arquivo\)/], // foto de perfil: o arquivo que fotos.js guardou (jid conferido pela regex)
    ['copia.js', /fs\.readFileSync\(arquivo, 'utf8'\)/], // estado da cópia de segurança: caminho fixo da config, só o JSON lido
  ];
  const ARQUIVO = /readFileSync|readFile\(|copyFileSync|copyFile\(|cpSync|createReadStream|openSync|readSync|writeFileSync|writeFile\(|createWriteStream|fs\/promises|fs\.promises/;
  const listar = (d) => fs.readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listar(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const usadas = new Set();
  const soltas = [];
  for (const arq of listar(src)) {
    const rel = path.relative(src, arq).split(path.sep).join('/');
    fs.readFileSync(arq, 'utf8').split('\n').forEach((linha, i) => {
      if (!ARQUIVO.test(linha)) return;
      const k = permitidas.findIndex(([f, re]) => f === rel && re.test(linha));
      if (k === -1) soltas.push(`${rel}:${i + 1}: ${linha.trim()}`);
      else usadas.add(k);
    });
  }
  assert.deepEqual(soltas, [], 'leitura ou gravação de arquivo fora da lista revisada');
  assert.equal(usadas.size, permitidas.length, 'a lista revisada tem item que não existe mais no código');
  // e os pontos de uso passam pela validação antes de ler
  const email = fs.readFileSync(path.join(src, 'canais/email.js'), 'utf8');
  assert.match(email, /const validados = validarAnexos\(anexos\.map\(\(a\) => a\.caminho\)\);\n\s+return anexos\.map\(\(a, i\) => \(\{ filename: a\.filename, content: lerValidado\(validados\[i\]\)/);
  assert.match(fs.readFileSync(path.join(src, 'canais/whatsapp.js'), 'utf8'),
    /const \[a\] = validarAnexos\(\[envio\.media_path\]\);\n\s+copia = copiaParaEnvio\(a, lerValidado\(a\)\);\n\s+envio\.media_path = copia\.caminho;/);
  const server = fs.readFileSync(path.join(src, 'server.js'), 'utf8');
  assert.match(server, /const validados = d\.anexos\?\.length \? lerValidados\(validarAnexos\(d\.anexos\)\) : null;/);
  assert.match(server, /guardarAnexos\(dirAnexos, id, lerValidados\(validarAnexos\(campos\.anexos\)\)\)/);
  assert.match(server, /fd = abrirValidado\(validarAnexo\(arq\)\);/);
  assert.match(server, /anexos: inspecionarAnexos\(m\.anexos\)/);
});
