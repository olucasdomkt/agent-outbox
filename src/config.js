// Configuração da Central. O que é de cada dono (nome, número, canais, clientes, cofre) vem de
// ~/.central-mensagens/config.json, lido na subida por carregarConfig(). Segredo NÃO fica aqui: é lido na hora
// do uso, pelo nome (src/segredos.js).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
// o banco mora fora do checkout: atualizar o código não mexe nos dados
const dbReal = path.join(home, '.central-mensagens/central.db');
const db = process.env.CENTRAL_DB || dbReal;
const dados = path.dirname(db);
// onde a ponte do WhatsApp grava (ela cria store/ na pasta de onde roda): sempre a pasta de dados de verdade
const store = process.env.CENTRAL_PONTE_STORE || path.join(path.dirname(dbReal), 'ponte/store');

export const config = {
  raiz,
  porta: Number(process.env.PORT) || 4912,
  portaProducao: 4912,
  host: '127.0.0.1',
  db,
  dbReal,
  // CENTRAL_MODO=previa: servidor de teste numa CÓPIA do banco, sem despachante, sem notificação e sem envio
  modo: process.env.CENTRAL_MODO || 'normal',
  // junto do banco, fora do repositório: diretório de pessoas e o config.json (o que o painel ajusta também mora nele)
  pessoas: process.env.CENTRAL_PESSOAS || path.join(dados, 'pessoas.json'),
  preferencias: path.join(dados, 'config.json'),
  // cópia durável de cada anexo (anexos/<id>/<nome>): o original costuma morar no tmp de um job
  anexos: path.join(dados, 'anexos'),
  // cópia de vida curta que a ponte do WhatsApp lê no envio (apagada depois da resposta)
  envio: path.join(dados, 'envio'),
  // miniaturas de perfil do WhatsApp que o painel mostra (src/fotos.js)
  fotos: path.join(dados, 'fotos'),
  // build do painel
  webDist: path.join(raiz, 'web/dist'),
  tickMs: 3000,
  // mensagem aprovada que falha por canal fora do ar fica tentando por esta janela
  retentarPorMin: 360,
  // aviso nativo: só existe no macOS (src/notificar.js); fora dele não faz nada
  notificarMac: process.env.CENTRAL_NOTIFICAR !== '0' && process.env.CENTRAL_MODO !== 'previa',
  // estado que o seu script de cópia de segurança grava, se você tiver um; a Central só lê (src/copia.js)
  backupEstado: process.env.CENTRAL_BACKUP_ESTADO || path.join(dados, 'copia-estado.json'),

  // quem aprova: o nome entra nos avisos e no guia das sessões; sem nome, os textos ficam neutros ("o dono")
  dono: { nome: '', whatsapp: '' },
  // clientes para o aviso de "cliente cruzado": [{ nome, termos?, familia? }]. Começa vazio (src/lint.js)
  clientes: [],
  // helper do cofre para o linter comparar o texto com os seus segredos (opcional; contrato em src/segredos.js)
  cofre: null,

  whatsapp: {
    ponte: process.env.CENTRAL_PONTE || 'http://127.0.0.1:8080',
    // token compartilhado com a ponte: ela gera store/bridge.token na 1a vez; a Central le o mesmo arquivo (env tem prioridade)
    ponteTokenFile: path.join(store, 'bridge.token'),
    messagesDb: path.join(store, 'messages.db'),
    sessaoDb: path.join(store, 'whatsapp.db'),
    // anti-ban: intervalo mínimo entre envios + teto diário
    intervaloMinMs: 6000,
    jitterMs: 4000,
    tetoDia: 80,
  },

  // desligado até ter `discord` no config.json; o token do bot é o segredo DISCORD_BOT_TOKEN
  discord: {
    ligado: false,
    tokenSecret: 'DISCORD_BOT_TOKEN',
    api: 'https://discord.com/api/v10',
    donoId: '', // o seu id de usuário no Discord: mensagem sua no canal = já respondida
  },

  // desligado até ter contas em `email.contas` no config.json (já autenticadas no workspace-mcp)
  email: {
    contas: [],
    mcpPorta: 8792,
    // num gerenciador de processos o PATH pode não ter ~/.local/bin, então o caminho vai absoluto
    uvx: [process.env.CENTRAL_UVX, path.join(home, '.local/bin/uvx'), '/opt/homebrew/bin/uvx', '/usr/local/bin/uvx']
      .find((p) => p && fs.existsSync(p)) || 'uvx',
    clientIdSecret: 'GOOGLE_WORKSPACE_OAUTH_CLIENT_ID',
    clientSecretSecret: 'GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET',
  },
};

// como chamar o dono num texto: o primeiro nome dele (config.json) ou, sem nome, "dono". O artigo fica no texto:
// `o ${dono()} aprova`, `lições do ${dono()}`.
export const dono = () => config.dono.nome.split(/\s+/)[0] || 'dono';

// token da ponte do WhatsApp (header X-Bridge-Token): env CENTRAL_BRIDGE_TOKEN, senao o arquivo que a ponte
// gera (store/bridge.token). Lazy + cache: a ponte pode ainda nao ter criado o arquivo quando a Central sobe.
let _ponteToken = '';
export function ponteToken() {
  if (_ponteToken) return _ponteToken;
  _ponteToken = (process.env.CENTRAL_BRIDGE_TOKEN || '').trim();
  if (!_ponteToken) { try { _ponteToken = fs.readFileSync(config.whatsapp.ponteTokenFile, 'utf8').trim(); } catch {} }
  return _ponteToken;
}

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const lista = (v) => (Array.isArray(v) ? v : []);
// caminho escrito à mão no config.json: "~/..." vale a pasta do usuário
const caminho = (v) => texto(v).replace(/^~(?=\/|$)/, home);

// Lê o config.json do dono e põe em `config` o que vale só na subida: dono, canais, clientes, cofre e a pasta da
// ponte. Arquivo ausente ou quebrado = tudo no padrão (só o WhatsApp, sem nome, sem cofre). O servidor e o msg
// chamam; os testes não, então nunca dependem do arquivo de quem os roda.
export function carregarConfig(arquivo = config.preferencias) {
  let j = {};
  try {
    const lido = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    if (lido && typeof lido === 'object' && !Array.isArray(lido)) j = lido;
  } catch { /* sem arquivo, ou quebrado: padrão */ }
  config.dono.nome = texto(j.dono?.nome);
  config.dono.whatsapp = String(j.dono?.whatsapp ?? '').replace(/\D/g, '');
  config.clientes = lista(j.clientes).filter((c) => texto(c?.nome)).map((c) => ({
    nome: texto(c.nome), familia: texto(c.familia), termos: lista(c.termos).map(texto).filter(Boolean),
  }));
  config.cofre = process.env.CENTRAL_SECRET_BIN || caminho(j.cofre?.helper) || null;
  if (!process.env.CENTRAL_PONTE_STORE && texto(j.whatsapp?.store)) {
    config.whatsapp.messagesDb = path.join(caminho(j.whatsapp.store), 'messages.db');
    config.whatsapp.sessaoDb = path.join(caminho(j.whatsapp.store), 'whatsapp.db');
  }
  if (!process.env.CENTRAL_PONTE && texto(j.whatsapp?.ponte)) config.whatsapp.ponte = texto(j.whatsapp.ponte);
  config.email.contas = lista(j.email?.contas).map((c) => texto(c).toLowerCase()).filter(Boolean);
  config.discord.ligado = !!j.discord && typeof j.discord === 'object';
  config.discord.donoId = String(j.discord?.donoId ?? '').replace(/\D/g, '');
  return config;
}
