// Discord por um bot seu (o token é o segredo DISCORD_BOT_TOKEN). Destino = canal de texto (#nome)
// ou pessoa (id "dm:<userId>", conversa privada). Desligado até ter `discord` no config.json.
import { config } from '../config.js';
import { segredo } from '../segredos.js';
import { decidir, fatiar, fetchJson, pontuar } from '../util.js';

const cfg = config.discord;
const api = (caminho, opts = {}) =>
  fetchJson(`${cfg.api}${caminho}`, {
    ...opts,
    headers: {
      authorization: `Bot ${segredo(cfg.tokenSecret)}`,
      'user-agent': 'central-mensagens (local, 0.1)',
      'content-type': 'application/json',
      ...(opts.headers || {}),
    },
  });

// o Discord limita chamadas: a lista de servidores muda quase nunca, então fica em cache
let cacheGuilds = { em: 0, lista: [] };
async function guilds() {
  if (Date.now() - cacheGuilds.em < 30 * 60e3 && cacheGuilds.lista.length) return cacheGuilds.lista;
  cacheGuilds = { em: Date.now(), lista: await api('/users/@me/guilds') };
  return cacheGuilds.lista;
}

let cacheCanais = { em: 0, lista: [] };
// canais privados ao bot (403). Guarda por 30 min: se o acesso for liberado, volta a tentar sozinho.
const semAcesso = new Map();
const bloqueado = (id) => Date.now() - (semAcesso.get(id) || 0) < 30 * 60e3;
let idBot = null;
let nomeBot = null;
// o id do Discord carrega a hora da criação nos bits altos
const horaDoId = (id) => (Number(BigInt(id) >> 22n) + 1420070400000);

async function canais() {
  if (Date.now() - cacheCanais.em < 10 * 60e3 && cacheCanais.lista.length) return cacheCanais.lista;
  const lista = [];
  for (const g of await guilds()) {
    const todos = await api(`/guilds/${g.id}/channels`);
    const categorias = new Map(todos.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
    for (const c of todos.filter((x) => x.type === 0 || x.type === 5)) {
      lista.push({
        id: c.id,
        nome: `#${c.name}`,
        tipo: 'canal',
        detalhe: [categorias.get(c.parent_id), g.name].filter(Boolean).join(' · '),
        servidor: g.name,
        recencia: -c.position,
        ultimaEm: c.last_message_id ? horaDoId(c.last_message_id) : 0,
      });
    }
  }
  cacheCanais = { em: Date.now(), lista };
  return lista;
}

// busca pessoa no servidor (para DM). Devolve destino com id "dm:<userId>"
const cachePessoas = new Map();
async function pessoas(q) {
  const termo = String(q || '').replace(/^@/, '').trim();
  if (termo.length < 2) return [];
  const c = cachePessoas.get(termo.toLowerCase());
  if (c && Date.now() - c.em < 10 * 60e3) return c.lista;
  const lista = [];
  for (const g of await guilds()) {
    let membros = [];
    try {
      membros = await api(`/guilds/${g.id}/members/search?query=${encodeURIComponent(termo)}&limit=5`);
    } catch {
      continue; // servidor sem permissão de buscar membro
    }
    for (const m of membros) {
      lista.push({
        id: `dm:${m.user.id}`,
        nome: m.nick || m.user.global_name || m.user.username,
        tipo: 'pessoa',
        detalhe: `mensagem privada · @${m.user.username} · ${g.name}`,
      });
    }
  }
  cachePessoas.set(termo.toLowerCase(), { em: Date.now(), lista });
  return lista;
}

// abre (ou reusa) a conversa privada com a pessoa
async function canalDeDm(userId) {
  const canal = await api('/users/@me/channels', { method: 'POST', body: JSON.stringify({ recipient_id: userId }) });
  if (!canal?.id) throw new Error('não consegui abrir a conversa privada');
  return canal.id;
}

// o texto em pedaços de até 1.990 caracteres, como o enviar posta (a prévia usa o mesmo corte)
export const montar = (m) => ({ partes: fatiar(String(m.corpo), 1990) });

export const discord = {
  id: 'discord',
  nome: 'Discord',
  contas: () => [{ id: 'bot', nome: 'Bot do Discord' }],
  contaPadrao: 'bot',

  async saude() {
    try {
      const me = await api('/users/@me');
      idBot = me.id;
      nomeBot = me.global_name || me.username;
      return { ok: true, resumo: `bot ${me.username} no ar` };
    } catch (e) {
      return { ok: false, resumo: e.message };
    }
  },

  async buscar(q) {
    const lista = await canais();
    if (!q) return lista.slice(0, 20).map(({ recencia, ...r }) => r);
    const porCanal = decidir(lista.map((c) => ({ ...c, score: pontuar(c.nome.slice(1), q.replace(/^#/, '')) })));
    const achados = porCanal.destino ? [porCanal.destino] : porCanal.candidatos;
    // sem canal com esse nome? pode ser uma pessoa (DM)
    return achados.length ? achados : pessoas(q);
  },

  async resolver(para) {
    const s = String(para || '').trim();
    if (s.startsWith('dm:')) return { destino: { id: s, nome: s.slice(3), tipo: 'pessoa' } };
    if (/^\d{15,}$/.test(s)) {
      const c = (await canais()).find((x) => x.id === s);
      return { destino: { id: s, nome: c?.nome || s, tipo: 'canal' } };
    }
    const alvo = s.replace(/^#/, '');
    const porCanal = decidir((await canais()).map((c) => ({ ...c, score: pontuar(c.nome.slice(1), alvo) })));
    if (porCanal.destino || porCanal.candidatos.length) return porCanal;
    const gente = await pessoas(alvo);
    if (gente.length === 1) return { destino: gente[0] };
    return { candidatos: gente };
  },

  // canais com conversa recente onde a última fala não é minha nem do bot.
  // canal privado ao bot responde 403 (Missing Access): fica de fora e não tenta de novo.
  async entrada({ horas = 72, limite = 25 } = {}) {
    if (!idBot) idBot = (await api('/users/@me')).id;
    const lista = await canais();
    const corte = Date.now() - horas * 3600e3;
    const recentes = lista.filter((c) => c.ultimaEm > corte).sort((a, b) => b.ultimaEm - a.ultimaEm).slice(0, 12);
    const itens = [];
    for (const c of recentes) {
      if (bloqueado(c.id)) continue;
      let msgs;
      try {
        msgs = await api(`/channels/${c.id}/messages?limit=5`);
        semAcesso.delete(c.id);
      } catch (e) {
        if (/HTTP 403/.test(e.message)) semAcesso.set(c.id, Date.now());
        continue;
      }
      const m = msgs[0];
      if (!m || m.author.id === cfg.donoId || m.author.id === idBot) continue; // eu já falei por último
      // só é pra mim se me marcaram ou se eu estava falando ali nas últimas 6 h
      const citado = !!cfg.donoId && ((m.mentions || []).some((u) => u.id === cfg.donoId) || (m.content || '').includes(cfg.donoId));
      const faleiAgora = msgs.some((x) => (x.author.id === cfg.donoId || x.author.id === idBot)
        && Date.now() - Date.parse(x.timestamp) < 6 * 3600e3);
      itens.push({
        precisa: citado || faleiAgora,
        motivo: citado ? 'marcaram você' : (faleiAgora ? 'canal em que você acabou de falar' : 'canal sem falar com você'),
        chave: `discord:${c.id}:${m.id}`,
        canal: 'discord', conta: 'bot',
        titulo: c.nome,
        de: m.author.global_name || m.author.username,
        texto: (m.content || (m.embeds?.length ? '[embed]' : '[anexo]')).replace(/\s+/g, ' ').slice(0, 400),
        em: Date.parse(m.timestamp) || 0,
        destino: { id: c.id, nome: c.nome, tipo: 'canal' },
      });
      if (itens.length >= limite) break;
    }
    return itens;
  },

  // última fala minha (ou do bot) no canal, para não repetir recado já dado
  async contexto(destino) {
    if (!idBot) idBot = (await api('/users/@me')).id;
    let msgs;
    try {
      const canalId = destino.startsWith('dm:') ? await canalDeDm(destino.slice(3)) : destino;
      msgs = await api(`/channels/${canalId}/messages?limit=20`);
    } catch (e) {
      return { confiavel: false, motivo: /HTTP 403/.test(e.message) ? 'o bot não tem acesso a este canal' : e.message };
    }
    const meu = msgs.find((m) => m.author.id === cfg.donoId || m.author.id === idBot);
    const outro = msgs.find((m) => m.author.id !== cfg.donoId && m.author.id !== idBot);
    const item = (m) => (m ? { em: Date.parse(m.timestamp), texto: m.content || '[anexo]', quem: m.author.global_name || m.author.username } : null);
    const minhasUltimas = msgs.filter((m) => (m.author.id === cfg.donoId || m.author.id === idBot) && (m.content || '').length > 20)
      .slice(0, 8).map(item);
    return { confiavel: true, minhaUltima: item(meu), minhasUltimas, deleUltima: item(outro) };
  },

  async ler(canal, n = 20) {
    const r = await this.resolver(canal);
    if (!r.destino) return { candidatos: r.candidatos };
    const msgs = await api(`/channels/${r.destino.id}/messages?limit=${Math.min(Number(n) || 20, 50)}`);
    return {
      conversa: r.destino,
      mensagens: msgs.reverse().map((m) => ({
        em: m.timestamp,
        de: m.author.global_name || m.author.username,
        texto: m.content || (m.embeds?.length ? '[embed]' : '[anexo]'),
      })),
    };
  },

  async previa(m) {
    const dm = String(m.destino_id).startsWith('dm:');
    let servidor = null;
    if (!dm) {
      try { servidor = (await canais()).find((c) => c.id === m.destino_id)?.servidor || null; } catch { /* sem rede: sem o nome do servidor */ }
    }
    return {
      canal: 'discord',
      alvo: { id: m.destino_id, nome: m.destino_nome || m.destino_id, tipo: dm ? 'dm' : 'canal', ...(servidor ? { servidor } : {}) },
      corpo: m.corpo,
      partes: montar(m).partes,
      bot: { nome: nomeBot || 'Bot' },
    };
  },

  // Tudo o que sai em texto, para o linter (src/lint.js): o texto inteiro (quem lê junta as partes) e cada
  // parte que o bot posta, do mesmo montar() do envio (o corte pode pôr um token no começo de uma parte)
  saida(m) {
    const { partes } = montar(m);
    return [
      { texto: String(m.corpo), onde: 'no texto', nome: 'texto' },
      ...(partes.length > 1 ? partes.map((p, k) => ({ texto: p, onde: `na parte ${k + 1} do Discord`, nome: `parte ${k + 1}` })) : []),
    ];
  },

  async enviar(m) {
    const ids = [];
    const canalId = m.destino_id.startsWith('dm:') ? await canalDeDm(m.destino_id.slice(3)) : m.destino_id;
    for (const parte of montar(m).partes) {
      const r = await api(`/channels/${canalId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: parte, allowed_mentions: { parse: [] } }),
      });
      ids.push(r.id);
    }
    return { resumo: `postada em ${m.destino_nome || m.destino_id}${ids.length > 1 ? ` (${ids.length} partes)` : ''}`, ids };
  },
};
