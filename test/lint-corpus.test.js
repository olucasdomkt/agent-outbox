// Corpus de regressão do detector de segredo: pelo menos um exemplo de cada padrão que o linter pega, mais as
// variações que costumam escapar (começo e fim de linha, aspas, quebra de linha, maiúsculas, acento, pontuação
// colada, negrito do WhatsApp, nome de variável de ambiente). Toda linha de BARRA tem de bloquear com regra
// "segredo" sem o valor aparecer no resultado; as de PASSA são falso positivo conhecido.
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspecionarAnexos } from '../src/anexos.js';
import { lint, padraoDeSegredo } from '../src/lint.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-corpus-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const TERCA_10H = new Date(2026, 8, 29, 10, 0).getTime();

// Valores de mentira montados em pedaços: o arquivo não carrega um token inteiro com cara de real.
const j = (...p) => p.join('');
const V = {
  openai: j('sk-', 'proj-', 'Ab3dEf6hIj9kLm2nOp5qRs8t'),
  openai2: j('sk-', 'Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2'),
  anthropic: j('sk-', 'ant-api03-', 'Qw1Er2Ty3Ui4Op5As6Df7Gh8'),
  github: j('gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'),
  githubPat: j('github', '_pat_', '11ABCDEFG0abcdefghijKLMNOPQRST'),
  slackBot: j('xo', 'xb-', '1234567890-abcdefghijklmn'),
  slackUser: j('xo', 'xp-', '9876543210-zyxwvutsrqpon'),
  aws: j('AK', 'IA', 'Z7Y6X5W4V3U2T1S0'),
  awsSecret: j('wJalrXUtnFEMI', '/K7MDENG/', 'bPxRfiCYzz9EXAMPLE'),
  jwt: j('eyJ', 'hbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiJ0ZXN0ZSJ9', '.', 'c2lnbmF0dXJhLWRlLXRlc3Rl'),
  jwtLongo: j('eyJ', 'a'.repeat(600), '.', 'eyJzdWIiOiJ0ZXN0ZSJ9', '.', 'c2lnbmF0dXJhLWRlLXRlc3Rl'),
  google: j('AI', 'za', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'),
  meta: j('EA', 'AG', 'm0PX4ZCpsBAO'.repeat(7)),
  stripe: j('sk', '_live_', 'a1B2c3D4e5F6g7H8i9J0k1L2'),
  supabase: j('sb', '_secret_', 'a1B2c3D4e5F6g7H8i9J0k1L2'),
  slackHook: j('https://hooks.', 'slack.com/services/', 'T00000000/B00000000/', 'XXXXXXXXXXXXXXXXXXXXXXXX'),
  discordHook: j('https://discord.com/api/', 'webhooks/', '123456789012345678/', 'AbCd'.repeat(10)),
};
const CORPO_PEM = 'MIIEpAIBAAKCAQEAcorpoDeTeste0123456789';
const pem = (tipo) => j('-----BEGIN ', tipo, '-----\n', CORPO_PEM, '\n-----END ', tipo, '-----');
const COFRE = [
  { nome: 'PAINEL_SENHA', valor: 'Qx7-valor-do-cofre' },
  { nome: 'SERVIDOR_CHAVE', valor: 'linha um da chave do servidor X1\nlinha dois da chave do servidor Y2' },
];

// como os clientes viriam do config.json (para a senha liberada por cliente)
const CLIENTES = [{ nome: 'Aurora' }];

// { nome, corpo, segredo (o que não pode aparecer no resultado), canal, assunto, citar, arquivos {nome: conteúdo}
//   (anexos criados no tmp), anexos (caminhos crus), cofre, senhasDeCliente, destino }
const BARRA = [
  // ---------------------------------------- padrões de texto e valor do cofre
  { nome: 'sk-proj (OpenAI)', corpo: `segue a chave: ${V.openai}`, segredo: V.openai },
  { nome: 'sk- sozinho na mensagem', corpo: V.openai2, segredo: V.openai2 },
  { nome: 'sk-ant- (Anthropic)', corpo: `chave da Anthropic ${V.anthropic}`, segredo: V.anthropic },
  { nome: 'ghp_ (GitHub)', corpo: `token do GitHub ${V.github}`, segredo: V.github },
  { nome: 'github_pat_', corpo: V.githubPat, segredo: V.githubPat },
  { nome: 'xoxb (Slack bot)', corpo: `bot do Slack: ${V.slackBot}`, segredo: V.slackBot },
  { nome: 'xoxp (Slack usuário)', corpo: V.slackUser, segredo: V.slackUser },
  { nome: 'AKIA (AWS)', corpo: `access key id ${V.aws}`, segredo: V.aws },
  { nome: 'JWT', corpo: `Authorization: Bearer ${V.jwt}`, segredo: V.jwt },
  { nome: 'JWT com cabeçalho de 600 caracteres', corpo: `jwt ${V.jwtLongo}`, segredo: V.jwtLongo },
  { nome: 'chave privada RSA', corpo: pem('RSA PRIVATE KEY'), segredo: CORPO_PEM },
  { nome: 'chave privada OPENSSH', corpo: pem('OPENSSH PRIVATE KEY'), segredo: CORPO_PEM },
  { nome: 'chave privada PKCS#8', corpo: pem('PRIVATE KEY'), segredo: CORPO_PEM },
  { nome: 'chave privada EC', corpo: pem('EC PRIVATE KEY'), segredo: CORPO_PEM },
  { nome: 'chave privada cifrada', corpo: pem('ENCRYPTED PRIVATE KEY'), segredo: CORPO_PEM },
  { nome: 'senha: X', corpo: 'senha: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'password=X', corpo: 'password=Sup3rS3creta', segredo: 'Sup3rS3creta' },
  { nome: 'passwd: X', corpo: 'passwd: Tr0ub4dor&3', segredo: 'Tr0ub4dor&3' },
  { nome: 'pwd=X', corpo: 'pwd=Abc123456', segredo: 'Abc123456' },
  { nome: 'token: X', corpo: 'token: abcDEF123456ghi', segredo: 'abcDEF123456ghi' },
  { nome: 'secret: X', corpo: 'secret: 9f8e7d6c5b4a', segredo: '9f8e7d6c5b4a' },
  { nome: 'api key: X', corpo: 'api key: QwErTy123456', segredo: 'QwErTy123456' },
  { nome: 'api_key=X', corpo: 'api_key=QwErTy123456', segredo: 'QwErTy123456' },
  { nome: 'apikey: X', corpo: 'apikey: QwErTy123456', segredo: 'QwErTy123456' },
  { nome: 'a senha é X', corpo: 'a senha é Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'a senha eh X', corpo: 'a senha eh Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'valor do cofre (simulado)', corpo: 'segue o acesso Qx7-valor-do-cofre', segredo: 'Qx7-valor-do-cofre' },
  { nome: 'linha de valor do cofre com várias linhas', corpo: 'linha um da chave do servidor X1', segredo: 'servidor X1' },
  { nome: 'segredo no assunto do e-mail', canal: 'email', assunto: `chave ${V.openai}`, corpo: 'segue', segredo: V.openai },
  // ---------------------------------------- citação, anexo e senha liberada por cliente
  { nome: 'segredo na citação do WhatsApp', corpo: 'combinado!', citar: 'token: abcDEF123456ghi', segredo: 'abcDEF123456ghi' },
  { nome: 'anexo de texto com sk-', canal: 'email', corpo: 'segue', arquivos: { 'planilha.csv': `nome,chave\nbot,${V.openai}\n` } },
  { nome: 'anexo de texto com senha: X', canal: 'email', corpo: 'segue', arquivos: { 'acessos.txt': 'painel\nsenha: Bri5as#5120\n' } },
  { nome: 'anexo de texto com valor do cofre', canal: 'email', corpo: 'segue', arquivos: { 'notas.md': '# acesso\nQx7-valor-do-cofre\n' } },
  ...['.env', '.env.local', 'id_rsa', 'id_ed25519', '.npmrc', '.netrc', '.pgpass', 'credentials.json', 'servidor.pem', 'certificado.p12', 'certificado.pfx']
    .map((n) => ({ nome: `anexo com nome de credencial: ${n}`, canal: 'email', corpo: 'segue', arquivos: { [n]: 'conteudo qualquer\n' } })),
  { nome: '.env que nem existe, num canal que não manda anexo', canal: 'discord', corpo: 'segue', anexos: ['/tmp/central-corpus-nao-existe/.env'] },
  {
    nome: 'mesmo valor com dois nomes no cofre, só um liberado para o cliente', corpo: 'acesso: Lib3rada#2026', segredo: 'Lib3rada#2026',
    destino: 'Aurora - Coordenação', cofre: [{ nome: 'REVISAO_SENHA', valor: 'Lib3rada#2026' }, { nome: 'OUTRA_SENHA', valor: 'Lib3rada#2026' }], senhasDeCliente: { REVISAO_SENHA: 'Aurora' },
  },
  {
    nome: 'valor que contém o liberado não é perdoado', corpo: 'senha: Lib3rada#2026XYZ', segredo: 'Lib3rada#2026XYZ',
    destino: 'Aurora - Coordenação', cofre: [{ nome: 'REVISAO_SENHA', valor: 'Lib3rada#2026' }], senhasDeCliente: { REVISAO_SENHA: 'Aurora' },
  },
  // ---------------------------------------- padrões novos (link, provedores)
  { nome: 'usuário:senha num link postgres://', corpo: 'banco: postgres://admin:Sup3rS3nha@exemplo.com:5432/app', segredo: 'Sup3rS3nha' },
  { nome: 'usuário:senha num link https://', corpo: 'https://admin:Bri5as5120@painel.exemplo.com', segredo: 'Bri5as5120' },
  { nome: 'apikey=JWT num link do Supabase', corpo: `https://api.exemplo.com/rest/v1/leads?select=*&apikey=${V.jwt}`, segredo: V.jwt },
  { nome: 'apikey= num link', corpo: 'https://api.exemplo.com/v1/leads?apikey=AbCdEf123456GhIj', segredo: 'AbCdEf123456GhIj' },
  { nome: 'sig= num link', corpo: 'https://cdn.exemplo.com/v.mp4?exp=1700000000&sig=ab12cd34ef56gh78', segredo: 'ab12cd34ef56gh78' },
  { nome: 'X-Amz-Signature', corpo: 'https://b.s3.amazonaws.com/f.pdf?X-Amz-Expires=600&X-Amz-Signature=0123456789abcdef0123', segredo: '0123456789abcdef0123' },
  { nome: 'X-Goog-Signature', corpo: 'https://storage.googleapis.com/b/f.pdf?X-Goog-Signature=a1b2c3d4e5f6a7b8c9d0', segredo: 'a1b2c3d4e5f6a7b8c9d0' },
  { nome: '#access_token no fragmento', corpo: 'https://app.exemplo.com/cb#access_token=ya29a0AfH6SMBxyz&expires_in=3599', segredo: 'ya29a0AfH6SMBxyz' },
  { nome: '?token= num link', corpo: 'https://api.exemplo.com/export?formato=csv&token=9f8e7d6c5b4a3210', segredo: '9f8e7d6c5b4a3210' },
  { nome: 'parâmetro em maiúsculas', corpo: 'https://api.exemplo.com/?TOKEN=AbCdEf123456GhIj', segredo: 'AbCdEf123456GhIj' },
  { nome: 'chave do Google (AIza)', corpo: `maps: ${V.google}`, segredo: V.google },
  { nome: 'token da Meta (EAA)', corpo: `token da página ${V.meta}`, segredo: V.meta },
  { nome: 'chave do Stripe', corpo: `stripe ${V.stripe}`, segredo: V.stripe },
  { nome: 'chave secreta do Supabase', corpo: `supabase ${V.supabase}`, segredo: V.supabase },
  { nome: 'webhook do Slack', corpo: `avisa no ${V.slackHook}`, segredo: 'XXXXXXXXXXXXXXXXXXXXXXXX' },
  { nome: 'webhook do Discord', corpo: `canal: ${V.discordHook}`, segredo: 'AbCd'.repeat(10) },
  { nome: 'chave privada PGP', corpo: pem('PGP PRIVATE KEY BLOCK'), segredo: CORPO_PEM },
  // ---------------------------------------- variações que costumam escapar
  { nome: 'começo de linha', corpo: `${V.github}\nesse é o token`, segredo: V.github },
  { nome: 'fim de linha', corpo: `o token do GitHub é este ${V.github}\nobrigado`, segredo: V.github },
  { nome: 'fim do texto com quebra', corpo: `chave ${V.openai}\n`, segredo: V.openai },
  { nome: 'entre aspas duplas', corpo: `"${V.openai}"`, segredo: V.openai },
  { nome: 'entre aspas simples', corpo: `'${V.openai}'`, segredo: V.openai },
  { nome: 'entre crases', corpo: `\`${V.openai}\``, segredo: V.openai },
  { nome: 'entre aspas curvas', corpo: `“${V.openai}”`, segredo: V.openai },
  { nome: 'padrão depois de quebra de linha', corpo: `chave:\n${V.aws}`, segredo: V.aws },
  { nome: 'senha depois de quebra de linha', corpo: 'senha:\nBri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'senha depois de \\r\\n', corpo: 'senha:\r\nBri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'senha depois de tab', corpo: 'senha:\tBri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'senha depois de espaço não separável', corpo: 'senha: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'SENHA: em maiúsculas', corpo: 'SENHA: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'PASSWORD= em maiúsculas', corpo: 'PASSWORD=Sup3rS3creta', segredo: 'Sup3rS3creta' },
  { nome: 'TOKEN: em maiúsculas', corpo: 'TOKEN: abcDEF123456ghi', segredo: 'abcDEF123456ghi' },
  { nome: 'export API_KEY=', corpo: 'export API_KEY=QwErTy123456', segredo: 'QwErTy123456' },
  { nome: 'Senha: com maiúscula', corpo: 'Senha: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'Senha é X', corpo: 'Senha é Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'A senha é: X', corpo: 'A senha é: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'SENHA É X', corpo: 'SENHA É Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'Usuário: X | Senha: Y', corpo: 'Usuário: admin | Senha: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'senha do painel: X', corpo: 'senha do painel: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'A senha do Wi-Fi é X', corpo: 'A senha do Wi-Fi é Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'Senha de acesso: X', corpo: 'Senha de acesso: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'entre parênteses', corpo: `(${V.openai})`, segredo: V.openai },
  { nome: 'entre colchetes', corpo: `[${V.github}]`, segredo: V.github },
  { nome: 'entre < >', corpo: `<${V.jwt}>`, segredo: V.jwt },
  { nome: 'ponto final colado', corpo: `a chave é ${V.aws}.`, segredo: V.aws },
  { nome: 'vírgula colada', corpo: `chaves: ${V.aws}, outra`, segredo: V.aws },
  { nome: 'chave=valor;', corpo: `chave=${V.openai};`, segredo: V.openai },
  { nome: 'JWT colado num hífen (x-eyJ...)', corpo: `x-${V.jwt}`, segredo: V.jwt },
  { nome: 'JWT colado num hífen (token-eyJ...)', corpo: `token-${V.jwt}`, segredo: V.jwt },
  { nome: 'JWT dentro de JSON', corpo: `{"token":"${V.jwt}"}`, segredo: V.jwt },
  { nome: 'senha:X. sem espaço e com ponto', corpo: 'senha:Bri5as#5120.', segredo: 'Bri5as#5120' },
  { nome: '(senha: X)', corpo: '(senha: Bri5as#5120)', segredo: 'Bri5as#5120' },
  { nome: '*Senha:* X (negrito do WhatsApp)', corpo: '*Senha:* Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: '*Senha*: X', corpo: '*Senha*: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: '**Senha:** X', corpo: '**Senha:** Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: '_senha_: X (itálico)', corpo: '_senha_: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: '*Senha do painel:* X', corpo: '*Senha do painel:* Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'Senha: *X* (valor em negrito)', corpo: 'Senha: *Bri5as#5120*', segredo: 'Bri5as#5120' },
  { nome: 'senha="X"', corpo: 'senha="Bri5as#5120"', segredo: 'Bri5as#5120' },
  { nome: 'JSON "password": "X"', corpo: '{"password": "Sup3rS3creta"}', segredo: 'Sup3rS3creta' },
  { nome: "YAML password: 'X'", corpo: "db:\n  password: 'Sup3rS3creta'", segredo: 'Sup3rS3creta' },
  { nome: 'DB_PASSWORD=X', corpo: 'DB_PASSWORD=Sup3rS3creta', segredo: 'Sup3rS3creta' },
  { nome: 'client_secret: X', corpo: 'client_secret: 9f8e7d6c5b4a', segredo: '9f8e7d6c5b4a' },
  { nome: 'SECRET_KEY=X', corpo: 'SECRET_KEY=Abc123def456', segredo: 'Abc123def456' },
  { nome: 'AWS_SECRET_ACCESS_KEY=X', corpo: `AWS_SECRET_ACCESS_KEY=${V.awsSecret}`, segredo: V.awsSecret },
  { nome: 'token e senha: X (um rótulo depois do outro)', corpo: 'token e senha: Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'senha: link X (a senha depois do link)', corpo: 'senha: https://painel.exemplo.com Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'senha: link → X', corpo: 'senha: https://painel.exemplo.com → Bri5as#5120', segredo: 'Bri5as#5120' },
  { nome: 'valor do cofre entre parênteses', corpo: '(Qx7-valor-do-cofre)', segredo: 'Qx7-valor-do-cofre' },
  { nome: 'valor do cofre entre aspas', corpo: '"Qx7-valor-do-cofre"', segredo: 'Qx7-valor-do-cofre' },
  { nome: 'valor do cofre em negrito', corpo: '*Qx7-valor-do-cofre*', segredo: 'Qx7-valor-do-cofre' },
  { nome: 'valor do cofre no começo da linha', corpo: 'Qx7-valor-do-cofre\nsegue', segredo: 'Qx7-valor-do-cofre' },
  { nome: 'usuário:senha entre parênteses', corpo: '(https://admin:Bri5as5120@painel.exemplo.com)', segredo: 'Bri5as5120' },
];

const PASSA = [
  { nome: 'o token de acesso expirou', corpo: 'o token de acesso expirou, gera outro' },
  { nome: 'a senha é a mesma de sempre', corpo: 'a senha é a mesma de sempre' },
  { nome: 'a senha do Otávio é diferente', corpo: 'a senha do Otávio é diferente' },
  { nome: 'Senha do painel: enviada por e-mail', corpo: 'Senha do painel: enviada por e-mail' },
  { nome: '*Senha:* *a mesma de antes*', corpo: '*Senha:* *a mesma de antes*' },
  { nome: 'token: expirado', corpo: 'token: expirado' },
  { nome: 'Tokens: (plural)', corpo: 'Tokens: veja o painel' },
  { nome: 'secretaria', corpo: 'A secretaria: aberta até 18h' },
  { nome: 'o token de acesso e refresh_token1 vencem juntos', corpo: 'o token de acesso e refresh_token1 vencem juntos' },
  { nome: 'PASSWORD_MIN_LENGTH=12', corpo: 'PASSWORD_MIN_LENGTH=12' },
  { nome: 'TOKEN_EXPIRES_IN=3600', corpo: 'TOKEN_EXPIRES_IN=3600' },
  { nome: 'não compartilhe sua senha', corpo: 'Não compartilhe sua senha com ninguém.' },
  { nome: 'o sk-learn', corpo: 'o sk-learn é uma biblioteca' },
  { nome: 'link de conversa com uuid', corpo: 'conversa: https://atendimento.exemplo.com/conversas?id=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' },
  { nome: 'wa.me com texto', corpo: 'https://wa.me/5511999990041?text=Oi%20quero%20saber%20mais' },
  { nome: 'Google Docs com usp', corpo: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?usp=sharing' },
  {
    nome: 'imagem em base64 com AIza, EAA e eyJ no meio',
    corpo: `data:image/png;base64,iVBORw0KGgo${'QUJD'.repeat(8)}AIzaSy${'A'.repeat(40)}EAA${'B'.repeat(90)}eyJ${'C'.repeat(20)}+/w==`,
  },
  // o link da página protegida não é a senha; o que vem depois do link continua conferido
  { nome: 'com senha: link', corpo: 'Relatório no ar, com senha: https://relatorio.exemplo.com/cedro (a senha está no grupo)' },
];

// ---------------------------------------------------------------- como cada linha vira mensagem e dados

function anexosDe(c) {
  if (c.anexos) return c.anexos;
  if (!c.arquivos) return undefined;
  const pasta = fs.mkdtempSync(path.join(dir, 'anexo-'));
  return Object.entries(c.arquivos).map(([nome, conteudo]) => {
    const p = path.join(pasta, nome);
    fs.writeFileSync(p, conteudo);
    return p;
  });
}
const mensagem = (c, anexos) => ({
  canal: c.canal || 'whatsapp', destino_id: 'g1', destino_nome: c.destino || 'Grupo Teste',
  assunto: c.assunto ?? (c.canal === 'email' ? 'Assunto' : undefined), corpo: c.corpo, anexos,
  extra: c.citar ? { citar: { id: 'M1', texto: c.citar } } : undefined,
});
const base = (c) => ({ segredos: c.cofre || COFRE, senhasDeCliente: c.senhasDeCliente || {}, pessoas: [], clientes: CLIENTES, agora: TERCA_10H });
const linterAtual = (m, c) => lint(m, { ...base(c), anexos: inspecionarAnexos(m.anexos) });
const barrou = (r) => r.bloqueios.some((b) => b.regra === 'segredo');

const CASOS = [...BARRA.map((c) => ({ ...c, barra: true })), ...PASSA];
for (const c of CASOS) c.anexosProntos = anexosDe(c); // os arquivos ficam prontos uma vez para todos os linters

// ---------------------------------------------------------------- testes

test('corpus: toda linha de BARRA bloqueia com regra "segredo" e o valor não aparece no resultado', () => {
  const escaparam = [];
  const vazaram = [];
  for (const c of BARRA.map((b) => CASOS.find((x) => x.nome === b.nome))) {
    const r = linterAtual(mensagem(c, c.anexosProntos), c);
    if (!barrou(r)) escaparam.push(c.nome);
    if (c.segredo && JSON.stringify(r).includes(c.segredo)) vazaram.push(c.nome);
  }
  assert.deepEqual(escaparam, [], `escaparam: ${escaparam.join(' | ')}`);
  assert.deepEqual(vazaram, [], `o valor apareceu no resultado: ${vazaram.join(' | ')}`);
  assert.ok(BARRA.length >= 100, `o corpus tem ${BARRA.length} linhas`);
});

test('corpus: as linhas de PASSA (falso positivo conhecido) não bloqueiam', () => {
  const barradas = PASSA.map((p) => CASOS.find((x) => x.nome === p.nome))
    .filter((c) => linterAtual(mensagem(c, c.anexosProntos), c).bloqueios.length).map((c) => c.nome);
  assert.deepEqual(barradas, []);
});

test('detector sem estouro de pilha nem volta atrás em trecho de 6 MB (anexo de texto vai até 20 MB)', () => {
  const N = 6 * 1024 * 1024;
  const rep = (s) => s.repeat(Math.ceil(N / s.length)).slice(0, N);
  const casos = [`sk-${rep('a')}`, j('gh', 'p_', rep('a')), `github_pat_${rep('a')}`, `xoxb-${rep('a')}`, rep('eyJ-'), `eyJ${rep('a')}`,
    `x.eyJ${rep('a')}.`, `-eyJ${rep('a')}.${rep('b')}.`, rep('-eyJaaaaaaaaaaa'), j('EA', 'A', rep('a')), j('sk', '_live_', rep('a')),
    j('sb', '_secret_', rep('a')), `hooks.slack.com/services/T/B/${rep('a')}`, `discord.com/api/webhooks/1/${rep('a')}`,
    `senha: ${rep('a')}`, `senha:${rep('*')}`, rep('senha: https://a '), rep('token e '), rep('senha do '), rep('*Senha*: '),
    `?token=${rep('a')}`, `https://u:${rep('a')}@`, rep('a_'), rep(' '), `-----BEGIN ${rep('A')}`];
  for (const texto of casos) {
    const t0 = performance.now();
    const r = lint({ canal: 'email', destino_id: 'x', assunto: 'a', corpo: 'oi' },
      { segredos: COFRE, agora: TERCA_10H, anexos: [{ caminho: '/x/a.txt', nome: 'a.txt', bytes: 1, texto }] });
    padraoDeSegredo(texto);
    const ms = performance.now() - t0;
    assert.ok(!r.bloqueios.some((b) => /erro|Maximum call stack/.test(b.msg)), texto.slice(0, 20));
    assert.ok(ms < 3000, `"${texto.slice(0, 16)}…": ${ms.toFixed(0)} ms`);
  }
});
