// Migração e relatório numa CÓPIA do banco de verdade. Fonte: CENTRAL_DB_COPIA ou $TMPDIR/central-copia.db
// (feita antes com `cp ~/.central-mensagens/central.db $TMPDIR/central-copia.db`); sem ela, o teste pula.
// O teste nunca abre o banco real: recusa a fonte se ela for o banco real ou estiver na pasta dele, e trabalha
// num snapshot novo da cópia (backup do SQLite), então a própria cópia também não muda.
process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../src/config.js';
import { abrirDb } from '../src/db.js';

const fonte = process.env.CENTRAL_DB_COPIA || path.join(os.tmpdir(), 'central-copia.db');
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const ehDoBancoReal = (p) => real(p) === real(config.dbReal) || real(path.dirname(p)) === real(path.dirname(config.dbReal));
const pular = !fs.existsSync(fonte) ? `sem cópia do banco em ${fonte}` : ehDoBancoReal(fonte) ? 'a fonte é o banco real: só cópia' : false;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'central-copia-real-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function snapshot(nome) {
  const destino = path.join(dir, nome);
  const origem = new Database(fonte, { readonly: true, fileMustExist: true });
  try {
    await origem.backup(destino);
  } finally {
    origem.close();
  }
  return destino;
}

// contagens e uma soma de verificação do que importa em cada linha (nunca imprime conteúdo)
function retrato(arquivo) {
  const db = new Database(arquivo, { readonly: true });
  try {
    const hash = (sql) => {
      const h = crypto.createHash('sha256');
      for (const r of db.prepare(sql).iterate()) h.update(JSON.stringify(r));
      return h.digest('hex');
    };
    const tabelas = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));
    return {
      mensagens: db.prepare('SELECT COUNT(*) n FROM mensagens').get().n,
      eventos: db.prepare('SELECT COUNT(*) n FROM eventos').get().n,
      estado: tabelas.has('estado') ? db.prepare("SELECT COUNT(*) n FROM estado WHERE chave != 'migracao_motivos_v2'").get().n : 0,
      somaMensagens: hash(`SELECT id, criado_em, status, canal, conta, destino_id, destino_nome, assunto, corpo, corpo_original,
        anexos, extra, cliente, sessao_nome, aprovado_em, enviado_em, tentativas, ultimo_erro, resultado FROM mensagens ORDER BY id`),
      somaEventos: hash('SELECT id, mensagem_id, em, tipo, detalhe FROM eventos ORDER BY id'),
      integridade: db.pragma('integrity_check', { simple: true }),
    };
  } finally {
    db.close();
  }
}

test('migração na cópia do banco real: roda duas vezes e nenhuma linha se perde ou muda', { skip: pular }, async () => {
  const arq = await snapshot('migracao.db');
  const antes = retrato(arq);
  assert.ok(antes.mensagens > 0, 'a cópia tem mensagens');
  abrirDb(arq).db.close();
  const depois1 = retrato(arq);
  const motivos1 = new Database(arq, { readonly: true }).prepare('SELECT id, motivo_codigo, motivo FROM mensagens ORDER BY id').all();
  abrirDb(arq).db.close();
  const depois2 = retrato(arq);
  const conn = new Database(arq, { readonly: true });
  const motivos2 = conn.prepare('SELECT id, motivo_codigo, motivo FROM mensagens ORDER BY id').all();
  const colunas = new Set(conn.prepare('PRAGMA table_info(mensagens)').all().map((c) => c.name));
  const semMotivo = conn.prepare(`SELECT COUNT(*) n FROM mensagens m WHERE status = 'descartada' AND motivo IS NULL
    AND EXISTS (SELECT 1 FROM eventos e WHERE e.mensagem_id = m.id AND e.tipo = 'descartada' AND e.detalhe IS NOT NULL)`).get().n;
  conn.close();
  assert.deepEqual(depois1, antes, 'a primeira migração não perde nem muda linha');
  assert.deepEqual(depois2, antes, 'a segunda também');
  assert.equal(antes.integridade, 'ok');
  for (const c of ['liberar_em', 'substitui_id', 'motivo_codigo', 'motivo', 'lint']) assert.ok(colunas.has(c), c);
  assert.deepEqual(motivos2, motivos1, 'o motivo copiado do evento não muda na segunda vez');
  assert.equal(semMotivo, 0, 'todo descarte antigo com motivo no evento ganhou o motivo na coluna');
});

const mediana = (v) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const umaCasa = (n) => (n == null ? null : Math.round(n * 10) / 10);
const dia = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const contar = (linhas, chave) => linhas.reduce((m, r) => m.set(chave(r), (m.get(chave(r)) || 0) + 1), new Map());

test('relatório na cópia do banco real bate com a conta feita à parte (linhas cruas, sem GROUP BY)', { skip: pular }, async () => {
  const arq = await snapshot('relatorio.db');
  const cru = new Database(arq, { readonly: true });
  const maisNova = cru.prepare('SELECT MAX(criado_em) t FROM mensagens').get().t;
  cru.close();
  const agora = maisNova + 3600e3;
  const repo = abrirDb(arq, { agora: () => agora });
  try {
    for (const dias of [7, 30, 3650]) {
      const r = repo.relatorio(dias);
      const desde = agora - dias * 86400e3;
      const linhas = repo.db.prepare('SELECT * FROM mensagens').all().filter((m) => m.criado_em >= desde);
      assert.equal(r.total, linhas.length, `total em ${dias} dias`);
      // por canal
      const canais = [...new Set(linhas.map((m) => m.canal))];
      const porCanal = canais.map((canal) => {
        const ms = linhas.filter((m) => m.canal === canal);
        const n = (f) => ms.filter(f).length;
        const aprov = ms.filter((m) => m.aprovado_em != null).map((m) => (m.aprovado_em - m.criado_em) / 60e3);
        return {
          canal, criadas: ms.length, enviadas: n((m) => m.status === 'enviada'), descartadas: n((m) => m.status === 'descartada'),
          erros: n((m) => m.status === 'erro'), abertas: n((m) => ['pendente', 'aprovada', 'enviando'].includes(m.status)),
          editadas: n((m) => m.corpo !== m.corpo_original),
          tamanhoMedio: Math.round(ms.reduce((s, m) => s + [...m.corpo].length, 0) / ms.length),
          aprovacaoMedianaMin: umaCasa(mediana(aprov)),
        };
      }).sort((a, b) => b.criadas - a.criadas || a.canal.localeCompare(b.canal));
      assert.deepEqual(r.porCanal, porCanal, `por canal em ${dias} dias`);
      // por dia (data local) e canal
      const chaves = [...new Set(linhas.map((m) => `${dia(m.criado_em)}|${m.canal}`))].sort();
      const porDia = chaves.map((k) => {
        const [d, canal] = k.split('|');
        const ms = linhas.filter((m) => dia(m.criado_em) === d && m.canal === canal);
        return { dia: d, canal, criadas: ms.length, enviadas: ms.filter((m) => m.status === 'enviada').length, descartadas: ms.filter((m) => m.status === 'descartada').length };
      });
      assert.deepEqual(r.porDia, porDia, `por dia em ${dias} dias`);
      // descartes por motivo e por sessão (com o motivo mais comum de cada uma)
      const descartadas = linhas.filter((m) => m.status === 'descartada');
      const motivos = [...contar(descartadas, (m) => m.motivo_codigo)].map(([motivo_codigo, n]) => ({ motivo_codigo, n }));
      const ordemMotivo = (a, b) => b.n - a.n || String(a.motivo_codigo ?? '').localeCompare(String(b.motivo_codigo ?? ''));
      assert.deepEqual([...r.descartesPorMotivo].sort(ordemMotivo), motivos.sort(ordemMotivo), `motivos em ${dias} dias`);
      const sessao = (m) => m.sessao_nome ?? '(sem sessão)';
      const porSessao = [...new Set(linhas.map(sessao))].map((s) => {
        const ms = linhas.filter((m) => sessao(m) === s);
        const classificados = [...contar(ms.filter((m) => m.status === 'descartada' && m.motivo_codigo != null), (m) => m.motivo_codigo)]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        return { sessao: s, criadas: ms.length, descartadas: ms.filter((m) => m.status === 'descartada').length, motivoTop: classificados[0]?.[0] ?? null };
      });
      const porNome = (a, b) => a.sessao.localeCompare(b.sessao);
      assert.deepEqual([...r.descartesPorSessao].sort(porNome), porSessao.sort(porNome), `sessões em ${dias} dias`);
      // medianas e porcentagem
      assert.equal(r.tempoAprovacaoMedianaMin, umaCasa(mediana(linhas.filter((m) => m.aprovado_em != null).map((m) => (m.aprovado_em - m.criado_em) / 60e3))));
      const editadas = linhas.filter((m) => m.corpo !== m.corpo_original).length;
      assert.equal(r.editadasPct, linhas.length ? umaCasa((100 * editadas) / linhas.length) : 0);
    }
  } finally {
    repo.db.close();
  }
});
