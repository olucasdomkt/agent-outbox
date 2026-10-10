// Central de Mensagens: API + painel. Escuta só em 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { carregarConfig, config } from './config.js';
import { esperandoEles, montarLista, promessaDaCentral, rascunhoCobranca, resumo as resumoTexto, varrerPromessas } from './acompanhar.js';
import { abrirValidado, guardarAnexos, inspecionarAnexos, lerValidados, validarAnexo, validarAnexos } from './anexos.js';
import { abrirDb, erroHttp } from './db.js';
import { saudeDaCopia } from './copia.js';
import { iniciarDespachante } from './despachante.js';
import { analisarDescartes, JANELA_DIAS as JANELA_LICOES, sugerirLicoes } from './licoes.js';
import { lint } from './lint.js';
import { notificar } from './notificar.js';
import { lerPessoas } from './pessoas.js';
import { gravarPreferencias, lerPreferencias } from './preferencias.js';
import { resumoDoCofre, valoresDoCofre } from './segredos.js';
import { mimeDe, parseQuando, semelhanca } from './util.js';
import { criarFotos, JID_COM_FOTO } from './fotos.js';
import { whatsapp } from './canais/whatsapp.js';
import { email } from './canais/email.js';
import { discord } from './canais/discord.js';

// todos os canais que existem (os testes usam os três)
export const CANAIS = { whatsapp, email, discord };
// os que estão configurados: o WhatsApp sempre; e-mail e Discord só depois de ligados no config.json. Canal
// desligado não aparece no painel nem no msg.
export const canaisLigados = () => ({
  whatsapp,
  ...(config.email.contas.length ? { email } : {}),
  ...(config.discord.ligado ? { discord } : {}),
});

// o relógio do limite é desligado quando a promessa termina (senão segura o processo até estourar)
function comTimeout(p, ms, msg) {
  let t;
  const limite = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); });
  return Promise.race([p, limite]).finally(() => clearTimeout(t));
}

function quandoOu400(v) {
  try {
    return parseQuando(v);
  } catch (e) {
    throw erroHttp(400, e.message);
  }
}

// ---------------------------------------------------------------- arquivos estáticos

const TIPOS_ESTATICOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const IMUTAVEL = 'public, max-age=31536000, immutable';
// Segunda barreira contra XSS na interface (a primeira é escapar na própria interface): só script e conexão da
// própria origem, sem moldura nem <base>. Estilo inline (style="...") está liberado. O anexo tem a sua própria
// CSP (sandbox), mais fechada.
export const CABECALHOS_SEGUROS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; "
    + "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

// arquivo de dentro de `raiz`, nunca de fora ("../" e caminho absoluto não passam); false = não existe
function servirArquivo(res, raiz, rel, cache = 'no-cache') {
  const base = path.resolve(raiz);
  const alvo = path.resolve(base, rel);
  if (alvo !== base && !alvo.startsWith(base + path.sep)) return false;
  let st;
  try { st = fs.statSync(alvo); } catch { return false; }
  if (!st.isFile()) return false;
  res.writeHead(200, {
    'content-type': TIPOS_ESTATICOS[path.extname(alvo).toLowerCase()] || 'application/octet-stream',
    'cache-control': cache,
    ...CABECALHOS_SEGUROS,
  });
  fs.createReadStream(alvo).pipe(res);
  return true;
}

// o que aparece no lugar do painel enquanto ele não foi construído (web/dist não vai no repositório)
const SEM_PAINEL = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Central de Mensagens</title>'
  + '<body style="font:16px/1.5 system-ui,sans-serif;max-width:40em;margin:15vh auto;padding:0 1em">'
  + '<h1>O painel ainda não foi construído</h1>'
  + '<p>A Central está no ar, mas falta o build do painel. Na pasta do projeto, rode:</p>'
  + '<pre>npm run build:web</pre>'
  + '<p>e recarregue esta página. A API e o <code>msg</code> já funcionam sem ele.</p></body></html>';

// "/" serve o painel (web/dist), com rota do app caindo no index.html. Hash do Vite (/assets/) fica em cache.
// Sem o build, a página diz qual comando rodar.
function servirEstatico(res, pathname, { webDist }) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return false; }
  if (p.includes('\0')) return false;
  const rel = p.slice(1);
  if (!fs.existsSync(path.join(webDist, 'index.html'))) {
    if (rel && path.extname(rel)) return false;
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...CABECALHOS_SEGUROS });
    res.end(SEM_PAINEL);
    return true;
  }
  if (rel && servirArquivo(res, webDist, rel, rel.startsWith('assets/') ? IMUTAVEL : 'no-cache')) return true;
  if (!rel || !path.extname(rel)) return servirArquivo(res, webDist, 'index.html');
  return false;
}

// ---------------------------------------------------------------- modo prévia

function mesmoArquivo(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  if (ra === rb) return true;
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  if (real(ra) === real(rb)) return true;
  try {
    const sa = fs.statSync(ra);
    const sb = fs.statSync(rb);
    return sa.dev === sb.dev && sa.ino === sb.ino; // link físico para o banco real
  } catch {
    return false;
  }
}

// CENTRAL_MODO=previa sobe um servidor de teste numa CÓPIA do banco. Recusa tudo que possa virar um
// segundo despachante no banco real (envio em duplicado para gente de verdade) ou mexer nos arquivos reais.
export function checarModo(env = process.env, { dbReal = config.dbReal, portaProducao = config.portaProducao } = {}) {
  const modo = env.CENTRAL_MODO || 'normal';
  if (!['normal', 'previa'].includes(modo)) throw new Error(`CENTRAL_MODO inválido: "${modo}" (use previa ou deixe vazio)`);
  if (modo === 'normal') return { modo };
  if (!env.CENTRAL_DB) throw new Error('modo prévia exige CENTRAL_DB apontando para uma CÓPIA do banco');
  if (mesmoArquivo(env.CENTRAL_DB, dbReal)) {
    throw new Error(`modo prévia recusado: CENTRAL_DB é o banco real (${dbReal}). Copie para $TMPDIR e aponte para a cópia.`);
  }
  if (path.resolve(path.dirname(env.CENTRAL_DB)) === path.resolve(path.dirname(dbReal))) {
    throw new Error(`modo prévia recusado: a cópia não pode ficar em ${path.dirname(dbReal)} (o config.json e o pessoas.json de lá são os de verdade)`);
  }
  const porta = Number(env.PORT);
  if (!env.PORT || !Number.isInteger(porta) || porta <= 0) throw new Error('modo prévia exige PORT (uma porta livre, nunca a da Central)');
  if (porta === portaProducao) throw new Error(`modo prévia recusado: a porta ${portaProducao} é a da Central de verdade`);
  return { modo };
}

// segunda trava do modo prévia: nenhum canal envia, mesmo que algo chame o enviar
export function canaisSemEnvio(canais) {
  return Object.fromEntries(Object.entries(canais).map(([id, c]) => [id, {
    ...c,
    enviar: async () => { throw new Error('modo prévia: envio desligado'); },
  }]));
}

// ---------------------------------------------------------------- app

export function criarApp({
  repo, canais = CANAIS, porta = config.porta,
  // testes não leem o cofre de verdade: lista vazia = "conferido, nada a comparar" (só os padrões contam)
  segredosDoCofre = process.env.NODE_ENV === 'test'
    ? async () => ({ valores: [], ok: true, falhas: [], erro: null, total: 0 }) : valoresDoCofre,
  // o estado do cofre sem valores, para /api/saude
  resumoCofre = process.env.NODE_ENV === 'test'
    ? () => ({ ok: true, idadeMin: 0, total: 0, falhas: [], erro: null, bloqueia: false, lendo: false }) : resumoDoCofre,
  pessoasDe = process.env.NODE_ENV === 'test' ? () => [] : () => lerPessoas(config.pessoas),
  // testes nunca gravam cópia de anexo na pasta de verdade
  dirAnexos = process.env.NODE_ENV === 'test' ? path.join(os.tmpdir(), `central-anexos-teste-${process.pid}`) : config.anexos,
  // foto de perfil do WhatsApp: testes não perguntam nada à ponte de verdade (sem isso a rota responde "sem foto")
  fotos = process.env.NODE_ENV === 'test' ? null
    : criarFotos({ dir: path.join(config.fotos, 'whatsapp'), ponte: config.whatsapp.ponte }),
  webDist = config.webDist,
  sse = {},
  cofreMs = 15e3, // quanto o linter espera o cofre antes de bloquear com "não consegui verificar segredos"
  copiaEstado = config.backupEstado, // estado da cópia de segurança, se houver uma (só leitura)
}) {
  let cacheSaude = { em: 0, dados: null };

  // um par por canal, `segredos` (o cofre do linter) e `copia` (a cópia de segurança); os dois últimos
  // sempre na hora, fora do cache dos canais
  async function saude() {
    if (!(Date.now() - cacheSaude.em < 15e3 && cacheSaude.dados)) {
      const pares = await Promise.all(Object.values(canais).map(async (c) => {
        try {
          return [c.id, await comTimeout(c.saude(), 8000, 'sem resposta em 8s')];
        } catch (e) {
          return [c.id, { ok: false, resumo: e.message }];
        }
      }));
      cacheSaude = { em: Date.now(), dados: Object.fromEntries(pares) };
    }
    let segredos;
    try {
      segredos = resumoCofre();
    } catch (e) {
      segredos = { ok: false, idadeMin: null, total: 0, falhas: [], erro: e.message, bloqueia: true, lendo: false };
    }
    // resumo em frase, como os canais têm: quem imprime `resumo` de cada chave (o msg de antes da v2) não mostra "undefined"
    const resumo = segredos.desligado ? 'sem cofre configurado: o linter confere só os padrões de texto (chave, token, senha)'
      : segredos.bloqueia
      ? `o linter barra tudo até ler o cofre: ${segredos.falhas?.length ? `${segredos.falhas.length} de ${segredos.total} não lidos` : segredos.erro}`
      : `${segredos.total} nomes do cofre conferidos, leitura de ${segredos.idadeMin} min atrás${segredos.ok ? '' : ' (a última recarga falhou)'}`;
    return { ...cacheSaude.dados, segredos: { ...segredos, resumo }, copia: saudeDaCopia(copiaEstado) };
  }

  // Entrada: o que chegou em cada canal e ainda espera resposta.
  // Cache curto porque e-mail e Discord são chamadas externas.
  const cacheEntrada = new Map();
  const lendoEntrada = new Map(); // a leitura em andamento por canal: o painel e o stream pedem juntos, lê uma vez
  function lerEntrada(canal) {
    if (!lendoEntrada.has(canal.id)) {
      const c = cacheEntrada.get(canal.id);
      // o canal devolve a lista, ou { itens, aviso } quando parte dele não leu (conta sem login)
      const p = comTimeout(Promise.resolve().then(() => canal.entrada({})), 45000, 'demorou demais')
        .then((r) => ({ em: Date.now(), itens: Array.isArray(r) ? r : r.itens, erro: Array.isArray(r) ? null : r.aviso || null }))
        .catch((e) => ({ em: Date.now(), itens: c?.itens || [], erro: e.message }))
        .then((dados) => { cacheEntrada.set(canal.id, dados); return dados; })
        .finally(() => lendoEntrada.delete(canal.id));
      lendoEntrada.set(canal.id, p);
    }
    return lendoEntrada.get(canal.id);
  }
  async function entradaDoCanal(canal) {
    const c = cacheEntrada.get(canal.id);
    const ttl = canal.id === 'email' ? 180e3 : 60e3;
    if (c && Date.now() - c.em < ttl) return c;
    // vencido: responde com o que já tem e atualiza por trás (a aba não espera o canal mais lento, o e-mail
    // leva de 3 a 45 s); sem nada guardado, espera a leitura
    const p = lerEntrada(canal);
    return c || p;
  }

  async function entrada(filtro) {
    const alvo = Object.values(canais).filter((c) => typeof c.entrada === 'function' && (!filtro || c.id === filtro));
    const partes = await Promise.all(alvo.map(async (c) => [c.id, await entradaDoCanal(c)]));
    const vistos = repo.vistos();
    let itens = partes.flatMap(([, d]) => d.itens).filter((i) => (vistos.get(i.chave) || 0) < i.em);
    const respostas = repo.respostasPor(itens.map((i) => i.chave));
    itens = itens.map((i) => ({ ...i, precisa: i.precisa !== false, resposta: respostas.get(i.chave) || null }))
      .sort((a, b) => b.em - a.em);
    return {
      itens,
      contagem: { precisa: itens.filter((i) => i.precisa).length, total: itens.length },
      erros: Object.fromEntries(partes.filter(([, d]) => d.erro).map(([id, d]) => [id, d.erro])),
    };
  }

  // Histórico do destino, com cache curto (o painel e a varredura perguntam o mesmo).
  const cacheContexto = new Map();
  async function contextoDe(canalId, destino) {
    const canal = canais[canalId];
    if (!canal || typeof canal.contexto !== 'function' || !destino) {
      return { confiavel: false, motivo: `${canal?.nome || canalId} ainda não confere o histórico` };
    }
    const chave = `${canalId}:${destino}`;
    const c = cacheContexto.get(chave);
    if (c && Date.now() - c.em < 60e3) return c.dados;
    let dados;
    try {
      dados = await comTimeout(canal.contexto(destino), 12000, 'demorou demais');
    } catch (e) {
      dados = { confiavel: false, motivo: e.message };
    }
    cacheContexto.set(chave, { em: Date.now(), dados });
    return dados;
  }

  // "Isso eu já mandei": tira da fila a sugestão cujo texto o dono já enviou na mão.
  // Prova é o CONTEÚDO parecido (>= 0.6). Só "falou com o destino depois" não some: pode ser outro assunto.
  const SEMELHANTE = 0.6;
  function jaMandou(m, ctx) {
    if (!ctx?.confiavel) return null;
    for (const x of ctx.minhasUltimas || []) {
      if (semelhanca(m.corpo, x.texto) >= SEMELHANTE) return x;
    }
    return null;
  }

  async function varrerRespondidas() {
    if (!repo.getEstado('sumirRespondidas', true)) return [];
    const sumiram = [];
    for (const m of repo.listar({ status: 'pendente', limite: 50 })) {
      if (!m.destino_id) continue;
      const igual = jaMandou(m, await contextoDe(m.canal, m.destino_id));
      if (!igual) continue;
      repo.descartar(m.id, `sumiu sozinha: você já mandou isso para ${m.destino_nome} em ${new Date(igual.em).toLocaleString('pt-BR')} — "${String(igual.texto || '').slice(0, 140)}"`, 'auto_respondida');
      sumiram.push(m.id);
    }
    return sumiram;
  }

  // Aba Acompanhar: "esperando eles" lê a ponte (60 s de cache, como a Entrada); vistos, promessas e cobranças vêm
  // do banco na hora, então o que o dono resolve some já na próxima leitura.
  let cacheEsperando = { em: 0, dados: null };
  function acompanhar({ tudo = false } = {}) {
    if (!cacheEsperando.dados || Date.now() - cacheEsperando.em >= 60e3) {
      let dados;
      try {
        dados = esperandoEles({ repo, whatsapp: canais.whatsapp });
      } catch (e) {
        dados = { itens: [], ultimas: new Map(), aviso: `não consegui ler o WhatsApp (${e.message})` };
      }
      cacheEsperando = { em: Date.now(), dados };
    }
    const esperando = cacheEsperando.dados;
    return { ...montarLista({ repo, esperando, tudo }), erros: esperando.aviso ? { whatsapp: esperando.aviso } : {} };
  }

  // Cobrar = um rascunho curto que entra PENDENTE na fila, como qualquer outra; nunca sai sem o dono aprovar
  async function cobrar(chave) {
    const item = acompanhar({ tudo: true }).itens.find((i) => i.chave === chave);
    if (!item) throw erroHttp(404, 'esse item não está mais no Acompanhar: a pessoa respondeu ou já foi resolvido');
    if (item.tipo === 'promessa' && item.promessa.sentido !== 'dele') throw erroHttp(400, 'promessa sua não se cobra: use Cumpri, Adiar ou Dispensar');
    if (item.cobranca && item.cobranca.status !== 'enviada') return { ...repo.obter(item.cobranca.id), ja: true };
    const m = await criarMensagem({
      canal: item.canal, conta: item.conta || undefined,
      destino_id: item.destino.id, destino_nome: item.destino.nome, destino_tipo: item.destino.tipo,
      corpo: rascunhoCobranca(item),
      responder_a: item.tipo === 'promessa' ? `${item.destino.nome} prometeu: ${item.promessa.trecho}` : `${item.destino.nome} não respondeu: ${resumoTexto(item.texto, 100)}`,
      contexto: 'Cobrança da aba Acompanhar',
      extra: { acompanhar: chave },
      sessao_nome: 'painel',
    });
    if (item.promessa) repo.ligarCobranca(item.promessa.id, m.id);
    return m;
  }

  function canalOu400(id) {
    const c = canais[id];
    if (!c) throw erroHttp(400, `canal inválido: "${id}". Use: ${Object.keys(canais).join(', ')}`);
    return c;
  }

  // ---------------------------------------------------------------- linter
  // Falha fechado: cofre que não responde em 15 s ou erro dentro do linter viram bloqueio "não consegui
  // verificar segredos" (a leitura do cofre segue em segundo plano e serve à próxima conferência).
  async function conferir(m) {
    try {
      let cofre;
      try {
        cofre = await comTimeout(Promise.resolve().then(segredosDoCofre), cofreMs, `o cofre não respondeu em ${cofreMs / 1000} s`);
      } catch (e) {
        cofre = { valores: null, erro: e.message, falhas: [], total: 0 };
      }
      // valores: o que foi lido (até 1 h); falhas: nomes sem leitura que sirva. O linter bloqueia sem valores
      // ou com qualquer falha; ok=false com tudo coberto (recarga que falhou, leitura anterior de até 1 h) passa.
      // saida: tudo o que o canal manda, do mesmo montar() do envio (corpo com menções e assinatura, assunto,
      // citação, destinatários, nome dos anexos, partes); o aprovar e o despachante passam por aqui. Sem
      // destino não há montar (e a mensagem não sai): valem os campos da linha até escolherem o destino.
      const canal = canais[m.canal];
      // quem está na mesma sequência (ordem entre mensagens) não conta como duplicada: a ordem já diz que são duas
      const sequencia = m.destino_id ? repo.sequenciaDe(m) : null;
      return lint(m, {
        saida: typeof canal?.saida === 'function' && m.destino_id ? canal.saida(m) : null,
        segredos: cofre?.valores ?? null,
        cofreErro: cofre?.erro,
        cofreFalhas: cofre?.falhas,
        cofreTotal: cofre?.total,
        semCofre: !!cofre?.desligado,
        pessoas: pessoasDe(),
        clientes: config.clientes,
        outrasPendentes: m.destino_id ? repo.pendentesPara(m.canal, m.destino_id, m.id ?? null).filter((id) => !sequencia.has(id)) : [],
        destinoConhecido: m.destino_id && typeof canal?.conhecido === 'function' ? canal.conhecido(m.destino_id) : null,
        anterior: m.substitui_id ? repo.obter(m.substitui_id) : null,
        senhasDeCliente: lerPreferencias().senhasDeCliente,
        anexos: inspecionarAnexos(m.anexos),
        // lições do dono: aviso, nunca bloqueio; a última enviada ao destino diz se é a primeira do dia (saudação)
        licoes: repo.licoesAtivas(),
        ultimaEnviada: m.destino_id ? repo.ultimaEnviadaPara(m.canal, m.destino_id) : null,
        agora: Date.now(),
      });
    } catch (e) {
      return { bloqueios: [{ regra: 'segredo', msg: `não consegui verificar segredos: erro no linter (${e.message})`, naoChecou: true }], avisos: [], cofre: false };
    }
  }

  // guarda o resultado na linha (o painel mostra); só para quem ainda pode sair
  async function comLint(m) {
    if (!m || !['pendente', 'erro', 'aprovada'].includes(m.status)) return m;
    return repo.salvarLint(m.id, await conferir(m));
  }

  // Toda aprovação passa aqui (botão, lote): o linter lê a linha do BANCO, nunca um texto vindo no pedido,
  // e o UPDATE só vale se a linha ainda for a versão que o linter leu. Não existe parâmetro que pule a trava.
  async function aprovarConferida(id, corpo = {}) {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const atual = repo.obter(id);
      if (!atual) throw erroHttp(404, `mensagem #${id} não existe`);
      if (!['pendente', 'erro'].includes(atual.status)) {
        throw erroHttp(409, `#${id} está “${atual.status}”, não dá para aprovar`, { status: atual.status });
      }
      const r = await conferir(atual);
      if (r.bloqueios.length) {
        repo.salvarLint(id, r);
        throw erroHttp(422, 'bloqueada', { bloqueios: r.bloqueios });
      }
      const quando = corpo.agendar_para !== undefined ? quandoOu400(corpo.agendar_para) : atual.agendar_para;
      const m = repo.aprovar(id, quando, { janelaMs: lerPreferencias().janelaDesfazerMs, versao: atual.atualizado_em, lint: r });
      if (m) return m;
    }
    throw erroHttp(409, `#${id} mudou enquanto o linter conferia; tente de novo`);
  }

  async function criarMensagem(d) {
    const canal = canalOu400(d.canal);
    let conta = d.conta || canal.contaPadrao;
    const contas = canal.contas();
    if (!contas.some((c) => c.id === conta)) {
      throw erroHttp(400, `conta "${conta}" não existe em ${canal.nome}. Opções: ${contas.map((c) => c.id).join(', ')}`);
    }
    // a validação de src/anexos.js: credencial (caminho, nome ou conteúdo), symlink, compactado e 20 MB
    // recusam antes de gravar a mensagem; o conteúdo já sai lido do descritor conferido para a cópia durável
    const validados = d.anexos?.length ? lerValidados(validarAnexos(d.anexos)) : null;
    let destino = null;
    let candidatos = null;
    let aviso = null;
    if (d.destino_id) {
      destino = { id: d.destino_id, nome: d.destino_nome || d.destino_id, tipo: d.destino_tipo || null };
    } else if (d.para) {
      try {
        const r = await canal.resolver(d.para, conta);
        if (r.destino) destino = r.destino; else candidatos = r.candidatos || [];
        if (r.conta) conta = r.conta;
      } catch (e) {
        candidatos = [];
        aviso = `não consegui procurar "${d.para}" agora (${e.message}); escolha o destino no painel`;
      }
    }
    const m = repo.criar({
      canal: canal.id, conta,
      destino_id: destino?.id, destino_nome: destino?.nome, destino_tipo: destino?.tipo,
      para_pedido: d.para || null, candidatos,
      responder_a: d.responder_a, contexto: d.contexto, assunto: d.assunto, corpo: d.corpo,
      anexos: d.anexos?.length ? d.anexos : null, extra: d.extra || null, cliente: d.cliente,
      sessao_nome: d.sessao_nome, sessao_job: d.sessao_job,
      app: d.app || d.origem?.repo || null, origem: d.origem || null,
      agendar_para: quandoOu400(d.agendar_para),
      substitui_id: d.substitui_id ?? null,
      tambem: !!d.tambem,
      depois_de: d.depois_de ?? null,
      espera_resposta: !!d.espera_resposta,
      acompanhar: d.acompanhar ?? null,
    });
    if (aviso) repo.evento(m.id, 'aviso', aviso);
    if (m.duplicada) return { ...m, aviso };
    // Mesma sessão, texto quase igual, OUTRO destino, a anterior ainda na fila: pode ser o destino corrigido
    // (a primeira foi para um número errado). Isso não substitui sozinho (pode ser o mesmo aviso para várias
    // pessoas); a resposta traz as parecidas e o msg add diz como descartar a anterior.
    const sid = d.origem?.sessao_id;
    const parecidas = !sid ? [] : repo.db.prepare(`SELECT id, destino_nome, status, corpo FROM mensagens WHERE canal = ? AND id NOT IN (?, ?)
      AND status IN ('pendente','erro') AND json_extract(origem, '$.sessao_id') = ? AND COALESCE(destino_id, '') <> COALESCE(?, '') AND criado_em > ?`)
      .all(m.canal, m.id, m.substitui_id ?? 0, sid, m.destino_id ?? null, m.criado_em - 86400e3)
      .filter((x) => semelhanca(x.corpo, m.corpo) >= 0.8)
      .map(({ id, destino_nome, status }) => ({ id, destino_nome, status }));
    let criada = m;
    if (validados) {
      try {
        criada = repo.trocarAnexos(m.id, guardarAnexos(dirAnexos, m.id, validados));
      } catch (e) {
        repo.evento(m.id, 'aviso', `não consegui guardar a cópia dos anexos (${e.message}); ficou o caminho original`);
      }
    }
    notificar(`${canal.nome} → ${m.destino_nome || d.para || 'destino a escolher'}`,
      `Nova mensagem para aprovar${m.sessao_nome ? ` (${m.sessao_nome})` : ''}`);
    return { ...(await comLint(criada)), aviso, ...(parecidas.length ? { parecidas } : {}) };
  }

  // PATCH: extra é mesclado no que já existe (citar, prazo, entrada, thread_id...); null apaga a chave.
  // Editar uma aprovada que ainda não saiu devolve ela para revisão. A ordem (depois_de, espera_resposta; null
  // solta) não devolve: só atrasa a saída, não muda o que sai. Acompanhar a resposta (horas; null para) também não.
  async function editarMensagem(id, pedido) {
    const { depois_de, espera_resposta, acompanhar: horas, ...corpo } = pedido;
    let m = 'acompanhar' in pedido ? repo.marcarAcompanhar(id, horas) : null;
    if ('depois_de' in pedido || 'espera_resposta' in pedido) m = repo.definirDepois(id, { depois_de, espera_resposta });
    if (m && !Object.keys(corpo).length) return m;
    const atual = repo.obter(id);
    if (!atual) throw erroHttp(404, `mensagem #${id} não existe`);
    if (corpo.conta) {
      const canal = canais[atual.canal];
      if (canal && !canal.contas().some((c) => c.id === corpo.conta)) throw erroHttp(400, `conta inválida: ${corpo.conta}`);
    }
    const campos = { ...corpo };
    // anexo novo também vira cópia da Central (o que já é cópia desta mensagem fica como está)
    if (campos.anexos != null && ['pendente', 'erro', 'aprovada'].includes(atual.status)) {
      campos.anexos = Array.isArray(campos.anexos) && !campos.anexos.length ? null
        : guardarAnexos(dirAnexos, id, lerValidados(validarAnexos(campos.anexos)));
    }
    if (campos.extra && typeof campos.extra === 'object' && !Array.isArray(campos.extra)) {
      const extra = { ...(atual.extra && typeof atual.extra === 'object' ? atual.extra : {}) };
      for (const [k, v] of Object.entries(campos.extra)) {
        if (v === null) delete extra[k]; else extra[k] = v;
      }
      campos.extra = Object.keys(extra).length ? extra : null;
    }
    return comLint(repo.editar(id, campos, { reabrir: true }));
  }

  const resumo = () => ({
    contagens: repo.contagens(),
    pausado: repo.getEstado('pausado', false),
    sumirRespondidas: repo.getEstado('sumirRespondidas', true),
    modo: config.modo,
    dono: config.dono.nome || null, // o painel usa nos textos; null = textos neutros
    clientes: config.clientes.map((c) => c.nome), // a grafia de cada cliente, para o painel agrupar a fila
    canais: Object.values(canais).map((c) => ({
      id: c.id, nome: c.nome, contas: c.contas(), contaPadrao: c.contaPadrao,
      podeLer: typeof c.ler === 'function', podeEntrada: typeof c.entrada === 'function',
    })),
  });

  const configAtual = () => {
    const p = lerPreferencias();
    return {
      sumirRespondidas: repo.getEstado('sumirRespondidas', true),
      janelaDesfazerMs: p.janelaDesfazerMs,
      assinaturas: p.assinaturas,
      senhasDeCliente: p.senhasDeCliente, // só leitura aqui: muda à mão no config.json
    };
  };
  function salvarConfig(corpo) {
    const parcial = {};
    for (const k of ['janelaDesfazerMs', 'assinaturas']) if (k in corpo) parcial[k] = corpo[k];
    if (Object.keys(parcial).length) {
      gravarPreferencias(parcial, { contasEmail: canais.email ? canais.email.contas().map((c) => c.id) : [] });
    }
    if ('sumirRespondidas' in corpo) repo.setEstado('sumirRespondidas', !!corpo.sumirRespondidas);
    return configAtual();
  }

  // a prévia sai do mesmo montar() do envio; cache curto por versão da linha
  const cachePrevia = new Map();
  async function previa(id) {
    const m = repo.obter(id);
    if (!m) throw erroHttp(404, `mensagem #${id} não existe`);
    if (!m.destino_id) throw erroHttp(400, `#${id} ainda não tem destino: escolha um para ver a prévia`);
    const canal = canais[m.canal];
    if (typeof canal?.previa !== 'function') throw erroHttp(400, `${canal?.nome || m.canal} ainda não tem prévia`);
    const chave = `${m.id}:${m.atualizado_em}`;
    const c = cachePrevia.get(chave);
    if (c && Date.now() - c.em < 15e3) return c.dados;
    const dados = await comTimeout(Promise.resolve().then(() => canal.previa(m)), 20000, 'a prévia demorou demais');
    for (const [k, v] of cachePrevia) if (Date.now() - v.em > 15e3) cachePrevia.delete(k);
    cachePrevia.set(chave, { em: Date.now(), dados });
    return dados;
  }

  // ---------------------------------------------------------------- lições (src/licoes.js)
  // Sugestões saem do que o dono editou antes de sair; a que virou lição ou que ele ignorou sai da lista.
  const sugestoesDeLicao = () => sugerirLicoes(repo.editadas(Date.now() - JANELA_LICOES * 86400e3));
  function telaLicoes() {
    const { sugestoes, edicoes } = sugestoesDeLicao();
    const licoes = repo.licoes();
    const fora = new Set([...licoes.map((l) => l.chave).filter(Boolean), ...repo.getEstado('licoes_ignoradas', [])]);
    return {
      janelaDias: JANELA_LICOES, sugestoes: sugestoes.filter((s) => !fora.has(s.chave)), licoes, edicoes,
      descartes: analisarDescartes(repo.descartadas(Date.now() - JANELA_LICOES * 86400e3)),
    };
  }
  // à mão (tipo, trecho, por, canal, nota) ou de uma sugestão (chave), com o que o dono mudou nela por cima
  function criarLicao(corpo) {
    const campos = Object.fromEntries(['tipo', 'trecho', 'por', 'canal', 'nota', 'ativa'].filter((k) => k in corpo).map((k) => [k, corpo[k]]));
    if (!corpo.chave) return repo.criarLicao(campos);
    const s = sugestoesDeLicao().sugestoes.find((x) => x.chave === corpo.chave);
    if (!s) throw erroHttp(404, 'essa sugestão não está mais na lista (a conta mudou): recarregue a tela');
    const { chave, tipo, trecho, por, padrao, canal, nota, contagem, evidencias } = s;
    return repo.criarLicao({ chave, tipo, trecho, por, padrao, canal, nota, contagem, evidencias, ...campos });
  }
  function ignorarSugestao(corpo) {
    if (!corpo.chave) throw erroHttp(400, 'falta a chave da sugestão');
    const lista = new Set(repo.getEstado('licoes_ignoradas', []));
    if (corpo.desfazer) lista.delete(String(corpo.chave));
    else lista.add(String(corpo.chave));
    repo.setEstado('licoes_ignoradas', [...lista]);
    return { ok: true };
  }

  const LOTE = {
    aprovar: (id) => aprovarConferida(id),
    descartar: (id, corpo) => repo.descartar(id, corpo.motivo ?? null, corpo.motivo_codigo ?? null),
    desfazer: (id) => repo.desfazer(id),
  };

  const rotas = [
    ['GET', /^\/api\/resumo$/, () => resumo()],
    ['GET', /^\/api\/saude$/, () => saude()],
    ['GET', /^\/api\/mensagens$/, (_, q) => repo.listar({
      status: q.get('status'), canal: q.get('canal'), cliente: q.get('cliente'), q: q.get('q'), limite: q.get('limite') || 200,
    })],
    ['GET', /^\/api\/mensagens\/(\d+)$/, ([id]) => {
      const m = repo.obter(Number(id));
      if (!m) throw erroHttp(404, `mensagem #${id} não existe`);
      return { ...m, eventos: repo.eventos(Number(id)) };
    }],
    ['GET', /^\/api\/mensagens\/(\d+)\/previa$/, ([id]) => previa(Number(id))],
    ['GET', /^\/api\/mensagens\/(\d+)\/versoes$/, ([id]) => repo.versoes(Number(id))],
    ['POST', /^\/api\/mensagens$/, (_, __, corpo) => criarMensagem(corpo)],
    ['PATCH', /^\/api\/mensagens\/(\d+)$/, ([id], _, corpo) => editarMensagem(Number(id), corpo)],
    ['PUT', /^\/api\/mensagens\/(\d+)$/, ([id], _, corpo) => editarMensagem(Number(id), corpo)],
    ['POST', /^\/api\/mensagens\/(\d+)\/aprovar$/, async ([id], _, corpo) => ({ ...(await aprovarConferida(Number(id), corpo)), ok: true })],
    ['POST', /^\/api\/mensagens\/(\d+)\/desfazer$/, ([id]) => ({ ...repo.desfazer(Number(id)), ok: true })],
    ['POST', /^\/api\/mensagens\/(\d+)\/agendar$/, ([id], _, corpo) => {
      if (!('quando' in corpo)) throw erroHttp(400, 'falta "quando" (epoch ms, "+2h", "2026-10-06 08:00" ou null)');
      return { ...repo.agendar(Number(id), quandoOu400(corpo.quando)), ok: true };
    }],
    ['POST', /^\/api\/mensagens\/(\d+)\/anexo\/(\d+)\/pasta$/, ([id, i]) => {
      const arq = repo.obter(Number(id))?.anexos?.[Number(i)];
      if (!arq || !path.isAbsolute(arq) || !fs.existsSync(arq)) throw erroHttp(404, 'anexo não encontrado');
      // mostra o arquivo na pasta: Finder no macOS, a pasta no Linux (xdg-open); sem nenhum dos dois, o painel
      // ainda recebe o caminho. Caminho absoluto começa com "/": nunca vira opção do comando.
      if (process.env.NODE_ENV !== 'test') {
        const alvo = path.resolve(arq);
        const [comando, args] = process.platform === 'darwin' ? ['open', ['-R', alvo]] : ['xdg-open', [path.dirname(alvo)]];
        execFile(comando, args, () => { /* sem o comando na máquina: nada a fazer */ });
      }
      return { ok: true, caminho: arq };
    }],
    ['POST', /^\/api\/mensagens\/(\d+)\/desaprovar$/, ([id]) => repo.desaprovar(Number(id))],
    ['POST', /^\/api\/mensagens\/(\d+)\/descartar$/, ([id], _, corpo) => ({
      ...repo.descartar(Number(id), corpo.motivo ?? null, corpo.motivo_codigo ?? null), ok: true,
    })],
    ['POST', /^\/api\/mensagens\/(\d+)\/restaurar$/, async ([id]) => comLint(repo.restaurar(Number(id)))],
    ['POST', /^\/api\/lote$/, async (_, __, corpo) => {
      const fazer = LOTE[corpo.acao];
      if (!fazer) throw erroHttp(400, `acao inválida: "${corpo.acao}". Use: ${Object.keys(LOTE).join(', ')}`);
      const ids = [...new Set((Array.isArray(corpo.ids) ? corpo.ids : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
      if (!ids.length) throw erroHttp(400, 'falta a lista ids');
      if (ids.length > 200) throw erroHttp(400, 'no máximo 200 mensagens por lote');
      const resultados = [];
      for (const id of ids) {
        try {
          const m = await fazer(id, corpo);
          resultados.push({ id, ok: true, status: m.status });
        } catch (e) {
          resultados.push({ id, ok: false, erro: e.message, ...(e.dados || {}) });
        }
      }
      return { resultados };
    }],
    // conferir um rascunho sem gravar nada (o editor chama enquanto o dono digita)
    ['POST', /^\/api\/lint$/, async (_, __, corpo) => {
      const base = corpo.id != null ? repo.obter(Number(corpo.id)) : null;
      if (corpo.id != null && !base) throw erroHttp(404, `mensagem #${corpo.id} não existe`);
      const m = { ...(base || {}) };
      for (const k of ['canal', 'conta', 'destino_id', 'destino_nome', 'cliente', 'assunto', 'corpo', 'anexos', 'extra', 'candidatos', 'agendar_para']) {
        if (k in corpo) m[k] = corpo[k];
      }
      if (!m.canal) throw erroHttp(400, 'falta o canal');
      return conferir(m);
    }],
    ['GET', /^\/api\/destinos$/, async (_, q) => canalOu400(q.get('canal')).buscar(q.get('q') || '', q.get('conta') || undefined)],
    ['GET', /^\/api\/ler$/, async (_, q) => {
      const canal = canalOu400(q.get('canal'));
      if (typeof canal.ler !== 'function') throw erroHttp(400, `${canal.nome} ainda não tem leitura`);
      return canal.ler(q.get('chat'), Number(q.get('n')) || 30, q.get('conta') || undefined);
    }],
    ['GET', /^\/api\/entrada$/, (_, q) => entrada(q.get('canal') || null)],
    // o que já rolou com o destino: evita aprovar mensagem que o dono já mandou na mão
    ['GET', /^\/api\/contexto$/, (_, q) => contextoDe(canalOu400(q.get('canal')).id, q.get('destino'))],
    ['POST', /^\/api\/varrer$/, async () => ({ sumiram: await varrerRespondidas() })],
    ['GET', /^\/api\/relatorio$/, (_, q) => repo.relatorio(Math.min(Math.max(Number(q.get('dias')) || 14, 1), 365))],
    // lições: ?ativas=1 só as que valem (msg guia); sem ele, a tela inteira (sugestões, lições, descartes)
    ['GET', /^\/api\/licoes$/, (_, q) => (['1', 'true'].includes(q.get('ativas')) ? { licoes: repo.licoesAtivas() } : telaLicoes())],
    ['POST', /^\/api\/licoes$/, (_, __, corpo) => criarLicao(corpo)],
    ['POST', /^\/api\/licoes\/ignorar$/, (_, __, corpo) => ignorarSugestao(corpo)],
    ['PATCH', /^\/api\/licoes\/(\d+)$/, ([id], _, corpo) => repo.editarLicao(Number(id), corpo)],
    ['GET', /^\/api\/config$/, () => configAtual()],
    ['PUT', /^\/api\/config$/, (_, __, corpo) => salvarConfig(corpo)],
    ['POST', /^\/api\/config$/, (_, __, corpo) => salvarConfig(corpo)],
    ['GET', /^\/api\/pessoas$/, () => pessoasDe()],
    ['POST', /^\/api\/entrada\/visto$/, (_, __, corpo) => {
      if (!corpo.chave) throw erroHttp(400, 'falta a chave do item');
      repo.marcarVisto(corpo.chave, corpo.em);
      return { ok: true };
    }],
    // aba Acompanhar ("Não preciso" usa o /api/entrada/visto, com a chave e o em do item)
    ['GET', /^\/api\/acompanhar$/, (_, q) => acompanhar({ tudo: ['1', 'true'].includes(q.get('tudo')) })],
    ['POST', /^\/api\/acompanhar\/cobrar$/, (_, __, corpo) => {
      if (!corpo.chave) throw erroHttp(400, 'falta a chave do item');
      return cobrar(String(corpo.chave));
    }],
    ['POST', /^\/api\/promessas\/(\d+)\/(cumpri|recebi|dispensar|reabrir|adiar)$/, ([id, acao], _, corpo) => {
      if (acao !== 'adiar') return repo.fecharPromessa(Number(id), acao);
      const horas = corpo.horas == null ? 24 : Number(corpo.horas);
      if (!Number.isInteger(horas) || horas < 1 || horas > 720) throw erroHttp(400, `horas inválidas: "${corpo.horas}" (de 1 a 720)`);
      return repo.adiarPromessa(Number(id), horas);
    }],
    ['POST', /^\/api\/pausar$/, () => { repo.setEstado('pausado', true); return { pausado: true }; }],
    ['POST', /^\/api\/retomar$/, () => { repo.setEstado('pausado', false); return { pausado: false }; }],
  ];

  // ---------------------------------------------------------------- tempo real (SSE)
  // PRAGMA data_version muda quando OUTRA conexão grava no banco (outro processo, script);
  // total_changes() pega o que esta conexão gravou. Só há timers enquanto alguém está ouvindo.
  const pollMs = sse.pollMs ?? 1000;
  const pingMs = sse.pingMs ?? 15000;
  const saudeMs = sse.saudeMs ?? 30000;
  const entradaMs = sse.entradaMs ?? 60000;
  const ouvintes = new Set();
  const enviadas = new Map(); // id → atualizado_em já mandado
  let timers = [];
  let marca = null;

  const evento = (res, nome, dados) => res.write(`event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`);
  const paraTodos = (nome, dados) => { for (const res of ouvintes) evento(res, nome, dados); };
  const versaoDoBanco = () => `${repo.db.pragma('data_version', { simple: true })}:${repo.db.prepare('SELECT total_changes() n').get().n}`;

  function conferirMudancas() {
    const v = versaoDoBanco();
    if (v === marca.versao) return;
    marca.versao = v;
    for (const m of repo.mudadasDesde(marca.desde - 5000)) {
      if (enviadas.get(m.id) === m.atualizado_em) continue;
      enviadas.set(m.id, m.atualizado_em);
      marca.desde = Math.max(marca.desde, m.atualizado_em);
      paraTodos('mensagem', m);
    }
    for (const [id, em] of enviadas) if (em < marca.desde - 60e3) enviadas.delete(id);
    paraTodos('resumo', resumo());
  }

  const repetir = (fn, ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; };
  function ligarStream() {
    marca = { versao: versaoDoBanco(), desde: Date.now() };
    enviadas.clear();
    timers = [
      repetir(() => { try { conferirMudancas(); } catch (e) { console.log('[stream]', e.message); } }, pollMs),
      repetir(() => { for (const res of ouvintes) res.write(': ping\n\n'); }, pingMs),
      repetir(() => saude().then((d) => paraTodos('saude', d)).catch(() => {}), saudeMs),
      repetir(() => {
        entrada(null).then((d) => paraTodos('entrada', d.contagem)).catch(() => {});
        contagemAcompanhar().then((c) => paraTodos('acompanhar', c)).catch(() => {});
      }, entradaMs),
    ];
  }
  // contador da aba Acompanhar (depois da resposta já aberta: a primeira leitura da ponte leva um instante)
  const contagemAcompanhar = () => Promise.resolve().then(() => acompanhar().contagem);
  function desligarStream() {
    for (const t of timers) clearInterval(t);
    timers = [];
  }

  function abrirStream(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    if (!ouvintes.size) ligarStream();
    ouvintes.add(res);
    evento(res, 'resumo', resumo());
    saude().then((d) => ouvintes.has(res) && evento(res, 'saude', d)).catch(() => {});
    entrada(null).then((d) => ouvintes.has(res) && evento(res, 'entrada', d.contagem)).catch(() => {});
    contagemAcompanhar().then((c) => ouvintes.has(res) && evento(res, 'acompanhar', c)).catch(() => {});
    req.on('close', () => {
      ouvintes.delete(res);
      if (!ouvintes.size) desligarStream();
    });
  }

  // ---------------------------------------------------------------- roteamento

  const hostsOk = new Set([`127.0.0.1:${porta}`, `localhost:${porta}`]);

  async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
    const responder = (status, dados) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(dados));
    };
    // DNS rebinding: só aceita quem chama pelo próprio endereço local
    if (!hostsOk.has(req.headers.host)) return responder(403, { erro: 'host não permitido' });

    if (req.method === 'GET' && url.pathname === '/api/stream') return abrirStream(req, res);

    // anexo de uma mensagem: só serve arquivo que está na lista de anexos dela
    const anexo = req.method === 'GET' && url.pathname.match(/^\/api\/mensagens\/(\d+)\/anexo\/(\d+)$/);
    if (anexo) {
      const arq = repo.obter(Number(anexo[1]))?.anexos?.[Number(anexo[2])];
      if (!arq) return responder(404, { erro: 'anexo não encontrado' });
      // a mesma validação do envio: mensagem antiga que aponta para credencial não vira download, e o que sai
      // é lido do descritor conferido (trocar o arquivo depois da validação não muda o que é servido)
      let fd;
      try {
        fd = abrirValidado(validarAnexo(arq));
      } catch (e) {
        return responder(e.codigo === 'sumiu' ? 404 : 403, { erro: e.message });
      }
      const nome = encodeURIComponent(path.basename(arq));
      res.writeHead(200, {
        'content-type': mimeDe(arq),
        'content-disposition': `${url.searchParams.has('baixar') ? 'attachment' : 'inline'}; filename*=UTF-8''${nome}`,
        'cache-control': 'no-store',
        // o anexo nunca roda script na origem da Central (HTML/SVG anexado abre isolado)
        'x-content-type-options': 'nosniff',
        // PDF fica de fora: o visualizador do Chrome não abre em sandbox, e PDF não roda script da página
        ...(path.extname(arq).toLowerCase() === '.pdf' ? {} : {
          'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        }),
      });
      return fs.createReadStream(arq, { fd }).pipe(res);
    }

    // foto de perfil do WhatsApp: 200 com a miniatura, 204 sem foto, 202 enquanto a ponte ainda está perguntando.
    // Só para quem o WhatsApp do dono já conhece ou é destino de mensagem da fila, e só pedido da própria
    // interface: página de outro site não usa a Central para sondar números com a conta dele.
    const foto = req.method === 'GET' && url.pathname.match(/^\/api\/fotos\/whatsapp\/([^/]{1,80})$/);
    if (foto) {
      const semCorpo = (status, cache) => { res.writeHead(status, { 'cache-control': cache }); res.end(); };
      if (!['same-origin', 'none', undefined].includes(req.headers['sec-fetch-site'])) return responder(403, { erro: 'só a própria interface pede foto' });
      let jid;
      try { jid = decodeURIComponent(foto[1]); } catch { jid = ''; }
      if (!JID_COM_FOTO.test(jid)) return responder(400, { erro: 'destino sem foto' });
      const conhecido = canais.whatsapp?.conhecido?.(jid)
        || !!repo.db.prepare("SELECT 1 FROM mensagens WHERE canal = 'whatsapp' AND destino_id = ? LIMIT 1").get(jid);
      if (!fotos || !conhecido) return semCorpo(204, 'no-store');
      const f = await fotos.foto(jid, { esperarMs: 1200 });
      if (f.estado === 'buscando') return semCorpo(202, 'no-store');
      let bytes = null;
      if (f.estado === 'tem') { try { bytes = fs.readFileSync(f.arquivo); } catch { /* apagada agora há pouco */ } }
      if (!bytes) return semCorpo(204, f.incerto || f.estado === 'tem' ? 'no-store' : 'private, max-age=3600');
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
      return res.end(bytes);
    }

    if (url.pathname.startsWith('/api/')) {
      const rota = rotas.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!rota) return responder(404, { erro: 'rota não existe' });
      // escrita exige cabeçalho próprio: formulário de outro site não consegue mandar
      if (req.method !== 'GET' && req.headers['x-central'] !== '1') return responder(403, { erro: 'falta o cabeçalho x-central' });
      try {
        let corpo = {};
        if (req.method !== 'GET') {
          let bruto = '';
          for await (const pedaco of req) {
            bruto += pedaco;
            if (bruto.length > 2e6) throw erroHttp(413, 'corpo grande demais');
          }
          corpo = bruto ? JSON.parse(bruto) : {};
          if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw erroHttp(400, 'o corpo tem de ser um objeto JSON');
        }
        const params = url.pathname.match(rota[1]).slice(1);
        return responder(200, await rota[2](params, url.searchParams, corpo));
      } catch (e) {
        return responder(e.status || (e instanceof SyntaxError ? 400 : 500), { erro: e.message, ...(e.dados || {}) });
      }
    }

    if (req.method === 'GET' && servirEstatico(res, url.pathname, { webDist })) return undefined;
    return responder(404, { erro: 'rota não existe' });
  }

  handler.varrerRespondidas = varrerRespondidas;
  handler.conferir = conferir;
  // promessas: a varredura de 10 min e o que acabou de sair (despachante)
  handler.varrerAcompanhar = (agora) => varrerPromessas({ repo, whatsapp: canais.whatsapp }, agora);
  handler.aoEnviar = (m) => promessaDaCentral({ repo, whatsapp: canais.whatsapp }, m);
  handler.ouvindo = () => ({ ouvintes: ouvintes.size, timers: timers.length });
  handler.parar = () => {
    desligarStream();
    for (const res of ouvintes) res.end();
    ouvintes.clear();
  };
  return handler;
}

// execução direta: node src/server.js
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let modo;
  try {
    ({ modo } = checarModo());
  } catch (e) {
    console.error(`[central] ${e.message}`);
    process.exit(1);
  }
  const previa = modo === 'previa';
  carregarConfig(); // dono, canais ligados, clientes e cofre: o config.json que mora junto do banco
  const repo = abrirDb(config.db);
  const canais = previa ? canaisSemEnvio(canaisLigados()) : canaisLigados();
  const app = criarApp({ repo, canais });
  const servidor = http.createServer(app);
  // A porta primeiro: se já há uma Central nela (subiram duas), este processo sai sem tocar na fila. Na ordem
  // inversa ele marcaria como erro o envio em andamento da outra, cairia no EADDRINUSE e um gerenciador de
  // processos repetiria isso a cada reinício.
  try {
    await new Promise((ok, falhou) => { servidor.once('error', falhou); servidor.listen(config.porta, config.host, ok); });
  } catch (e) {
    console.error(`[central] não subiu: ${e.code === 'EADDRINUSE' ? `a porta ${config.porta} já está em uso (outra Central no ar?); a fila não foi tocada` : e.message}`);
    process.exit(1);
  }
  console.log(`[central] no ar em http://${config.host}:${config.porta} · banco ${config.db} · canais: ${Object.keys(canais).join(', ')}${previa ? ' · MODO PRÉVIA: sem despachante, sem notificação, sem envio' : ''}`);
  if (!fs.existsSync(path.join(config.webDist, 'index.html'))) {
    console.log('[central] o painel ainda não foi construído: rode "npm run build:web" (a API e o msg já funcionam)');
  }
  if (!previa) {
    const presas = repo.recuperarInterrompidas();
    if (presas) console.log(`[central] ${presas} envio(s) interrompido(s) marcados como erro para conferência`);
  }
  // aquece o cofre do linter (a primeira leitura leva alguns segundos) e o mantém lido mesmo sem mensagem
  // chegando: a recarga só acontece quando alguém pede, e leitura com mais de 1 h não vale
  valoresDoCofre().then((r) => console.log(r.desligado ? '[cofre] sem helper configurado: o linter confere só os padrões de texto'
    : r.valores && !r.falhas.length
    ? `[cofre] ${r.total} nomes lidos, ${r.valores.length} valores para o linter`
    : `[cofre] o linter bloqueia até conseguir ler: ${r.falhas.length ? `${r.falhas.length} de ${r.total} não lidos` : r.erro}`));
  setInterval(() => valoresDoCofre().catch(() => {}), 5 * 60e3);
  let despachante = null;
  if (!previa) {
    despachante = iniciarDespachante({
      repo, canais, config, conferir: app.conferir,
      // "só depois que a pessoa responder": a ponte do WhatsApp (só leitura) diz quando ela mandou a última mensagem
      respostas: (a) => canais[a.canal]?.ultimaRecebida?.(a.destino_id) ?? null,
      aoEnviar: app.aoEnviar,
    });
    // varre a fila atrás de sugestão que o dono já respondeu na mão
    const varredura = setInterval(() => {
      app.varrerRespondidas().then((ids) => {
        if (ids.length) console.log(`[varredura] ${ids.length} sumiram porque já foram respondidas: ${ids.map((i) => `#${i}`).join(', ')}`);
      }).catch((e) => console.log('[varredura]', e.message));
    }, 120e3);
    varredura.unref?.();
  }
  // aba Acompanhar: promessas novas no que saiu e no WhatsApp (só leitura da ponte), a cada 10 min
  const varrerPromessasAgora = () => {
    try {
      const r = app.varrerAcompanhar();
      if (r.novas) console.log(`[acompanhar] ${r.novas} promessa(s) nova(s)`);
    } catch (e) {
      console.log('[acompanhar]', e.message);
    }
  };
  setTimeout(varrerPromessasAgora, 5e3).unref?.();
  setInterval(varrerPromessasAgora, 10 * 60e3).unref?.();
  const sair = () => { despachante?.parar(); app.parar(); servidor.close(); process.exit(0); };
  process.on('SIGTERM', sair);
  process.on('SIGINT', sair);
}
