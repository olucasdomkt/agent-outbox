// WhatsApp do dono, pela ponte whatsmeow (pasta ponte/, 127.0.0.1:8080).
// Diretório de destinos = tabela chats da ponte (nome de todo grupo/contato) + a agenda do celular.
import Database from 'better-sqlite3';
import path from 'node:path';
import { copiaParaEnvio, lerValidado, validarAnexos } from '../anexos.js';
import { config, ponteToken } from '../config.js';
import { decidir, erroTransitorio, infoAnexo, norm, pontuar } from '../util.js';

const cfg = config.whatsapp;
// conexão aberta por caminho: se o caminho da configuração muda (testes), reabre no novo
const conexoes = { msgs: { caminho: null, db: null }, sessao: { caminho: null, db: null } };

function abrir(caminho) {
  try {
    const db = new Database(caminho, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 3000');
    return db;
  } catch {
    return null;
  }
}
function conexao(qual, caminho) {
  const c = conexoes[qual];
  if (c.caminho !== caminho || !c.db) {
    if (c.caminho !== caminho) c.db?.close();
    conexoes[qual] = { caminho, db: abrir(caminho) };
  }
  return conexoes[qual].db;
}
const msgs = () => conexao('msgs', cfg.messagesDb);
const sessao = () => conexao('sessao', cfg.sessaoDb);

const tipoDe = (jid) => (jid.endsWith('@g.us') ? 'grupo' : 'contato');
// como o dono aparece numa conversa (prévia e msg ler): o nome do config.json ou "Você"
const eu = () => config.dono.nome || 'Você';

// meu próprio número, para saber quando me citam num grupo: o da sessão da ponte ou, sem ela, o do config.json
let meuNumeroCache;
function meuNumero() {
  if (meuNumeroCache !== undefined) return meuNumeroCache;
  const jid = sessao()?.prepare('SELECT jid FROM whatsmeow_device LIMIT 1').get()?.jid || '';
  meuNumeroCache = jid.split('@')[0].split(/[.:]/)[0] || config.dono.whatsapp || null;
  return meuNumeroCache;
}

// "ok", "valeu", "ah sim, show!", "👍": fecha assunto, não pede resposta
const PALAVRAS_DE_FECHAMENTO = new Set(('ok okay okey blz beleza valeu vlw obrigado obrigada brigada brigado agradecido show top perfeito ' +
  'entendi entendido combinado isso mesmo certo sim claro pode ser pra voce ta tah bom boa tudo bem ah uhum aham ata legal massa otimo otima ' +
  'demais bacana joia opa oi ola bom dia tarde noite grato gratidao e nada de').split(' '));
const RISADA = /^(k{2,}|rs{1,}|(ha|he|hi|hu){2,}h?|hehe\w*|huahua\w*)$/;
const soEmoji = (s) => s.length <= 12 && !/[a-z0-9]/i.test(s) && /\p{Extended_Pictographic}/u.test(s);

function ehFechamento(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return true;
  if (soEmoji(bruto)) return true;
  if (bruto.length > 45) return false;
  const palavras = bruto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!palavras.length) return true;
  return palavras.every((p) => PALAVRAS_DE_FECHAMENTO.has(p) || RISADA.test(p));
}

// tem nome na agenda? número pessoal vive cheio de robô e empresa
function temNome(jid) {
  const nome = nomeDe(jid);
  return !!nome && !/^\+?\d+$/.test(nome);
}

// Pré-filtro: isto aqui é pra mim? Em grupo, só quando me citam ou quando eu estava na conversa.
function relevancia({ grupo, novas, minhaUltimaEm, meu, jid }) {
  const textos = novas.map((n) => n.texto);
  if (textos.every(ehFechamento)) return { precisa: false, motivo: 'só confirmação ("ok", "obrigado")' };
  if (!grupo) {
    if (!temNome(jid)) return { precisa: false, motivo: 'número sem nome na agenda (empresa, robô)' };
    return { precisa: true, motivo: 'conversa direta' };
  }
  const junto = textos.join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (meu && junto.includes(`@${meu}`)) return { precisa: true, motivo: 'marcaram você no grupo' };
  const primeiroNome = norm(config.dono.nome).split(' ')[0];
  if (primeiroNome && junto.split(/[^a-z0-9]+/).includes(primeiroNome)) return { precisa: true, motivo: 'citaram seu nome' };
  if (minhaUltimaEm && Date.now() - minhaUltimaEm < 6 * 3600e3) return { precisa: true, motivo: 'grupo em que você acabou de falar' };
  return { precisa: false, motivo: 'grupo, sem falar com você' };
}

// meu número e meu @lid: a conversa comigo mesmo (anotações) não é conversa com ninguém
function meusJids() {
  let d = null;
  try { d = sessao()?.prepare('SELECT * FROM whatsmeow_device LIMIT 1').get(); } catch { /* banco sem a tabela */ }
  const user = (j) => String(j).split('@')[0].split(/[.:]/)[0];
  const numero = d?.jid ? user(d.jid) : config.dono.whatsapp;
  return new Set([numero && `${numero}@s.whatsapp.net`, d?.lid && `${user(d.lid)}@lid`].filter(Boolean));
}

// conversa direta: nem grupo, nem status, nem canal
const DIRETA = "chat_jid NOT LIKE '%@g.us' AND chat_jid NOT LIKE '%@broadcast' AND chat_jid NOT LIKE '%@newsletter'";
const textoPonte = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// A ponte parou de gravar há mais de 12 h? Aí "não respondeu" pode ser só o histórico parado.
function ponteParada(db) {
  const ultima = db.prepare('SELECT MAX(timestamp) t FROM messages').get()?.t;
  return ultima && Date.now() - Date.parse(ultima) > 12 * 3600e3
    ? `a ponte do WhatsApp parou de gravar em ${String(ultima).slice(0, 16)}: sem ela não dá para saber quem respondeu` : null;
}

// @lid (formato novo) não entrega bem; envia sempre para telefone@s.whatsapp.net
function jidEnvio(jid) {
  if (!jid.endsWith('@lid')) return jid;
  const pn = sessao()?.prepare('SELECT pn FROM whatsmeow_lid_map WHERE lid = ?').get(jid.split('@')[0])?.pn;
  return pn ? `${pn}@s.whatsapp.net` : jid;
}

// "nome" que é só número (o WhatsApp grava @lid assim) não serve de nome
const serve = (n) => n && !/^\+?\d{5,}$/.test(String(n).trim());

// A mesma pessoa aparece como @lid e como telefone, e só uma das conversas tem o nome.
// Procura nos dois, na conversa e na agenda do WhatsApp, e ignora "nome" que é só o número.
function nomeDe(jid) {
  if (!jid) return '?';
  const canon = jidEnvio(jid);
  const tentativas = [...new Set([canon, jid])];
  for (const j of tentativas) {
    const c = msgs()?.prepare('SELECT name FROM chats WHERE jid = ?').get(j);
    if (serve(c?.name)) return c.name;
    const ct = sessao()?.prepare('SELECT full_name, push_name, first_name FROM whatsmeow_contacts WHERE their_jid = ?').get(j);
    const nome = [ct?.full_name, ct?.push_name, ct?.first_name].find(serve);
    if (nome) return nome;
  }
  return canon.endsWith('@s.whatsapp.net') ? `+${canon.split('@')[0]}` : canon.split('@')[0];
}

// remetente dentro de grupo vem sem servidor: pode ser telefone ou @lid
function nomeDoRemetente(sender) {
  if (!sender) return '?';
  if (sender.includes('@')) return nomeDe(sender);
  const ehLid = !!sessao()?.prepare('SELECT pn FROM whatsmeow_lid_map WHERE lid = ?').get(sender);
  return nomeDe(`${sender}@${ehLid ? 'lid' : 's.whatsapp.net'}`);
}

function telefone(para) {
  const dig = String(para).replace(/\D/g, '');
  if (!/^\+?[\d\s().-]{10,}$/.test(String(para).trim()) || dig.length < 10) return null;
  return dig.length <= 11 ? `55${dig}` : dig;
}

// Celular do Brasil com e sem o nono dígito: conta antiga de WhatsApp fica registrada sem ele
// (o contato é 551199990001, e quem digita põe o 9)
function variantes(fone) {
  if (/^55\d{2}9\d{8}$/.test(fone)) return [fone, fone.slice(0, 4) + fone.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(fone)) return [fone, `${fone.slice(0, 4)}9${fone.slice(4)}`];
  return [fone];
}

// Destinos para buscar e resolver: as conversas da ponte e a agenda do celular. A conversa @lid grava como
// "nome" o próprio número; o nome de verdade está na agenda (whatsmeow_contacts), e às vezes só nela: sem a
// agenda, o contato não aparece na busca e a sessão acaba digitando o número de cabeça.
// O mesmo contato pode ter uma conversa @lid e outra pelo telefone: junta as duas no telefone.
function diretorio() {
  const db = msgs();
  const s = sessao();
  const lista = db ? db.prepare('SELECT jid, name, last_message_time FROM chats').all() : [];
  const lids = new Map(s ? s.prepare('SELECT lid, pn FROM whatsmeow_lid_map').all().map((x) => [x.lid, x.pn]) : []);
  const telefoneDe = (jid) => {
    const [user, servidor] = jid.split('@');
    return servidor === 'lid' && lids.has(user) ? `${lids.get(user)}@s.whatsapp.net` : jid;
  };
  // na agenda: o nome que o dono salvou no celular e, à parte, o que a pessoa pôs no perfil
  const agenda = new Map();
  for (const c of s ? s.prepare('SELECT their_jid, full_name, first_name, push_name FROM whatsmeow_contacts').all() : []) {
    const jid = telefoneDe(c.their_jid);
    const a = agenda.get(jid) || { salvo: '', perfil: '' };
    a.salvo ||= [c.full_name, c.first_name].find(serve) || '';
    a.perfil ||= serve(c.push_name) ? c.push_name : '';
    agenda.set(jid, a);
  }
  const porJid = new Map();
  for (const c of lista) {
    const jid = telefoneDe(c.jid);
    const recencia = Date.parse(c.last_message_time) || 0;
    const nome = serve(c.name) ? c.name : '';
    const atual = porJid.get(jid);
    if (atual) {
      atual.nome ||= nome; // a outra conversa (telefone ou @lid) pode ter o nome
      if (atual.recencia >= recencia) continue;
    }
    const quando = c.last_message_time ? `última conversa ${String(c.last_message_time).slice(0, 10)}` : null;
    porJid.set(jid, { id: jid, nome: nome || atual?.nome || '', tipo: tipoDe(jid), sobre: quando, recencia });
  }
  // contato salvo no celular que ainda não tem conversa na ponte também é destino
  for (const [jid, a] of agenda) {
    if (a.salvo && !porJid.has(jid) && jid.endsWith('@s.whatsapp.net')) porJid.set(jid, { id: jid, nome: '', tipo: 'contato', sobre: 'da agenda do celular', recencia: 0 });
  }
  return [...porJid.values()].map(({ sobre, ...x }) => {
    const fone = x.id.endsWith('@s.whatsapp.net') ? `+${x.id.split('@')[0]}` : null;
    return { ...x, nome: x.nome || agenda.get(x.id)?.salvo || agenda.get(x.id)?.perfil || fone || x.id, detalhe: [fone, sobre].filter(Boolean).join(' · ') };
  });
}

// Quem fala nesta conversa, para transformar "@Nome" em marcação de verdade.
// Sem isso o "@Elisa" vai como texto e não marca ninguém (o WhatsApp precisa do JID + "@numero" no texto).
function participantesDe(chatJid) {
  const db = msgs();
  if (!db) return [];
  const jids = [chatJid];
  if (chatJid.endsWith('@s.whatsapp.net')) {
    const lid = sessao()?.prepare('SELECT lid FROM whatsmeow_lid_map WHERE pn = ?').get(chatJid.split('@')[0])?.lid;
    if (lid) jids.push(`${lid}@lid`);
  }
  const linhas = db.prepare(`SELECT DISTINCT sender FROM messages
    WHERE chat_jid IN (${jids.map(() => '?').join(',')}) AND is_from_me = 0 AND sender IS NOT NULL AND sender != ''
    ORDER BY timestamp DESC LIMIT 60`).all(...jids);
  const gente = [];
  for (const { sender } of linhas) {
    const jid = sender.includes('@') ? sender : `${sender}@s.whatsapp.net`;
    const fone = jidEnvio(jid).split('@')[0];
    if (!/^\d{8,}$/.test(fone)) continue;
    gente.push({ jid: `${fone}@s.whatsapp.net`, numero: fone, nome: nomeDe(jid) });
  }
  if (!chatJid.endsWith('@g.us')) {
    const fone = chatJid.split('@')[0];
    if (/^\d{8,}$/.test(fone)) gente.push({ jid: chatJid, numero: fone, nome: nomeDe(chatJid) });
  }
  return gente;
}

// troca "@Nome" pelo "@numero" que o WhatsApp entende e devolve os JIDs marcados
// (mais quem foi marcado e quem fala na conversa, para a prévia não consultar de novo)
export function prepararMencoes(texto, chatJid) {
  const gente = participantesDe(chatJid);
  const marcados = new Map();
  const corpo = String(texto).replace(/@([\p{L}][\p{L}0-9._-]*)/gu, (bruto, nome) => {
    if (/^\d+$/.test(nome)) return bruto; // já é número
    const alvo = norm(nome);
    const p = gente.find((g) => norm(g.nome).split(' ').some((parte) => parte === alvo))
      || gente.find((g) => norm(g.nome).startsWith(alvo));
    if (!p) return bruto; // ninguém com esse nome na conversa: fica texto puro
    marcados.set(p.jid, p);
    return `@${p.numero}`;
  });
  return { corpo, mencoes: [...marcados.keys()], marcados: [...marcados.values()], gente };
}

// a mesma conversa pode estar gravada no telefone e no @lid
function jidsDaConversa(jid) {
  const jids = [jid];
  const user = jid.split('@')[0];
  if (jid.endsWith('@s.whatsapp.net')) {
    const lid = sessao()?.prepare('SELECT lid FROM whatsmeow_lid_map WHERE pn = ?').get(user)?.lid;
    if (lid) jids.push(`${lid}@lid`);
  } else if (jid.endsWith('@lid')) {
    const pn = sessao()?.prepare('SELECT pn FROM whatsmeow_lid_map WHERE lid = ?').get(user)?.pn;
    if (pn) jids.push(`${pn}@s.whatsapp.net`);
  }
  return jids;
}

// as últimas falas da conversa (as duas pontas), da mais antiga para a mais nova
function conversaRecente(chatJid, n = 6) {
  const db = msgs();
  if (!db) return [];
  const jids = jidsDaConversa(chatJid);
  const grupo = chatJid.endsWith('@g.us');
  return db.prepare(`SELECT id, sender, content, timestamp, is_from_me, media_type FROM messages
    WHERE chat_jid IN (${jids.map(() => '?').join(',')}) ORDER BY timestamp DESC LIMIT ?`).all(...jids, n)
    .reverse()
    .map((l) => ({
      id: l.id,
      sender: l.sender || null,
      de: l.is_from_me ? eu() : (grupo ? nomeDoRemetente(l.sender) : nomeDe(chatJid)),
      eu: !!l.is_from_me,
      texto: l.content || '',
      em: Date.parse(l.timestamp) || 0,
      ...(l.media_type ? { midia: l.media_type } : {}),
    }));
}

// Monta o envio (o JSON que vai para a ponte) com o mesmo código que serve a prévia: o painel mostra o que sai.
// Citação automática e menções acontecem aqui; só o PRIMEIRO anexo vai (a ponte manda uma mídia por mensagem).
export function montar(m) {
  const recipient = jidEnvio(m.destino_id);
  const anexos = Array.isArray(m.anexos) ? m.anexos : [];
  const alvo = m.extra?.citar ? null : alvoDaResposta(m, recipient);
  const texto = alvo?.marcarNoInicio && !m.corpo.startsWith('@') ? `@${m.corpo}` : m.corpo;
  const { corpo, mencoes, marcados, gente } = prepararMencoes(texto, recipient);
  const citar = m.extra?.citar || alvo?.citar || null; // { id, sender, texto } da mensagem que está sendo respondida
  const envio = {
    recipient,
    message: corpo,
    media_path: anexos[0] || '',
    ...(mencoes.length ? { mentions: mencoes } : {}),
    ...(citar?.id ? {
      reply_to_id: citar.id,
      reply_to_sender: citar.sender || '',
      reply_to_text: String(citar.texto || '').slice(0, 400),
    } : {}),
  };
  return { envio, citar: citar?.id ? citar : null, automatica: !!alvo, marcados, gente };
}

// Resposta a uma pessoa num grupo que chegou sem citação (ex.: `msg add` de outra sessão):
// acha a pessoa pelo nome no começo do texto ("Noemi, ...") ou no "responder a" e devolve a última
// mensagem dela no grupo (48 h) para citar. null se não achar ninguém: aí vai como antes.
export function alvoDaResposta(m, chatJid) {
  const db = msgs();
  if (!db || !chatJid.endsWith('@g.us')) return null;
  const abre = String(m.corpo || '').match(/^@?([\p{L}]+)\s*[,:!]/u);
  const nomes = [abre?.[1], String(m.responder_a || '').match(/^([\p{L}]+)/u)?.[1]].filter(Boolean).map(norm);
  if (!nomes.length) return null;
  const desde = new Date(Date.now() - 48 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  const linhas = db.prepare(`SELECT id, sender, content, media_type FROM messages
    WHERE chat_jid = ? AND is_from_me = 0 AND timestamp >= ? ORDER BY timestamp DESC LIMIT 200`).all(chatJid, desde);
  for (const alvo of nomes) {
    const l = linhas.find((x) => norm(nomeDoRemetente(x.sender)).split(' ').includes(alvo));
    if (l) {
      return {
        citar: { id: l.id, sender: l.sender, texto: l.content || (l.media_type ? `[${l.media_type}]` : '') },
        // só vira marcação quando o texto abre chamando a pessoa pelo nome
        marcarNoInicio: !!abre && norm(abre[1]) === alvo,
      };
    }
  }
  return null;
}

export const whatsapp = {
  id: 'whatsapp',
  nome: 'WhatsApp',
  contas: () => [{ id: 'pessoal', nome: 'WhatsApp pessoal' }],
  contaPadrao: 'pessoal',
  pausaEntreEnviosMs: () => cfg.intervaloMinMs + Math.random() * cfg.jitterMs,
  tetoDia: cfg.tetoDia,

  async saude() {
    const ultima = msgs()?.prepare('SELECT MAX(timestamp) t FROM messages').get()?.t || null;
    try {
      await fetch(`${cfg.ponte}/api/send`, { headers: { 'x-bridge-token': ponteToken() }, signal: AbortSignal.timeout(2500) });
      return { ok: true, resumo: 'ponte no ar', ultimaMensagem: ultima };
    } catch {
      return {
        ok: false,
        resumo: 'ponte do WhatsApp fora do ar: ela está desligada ou a sessão caiu',
        acao: 'suba a ponte de novo e, se ela mostrar um QR, leia com o celular (ponte/README.md)',
        ultimaMensagem: ultima,
      };
    }
  },

  buscar(q) {
    const lista = diretorio();
    if (!q) return lista.sort((a, b) => b.recencia - a.recencia).slice(0, 15).map(({ recencia, ...r }) => r);
    // número digitado de qualquer jeito ("+55 11 99999-0001", "9999-0001"): casa pelos 8 últimos dígitos,
    // que são os mesmos com e sem o nono
    const dig = String(q).replace(/\D/g, '');
    const final = /^[\d\s()+.-]+$/.test(String(q).trim()) && dig.length >= 8 ? dig.slice(-8) : null;
    const pelos = (x) => (x.id.startsWith(q) || (final && x.id.split('@')[0].endsWith(final)) ? 90 : 0);
    const res = decidir(lista.map((x) => ({ ...x, score: Math.max(pontuar(x.nome, q), pelos(x)) })));
    return res.destino ? [res.destino] : res.candidatos;
  },

  resolver(para) {
    const s = String(para || '').trim();
    if (!s) return { candidatos: [] };
    if (s.includes('@')) return { destino: { id: s, nome: nomeDe(s), tipo: tipoDe(s) } };
    const fone = telefone(s);
    if (fone) {
      // vale o contato que existe (agenda ou conversa), com ou sem o nono dígito; fora dos dois o número vai
      // como veio e o linter avisa (conhecido) antes de aprovar
      const contatos = new Map(diretorio().filter((x) => x.tipo === 'contato').map((x) => [x.id.split('@')[0], x]));
      const achado = variantes(fone).map((f) => contatos.get(f)).find(Boolean);
      if (achado) return { destino: { id: achado.id, nome: achado.nome, tipo: 'contato' } };
      const jid = `${fone}@s.whatsapp.net`;
      return { destino: { id: jid, nome: nomeDe(jid), tipo: 'contato' } };
    }
    return decidir(diretorio().map((x) => ({ ...x, score: pontuar(x.nome, s) })));
  },

  // O destino existe no WhatsApp do dono? (conversa na ponte, também só no @lid, ou contato na agenda)
  // null = não deu para ler os bancos da ponte; aí o linter não diz nada
  conhecido(jid) {
    const db = msgs();
    const s = sessao();
    if (!jid || !db || !s) return null;
    const alvo = jidEnvio(jid);
    if (db.prepare('SELECT 1 FROM chats WHERE jid IN (?, ?)').get(alvo, jid)) return true;
    if (s.prepare('SELECT 1 FROM whatsmeow_contacts WHERE their_jid IN (?, ?)').get(alvo, jid)) return true;
    const lid = s.prepare('SELECT lid FROM whatsmeow_lid_map WHERE pn = ?').get(alvo.split('@')[0])?.lid;
    return !!(lid && db.prepare('SELECT 1 FROM chats WHERE jid = ?').get(`${lid}@lid`));
  },

  // Quando a pessoa mandou a última mensagem na conversa direta (telefone e @lid), em ms; null sem nenhuma, em grupo
  // ou sem o banco da ponte. É a fonte do "só depois que ela responder" (src/db.js, conferirRespostas) e do
  // "não respondeu" da aba Acompanhar, que pede grupo (grupo: true) só para mensagem marcada: qualquer um que falou.
  ultimaRecebida(jid, { grupo = false } = {}) {
    const db = msgs();
    if (!db || !jid || (jid.endsWith('@g.us') && !grupo)) return null;
    const jids = jidsDaConversa(jidEnvio(jid));
    const r = db.prepare(`SELECT MAX(timestamp) t FROM messages WHERE chat_jid IN (${jids.map(() => '?').join(',')}) AND is_from_me = 0`).get(...jids);
    return (r?.t && Date.parse(r.t)) || null;
  },

  // --- aba Acompanhar (só leitura) ---
  canonico: (jid) => (jid ? jidEnvio(jid) : jid),
  nome: (jid) => nomeDe(jid),

  // Minhas últimas falas (até `por`) em cada conversa direta desde `desde` (ms), telefone e @lid juntos, da mais nova
  // para a mais velha. aviso: ponte parada ou sem banco (aí não diz nada: ela pode ter respondido).
  minhasRecentes({ desde, por = 5 }) {
    const db = msgs();
    if (!db) return { conversas: [], aviso: 'banco de mensagens da ponte não encontrado' };
    const parada = ponteParada(db);
    if (parada) return { conversas: [], aviso: parada };
    const meus = meusJids();
    const porJid = new Map();
    for (const l of db.prepare(`SELECT id, chat_jid, content, timestamp, media_type FROM messages
        WHERE is_from_me = 1 AND timestamp >= ? AND ${DIRETA} ORDER BY timestamp DESC`).iterate(textoPonte(desde))) {
      const jid = jidEnvio(l.chat_jid);
      if (meus.has(l.chat_jid) || meus.has(jid)) continue;
      if (!porJid.has(jid)) porJid.set(jid, []);
      const minhas = porJid.get(jid);
      if (minhas.length < por) minhas.push({ id: l.id, em: Date.parse(l.timestamp) || 0, texto: l.content || (l.media_type ? `[${l.media_type}]` : '') });
    }
    return { conversas: [...porJid].map(([jid, minhas]) => ({ jid, nome: nomeDe(jid), minhas: minhas.sort((a, b) => b.em - a.em) })), aviso: null };
  },

  // Mensagens de conversa direta (as duas pontas) depois do ponto `depoisDe` (rowid), para a varredura das promessas.
  // Para na primeira mais nova que `ate` (ms), que volta na próxima passada; cursor = até onde leu.
  novasDiretas({ depoisDe = 0, desde, ate }) {
    const db = msgs();
    if (!db) return { linhas: [], cursor: null };
    const max = db.prepare('SELECT MAX(rowid) n FROM messages').get()?.n ?? 0;
    const meus = meusJids();
    const linhas = [];
    let cursor = max;
    // ponto maior que o banco: a ponte recriou o banco, começa de novo (a chave da promessa não duplica)
    for (const l of db.prepare(`SELECT rowid, id, chat_jid, content, timestamp, is_from_me, media_type FROM messages
        WHERE rowid > ? AND rowid <= ? AND timestamp >= ? AND ${DIRETA} ORDER BY rowid`).iterate(depoisDe > max ? 0 : depoisDe, max, textoPonte(desde))) {
      const em = Date.parse(l.timestamp) || 0;
      if (em > ate) { cursor = l.rowid - 1; break; }
      const jid = jidEnvio(l.chat_jid);
      if (!l.content || meus.has(l.chat_jid) || meus.has(jid)) continue;
      linhas.push({ rowid: l.rowid, id: l.id, chat: l.chat_jid, jid, eu: !!l.is_from_me, texto: l.content, em, midia: l.media_type || null });
    }
    return { linhas, cursor };
  },

  // "te mando o contrato" e, em até `ms`, o arquivo, o link ou um texto longo da mesma pessoa: era a entrega
  arquivoLogoDepois(l, ms) {
    const db = msgs();
    if (!db) return false;
    const jids = jidsDaConversa(l.jid);
    return db.prepare(`SELECT content, timestamp, media_type, is_from_me FROM messages
      WHERE rowid > ? AND chat_jid IN (${jids.map(() => '?').join(',')}) ORDER BY rowid LIMIT 5`).all(l.rowid, ...jids)
      .some((x) => {
        const depois = (Date.parse(x.timestamp) || 0) - l.em;
        return !!x.is_from_me === l.eu && depois >= 0 && depois <= ms
          && (!!x.media_type || /https?:\/\/|www\./.test(x.content || '') || String(x.content || '').length >= 200);
      });
  },

  async enviar(m) {
    const { envio, citar } = montar(m);
    // A ponte lê o arquivo pelo caminho. A validação da criação roda de novo (credencial, symlink, conteúdo,
    // 20 MB) e a ponte recebe uma CÓPIA feita do descritor conferido, numa pasta nova só da Central, apagada
    // depois da resposta: trocar o anexo original depois de validar não muda o que sai.
    let copia = null;
    if (envio.media_path) {
      const [a] = validarAnexos([envio.media_path]);
      copia = copiaParaEnvio(a, lerValidado(a));
      envio.media_path = copia.caminho;
    }
    const mencoes = envio.mentions || [];
    let r;
    try {
      r = await fetch(`${cfg.ponte}/api/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bridge-token': ponteToken() },
        body: JSON.stringify(envio),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      throw erroTransitorio(`ponte do WhatsApp fora do ar (${e.cause?.code || e.message})`);
    } finally {
      copia?.apagar();
    }
    const resposta = await r.json().catch(() => ({}));
    if (!r.ok || !resposta.success) {
      const msg = resposta.message || `HTTP ${r.status}`;
      if (/not connected|timeout|websocket/i.test(msg)) throw erroTransitorio(`WhatsApp desconectado: ${msg}`);
      // "no LID found ... from server": o WhatsApp não tem conta nesse número (dígito errado, quase sempre)
      if (/no LID found/i.test(msg)) throw new Error(`número sem WhatsApp: ${envio.recipient.split('@')[0]} não tem conta, confira os dígitos (ponte: ${msg})`);
      throw new Error(`ponte recusou: ${msg}`);
    }
    return {
      resumo: `enviada para ${m.destino_nome || envio.recipient}`
        + (citar ? ', citando a mensagem dele' : '')
        + (mencoes.length ? `, marcando ${mencoes.length} pessoa(s)` : ''),
      para: envio.recipient,
      mencoes,
    };
  },

  // Tudo o que sai em texto, do mesmo montar() do envio, para o linter (src/lint.js): o corpo já com as
  // menções trocadas, o texto citado (a citação automática também) e o nome do anexo que vai (só o primeiro)
  saida(m) {
    const { envio } = montar(m);
    return [
      { texto: envio.message, onde: 'no texto', nome: 'texto' },
      ...(envio.reply_to_text ? [{ texto: envio.reply_to_text, onde: 'na citação', nome: 'citação' }] : []),
      ...(envio.media_path ? [{ texto: path.basename(envio.media_path), onde: 'no nome do anexo', nome: 'nome do anexo' }] : []),
    ];
  },

  // a mensagem como vai sair: corpo final, quem é marcado, o que é citado, anexos e as últimas falas da conversa
  previa(m) {
    const { envio, citar, automatica, marcados, gente } = montar(m);
    const grupo = envio.recipient.endsWith('@g.us');
    const pessoa = ({ jid, numero, nome }) => ({ jid, numero, nome });
    return {
      canal: 'whatsapp',
      para: {
        id: envio.recipient,
        nome: m.destino_nome || nomeDe(envio.recipient),
        tipo: tipoDe(envio.recipient),
        ...(grupo ? { participantes: [...new Map(gente.map((g) => [g.jid, pessoa(g)])).values()] } : {}),
      },
      corpo: envio.message,
      mencoes: marcados.map(pessoa),
      citar: citar ? {
        id: citar.id,
        sender: citar.sender || '',
        de: citar.de || nomeDoRemetente(citar.sender),
        texto: envio.reply_to_text,
        automatica,
      } : null,
      anexos: (Array.isArray(m.anexos) ? m.anexos : []).map((c, i) => ({ ...infoAnexo(c, i, m.id), enviado: i === 0 })),
      contexto: conversaRecente(envio.recipient, 6),
    };
  },

  // O que já rolou com este destino, para não oferecer mensagem que o dono já mandou na mão.
  // Se a ponte está desligada, o histórico está parado: devolve isso em vez de fingir que não há nada.
  contexto(destinoId) {
    const db = msgs();
    if (!db) return { confiavel: false, motivo: 'banco de mensagens da ponte não encontrado' };
    const ultimaGeral = db.prepare('SELECT MAX(timestamp) t FROM messages').get()?.t;
    const paradoDesde = ultimaGeral && Date.now() - Date.parse(ultimaGeral) > 12 * 3600e3 ? ultimaGeral : null;
    const jids = [destinoId];
    const user = destinoId.split('@')[0];
    if (destinoId.endsWith('@s.whatsapp.net')) {
      const lid = sessao()?.prepare('SELECT lid FROM whatsmeow_lid_map WHERE pn = ?').get(user)?.lid;
      if (lid) jids.push(`${lid}@lid`);
    }
    const minha = db.prepare(`SELECT content, timestamp, media_type FROM messages
      WHERE chat_jid IN (${jids.map(() => '?').join(',')}) AND is_from_me = 1 ORDER BY timestamp DESC LIMIT 1`).get(...jids);
    const minhasUltimas = db.prepare(`SELECT content, timestamp FROM messages
      WHERE chat_jid IN (${jids.map(() => '?').join(',')}) AND is_from_me = 1 AND content IS NOT NULL AND length(content) > 20
      ORDER BY timestamp DESC LIMIT 8`).all(...jids).map((x) => ({ em: Date.parse(x.timestamp), texto: x.content }));
    const dele = db.prepare(`SELECT content, timestamp, media_type FROM messages
      WHERE chat_jid IN (${jids.map(() => '?').join(',')}) AND is_from_me = 0 ORDER BY timestamp DESC LIMIT 1`).get(...jids);
    return {
      confiavel: !paradoDesde,
      motivo: paradoDesde ? `a ponte do WhatsApp está desligada: o histórico parou em ${String(paradoDesde).slice(0, 16)}` : null,
      minhaUltima: minha ? { em: Date.parse(minha.timestamp), texto: minha.content || `[${minha.media_type || 'mídia'}]` } : null,
      minhasUltimas,
      deleUltima: dele ? { em: Date.parse(dele.timestamp), texto: dele.content || `[${dele.media_type || 'mídia'}]` } : null,
    };
  },

  // O que chegou desde a minha última fala, agrupado POR CONVERSA (não por mensagem):
  // várias mensagens seguidas da mesma pessoa viram um item só, com o texto inteiro.
  entrada({ dias = 7, limite = 30 } = {}) {
    const db = msgs();
    if (!db) return [];
    const desde = new Date(Date.now() - dias * 86400e3).toISOString().replace('T', ' ').slice(0, 19);
    const chats = db.prepare(`SELECT jid, name, last_message_time FROM chats WHERE last_message_time > ?
      ORDER BY last_message_time DESC LIMIT 120`).all(desde);
    const ultimas = db.prepare(`SELECT id, sender, content, timestamp, is_from_me, media_type FROM messages
      WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT 20`);
    const meu = meuNumero();
    const itens = [];
    const vistos = new Set();
    for (const c of chats) {
      if (/@(broadcast|newsletter)$/.test(c.jid)) continue; // status e canais não são conversa
      const destinoJid = jidEnvio(c.jid); // junta a conversa @lid com a do telefone
      if (vistos.has(destinoJid)) continue;
      vistos.add(destinoJid);
      const linhas = ultimas.all(c.jid);
      if (!linhas.length || linhas[0].is_from_me) continue; // já respondi
      // tudo que chegou depois da minha última fala
      const novas = [];
      let minhaUltimaEm = 0;
      for (const l of linhas) {
        if (l.is_from_me) { minhaUltimaEm = Date.parse(l.timestamp) || 0; break; }
        novas.unshift({
          id: l.id,
          de: tipoDe(c.jid) === 'grupo' ? nomeDoRemetente(l.sender) : nomeDe(c.jid),
          texto: l.content || (l.media_type ? `[${l.media_type}]` : ''),
          em: Date.parse(l.timestamp) || 0,
          sender: l.sender,
        });
      }
      if (!novas.length) continue;
      if (novas.length > 10) novas.splice(0, novas.length - 10); // rajada longa: só as 10 últimas
      const nome = nomeDe(c.jid);
      const grupo = tipoDe(c.jid) === 'grupo';
      const ultima = novas[novas.length - 1];
      itens.push({
        chave: `whatsapp:${destinoJid}:${ultima.em}`,
        canal: 'whatsapp', conta: 'pessoal',
        titulo: nome,
        de: [...new Set(novas.map((n) => n.de))].join(', '),
        texto: novas.map((n) => (grupo ? `${n.de}: ${n.texto}` : n.texto)).join('\n'),
        mensagens: novas,
        // o que a resposta vai citar: a última mensagem que ele mandou
        citar: ultima.id ? { id: ultima.id, sender: ultima.sender || destinoJid, texto: ultima.texto, de: ultima.de } : null,
        em: ultima.em,
        destino: { id: destinoJid, nome, tipo: tipoDe(destinoJid) },
        ...relevancia({ grupo, novas, minhaUltimaEm, meu, jid: destinoJid }),
      });
      if (itens.length >= limite) break;
    }
    return itens;
  },

  // últimas mensagens de uma conversa, para a sessão ler sem print
  ler(chat, n = 30) {
    const db = msgs();
    if (!db) throw new Error('banco de mensagens da ponte não encontrado');
    const r = this.resolver(chat);
    if (!r.destino) return { candidatos: r.candidatos };
    const jid = r.destino.id;
    const alternativos = [jid];
    const user = jid.split('@')[0];
    if (jid.endsWith('@s.whatsapp.net')) {
      const lid = sessao()?.prepare('SELECT lid FROM whatsmeow_lid_map WHERE pn = ?').get(user)?.lid;
      if (lid) alternativos.push(`${lid}@lid`);
    } else if (jid.endsWith('@lid')) {
      const pn = sessao()?.prepare('SELECT pn FROM whatsmeow_lid_map WHERE lid = ?').get(user)?.pn;
      if (pn) alternativos.push(`${pn}@s.whatsapp.net`);
    }
    const linhas = db.prepare(`SELECT sender, content, timestamp, is_from_me, media_type FROM messages
      WHERE chat_jid IN (${alternativos.map(() => '?').join(',')}) ORDER BY timestamp DESC LIMIT ?`).all(...alternativos, Number(n));
    const cacheNomes = new Map();
    const autor = (sender) => {
      if (!sender) return '?';
      if (!cacheNomes.has(sender)) cacheNomes.set(sender, nomeDe(sender.includes('@') ? sender : `${sender}@s.whatsapp.net`));
      return cacheNomes.get(sender);
    };
    const ultimaGeral = db.prepare('SELECT MAX(timestamp) t FROM messages').get()?.t;
    const parado = ultimaGeral && Date.now() - Date.parse(ultimaGeral) > 24 * 3600e3;
    return {
      conversa: r.destino,
      mensagens: linhas.reverse().map((l) => ({
        em: l.timestamp,
        de: l.is_from_me ? eu() : autor(l.sender),
        eu: !!l.is_from_me,
        texto: l.content || (l.media_type ? `[${l.media_type}]` : ''),
      })),
      aviso: parado ? `histórico desatualizado: a ponte não grava nada desde ${String(ultimaGeral).slice(0, 16)}` : undefined,
    };
  },
};
