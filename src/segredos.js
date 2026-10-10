// Segredos, sempre pelo nome e na hora do uso. O valor nunca é logado nem gravado em disco; fica só em memória
// (o de canal por 10 min; os do linter até a próxima leitura do cofre, valendo no máximo 1 h).
//
// O cofre é OPCIONAL. É um helper seu (config.json → cofre.helper, ou a variável CENTRAL_SECRET_BIN): um
// executável que responde a dois comandos, cada um em até 10 s:
//   <helper> list        um nome por linha, em MAIÚSCULAS_COM_UNDERSCORE; sai com 0
//   <helper> get NOME    o valor em stdout; sai com 0 (outro código = não tem esse nome)
// Com helper, o linter compara o texto de toda mensagem com os valores guardados e falha fechado se não
// conseguir ler. Sem helper, vale só a detecção por padrão de texto (sk-, ghp_, "senha:"...).
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

// o helper do cofre, ou null (sem cofre)
const bin = () => process.env.CENTRAL_SECRET_BIN || config.cofre || null;
const TTL = 10 * 60 * 1000;
const cache = new Map();
const execFileP = promisify(execFile);

// Segredo de canal (token do bot do Discord, cliente OAuth do e-mail): a variável de ambiente com esse nome ou,
// se houver, o cofre.
export function segredo(nome) {
  const c = cache.get(nome);
  if (c && Date.now() - c.em < TTL) return c.valor;
  let valor = String(process.env[nome] || '').trim();
  if (!valor) {
    const helper = bin();
    if (!helper) throw new Error(`segredo ${nome} não configurado: defina a variável de ambiente ${nome} ou um helper de cofre`);
    try {
      valor = execFileSync(helper, ['get', nome], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      throw new Error(`segredo ${nome} não está no cofre`);
    }
  }
  cache.set(nome, { valor, em: Date.now() });
  return valor;
}

// testes: põe um valor no cache sem tocar no cofre de verdade
export function semearSegredo(nome, valor) {
  cache.set(nome, { valor, em: Date.now() });
}

// --- valores do cofre para o linter achar segredo colado no texto ---
// Só nomes com cara de segredo. Identificador (URL, ID, login, e-mail, host, porta, telefone) e chave pública
// ficam de fora, senão todo e-mail que cita o próprio endereço seria barrado.
const PALAVRA_DE_SEGREDO = /SENHA|PASSWORD|PASS|PW|SECRET|SEGREDO|TOKEN|KEY|PAT|PIN/;
export function nomeEhSegredo(nome) {
  if (/(^|_)(PUBLIC|PUBLICO|PUBLISHABLE|ANON)(_|$)/.test(nome)) return false;
  if (/_(URL|ID|SID|LOGIN|USER|USERNAME|EMAIL|HOST|PORT|DB|NAME|PHONE|REF|SENDER)(_|$)/.test(nome)
    && !PALAVRA_DE_SEGREDO.test(nome)) return false;
  return true;
}

// Estado EXPLÍCITO, por nome: a última leitura boa de cada um ({ valor, em }) e a última lista boa de nomes.
// Erro nunca vira sucesso: lista que não veio, nome que não leu e valor velho demais aparecem em `falhas` ou
// `erro`, e o linter bloqueia. As regras:
//   1. qualquer erro ao listar ou ler um nome deixa ok=false (e o motivo em `erro`);
//   2. a recarga que falha depois de um sucesso usa a leitura anterior de cada nome só até 1 h de idade; nome
//      NOVO que não leu, ou leitura com mais de 1 h, vai para `falhas` (o linter bloqueia com "N de M não
//      lidos"); a lista de nomes com mais de 1 h também não vale (valores null, bloqueia com o motivo);
//   3. a lista de nomes é relida a cada recarga: segredo novo no cofre entra sem reiniciar o servidor;
//   4. recarrega a cada 10 min (a resposta não espera: vale o que já foi lido até 1 h); depois de uma recarga
//      com erro, tenta de novo em 1 min.
const IDADE_MAX = 60 * 60 * 1000;
const ESPERA_ERRO = 60 * 1000;
const lidos = new Map(); // nome → { valor, em }
let lista = null; // { nomes, em }: a última lista boa
let ultima = null; // { em, erro }: a última recarga, boa ou não
let recarga = null; // a recarga em andamento
let versao = 0; // sobe a cada recarga que leu a lista
let memo = null; // { chave, valores }: o mesmo array enquanto nada muda (o linter prepara os valores uma vez por array)
let geracao = 0; // esquecerCofre() sobe: a recarga que começou antes não grava mais nada

const minutos = (ms) => Math.floor(ms / 60e3);

// O estado agora, sem ler nada: { valores, carregadoEm, ok, falhas, erro, total, tentadoEm, lendo }.
// valores: [{nome, valor}] que o linter usa (null = nada que sirva); carregadoEm: a leitura mais velha em uso.
function retrato(agora) {
  const base = { tentadoEm: ultima?.em ?? null, lendo: !!recarga };
  if (!lista) {
    return { valores: null, carregadoEm: null, ok: false, falhas: [], erro: ultima?.erro || 'o cofre ainda não foi lido', total: 0, ...base };
  }
  if (agora - lista.em > IDADE_MAX) {
    const motivo = `a última lista boa do cofre tem ${minutos(agora - lista.em)} min (o máximo é 60)`;
    return { valores: null, carregadoEm: lista.em, ok: false, falhas: [], erro: ultima?.erro ? `${ultima.erro}; ${motivo}` : motivo, total: lista.nomes.length, ...base };
  }
  const usados = [];
  const falhas = [];
  let carregadoEm = lista.em;
  for (const nome of lista.nomes) {
    const l = lidos.get(nome);
    if (!l || agora - l.em > IDADE_MAX) {
      falhas.push(nome);
      continue;
    }
    carregadoEm = Math.min(carregadoEm, l.em);
    if (l.valor.trim().length >= 8) usados.push(nome); // valor curto foi lido, mas não é conferido
  }
  const chave = `${versao}|${usados.length}`; // dentro da mesma versão, a lista só encolhe (valor que passou de 1 h)
  if (memo?.chave !== chave) memo = { chave, valores: usados.map((nome) => ({ nome, valor: lidos.get(nome).valor })) };
  return { valores: memo.valores, carregadoEm, ok: !ultima?.erro && !falhas.length, falhas, erro: ultima?.erro ?? null, total: lista.nomes.length, ...base };
}

// Sem helper não há cofre: nada a comparar e nada a esperar (desligado: true). O linter segue só com os padrões.
const SEM_COFRE = { valores: [], carregadoEm: null, ok: true, falhas: [], erro: null, total: 0, tentadoEm: null, lendo: false, desligado: true };

// Para o linter: devolve o estado e recarrega quando passou da hora (10 min, ou 1 min depois de erro). Se o
// que já foi lido cobre todos os nomes (até 1 h), responde na hora e a recarga corre por trás; senão, espera
// a recarga. `agora` só existe para o teste.
export function valoresDoCofre({ agora = Date.now() } = {}) {
  if (!bin()) return Promise.resolve(SEM_COFRE);
  const r = retrato(agora);
  const desde = ultima ? agora - ultima.em : Infinity;
  if (desde < (r.ok ? TTL : ESPERA_ERRO)) return Promise.resolve(r);
  if (!recarga) {
    const p = recarregar(agora)
      .catch((e) => { ultima = { em: agora, erro: `erro ao ler o cofre (${e.message})` }; })
      .finally(() => { if (recarga === p) recarga = null; });
    recarga = p;
  }
  if (r.valores && !r.falhas.length) return Promise.resolve(r);
  return recarga.then(() => retrato(agora));
}

// Para /api/saude: o estado sem nenhum valor. bloqueia = o linter está barrando tudo por causa do cofre;
// desligado = não há cofre configurado (não é problema: vale a detecção por padrão).
export function resumoDoCofre({ agora = Date.now() } = {}) {
  if (!bin()) return { ok: true, idadeMin: null, total: 0, falhas: [], erro: null, bloqueia: false, lendo: false, desligado: true };
  const r = retrato(agora);
  return {
    ok: r.ok,
    idadeMin: r.carregadoEm == null ? null : minutos(agora - r.carregadoEm),
    total: r.total,
    falhas: r.falhas,
    erro: r.erro,
    bloqueia: !r.valores || r.falhas.length > 0,
    lendo: r.lendo,
  };
}

// testes: esquece tudo o que foi lido
export function esquecerCofre() {
  geracao++;
  lidos.clear();
  lista = null;
  ultima = null;
  recarga = null;
  memo = null;
}

// Lista os nomes (<helper> list) e lê cada valor com execFile, 8 por vez; o que falhou é lido de novo, um por vez
// (cofre ocupado deixa o primeiro lote passar do tempo), menos quando falhou tudo (cofre trancado).
async function recarregar(agora) {
  const g = geracao;
  let nomes;
  try {
    const { stdout } = await execFileP(bin(), ['list'], { timeout: 10e3 });
    nomes = stdout.split('\n').map((s) => s.trim()).filter((n) => /^[A-Z0-9_]+$/.test(n) && nomeEhSegredo(n));
  } catch (e) {
    const porque = typeof e.code === 'number' ? `saiu com código ${e.code}` : e.killed ? 'sem resposta em 10 s' : e.code || 'erro';
    if (g === geracao) ultima = { em: agora, erro: `não consegui listar o cofre (${porque})` };
    return;
  }
  if (g !== geracao) return;
  // lista vazia não é "nada a conferir": é o cofre sem responder direito
  if (!nomes.length) {
    ultima = { em: agora, erro: 'o cofre não listou nenhum nome' };
    return;
  }
  const ler = async (nome) => {
    try {
      const { stdout } = await execFileP(bin(), ['get', nome], { timeout: 10e3, maxBuffer: 1 << 20 });
      if (g === geracao) lidos.set(nome, { valor: stdout.replace(/\r?\n$/, ''), em: agora });
      return true;
    } catch {
      return false;
    }
  };
  let falharam = [];
  for (let i = 0; i < nomes.length; i += 8) {
    await Promise.all(nomes.slice(i, i + 8).map(async (nome) => { if (!(await ler(nome))) falharam.push(nome); }));
  }
  if (falharam.length && falharam.length < nomes.length) {
    const deNovo = falharam;
    falharam = [];
    for (const nome of deNovo) if (!(await ler(nome))) falharam.push(nome);
  }
  if (g !== geracao) return;
  const atuais = new Set(nomes);
  for (const nome of lidos.keys()) if (!atuais.has(nome)) lidos.delete(nome); // saiu do cofre, sai da conferência
  lista = { nomes, em: agora };
  versao++;
  const quais = `${falharam.slice(0, 5).join(', ')}${falharam.length > 5 ? '…' : ''}`;
  ultima = {
    em: agora,
    erro: !falharam.length ? null
      : falharam.length === nomes.length ? `não consegui ler nenhum dos ${nomes.length} valores do cofre (cofre trancado?)`
        : `não consegui ler ${falharam.length} de ${nomes.length} valores do cofre (${quais})`,
  };
}
