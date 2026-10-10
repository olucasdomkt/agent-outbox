// Fila de mensagens em SQLite. Ciclo de vida:
//   pendente ──aprovar──▶ aprovada ──(janela de desfazer + horário)──▶ enviando ──▶ enviada
//      ▲  │                  │  └──desfazer/editar──▶ pendente           └──────▶ erro ──(tentar de novo)──▶ pendente
//      │  └──descartar──▶ descartada ◀──descartar──┘
//      └──────────────── restaurar ◀──────┘
//   nova versão (substitui_id): a anterior que ainda não saiu vira "substituida"
//   ordem (depois_de): a aprovada só sai depois que a anterior saiu e, com espera_resposta, depois que a pessoa
//   respondeu a ela (respondida_em); anterior descartada ou com erro bloqueia, e só o dono solta
// atualizado_em é a versão da linha: toda escrita grava MAX(agora, atualizado_em + 1), então duas mudanças
// no mesmo milissegundo nunca deixam o mesmo valor (o aprovar confere a versão que o linter leu, e o
// tempo real do painel usa ela para não perder mudança).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { norm } from './util.js';
import { avisaNoLint, CANAIS_LICAO, padraoDe, textoDaLicao } from './licoes.js';

export const STATUS = ['pendente', 'aprovada', 'enviando', 'enviada', 'erro', 'descartada', 'substituida'];
// motivo do descarte: teclas 1 a 5 do painel, texto livre ("outro") e a varredura do "já respondi"
export const MOTIVOS = ['ja_mandei', 'tom', 'longo', 'destino', 'desatualizada', 'outro', 'auto_respondida'];
const EDITAVEL = new Set(['pendente', 'erro']);
const JANELA_DUPLICADA_MS = 30 * 60 * 1000;
// colunas da v2 (plataforma): migração aditiva, só cria o que falta
const COLUNAS_V2 = { liberar_em: 'INTEGER', substitui_id: 'INTEGER', motivo_codigo: 'TEXT', motivo: 'TEXT', lint: 'TEXT' };
// ordem entre mensagens: "sai depois da #N", "só depois que a pessoa responder" e quando ela respondeu
const COLUNAS_ORDEM = { depois_de: 'INTEGER', espera_resposta: 'INTEGER NOT NULL DEFAULT 0', respondida_em: 'INTEGER' };
// a anterior já saiu e, se pedido, a pessoa já respondeu: a regra do despachante (a mesma do aguardandoDe, em SQL)
const LIBERADA = `(depois_de IS NULL OR ((espera_resposta = 0 OR respondida_em IS NOT NULL)
  AND EXISTS (SELECT 1 FROM mensagens a WHERE a.id = mensagens.depois_de AND a.status = 'enviada')))`;
const ESPERA_SEM_ANTERIOR = 'esperar a resposta precisa de uma anterior: diga depois de qual mensagem (depois_de)';
const NOME_CANAL = { email: 'e-mail', discord: 'Discord' };
// aba Acompanhar: em quantas horas sem resposta a enviada entra na aba (null = não acompanha)
const COLUNAS_ACOMPANHAR = { acompanhar: 'INTEGER' };
export const PROMESSA_FECHA = { cumpri: 'cumprida', recebi: 'recebida', dispensar: 'dispensada' };
// "Otávio Ramos Pires" vira "Otávio"; número fica como está
const primeiroNome = (nome) => {
  const n = String(nome || '').trim();
  return /^\p{L}/u.test(n) ? n.split(/\s+/)[0] : n || 'a pessoa';
};
// "acompanhar a resposta": true = 24 h, número ou "48h" = essas horas, null/false = não acompanha.
// Só WhatsApp: é de lá que a Central lê se a pessoa respondeu.
function horasDe(v, canal) {
  if (v == null || v === false) return null;
  if (canal && canal !== 'whatsapp') throw erroHttp(400, `acompanhar a resposta só vale para WhatsApp: esta é ${NOME_CANAL[canal] || canal}`);
  const n = v === true ? 24 : Number(String(v).trim().replace(/h$/i, ''));
  if (!Number.isInteger(n) || n < 1 || n > 720) throw erroHttp(400, `acompanhar inválido: "${v}" (horas sem resposta, de 1 a 720; o padrão é 24)`);
  return n;
}

const CAMPOS_EDITAVEIS = [
  'conta', 'destino_id', 'destino_nome', 'destino_tipo', 'candidatos',
  'responder_a', 'contexto', 'assunto', 'corpo', 'anexos', 'extra', 'cliente',
];

// agora: relógio injetável (os testes da janela de desfazer controlam o tempo)
export function abrirDb(arquivo, { agora = Date.now } = {}) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new Database(arquivo);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS mensagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      criado_em INTEGER NOT NULL,
      atualizado_em INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente',
      canal TEXT NOT NULL,
      conta TEXT,
      destino_id TEXT,
      destino_nome TEXT,
      destino_tipo TEXT,
      para_pedido TEXT,
      candidatos TEXT,
      responder_a TEXT,
      contexto TEXT,
      assunto TEXT,
      corpo TEXT NOT NULL,
      corpo_original TEXT NOT NULL,
      anexos TEXT,
      extra TEXT,
      cliente TEXT,
      sessao_nome TEXT,
      sessao_job TEXT,
      agendar_para INTEGER,
      aprovado_em INTEGER,
      enviado_em INTEGER,
      proxima_tentativa INTEGER,
      tentativas INTEGER NOT NULL DEFAULT 0,
      ultimo_erro TEXT,
      resultado TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_msg_fila ON mensagens(status, proxima_tentativa);
    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mensagem_id INTEGER NOT NULL,
      em INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      detalhe TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_evt_msg ON eventos(mensagem_id);
    CREATE TABLE IF NOT EXISTS estado (chave TEXT PRIMARY KEY, valor TEXT);
    -- item da Entrada que o dono dispensou: some até chegar mensagem mais nova
    CREATE TABLE IF NOT EXISTS vistos (chave TEXT PRIMARY KEY, ate_em INTEGER NOT NULL);
    -- promessa achada numa mensagem (aba Acompanhar): sentido "minha" = o dono prometeu, "dele" = prometeram a ele.
    -- chave = origem + id da mensagem: varrer de novo não duplica
    CREATE TABLE IF NOT EXISTS promessas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT NOT NULL UNIQUE,
      origem TEXT NOT NULL,
      sentido TEXT NOT NULL,
      canal TEXT NOT NULL,
      destino_id TEXT,
      destino_nome TEXT,
      mensagem_id INTEGER,
      trecho TEXT NOT NULL,
      frase TEXT NOT NULL,
      em INTEGER NOT NULL,
      prazo INTEGER NOT NULL,
      prazo_dito TEXT,
      status TEXT NOT NULL DEFAULT 'aberta',
      fechada_em INTEGER,
      cobranca_id INTEGER,
      criado_em INTEGER NOT NULL,
      atualizado_em INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_promessas_status ON promessas(status, prazo);
    -- lição do dono (src/licoes.js): o que ele sempre corrige; ativa vira aviso do linter e entra no msg guia.
    -- chave = a sugestão de onde veio (null = escrita à mão); padrao = regra que a máquina confere (saudação, fecho...)
    CREATE TABLE IF NOT EXISTS licoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      trecho TEXT,
      por TEXT,
      padrao TEXT,
      canal TEXT,
      nota TEXT,
      contagem INTEGER NOT NULL DEFAULT 0,
      evidencias TEXT,
      chave TEXT UNIQUE,
      ativa INTEGER NOT NULL DEFAULT 1,
      criado_em INTEGER NOT NULL,
      atualizado_em INTEGER NOT NULL
    );
    -- cada mensagem em que a lição avisou (uma vez por mensagem)
    CREATE TABLE IF NOT EXISTS licoes_disparos (
      licao_id INTEGER NOT NULL,
      mensagem_id INTEGER NOT NULL,
      em INTEGER NOT NULL,
      PRIMARY KEY (licao_id, mensagem_id)
    );
  `);
  const cols = new Set(db.prepare('PRAGMA table_info(mensagens)').all().map((c) => c.name));
  for (const c of ['app', 'origem']) if (!cols.has(c)) db.exec(`ALTER TABLE mensagens ADD COLUMN ${c} TEXT`);
  for (const [c, tipo] of Object.entries(COLUNAS_V2)) if (!cols.has(c)) db.exec(`ALTER TABLE mensagens ADD COLUMN ${c} ${tipo}`);
  for (const [c, tipo] of Object.entries(COLUNAS_ORDEM)) if (!cols.has(c)) db.exec(`ALTER TABLE mensagens ADD COLUMN ${c} ${tipo}`);
  for (const [c, tipo] of Object.entries(COLUNAS_ACOMPANHAR)) if (!cols.has(c)) db.exec(`ALTER TABLE mensagens ADD COLUMN ${c} ${tipo}`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_msg_substitui ON mensagens(substitui_id);
    CREATE INDEX IF NOT EXISTS idx_msg_atualizado ON mensagens(atualizado_em);
    CREATE INDEX IF NOT EXISTS idx_msg_depois ON mensagens(depois_de);
  `);
  migrarMotivosAntigos(db);
  // busca sem acento e sem caixa ("otavio" acha "Otávio")
  db.function('norm', { deterministic: true }, (s) => norm(s));
  return criarRepo(db, agora);
}

// Descarte de antes da v2 só tem o motivo no evento: copia para a coluna, uma vez só.
// "sumiu sozinha" é a varredura do "já respondi", só esse motivo dá para classificar sem chutar.
function migrarMotivosAntigos(db) {
  if (db.prepare("SELECT 1 FROM estado WHERE chave = 'migracao_motivos_v2'").get()) return;
  db.transaction(() => {
    db.prepare(`UPDATE mensagens SET motivo = (SELECT detalhe FROM eventos e WHERE e.mensagem_id = mensagens.id
        AND e.tipo = 'descartada' ORDER BY e.id DESC LIMIT 1)
      WHERE status = 'descartada' AND motivo IS NULL`).run();
    db.prepare(`UPDATE mensagens SET motivo_codigo = 'auto_respondida'
      WHERE status = 'descartada' AND motivo_codigo IS NULL AND motivo LIKE 'sumiu sozinha:%'`).run();
    db.prepare("INSERT INTO estado (chave, valor) VALUES ('migracao_motivos_v2', 'true')").run();
  })();
}

const json = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));
function hidratar(m) {
  if (!m) return m;
  for (const k of ['candidatos', 'anexos', 'extra', 'resultado', 'origem', 'lint']) {
    if (m[k]) try { m[k] = JSON.parse(m[k]); } catch { /* texto solto */ }
  }
  m.editado = m.corpo !== m.corpo_original;
  return m;
}

function mediana(lista) {
  if (!lista.length) return null;
  const v = [...lista].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}
const umaCasa = (n) => (n == null ? null : Math.round(n * 10) / 10);

const TIPOS_LICAO = ['evitar', 'trocar', 'regra'];
// O que vai ser gravado numa lição, conferido. atual = a lição como está (edição).
function limparLicao(d, atual = {}) {
  const l = { tipo: null, trecho: null, por: null, padrao: null, canal: null, nota: null, ...atual };
  for (const k of ['tipo', 'trecho', 'por', 'padrao', 'canal', 'nota']) {
    if (k in d) l[k] = d[k] == null || !String(d[k]).trim() ? null : String(d[k]).trim();
  }
  if (!TIPOS_LICAO.includes(l.tipo)) throw erroHttp(400, `tipo inválido: "${l.tipo ?? ''}". Use: ${TIPOS_LICAO.join(', ')}`);
  if (l.canal && !CANAIS_LICAO.includes(l.canal)) throw erroHttp(400, `canal inválido: "${l.canal}". Use: ${CANAIS_LICAO.join(', ')} ou nenhum (vale para todos)`);
  if (l.padrao && !padraoDe(l.padrao)) throw erroHttp(400, `padrão inválido: "${l.padrao}"`);
  if (l.tipo !== 'trocar') l.por = null;
  if (l.tipo !== 'regra') l.padrao = null;
  if (l.tipo !== 'regra' && !l.trecho) throw erroHttp(400, 'falta o trecho: o que a sessão deve evitar ou trocar');
  if (l.tipo === 'trocar' && !l.por) throw erroHttp(400, 'falta o "por": o que entra no lugar do trecho');
  if (l.tipo === 'regra' && !l.nota && !l.trecho && !l.padrao) throw erroHttp(400, 'escreva a regra, ex.: "sem Att. no fim: assine com o nome"');
  if ((l.trecho?.length ?? 0) > 200 || (l.por?.length ?? 0) > 200) throw erroHttp(400, 'trecho longo demais: até 200 caracteres');
  if ((l.nota?.length ?? 0) > 500) throw erroHttp(400, 'nota longa demais: até 500 caracteres');
  return l;
}
// texto = como o aviso sai para a sessão; avisa = false quando a lição só aparece no msg guia
const hidratarLicao = (l) => l && {
  ...l, ativa: !!l.ativa, evidencias: l.evidencias ? JSON.parse(l.evidencias) : [],
  texto: textoDaLicao(l), nome: padraoDe(l.padrao)?.nome ?? null, avisa: avisaNoLint(l),
};
// disparos = em quantas mensagens a lição avisou; corrigidas = a sessão mandou versão nova (--substitui) em que ela
// não avisou mais, antes de o dono precisar corrigir
const SQL_LICAO = `SELECT l.*,
    (SELECT COUNT(*) FROM licoes_disparos d WHERE d.licao_id = l.id) disparos,
    (SELECT COUNT(*) FROM licoes_disparos d JOIN mensagens m ON m.id = d.mensagem_id
      WHERE d.licao_id = l.id AND m.status = 'substituida' AND EXISTS (SELECT 1 FROM mensagens n WHERE n.substitui_id = m.id
        AND NOT EXISTS (SELECT 1 FROM licoes_disparos d2 WHERE d2.licao_id = l.id AND d2.mensagem_id = n.id))) corrigidas
  FROM licoes l`;

function criarRepo(db, agora) {
  const evento = (id, tipo, detalhe) =>
    db.prepare('INSERT INTO eventos (mensagem_id, em, tipo, detalhe) VALUES (?,?,?,?)')
      .run(id, agora(), tipo, detalhe == null ? null : String(detalhe));

  // O que a mensagem espera para sair (null = nada), para o painel e o msg: a anterior sair ("anterior"), a pessoa
  // responder a ela ("resposta") ou nada mais, porque a anterior foi descartada ou deu erro ("bloqueada": só o dono
  // solta). O despachante segue a mesma regra, em SQL (LIBERADA).
  function aguardandoDe(m) {
    if (m.depois_de == null || !['pendente', 'aprovada', 'erro'].includes(m.status)) return null;
    const a = db.prepare('SELECT id, status, destino_nome FROM mensagens WHERE id = ?').get(m.depois_de);
    const base = { id: m.depois_de, status: a?.status ?? null, quem: a?.destino_nome ?? null };
    if (!a || a.status === 'descartada' || a.status === 'erro') return { ...base, motivo: 'bloqueada' };
    if (a.status !== 'enviada') return { ...base, motivo: 'anterior' };
    if (m.espera_resposta && m.respondida_em == null) return { ...base, motivo: 'resposta' };
    return null;
  }
  const ler = (linha) => {
    const m = hidratar(linha);
    if (m) m.aguardando = aguardandoDe(m);
    return m;
  };
  const obter = (id) => ler(db.prepare('SELECT * FROM mensagens WHERE id = ?').get(id));
  const lerPromessa = (id) => db.prepare('SELECT * FROM promessas WHERE id = ?').get(id) || null;
  const lerLicao = (id) => hidratarLicao(db.prepare(`${SQL_LICAO} WHERE l.id = ?`).get(id)) || null;
  // a lição que avisou nesta mensagem conta um disparo (uma vez por mensagem)
  function registrarDisparos(id, resultado) {
    for (const a of resultado?.avisos || []) {
      if (a.regra === 'licao' && a.licao) {
        db.prepare('INSERT OR IGNORE INTO licoes_disparos (licao_id, mensagem_id, em) VALUES (?, ?, ?)').run(a.licao, id, agora());
      }
    }
  }

  // A versão que está valendo: uma "substituida" segue para a versão nova, até a última.
  function viva(id) {
    let m = db.prepare('SELECT * FROM mensagens WHERE id = ?').get(id);
    for (let i = 0; m?.status === 'substituida' && i < 100; i++) {
      const nova = db.prepare('SELECT * FROM mensagens WHERE substitui_id = ? AND id > ? ORDER BY id LIMIT 1').get(m.id, m.id);
      if (!nova) break;
      m = nova;
    }
    return m || null;
  }
  // 485, "485" ou "#485"
  function idDe(v) {
    const n = Number(String(v).trim().replace(/^#/, ''));
    if (!Number.isInteger(n) || n <= 0) throw erroHttp(400, `depois_de inválido: "${v}" (use o número da mensagem, ex.: 485)`);
    return n;
  }
  // A anterior (já a viva) serve? Não pode ser a própria (nem a versão que esta substitui), nem estar descartada,
  // nem fechar ciclo (A espera B e B espera A). Esperar a resposta só vale para WhatsApp em conversa direta.
  function validarAnterior(a, espera, proprios) {
    if (proprios.includes(a.id)) throw erroHttp(400, `uma mensagem não sai depois de si mesma (#${a.id})`);
    if (a.status === 'descartada') throw erroHttp(400, `a #${a.id} foi descartada: restaure ela antes ou escolha outra`);
    for (let x = a, i = 0; x?.depois_de != null && i < 100; i++) {
      if (proprios.includes(x.depois_de)) {
        throw erroHttp(400, `as duas ficariam esperando uma pela outra: a #${a.id} já sai depois da #${x.depois_de}`);
      }
      x = db.prepare('SELECT id, depois_de FROM mensagens WHERE id = ?').get(x.depois_de);
    }
    if (!espera) return;
    const porque = a.canal !== 'whatsapp' ? `a #${a.id} é ${NOME_CANAL[a.canal] || a.canal}`
      : !a.destino_id ? `a #${a.id} ainda não tem destino`
        : a.destino_id.endsWith('@g.us') ? `a #${a.id} vai para um grupo (${a.destino_nome || a.destino_id})` : null;
    if (porque) throw erroHttp(400, `esperar a resposta só vale para WhatsApp em conversa direta: ${porque}`);
  }
  const textoOrdem = (a, espera) => (espera ? `sai só depois que ${primeiroNome(a.destino_nome)} responder à #${a.id}` : `sai depois da #${a.id}`)
    + (a.status === 'enviada' ? ` (a #${a.id} já saiu${espera ? '' : ': está liberada'})` : '');

  // Quem sai depois desta e ainda não saiu: a versão da linha muda (o painel relê o estado dela) e, se veio, o evento.
  function tocarDependentes(id, ev = null) {
    const deps = db.prepare(`SELECT id, espera_resposta FROM mensagens WHERE depois_de = ? AND status IN ('pendente','aprovada','erro')`).all(id);
    for (const d of deps) {
      db.prepare('UPDATE mensagens SET atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?').run(agora(), d.id);
      const e = typeof ev === 'function' ? ev(d) : ev;
      if (e) evento(d.id, e[0], e[1]);
    }
  }

  function exigir(id, permitidos, acao) {
    const m = obter(id);
    if (!m) throw erroHttp(404, `mensagem #${id} não existe`);
    if (!permitidos.includes(m.status)) throw erroHttp(409, `#${id} está “${m.status}”, não dá para ${acao}`, { status: m.status });
    return m;
  }
  // UPDATE condicional que não pegou ninguém: alguém mudou o status no meio do caminho
  function mudouNoMeio(id, acao) {
    const atual = obter(id);
    return erroHttp(409, `#${id} mudou para “${atual?.status}” antes de ${acao}`, { status: atual?.status });
  }

  // Nova versão chegou: a anterior que ainda não saiu (pendente, aprovada esperando ou com erro) vira
  // "substituida", para nunca saírem as duas. Se a anterior já saiu, a nova leva o aviso.
  function substituir(anteriorId, novoId, t, automatica = false) {
    const antes = obter(anteriorId).status;
    const r = db.prepare(`UPDATE mensagens SET status = 'substituida', liberar_em = NULL, proxima_tentativa = NULL, atualizado_em = MAX(?, atualizado_em + 1)
      WHERE id = ? AND status IN ('pendente','aprovada','erro')`).run(t, anteriorId);
    if (r.changes) {
      evento(anteriorId, 'substituida', `pela #${novoId}${automatica ? ' (a mesma sessão mandou de novo para o mesmo destino)' : ''}`);
      evento(novoId, 'versao', `nova versão da #${anteriorId}`);
      // erro pode ter sido um envio interrompido que chegou mesmo assim
      if (antes === 'erro') evento(novoId, 'aviso', `a versão anterior (#${anteriorId}) deu erro: confira se ela saiu antes de aprovar`);
      // quem saía depois da anterior passa a sair depois da versão nova (a descartada também: restaurada, não espera
      // uma substituída para sempre)
      for (const d of db.prepare(`SELECT id FROM mensagens WHERE depois_de = ? AND id != ? AND status IN ('pendente','aprovada','erro','descartada')`).all(anteriorId, novoId)) {
        db.prepare('UPDATE mensagens SET depois_de = ?, respondida_em = NULL, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?').run(novoId, t, d.id);
        evento(d.id, 'ordem', `a #${anteriorId} ganhou versão nova (#${novoId}): esta sai depois dela`);
      }
      return;
    }
    const status = obter(anteriorId).status;
    if (status === 'enviada' || status === 'enviando') evento(novoId, 'aviso', `substitui uma mensagem que já foi enviada (#${anteriorId})`);
    else evento(novoId, 'versao', `nova versão da #${anteriorId} (que estava "${status}")`);
  }

  // Sem --substitui: a mesma sessão do Claude (o id dela, ou o job) mandando de novo para o mesmo destino,
  // com a anterior ainda esperando aprovação ou com erro, é correção: se a sessão mudou a
  // mensagem, a anterior tem de sair da fila (na prática, a maioria dos reenvios vem sem --substitui).
  // Duas mensagens diferentes de propósito para o mesmo destino: tambem.
  // Com "sai depois da #N" (depois), só conta como correção a da mesma posição (que também sai depois da #N):
  // "manda X e depois Y" não pode trocar X por Y.
  function anteriorDaSessao(d, depois = null) {
    const sid = d.origem?.sessao_id || null;
    if ((!sid && !d.sessao_job) || (!d.destino_id && !d.para_pedido)) return null;
    return db.prepare(`SELECT id FROM mensagens WHERE canal = @canal AND status IN ('pendente','erro')
      AND ${sid ? "json_extract(origem, '$.sessao_id') = @quem" : 'sessao_job = @quem'}
      AND (destino_id = @destino OR para_pedido = @pedido) ${depois != null ? 'AND depois_de = @depois' : ''} ORDER BY id DESC LIMIT 1`)
      .get({ canal: d.canal, quem: sid || d.sessao_job, destino: d.destino_id ?? null, pedido: d.para_pedido ?? null, ...(depois != null ? { depois } : {}) }) || null;
  }

  return {
    db,
    obter,
    evento,

    criar(d) {
      if (!d.canal) throw erroHttp(400, 'canal é obrigatório');
      if (!d.corpo || !String(d.corpo).trim()) throw erroHttp(400, 'corpo vazio');
      const anterior = d.substitui_id != null ? obter(Number(d.substitui_id)) : null;
      if (d.substitui_id != null && !anterior) throw erroHttp(404, `mensagem #${d.substitui_id} (a substituir) não existe`);
      if (d.espera_resposta && d.depois_de == null) throw erroHttp(400, ESPERA_SEM_ANTERIOR);
      const acompanhar = horasDe(d.acompanhar, d.canal);
      const alvo = d.destino_id || d.para_pedido || '';
      const dup = db.prepare(`SELECT id FROM mensagens WHERE canal = ? AND COALESCE(destino_id, para_pedido, '') = ?
        AND corpo_original = ? AND status IN ('pendente','aprovada','enviando','enviada') AND criado_em > ?
        ORDER BY id DESC LIMIT 1`).get(d.canal, alvo, d.corpo, agora() - JANELA_DUPLICADA_MS);
      if (dup) return { ...obter(dup.id), duplicada: true };
      const t = agora();
      const id = db.transaction(() => {
        // "sai depois da #N": vale a versão viva dela (a sessão pode citar uma que já ganhou versão nova)
        let depois = null;
        if (d.depois_de != null) {
          const n = idDe(d.depois_de);
          depois = viva(n);
          if (!depois) throw erroHttp(404, `a #${n} (a anterior) não existe`);
        }
        const automatica = !anterior && !d.tambem ? anteriorDaSessao(d, depois?.id) : null;
        const versaoDe = anterior || (automatica && obter(automatica.id));
        // a versão nova fica no mesmo lugar da sequência (a ordem que o dono marcou não some numa correção)
        let ordem = null;
        if (depois) {
          validarAnterior(depois, !!d.espera_resposta, versaoDe ? [versaoDe.id] : []);
          ordem = { depois_de: depois.id, espera_resposta: d.espera_resposta ? 1 : 0, respondida_em: null };
        } else if (versaoDe?.depois_de != null && ['pendente', 'aprovada', 'erro'].includes(versaoDe.status)) {
          ordem = { depois_de: versaoDe.depois_de, espera_resposta: versaoDe.espera_resposta, respondida_em: versaoDe.respondida_em };
        }
        // a correção continua acompanhada se a anterior estava
        const horas = acompanhar ?? (d.canal === 'whatsapp' ? versaoDe?.acompanhar ?? null : null);
        const r = db.prepare(`INSERT INTO mensagens (criado_em, atualizado_em, status, canal, conta, destino_id, destino_nome,
            destino_tipo, para_pedido, candidatos, responder_a, contexto, assunto, corpo, corpo_original, anexos, extra,
            cliente, sessao_nome, sessao_job, agendar_para, app, origem, substitui_id, depois_de, espera_resposta, respondida_em, acompanhar)
          VALUES (@t, @t, 'pendente', @canal, @conta, @destino_id, @destino_nome, @destino_tipo, @para_pedido, @candidatos,
            @responder_a, @contexto, @assunto, @corpo, @corpo, @anexos, @extra, @cliente, @sessao_nome, @sessao_job, @agendar_para,
            @app, @origem, @substitui_id, @depois_de, @espera_resposta, @respondida_em, @acompanhar)`)
          .run({
            t, canal: d.canal, conta: d.conta ?? null, destino_id: d.destino_id ?? null,
            destino_nome: d.destino_nome ?? null, destino_tipo: d.destino_tipo ?? null,
            para_pedido: d.para_pedido ?? null, candidatos: json(d.candidatos), responder_a: d.responder_a ?? null,
            contexto: d.contexto ?? null, assunto: d.assunto ?? null, corpo: String(d.corpo),
            anexos: json(d.anexos), extra: json(d.extra), cliente: d.cliente ?? null,
            sessao_nome: d.sessao_nome ?? null, sessao_job: d.sessao_job ?? null, agendar_para: d.agendar_para ?? null,
            app: d.app ?? null, origem: json(d.origem), substitui_id: versaoDe?.id ?? null,
            depois_de: ordem?.depois_de ?? null, espera_resposta: ordem?.espera_resposta ?? 0, respondida_em: ordem?.respondida_em ?? null,
            acompanhar: horas,
          });
        const novo = Number(r.lastInsertRowid);
        evento(novo, 'criada', d.sessao_nome ? `pela sessão "${d.sessao_nome}"` : null);
        if (horas) evento(novo, 'acompanhar', `avisa na aba Acompanhar se não responder em ${horas} h`);
        if (versaoDe) substituir(versaoDe.id, novo, t, !!automatica);
        if (depois) evento(novo, 'marcada', textoOrdem(depois, !!d.espera_resposta));
        else if (ordem) evento(novo, 'ordem', `mantém a sequência da #${versaoDe.id}: sai depois da #${ordem.depois_de}`);
        return novo;
      })();
      return obter(id);
    },

    listar({ status, canal, cliente, q, limite = 200 } = {}) {
      const onde = [];
      const args = [];
      if (status) {
        const lista = String(status).split(',');
        onde.push(`status IN (${lista.map(() => '?').join(',')})`);
        args.push(...lista);
      }
      if (canal) { onde.push('canal = ?'); args.push(canal); }
      if (cliente) { onde.push('norm(cliente) = norm(?)'); args.push(cliente); }
      if (q && String(q).trim()) {
        const termo = `%${norm(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        onde.push(`(${['corpo', 'destino_nome', 'sessao_nome', 'responder_a'].map((c) => `norm(${c}) LIKE ? ESCAPE '\\'`).join(' OR ')})`);
        args.push(termo, termo, termo, termo);
      }
      const ordem = status === 'enviada' || status === 'descartada' ? 'atualizado_em DESC' : 'criado_em DESC';
      const n = Math.min(Math.max(Number(limite) || 200, 1), 2000);
      const sql = `SELECT * FROM mensagens ${onde.length ? 'WHERE ' + onde.join(' AND ') : ''} ORDER BY ${ordem} LIMIT ?`;
      return db.prepare(sql).all(...args, n).map(ler);
    },

    eventos(id) {
      return db.prepare('SELECT em, tipo, detalhe FROM eventos WHERE mensagem_id = ? ORDER BY id').all(id);
    },

    contagens() {
      const out = Object.fromEntries(STATUS.map((s) => [s, 0]));
      for (const r of db.prepare('SELECT status, COUNT(*) n FROM mensagens GROUP BY status').all()) out[r.status] = r.n;
      return out;
    },

    // reabrir: editar uma aprovada que ainda não saiu devolve ela para revisão (painel v2).
    // Sem reabrir vale a regra antiga: só pendente ou erro.
    editar(id, campos, { reabrir = false } = {}) {
      const m = exigir(id, reabrir ? ['pendente', 'erro', 'aprovada'] : [...EDITAVEL], 'editar');
      const sets = [];
      const args = {};
      for (const k of CAMPOS_EDITAVEIS) {
        if (!(k in campos)) continue;
        const v = ['candidatos', 'anexos', 'extra'].includes(k) ? json(campos[k]) : campos[k];
        sets.push(`${k} = @${k}`);
        args[k] = v ?? null;
      }
      if (!sets.length) return m;
      if ('corpo' in campos && !String(campos.corpo || '').trim()) throw erroHttp(400, 'corpo vazio');
      const voltar = m.status === 'aprovada';
      const reaberta = voltar ? ", status = 'pendente', aprovado_em = NULL, liberar_em = NULL, proxima_tentativa = NULL" : '';
      const r = db.prepare(`UPDATE mensagens SET ${sets.join(', ')}${reaberta}, atualizado_em = MAX(@t, atualizado_em + 1) WHERE id = @id AND status = @antes`)
        .run({ ...args, t: agora(), id, antes: m.status });
      if (!r.changes) throw mudouNoMeio(id, 'a edição');
      const mudou = Object.keys(campos).filter((k) => CAMPOS_EDITAVEIS.includes(k));
      evento(id, 'editada', mudou.join(', '));
      if (voltar) evento(id, 'desaprovada', 'editada depois de aprovada: voltou para revisão');
      return obter(id);
    },

    // janelaMs: tempo para desfazer antes de o despachante poder pegar (o painel usa 10 s; aqui o padrão é 0).
    // versao: atualizado_em lido quando o linter conferiu; se a mensagem mudou depois disso, devolve null.
    aprovar(id, agendarPara = null, { janelaMs = 0, versao = null, lint = null } = {}) {
      const m = exigir(id, ['pendente', 'erro'], 'aprovar');
      if (!m.destino_id) throw erroHttp(400, `#${id} ainda não tem destino definido`);
      if (m.canal === 'email' && !m.assunto) throw erroHttp(400, `#${id} é e-mail e está sem assunto`);
      const t = agora();
      const quando = agendarPara && agendarPara > t ? agendarPara : null;
      const janela = Math.max(0, Number(janelaMs) || 0);
      const r = db.prepare(`UPDATE mensagens SET status = 'aprovada', aprovado_em = @t, agendar_para = @quando, liberar_em = @liberar,
          proxima_tentativa = @proxima, tentativas = 0, ultimo_erro = NULL, lint = COALESCE(@lint, lint), atualizado_em = MAX(@t, atualizado_em + 1)
        WHERE id = @id AND status IN ('pendente','erro') AND (@versao IS NULL OR atualizado_em = @versao)`)
        .run({ t, quando, liberar: t + janela, proxima: quando || t, lint: json(lint), id, versao });
      if (!r.changes) {
        if (versao != null && ['pendente', 'erro'].includes(obter(id)?.status)) return null;
        throw mudouNoMeio(id, 'aprovar');
      }
      registrarDisparos(id, lint);
      const quandoTexto = quando ? `agendada para ${new Date(quando).toLocaleString('pt-BR')}`
        : janela ? `sai em ${Math.round(janela / 1000)} s se ninguém desfizer` : 'enviar agora';
      evento(id, 'aprovada', quandoTexto);
      // tentar de novo: quem esperava por ela deixa de estar bloqueado
      if (m.status === 'erro') tocarDependentes(id);
      return obter(id);
    },

    // Desfazer: UPDATE condicional, atômico frente ao despachante. Só volta se ainda está "aprovada";
    // depois que o despachante marcou "enviando", não volta mais (409 ja_saiu).
    desfazer(id) {
      const m = obter(id);
      if (!m) throw erroHttp(404, `mensagem #${id} não existe`);
      if (m.status === 'pendente') return m; // já está em revisão: apertar Z duas vezes não é erro
      const r = db.prepare(`UPDATE mensagens SET status = 'pendente', aprovado_em = NULL, liberar_em = NULL, proxima_tentativa = NULL,
        atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ? AND status = 'aprovada'`).run(agora(), id);
      if (!r.changes) throw erroHttp(409, 'ja_saiu', { status: obter(id).status });
      evento(id, 'desfeita', 'voltou para revisão');
      return obter(id);
    },

    desaprovar(id) {
      exigir(id, ['aprovada'], 'voltar para aprovação');
      const r = db.prepare(`UPDATE mensagens SET status = 'pendente', aprovado_em = NULL, agendar_para = NULL, liberar_em = NULL,
        proxima_tentativa = NULL, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ? AND status = 'aprovada'`).run(agora(), id);
      if (!r.changes) throw mudouNoMeio(id, 'voltar para aprovação');
      evento(id, 'desaprovada');
      return obter(id);
    },

    // Agendar só grava o horário: quem manda sair é o aprovar. Em aprovada, reprograma (null = sair já).
    agendar(id, quando) {
      const m = exigir(id, ['pendente', 'erro', 'aprovada'], 'agendar');
      const t = agora();
      const q = quando && quando > t ? quando : null;
      const r = m.status === 'aprovada'
        ? db.prepare(`UPDATE mensagens SET agendar_para = ?, proxima_tentativa = ?, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ? AND status = 'aprovada'`)
          .run(q, q || t, t, id)
        : db.prepare(`UPDATE mensagens SET agendar_para = ?, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ? AND status IN ('pendente','erro')`)
          .run(q, t, id);
      if (!r.changes) throw mudouNoMeio(id, 'agendar');
      evento(id, 'agendada', q ? `para ${new Date(q).toLocaleString('pt-BR')}` : 'sem horário marcado');
      return obter(id);
    },

    descartar(id, motivo = null, codigo = null) {
      if (codigo != null && !MOTIVOS.includes(codigo)) {
        throw erroHttp(400, `motivo_codigo inválido: "${codigo}". Use: ${MOTIVOS.join(', ')}`);
      }
      exigir(id, ['pendente', 'aprovada', 'erro'], 'descartar');
      const texto = motivo == null || motivo === '' ? null : String(motivo).slice(0, 500);
      const r = db.prepare(`UPDATE mensagens SET status = 'descartada', motivo_codigo = ?, motivo = ?, liberar_em = NULL,
        proxima_tentativa = NULL, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ? AND status IN ('pendente','aprovada','erro')`)
        .run(codigo, texto, agora(), id);
      if (!r.changes) throw mudouNoMeio(id, 'descartar');
      evento(id, 'descartada', texto ?? codigo);
      // quem esperava por ela não sai mais sozinha: fica bloqueada até o dono soltar ou descartar
      tocarDependentes(id, ['bloqueada', `a #${id} foi descartada; esta esperava por ela`]);
      return obter(id);
    },

    restaurar(id) {
      exigir(id, ['descartada'], 'restaurar');
      db.prepare(`UPDATE mensagens SET status = 'pendente', motivo_codigo = NULL, motivo = NULL, atualizado_em = MAX(?, atualizado_em + 1)
        WHERE id = ? AND status = 'descartada'`).run(agora(), id);
      evento(id, 'restaurada');
      tocarDependentes(id);
      return obter(id);
    },

    // Muda a ordem (PATCH/PUT): depois_de = a anterior (null solta), espera_resposta = só depois que a pessoa
    // responder; undefined mantém o que está. Não reabre a aprovada: a ordem só atrasa a saída, não muda o que sai.
    definirDepois(id, { depois_de, espera_resposta } = {}) {
      const m = exigir(id, ['pendente', 'aprovada', 'erro'], 'mudar a ordem');
      const t = agora();
      if (depois_de === null || (depois_de === undefined && m.depois_de == null)) {
        if (espera_resposta) throw erroHttp(400, ESPERA_SEM_ANTERIOR);
        if (m.depois_de == null) return m;
        const r = db.prepare(`UPDATE mensagens SET depois_de = NULL, espera_resposta = 0, respondida_em = NULL,
          atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ? AND status = ?`).run(t, id, m.status);
        if (!r.changes) throw mudouNoMeio(id, 'soltar');
        evento(id, 'solta', `saiu da sequência: não espera mais a #${m.depois_de}`);
        return obter(id);
      }
      const n = depois_de === undefined ? m.depois_de : idDe(depois_de);
      const a = viva(n);
      if (!a) throw erroHttp(404, `a #${n} (a anterior) não existe`);
      const espera = espera_resposta === undefined ? !!m.espera_resposta : !!espera_resposta;
      if (a.id === m.depois_de && espera === !!m.espera_resposta) return m;
      validarAnterior(a, espera, [id]);
      const r = db.prepare(`UPDATE mensagens SET depois_de = ?, espera_resposta = ?, respondida_em = NULL,
        atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ? AND status = ?`).run(a.id, espera ? 1 : 0, t, id, m.status);
      if (!r.changes) throw mudouNoMeio(id, 'mudar a ordem');
      evento(id, 'marcada', textoOrdem(a, espera));
      return obter(id);
    },

    // "Só depois que a pessoa responder": a anterior já saiu, e a fonte (a ponte do WhatsApp, só leitura) diz quando a
    // pessoa mandou a última mensagem na conversa. Resposta depois da saída libera, uma vez só (o despachante chama a
    // cada volta). fonte({canal, destino_id, enviado_em}) → ms da última mensagem dela, ou null.
    conferirRespostas(fonte) {
      const esperando = db.prepare(`SELECT m.id, a.id anterior, a.canal, a.destino_id, a.destino_nome, a.enviado_em
        FROM mensagens m JOIN mensagens a ON a.id = m.depois_de
        WHERE m.espera_resposta = 1 AND m.respondida_em IS NULL AND m.status IN ('pendente','aprovada','erro')
          AND a.status = 'enviada' AND a.enviado_em IS NOT NULL`).all();
      const liberadas = [];
      for (const x of esperando) {
        const em = fonte({ canal: x.canal, destino_id: x.destino_id, enviado_em: x.enviado_em });
        if (!(Number(em) > x.enviado_em)) continue;
        const r = db.prepare(`UPDATE mensagens SET respondida_em = ?, atualizado_em = MAX(?, atualizado_em + 1)
          WHERE id = ? AND respondida_em IS NULL AND depois_de = ?`).run(Number(em), agora(), x.id, x.anterior);
        if (!r.changes) continue;
        evento(x.id, 'liberada', `${primeiroNome(x.destino_nome)} respondeu à #${x.anterior}: liberada`);
        liberadas.push(x.id);
      }
      return liberadas;
    },

    // "Acompanhar a resposta" (aba Acompanhar): horas sem resposta até avisar; null para de acompanhar. Vale também
    // para a que já saiu, e não reabre a aprovada (não muda o que sai).
    marcarAcompanhar(id, horas) {
      const m = exigir(id, ['pendente', 'aprovada', 'enviando', 'enviada', 'erro'], 'acompanhar a resposta');
      const h = horasDe(horas, m.canal);
      if ((m.acompanhar ?? null) === h) return m;
      db.prepare('UPDATE mensagens SET acompanhar = ?, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?').run(h, agora(), id);
      evento(id, 'acompanhar', h ? `avisa na aba Acompanhar se não responder em ${h} h` : 'parou de acompanhar a resposta');
      return obter(id);
    },

    // guarda o resultado do linter; só mexe na linha (e avisa o painel) quando o resultado mudou
    salvarLint(id, resultado) {
      const novo = JSON.stringify(resultado);
      db.prepare('UPDATE mensagens SET lint = @novo, atualizado_em = MAX(@t, atualizado_em + 1) WHERE id = @id AND (lint IS NULL OR lint != @novo)')
        .run({ novo, t: agora(), id });
      registrarDisparos(id, resultado);
      return obter(id);
    },

    // caminhos das cópias que a Central guardou dos anexos (anexo durável): não conta como edição
    trocarAnexos(id, anexos) {
      db.prepare('UPDATE mensagens SET anexos = ?, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?').run(json(anexos), agora(), id);
      return obter(id);
    },

    // outras pendentes para o mesmo destino (aviso de duplicada no linter)
    pendentesPara(canal, destino, exceto = null) {
      return db.prepare(`SELECT id FROM mensagens WHERE status = 'pendente' AND canal = ? AND destino_id = ? AND id != ?
        ORDER BY id`).all(canal, destino, exceto ?? -1).map((r) => r.id);
    },
    // a sequência da mensagem: todas as ligadas a ela pela ordem (depois_de), para trás e para frente. O aviso de
    // duplicada não conta quem está na mesma sequência: a ordem já diz que são mensagens diferentes.
    sequenciaDe(m) {
      const ids = new Set();
      const fila = [m.id, m.depois_de].filter((x) => x != null);
      while (fila.length && ids.size < 500) {
        const x = fila.pop();
        if (ids.has(x)) continue;
        ids.add(x);
        const anterior = db.prepare('SELECT depois_de FROM mensagens WHERE id = ?').get(x)?.depois_de;
        if (anterior != null) fila.push(anterior);
        for (const d of db.prepare('SELECT id FROM mensagens WHERE depois_de = ?').all(x)) fila.push(d.id);
      }
      return ids;
    },

    // Todas as versões da mesma mensagem, da mais antiga para a mais nova.
    versoes(id) {
      let raiz = obter(id);
      if (!raiz) throw erroHttp(404, `mensagem #${id} não existe`);
      for (let i = 0; i < 100 && raiz.substitui_id; i++) {
        const anterior = obter(raiz.substitui_id);
        if (!anterior) break;
        raiz = anterior;
      }
      return db.prepare(`WITH RECURSIVE cadeia(id) AS (
          SELECT ? UNION SELECT m.id FROM mensagens m JOIN cadeia c ON m.substitui_id = c.id)
        SELECT m.id, m.criado_em, m.status, m.corpo, m.sessao_nome FROM mensagens m JOIN cadeia USING (id)
        ORDER BY m.criado_em, m.id`).all(raiz.id);
    },

    // linhas que mudaram desde t (tempo real do painel)
    mudadasDesde(t) {
      return db.prepare('SELECT * FROM mensagens WHERE atualizado_em >= ? ORDER BY atualizado_em, id').all(t).map(ler);
    },

    // Relatório das mensagens CRIADAS nos últimos `dias`, cada uma com o status que tem agora.
    relatorio(dias = 14) {
      const desde = agora() - dias * 86400e3;
      const daJanela = 'FROM mensagens WHERE criado_em >= @desde';
      const porCanal = db.prepare(`SELECT canal, COUNT(*) criadas, SUM(status = 'enviada') enviadas,
          SUM(status = 'descartada') descartadas, SUM(status = 'erro') erros,
          SUM(status IN ('pendente','aprovada','enviando')) abertas, SUM(corpo != corpo_original) editadas,
          CAST(ROUND(AVG(length(corpo))) AS INTEGER) tamanhoMedio
        ${daJanela} GROUP BY canal ORDER BY criadas DESC, canal`).all({ desde });
      const aprovacoes = db.prepare(`SELECT canal, aprovado_em - criado_em ms ${daJanela} AND aprovado_em IS NOT NULL`).all({ desde });
      for (const c of porCanal) {
        c.aprovacaoMedianaMin = umaCasa(mediana(aprovacoes.filter((a) => a.canal === c.canal).map((a) => a.ms / 60e3)));
      }
      const porDia = db.prepare(`SELECT date(criado_em / 1000, 'unixepoch', 'localtime') dia, canal, COUNT(*) criadas,
          SUM(status = 'enviada') enviadas, SUM(status = 'descartada') descartadas
        ${daJanela} GROUP BY dia, canal ORDER BY dia, canal`).all({ desde });
      const descartesPorMotivo = db.prepare(`SELECT motivo_codigo, COUNT(*) n ${daJanela} AND status = 'descartada'
        GROUP BY motivo_codigo ORDER BY n DESC, motivo_codigo`).all({ desde });
      const sessoes = db.prepare(`SELECT COALESCE(sessao_nome, '(sem sessão)') sessao, COUNT(*) criadas,
          SUM(status = 'descartada') descartadas
        ${daJanela} GROUP BY 1 ORDER BY descartadas DESC, criadas DESC, sessao`).all({ desde });
      // motivo mais comum entre os descartes classificados de cada sessão (empate: ordem alfabética)
      const topo = new Map();
      for (const r of db.prepare(`SELECT COALESCE(sessao_nome, '(sem sessão)') sessao, motivo_codigo, COUNT(*) n
          ${daJanela} AND status = 'descartada' AND motivo_codigo IS NOT NULL
          GROUP BY 1, 2 ORDER BY n DESC, motivo_codigo`).all({ desde })) {
        if (!topo.has(r.sessao)) topo.set(r.sessao, r.motivo_codigo);
      }
      const total = db.prepare(`SELECT COUNT(*) n, SUM(corpo != corpo_original) editadas ${daJanela}`).get({ desde });
      return {
        dias, desde, total: total.n,
        porCanal, porDia, descartesPorMotivo,
        descartesPorSessao: sessoes.map((s) => ({ ...s, motivoTop: topo.get(s.sessao) ?? null })),
        tempoAprovacaoMedianaMin: umaCasa(mediana(aprovacoes.map((a) => a.ms / 60e3))),
        editadasPct: total.n ? umaCasa((100 * total.editadas) / total.n) : 0,
      };
    },

    // --- Lições (src/licoes.js) ---
    // o que o dono editou antes de sair, as mais novas primeiro, e o que foi descartado: a matéria das sugestões
    editadas(desde, limite = 400) {
      return db.prepare(`SELECT id, canal, sessao_nome, corpo_original, corpo FROM mensagens
        WHERE status IN ('enviada','aprovada','enviando') AND corpo != corpo_original AND criado_em >= ? ORDER BY id DESC LIMIT ?`).all(desde, limite);
    },
    descartadas(desde) {
      return db.prepare(`SELECT canal, sessao_nome, motivo_codigo, motivo FROM mensagens WHERE status = 'descartada' AND criado_em >= ?`).all(desde);
    },
    licoes() {
      return db.prepare(`${SQL_LICAO} ORDER BY l.ativa DESC, l.id DESC`).all().map(hidratarLicao);
    },
    // as que o linter confere e o msg guia mostra
    licoesAtivas() {
      return db.prepare('SELECT * FROM licoes WHERE ativa = 1 ORDER BY id').all().map(hidratarLicao);
    },
    licao: lerLicao,
    // d: tipo, trecho, por, padrao, canal, nota e, vindo de uma sugestão, chave, contagem e evidencias
    criarLicao(d) {
      const l = limparLicao(d);
      const chave = d.chave ? String(d.chave) : null;
      const ja = chave && db.prepare('SELECT id FROM licoes WHERE chave = ?').get(chave);
      if (ja) throw erroHttp(409, `essa sugestão já virou a lição ${ja.id}`);
      const t = agora();
      const r = db.prepare(`INSERT INTO licoes (tipo, trecho, por, padrao, canal, nota, contagem, evidencias, chave, ativa, criado_em, atualizado_em)
        VALUES (@tipo, @trecho, @por, @padrao, @canal, @nota, @contagem, @evidencias, @chave, @ativa, @t, @t)`).run({
        tipo: l.tipo, trecho: l.trecho, por: l.por, padrao: l.padrao, canal: l.canal, nota: l.nota,
        contagem: Math.max(0, Number(d.contagem) || 0), evidencias: json(d.evidencias || null), chave, ativa: d.ativa === false ? 0 : 1, t,
      });
      return lerLicao(Number(r.lastInsertRowid));
    },
    // editar o texto, o canal ou ligar/desligar (ativa); a lição nunca é apagada
    editarLicao(id, d) {
      const atual = db.prepare('SELECT * FROM licoes WHERE id = ?').get(id);
      if (!atual) throw erroHttp(404, `lição ${id} não existe`);
      const l = limparLicao(d, atual);
      db.prepare(`UPDATE licoes SET tipo = @tipo, trecho = @trecho, por = @por, padrao = @padrao, canal = @canal, nota = @nota,
          ativa = @ativa, atualizado_em = MAX(@t, atualizado_em + 1) WHERE id = @id`).run({
        tipo: l.tipo, trecho: l.trecho, por: l.por, padrao: l.padrao, canal: l.canal, nota: l.nota,
        ativa: ('ativa' in d ? !!d.ativa : !!atual.ativa) ? 1 : 0, t: agora(), id,
      });
      return lerLicao(id);
    },

    // --- despachante ---
    // Pega a próxima aprovada que já pode sair: janela de desfazer vencida, horário (se houver) chegado e, se ela sai
    // depois de outra, a anterior já saiu (e a pessoa já respondeu, quando pedido).
    // excluir = canais em intervalo anti-ban ou no teto do dia, para não travarem os outros
    proximaParaEnviar(t = agora(), excluir = []) {
      const fora = excluir.length ? `AND canal NOT IN (${excluir.map(() => '?').join(',')})` : '';
      return ler(db.prepare(`SELECT * FROM mensagens WHERE status = 'aprovada' AND proxima_tentativa <= ?
          AND (liberar_em IS NULL OR liberar_em <= ?) AND (agendar_para IS NULL OR agendar_para <= ?) AND ${LIBERADA} ${fora}
        ORDER BY proxima_tentativa, id LIMIT 1`).get(t, t, t, ...excluir));
    },
    // trava otimista: só um envio pega a mensagem, e nunca antes de a janela de desfazer acabar nem da anterior sair
    marcarEnviando(id) {
      const t = agora();
      const r = db.prepare(`UPDATE mensagens SET status = 'enviando', tentativas = tentativas + 1, atualizado_em = MAX(?, atualizado_em + 1)
        WHERE id = ? AND status = 'aprovada' AND (liberar_em IS NULL OR liberar_em <= ?)
          AND (agendar_para IS NULL OR agendar_para <= ?) AND ${LIBERADA}`).run(t, id, t, t);
      return r.changes === 1;
    },
    marcarEnviada(id, resultado) {
      const t = agora();
      db.prepare(`UPDATE mensagens SET status = 'enviada', enviado_em = ?, resultado = ?, ultimo_erro = NULL,
        atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?`).run(t, json(resultado), t, id);
      evento(id, 'enviada', resultado?.resumo);
      // quem saía depois desta: sem esperar resposta, está liberada; esperando, passa a esperar a pessoa responder
      const quem = primeiroNome(db.prepare('SELECT destino_nome FROM mensagens WHERE id = ?').get(id)?.destino_nome);
      tocarDependentes(id, (d) => (d.espera_resposta
        ? ['ordem', `a #${id} saiu; agora espera ${quem} responder`]
        : ['liberada', `a #${id} saiu: liberada`]));
    },
    // transitório (canal fora do ar): volta para a fila com espera crescente até a janela acabar
    marcarFalha(id, erro, { transitorio = false, janelaMs = 6 * 3600e3 } = {}) {
      const m = obter(id);
      const t = agora();
      const base = m.agendar_para || m.aprovado_em || t;
      if (transitorio && t - base < janelaMs) {
        const espera = Math.min(10 * 60e3, 15e3 * 2 ** Math.min(m.tentativas, 6));
        db.prepare(`UPDATE mensagens SET status = 'aprovada', ultimo_erro = ?, proxima_tentativa = ?, atualizado_em = MAX(?, atualizado_em + 1)
          WHERE id = ?`).run(String(erro), t + espera, t, id);
        evento(id, 'retentar', `${erro} (de novo em ${Math.round(espera / 1000)}s)`);
        return 'retentar';
      }
      db.prepare(`UPDATE mensagens SET status = 'erro', ultimo_erro = ?, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?`)
        .run(String(erro), t, id);
      evento(id, 'erro', erro);
      tocarDependentes(id, ['bloqueada', `a #${id} deu erro; esta esperava por ela`]);
      return 'erro';
    },
    // envio cortado no meio (Central caiu): não sabemos se saiu, então não reenvia sozinho
    recuperarInterrompidas() {
      const presas = db.prepare(`SELECT id FROM mensagens WHERE status = 'enviando'`).all();
      for (const { id } of presas) {
        db.prepare(`UPDATE mensagens SET status = 'erro', ultimo_erro = ?, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?`)
          .run('envio interrompido (a Central reiniciou no meio). Confira no canal se saiu antes de reenviar.', agora(), id);
        evento(id, 'erro', 'envio interrompido');
        tocarDependentes(id, ['bloqueada', `a #${id} deu erro; esta esperava por ela`]);
      }
      return presas.length;
    },
    enviadasDesde(canal, desde) {
      return db.prepare(`SELECT COUNT(*) n FROM mensagens WHERE canal = ? AND status = 'enviada' AND enviado_em >= ?`)
        .get(canal, desde).n;
    },

    // --- Entrada ---
    marcarVisto(chave, ateEm) {
      db.prepare(`INSERT INTO vistos (chave, ate_em) VALUES (?, ?)
        ON CONFLICT(chave) DO UPDATE SET ate_em = MAX(ate_em, excluded.ate_em)`).run(chave, ateEm || Date.now());
    },
    vistos() {
      return new Map(db.prepare('SELECT chave, ate_em FROM vistos').all().map((v) => [v.chave, v.ate_em]));
    },
    // já existe mensagem na fila respondendo este item? (campo: "entrada", ou "acompanhar" para a cobrança)
    respostasPor(chaves, campo = 'entrada') {
      if (!chaves.length) return new Map();
      const caminho = campo === 'acompanhar' ? '$.acompanhar' : '$.entrada';
      const linhas = db.prepare(`SELECT id, status, json_extract(extra, '${caminho}') chave FROM mensagens
        WHERE json_extract(extra, '${caminho}') IN (${chaves.map(() => '?').join(',')})
          AND status IN ('pendente','aprovada','enviando','enviada') ORDER BY id`).all(...chaves);
      return new Map(linhas.map((l) => [l.chave, { id: l.id, status: l.status }]));
    },

    // --- Acompanhar ---
    // enviadas marcadas para acompanhar a resposta, desde t
    acompanhadas(desde) {
      return db.prepare(`SELECT id, canal, destino_id, destino_nome, corpo, enviado_em, acompanhar FROM mensagens
        WHERE status = 'enviada' AND acompanhar IS NOT NULL AND canal = 'whatsapp' AND destino_id IS NOT NULL AND enviado_em >= ?
        ORDER BY enviado_em`).all(desde);
    },
    // o que a Central enviou desde t (a varredura das promessas), na ordem do envio
    enviadasDesdeEm(desde) {
      return db.prepare(`SELECT * FROM mensagens WHERE status = 'enviada' AND enviado_em >= ? ORDER BY enviado_em, id`).all(desde).map(hidratar);
    },
    ultimaEnviadaPara(canal, destino) {
      return db.prepare(`SELECT MAX(enviado_em) t FROM mensagens WHERE canal = ? AND destino_id = ? AND status = 'enviada'`).get(canal, destino)?.t ?? null;
    },
    // Grava a promessa achada; null se já existe. A mensagem que a Central mandou também aparece na ponte do WhatsApp:
    // o mesmo trecho, para o mesmo destino, até 30 min de diferença e pela outra origem é a mesma promessa.
    registrarPromessa(p) {
      const igual = db.prepare(`SELECT id FROM promessas WHERE chave = ? OR (sentido = ? AND canal = ? AND destino_id IS ? AND origem != ?
        AND norm(trecho) = norm(?) AND ABS(em - ?) <= 1800000) LIMIT 1`).get(p.chave, p.sentido, p.canal, p.destino_id ?? null, p.origem, p.trecho, p.em);
      if (igual) return null;
      const t = agora();
      const r = db.prepare(`INSERT OR IGNORE INTO promessas (chave, origem, sentido, canal, destino_id, destino_nome, mensagem_id, trecho, frase,
          em, prazo, prazo_dito, criado_em, atualizado_em)
        VALUES (@chave, @origem, @sentido, @canal, @destino_id, @destino_nome, @mensagem_id, @trecho, @frase, @em, @prazo, @prazo_dito, @t, @t)`)
        .run({ ...p, destino_id: p.destino_id ?? null, destino_nome: p.destino_nome ?? null, mensagem_id: p.mensagem_id ?? null, prazo_dito: p.prazo_dito ?? null, t });
      return r.changes ? lerPromessa(Number(r.lastInsertRowid)) : null;
    },
    promessa: lerPromessa,
    promessasAbertas() {
      return db.prepare(`SELECT * FROM promessas WHERE status = 'aberta' ORDER BY prazo, id`).all();
    },
    // Cumpri (a minha), Recebi (a dele) ou Dispensar; reabrir = o "Desfazer" do painel
    fecharPromessa(id, acao) {
      const p = lerPromessa(id);
      if (!p) throw erroHttp(404, `promessa ${id} não existe`);
      const status = acao === 'reabrir' ? 'aberta' : Object.hasOwn(PROMESSA_FECHA, acao) ? PROMESSA_FECHA[acao] : null;
      if (!status) throw erroHttp(400, `ação inválida: "${acao}". Use: ${[...Object.keys(PROMESSA_FECHA), 'adiar', 'reabrir'].join(', ')}`);
      if (acao === 'cumpri' && p.sentido !== 'minha') throw erroHttp(400, 'essa promessa foi feita a você: use Recebi');
      if (acao === 'recebi' && p.sentido !== 'dele') throw erroHttp(400, 'essa promessa é sua: use Cumpri');
      const t = agora();
      db.prepare('UPDATE promessas SET status = ?, fechada_em = ?, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?')
        .run(status, status === 'aberta' ? null : t, t, id);
      return lerPromessa(id);
    },
    // Adiar 1 dia: conta do prazo ou de agora, o que for mais tarde (adiar uma atrasada dá 24 h a partir de agora)
    adiarPromessa(id, horas = 24) {
      const p = lerPromessa(id);
      if (!p) throw erroHttp(404, `promessa ${id} não existe`);
      if (p.status !== 'aberta') throw erroHttp(409, `essa promessa já está "${p.status}"`);
      const t = agora();
      db.prepare('UPDATE promessas SET prazo = ?, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?').run(Math.max(p.prazo, t) + horas * 3600e3, t, id);
      return lerPromessa(id);
    },
    ligarCobranca(id, mensagemId) {
      db.prepare('UPDATE promessas SET cobranca_id = ?, atualizado_em = MAX(?, atualizado_em + 1) WHERE id = ?').run(mensagemId, agora(), id);
    },

    getEstado(chave, padrao = null) {
      const r = db.prepare('SELECT valor FROM estado WHERE chave = ?').get(chave);
      return r ? JSON.parse(r.valor) : padrao;
    },
    setEstado(chave, valor) {
      db.prepare('INSERT INTO estado (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
        .run(chave, JSON.stringify(valor));
    },
  };
}

export function erroHttp(status, msg, dados = null) {
  const e = new Error(msg);
  e.status = status;
  if (dados) e.dados = dados;
  return e;
}
