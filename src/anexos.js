// Anexos: a validação de arquivo anexado, toda num lugar só. Roda ao criar e ao editar a mensagem (antes da cópia
// durável), no linter (aprovar e de novo no despachante, na hora de enviar), no download e dentro do envio do
// e-mail e do WhatsApp. A Central lê o arquivo no Node (o e-mail vai em base64), então a trava de
// caminho que o workspace-mcp fazia agora é dela:
// - o caminho REAL (realpath nativo: symlink seguido e a caixa que está no disco) tem de ser arquivo comum,
//   fora das pastas e dos nomes de credencial; comparação em NFC e minúsculas, sempre por pasta inteira;
// - caminho não pega hardlink nem arquivo renomeado (id_rsa salvo como "contrato.pdf"): o CONTEÚDO de todo
//   anexo é conferido atrás de chave privada e dos padrões de token do linter (2 MB na validação, tudo no envio);
// - o que sai é lido de um descritor aberto sem seguir symlink (O_NOFOLLOW) e conferido no próprio descritor
//   (mesmo arquivo da validação, arquivo comum, mesmo tamanho): trocar o arquivo depois de validar não vaza nada;
// - até 20 MB por mensagem; compactado não sai.
// A recusa diz qual anexo e por quê, nunca o conteúdo. Procurar valor do cofre em anexo de texto fica no linter.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { padraoDeSegredo } from './lint.js';

export const LIMITE_MENSAGEM = 20 * 1024 * 1024;
// anexo de texto maior que isto não é varrido atrás de segredo, então fica barrado ("não pôde ser checado").
// Igual ao limite da mensagem: as regex do linter são lineares, sem X{n,} (estoura a pilha do V8 a partir de
// ~5 MB sem quebra). Tempo do lint completo, linear: 2 MB em até ~0,2 s e 20 MB em até ~1,7 s (pior caso medido:
// base64 contínuo com um cofre de centenas de valores).
export const LIMITE_VARREDURA = LIMITE_MENSAGEM;
// quanto do conteúdo a validação lê atrás de chave e token (no envio, o arquivo inteiro que sai)
const AMOSTRA_CONTEUDO = 2 * 1024 * 1024;

// Relativo à home, em minúsculas (o disco do Mac não diferencia: ~/.SSH é ~/.ssh).
const CAMINHO_SENSIVEL = [
  [/^\.ssh(?:\/|$)/, '~/.ssh (chaves SSH)'],
  [/^\.gnupg(?:\/|$)/, '~/.gnupg (chaves GPG)'],
  [/^\.kube(?:\/|$)/, '~/.kube (acesso ao Kubernetes)'],
  [/^\.aws(?:\/|$)/, '~/.aws (credenciais da AWS)'],
  [/^\.config\/gcloud(?:\/|$)/, '~/.config/gcloud (credenciais do Google Cloud)'],
  [/^\.docker(?:\/|$)/, '~/.docker (login do Docker)'],
  [/^\.google_workspace_mcp(?:\/|$)/, '~/.google_workspace_mcp (tokens do Gmail)'],
  [/^\.workspace-mcp\/credentials/, '~/.workspace-mcp (tokens do Gmail)'],
  [/^library\/keychains(?:\/|$)/, '~/Library/Keychains (chaveiro do Mac)'],
  // o .claude.json tem cópias ao lado (.backup, .bak-*, .tmp.*) com o mesmo conteúdo
  [/^\.claude\.json/, '~/.claude.json (conta do Claude)'],
  [/^\.central-mensagens\/central\.db/, 'o banco da Central'],
];
// Nome de arquivo que só existe para guardar credencial, em qualquer pasta.
const NOME_SENSIVEL = [
  [/^\.env(?:rc)?$|^\.env\.|\.env$/, '.env'],
  [/^id_(?:rsa|ed25519|ecdsa|dsa)/, 'chave SSH'],
  [/\.(?:pem|p12|pfx)$/, 'certificado ou chave privada'],
  [/\.key$/, 'chave privada .key; se for Keynote, exporte em PDF'],
  [/\.kdbx$/, 'cofre de senhas do KeePass'],
  [/^(?:\.?credentials|client_secret.*|service-account.*)\.json$/, 'credencial em JSON'],
  [/^\.(?:netrc|npmrc|pypirc|pgpass|git-credentials)$/, 'arquivo de senha'],
];
// compactado esconde qualquer coisa: não sai
const COMPACTADO = /\.(?:zip|7z|rar|tar|gz|tgz|bz2|xz)$/i;
// texto: sempre varrido pelo linter. O resto é olhado pelo conteúdo (texto com extensão de PDF também é varrido).
const TEXTO = /\.(?:txt|md|csv|tsv|json|html?|xml|ya?ml|env|ini|conf|cfg|toml|log|js|mjs|cjs|ts|py|sh|sql)$/i;

const mb = (n) => (n / 1048576).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function recusa(codigo, msg) {
  const e = new Error(msg);
  e.status = 400;
  e.codigo = codigo;
  return e;
}

// para comparar: Unicode em NFC (o mesmo "ã" pode vir em duas formas) e minúsculas
const chave = (p) => p.normalize('NFC').toLowerCase();
// dentro da pasta só por segmento inteiro: "~/.sshx" não está em "~/.ssh"
const dentro = (p, dir) => p === dir || p.startsWith(dir + path.sep);

// a home do processo e a do usuário no sistema (HOME trocado não abre ~/.ssh), como foi dada e a real
function homes(home) {
  const lista = new Set();
  let doSistema = null;
  try { doSistema = os.userInfo().homedir; } catch { /* sem usuário no sistema */ }
  for (const h of [home ?? os.homedir(), doSistema]) {
    if (!h) continue;
    lista.add(chave(path.resolve(h)));
    try { lista.add(chave(fs.realpathSync.native(h))); } catch { /* home que não existe */ }
  }
  return [...lista];
}

// o motivo da recusa (curto, sem conteúdo) ou null
function sensivel(caminhos, home) {
  const raizes = homes(home);
  for (const p of caminhos.map(chave)) {
    const nome = path.basename(p);
    for (const [re, porque] of NOME_SENSIVEL) if (re.test(nome)) return `nome de arquivo de credencial (${porque})`;
    for (const h of raizes) {
      if (!dentro(p, h) || p === h) continue;
      const rel = p.slice(h.length + 1).split(path.sep).join('/');
      for (const [re, porque] of CAMINHO_SENSIVEL) if (re.test(rel)) return `está em ${porque}`;
    }
  }
  return null;
}

// Abre sem seguir symlink e sem travar em fifo, e confere no DESCRITOR que é o mesmo arquivo comum que a
// validação viu (mesmo inode e tamanho). Quem chama fecha o descritor.
function abrir(a) {
  let fd;
  try {
    fd = fs.openSync(a.real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (e) {
    if (e.code === 'ELOOP') throw recusa('mudou', `anexo mudou depois da conferência (virou atalho): ${a.caminho}`);
    if (e.code === 'ENOENT') throw recusa('sumiu', `anexo não encontrado: ${a.caminho}`);
    throw recusa('ilegivel', `anexo não pôde ser checado (não consegui ler: ${e.code || e.message}): ${a.caminho}`);
  }
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.dev !== a.dev || st.ino !== a.ino || st.size !== a.bytes) {
    fs.closeSync(fd);
    throw recusa('mudou', `anexo mudou depois da conferência: ${a.caminho}`);
  }
  return fd;
}

function lerDoDescritor(fd, n) {
  const buf = Buffer.alloc(n);
  let lidos = 0;
  while (lidos < n) {
    const k = fs.readSync(fd, buf, lidos, n - lidos, lidos);
    if (!k) break;
    lidos += k;
  }
  return buf.subarray(0, lidos);
}

const temBomUtf16 = (b) => b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));
// texto do arquivo: UTF-16 se tiver BOM, senão UTF-8 (byte inválido vira �; segredo é ASCII e continua lá)
function decodificar(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  return buf.toString('utf8');
}

// chave privada ou token no conteúdo, seja qual for a extensão (binário lido byte a byte: o ASCII aparece)
function conferirConteudo(a, buf) {
  const nome = padraoDeSegredo(temBomUtf16(buf) ? decodificar(buf) : buf.toString('latin1'));
  if (nome) throw recusa('conteudo', `anexo recusado, tem ${nome} dentro: ${a.caminho}`);
}

// Um anexo: caminho absoluto, symlink seguido até o arquivo real, nada de credencial (pelo caminho, pelo nome e
// pelos primeiros 2 MB do conteúdo), só arquivo comum. Devolve { caminho, real, nome, bytes, tipo, dev, ino };
// recusa com erro 400 e `codigo`. `home` só existe para o teste apontar para uma home falsa.
export function validarAnexo(caminho, { home } = {}) {
  if (typeof caminho !== 'string' || !path.isAbsolute(caminho)) throw recusa('caminho', `anexo precisa de caminho absoluto: ${caminho}`);
  const dado = path.resolve(caminho);
  // nome e pasta de credencial barram antes de olhar o disco: ".env" que nem existe também é recusado
  let motivo = sensivel([dado], home);
  if (motivo) throw recusa('sensivel', `anexo recusado, ${motivo}: ${caminho}`);
  let real;
  try {
    real = fs.realpathSync.native(dado);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw recusa('sumiu', `anexo não encontrado: ${caminho}`);
    throw recusa('ilegivel', `anexo não pôde ser checado (não consegui ler: ${e.code || e.message}): ${caminho}`);
  }
  motivo = sensivel([real], home);
  if (motivo) throw recusa('sensivel', `anexo recusado, ${motivo}: ${caminho}${real !== dado ? ` → ${real}` : ''}`);
  let st;
  try { st = fs.statSync(real); } catch { throw recusa('sumiu', `anexo não encontrado: ${caminho}`); }
  if (!st.isFile()) throw recusa('nao_arquivo', `anexo não é um arquivo comum (pasta ou dispositivo): ${caminho}`);
  const nome = path.basename(dado);
  const tipo = COMPACTADO.test(nome) || COMPACTADO.test(real) ? 'compactado'
    : TEXTO.test(nome) || TEXTO.test(real) ? 'texto' : 'binario';
  const a = { caminho, real, nome, bytes: st.size, tipo, dev: st.dev, ino: st.ino };
  const fd = abrir(a);
  try {
    conferirConteudo(a, lerDoDescritor(fd, Math.min(st.size, AMOSTRA_CONTEUDO)));
  } finally {
    fs.closeSync(fd);
  }
  return a;
}

const msgCompactado = (a) => `anexo compactado recusado: ${a.caminho} (zip, rar, 7z, tar e gz escondem qualquer coisa; mande os arquivos soltos)`;
const msgGrande = (total) => `anexos somam ${mb(total)} MB; o limite é 20 MB por mensagem: mande por link`;

// A lista inteira, como entra na mensagem e como sai no envio: cada um validado, nada compactado, até 20 MB.
export function validarAnexos(caminhos, opcoes) {
  if (!Array.isArray(caminhos)) throw recusa('caminho', 'anexos é uma lista de caminhos');
  const lista = caminhos.map((c) => validarAnexo(c, opcoes));
  const compactado = lista.find((a) => a.tipo === 'compactado');
  if (compactado) throw recusa('compactado', msgCompactado(compactado));
  const total = lista.reduce((s, a) => s + a.bytes, 0);
  if (total > LIMITE_MENSAGEM) throw recusa('grande', msgGrande(total));
  return lista;
}

// O conteúdo de um anexo validado, lido do descritor conferido (até `limite` bytes) e conferido de novo atrás
// de chave e token: é o que vai para o e-mail, para a cópia que a ponte do WhatsApp lê e para a cópia durável.
export function lerValidado(a, limite = Infinity) {
  const fd = abrir(a);
  try {
    const buf = lerDoDescritor(fd, Math.min(a.bytes, limite));
    conferirConteudo(a, buf);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

// descritor do anexo validado para servir no download (quem recebe fecha)
export function abrirValidado(a) {
  return abrir(a);
}

// texto = sem byte zero e UTF-8 válido nos primeiros 8 KB (ou com BOM de UTF-16)
function pareceTexto(amostra) {
  if (temBomUtf16(amostra)) return true;
  if (amostra.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(amostra, { stream: true });
    return true;
  } catch {
    return false;
  }
}

// O que o linter recebe de cada anexo (dados.anexos): `recusa` (a mesma da validação), `texto` para procurar
// segredo, `naoLido` (texto grande demais para varrer: bloqueia) ou `binario` (PDF, imagem, planilha: só avisa).
// bytes null = não deu para medir.
export function inspecionarAnexos(caminhos, opcoes) {
  return (Array.isArray(caminhos) ? caminhos : []).map((caminho) => {
    const nome = path.basename(String(caminho));
    let a;
    try {
      a = validarAnexo(caminho, opcoes);
    } catch (e) {
      return { caminho, nome, bytes: null, recusa: { codigo: e.codigo || 'erro', msg: e.message } };
    }
    const base = { caminho, nome, bytes: a.bytes };
    if (a.tipo === 'compactado') return { ...base, recusa: { codigo: 'compactado', msg: msgCompactado(a) } };
    try {
      if (a.tipo !== 'texto' && !pareceTexto(lerValidado(a, 8192))) return { ...base, binario: true };
      if (a.bytes > LIMITE_VARREDURA) return { ...base, naoLido: `tem ${mb(a.bytes)} MB e a varredura lê até ${mb(LIMITE_VARREDURA)} MB` };
      return { ...base, texto: decodificar(lerValidado(a)) };
    } catch (e) {
      return { ...base, recusa: { codigo: e.codigo || 'erro', msg: e.message } };
    }
  });
}

// Lê o conteúdo conferido de cada anexo validado ANTES de gravar a mensagem (problema = 400, nada gravado).
export const lerValidados = (validados) => validados.map((a) => ({ ...a, dados: lerValidado(a) }));

// Cópia durável em <dirAnexos>/<id>/<nome>, gravada a partir do conteúdo lido do descritor conferido (não do
// caminho, que pode mudar de alvo). O que já é cópia desta mensagem fica como está; nome repetido vira "nome (2)".
export function guardarAnexos(dirAnexos, id, lidos) {
  const dir = path.resolve(dirAnexos, String(id));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return lidos.map((a) => {
    if (path.dirname(path.resolve(a.caminho)) === dir) return a.caminho;
    const { name, ext } = path.parse(a.nome);
    let nome = `${name}${ext}`;
    for (let k = 2; fs.existsSync(path.join(dir, nome)); k++) nome = `${name} (${k})${ext}`;
    const destino = path.join(dir, nome);
    fs.writeFileSync(destino, a.dados, { flag: 'wx', mode: 0o600 });
    return destino;
  });
}

// Cópia de envio para a ponte do WhatsApp (que lê o arquivo pelo caminho): pasta nova e aleatória (0700) em
// <pasta do banco>/envio, com o nome original (é o nome que o destinatário vê no documento). apagar() no fim.
const pastaDeEnvio = () => (process.env.NODE_ENV === 'test' ? path.join(os.tmpdir(), `central-envio-teste-${process.pid}`) : config.envio);
export function copiaParaEnvio(a, dados) {
  const raiz = pastaDeEnvio();
  fs.mkdirSync(raiz, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(raiz, 'w-'));
  const caminho = path.join(dir, a.nome);
  fs.writeFileSync(caminho, dados, { flag: 'wx', mode: 0o600 });
  return { caminho, apagar: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
