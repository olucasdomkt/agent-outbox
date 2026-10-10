// Foto de perfil do WhatsApp no painel. A ponte diz onde está a miniatura (GET /api/avatar; a URL expira), a
// Central baixa e guarda em <dados>/fotos/whatsapp/<jid>.jpg. Quem não tem foto, ou esconde, fica marcado por um
// dia em <jid>.sem, para a mesma pergunta não se repetir a cada tela. Uma consulta por vez e com intervalo: quem
// pergunta ao WhatsApp é a conta pessoal do dono.
import fs from 'node:fs';
import path from 'node:path';
import { ponteToken } from './config.js';

// contato (número), conversa de número escondido (@lid) e grupo (o novo é só dígitos; o antigo, criador-quando)
export const JID_COM_FOTO = /^\d{5,25}(?:-\d{5,15})?@(?:s\.whatsapp\.net|lid|g\.us)$/;
const VALE_MS = 7 * 24 * 3600e3; // foto guardada: depois disso renova por trás (a guardada continua valendo)
const SEM_FOTO_MS = 24 * 3600e3; // "não tem foto": pergunta de novo no dia seguinte
const ERRO_MS = 5 * 60e3; // ponte fora do ar ou download que falhou: tenta de novo em 5 min
const MAX_BYTES = 512 * 1024; // a miniatura tem de 2 a 4 KB
const MAX_FILA = 300;
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

export function criarFotos({ dir, ponte, rede = (...a) => fetch(...a), agora = () => Date.now(), intervaloMs = 400 }) {
  const emCurso = new Map(); // jid → promessa da busca
  const erros = new Map(); // jid → até quando não tentar de novo
  let fila = Promise.resolve();

  const arquivo = (jid, ext) => path.join(dir, `${jid}.${ext}`);
  const idade = (p) => { try { return agora() - fs.statSync(p).mtimeMs; } catch { return null; } };
  // grava num arquivo novo e troca o nome: quem lê nunca pega pela metade e link no caminho não é seguido.
  // A data do arquivo é o "quando perguntei", pelo mesmo relógio que mede a validade.
  const gravar = (final, bytes) => {
    const tmp = `${final}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    try {
      fs.writeFileSync(tmp, bytes, { flag: 'wx', mode: 0o600 });
      const t = new Date(agora());
      fs.utimesSync(tmp, t, t);
      fs.renameSync(tmp, final);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  };

  async function buscar(jid) {
    const r = await rede(`${ponte}/api/avatar?jid=${encodeURIComponent(jid)}`, { headers: { 'x-bridge-token': ponteToken() }, signal: AbortSignal.timeout(20e3) });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.success) throw new Error(d?.message || `a ponte respondeu ${r.status}`);
    fs.mkdirSync(dir, { recursive: true });
    if (!d.found) {
      fs.rmSync(arquivo(jid, 'jpg'), { force: true }); // tirou a foto: a antiga some
      gravar(arquivo(jid, 'sem'), '');
      return;
    }
    // a URL vem de fora: só o CDN do WhatsApp, por https e sem seguir redirecionamento
    const url = new URL(d.url);
    if (url.protocol !== 'https:' || !/(^|\.)whatsapp\.net$/.test(url.hostname)) throw new Error(`foto fora do WhatsApp (${url.hostname})`);
    const img = await rede(url.href, { redirect: 'error', signal: AbortSignal.timeout(15e3) });
    if (!img.ok) throw new Error(`o WhatsApp respondeu ${img.status} na foto`);
    const pedacos = [];
    let total = 0;
    for await (const p of img.body) {
      total += p.length;
      if (total > MAX_BYTES) throw new Error('foto grande demais');
      pedacos.push(p);
    }
    const bytes = Buffer.concat(pedacos);
    if (!bytes.subarray(0, 3).equals(JPEG)) throw new Error('a foto não é JPEG');
    gravar(arquivo(jid, 'jpg'), bytes);
    fs.rmSync(arquivo(jid, 'sem'), { force: true });
  }

  // a busca deste jid (a mesma promessa para quem pedir de novo no meio); null = fila cheia
  function enfileirar(jid) {
    if (emCurso.has(jid)) return emCurso.get(jid);
    if (emCurso.size >= MAX_FILA) return null;
    const tarefa = fila.then(() => buscar(jid)).then(
      () => { erros.delete(jid); },
      (e) => {
        erros.set(jid, agora() + ERRO_MS);
        console.error(`[fotos] ${jid.replace(/^\d+(?=\d{4})/, '…')}: ${e.message}`);
      },
    );
    fila = tarefa.then(() => new Promise((ok) => { setTimeout(ok, intervaloMs); }));
    const p = tarefa.finally(() => emCurso.delete(jid));
    emCurso.set(jid, p);
    return p;
  }

  // O que há agora, sem esperar a rede:
  //   { estado: 'tem', arquivo }        foto guardada (se passou de 7 dias, renova por trás)
  //   { estado: 'sem' }                 perguntou e não tem (vale 1 dia); com incerto = não deu para perguntar
  //   { estado: 'buscando', pronto }    perguntando agora; `pronto` resolve quando terminar, com ou sem foto
  function estado(jid) {
    const falhouHaPouco = (erros.get(jid) || 0) > agora();
    const foto = idade(arquivo(jid, 'jpg'));
    if (foto != null) {
      if (foto > VALE_MS && !falhouHaPouco) enfileirar(jid);
      return { estado: 'tem', arquivo: arquivo(jid, 'jpg') };
    }
    const sem = idade(arquivo(jid, 'sem'));
    if (sem != null && sem < SEM_FOTO_MS) return { estado: 'sem' };
    if (falhouHaPouco) return { estado: 'sem', incerto: true };
    const pronto = enfileirar(jid);
    return pronto ? { estado: 'buscando', pronto } : { estado: 'sem', incerto: true };
  }

  // Para a rota: com a fila curta espera um instante (uma consulta leva uns 300 ms), senão responde "buscando"
  // na hora. Pedido de imagem preso segura uma das poucas conexões do navegador com a Central.
  async function foto(jid, { esperarMs = 0 } = {}) {
    if (!JID_COM_FOTO.test(jid)) return { estado: 'invalido' };
    const e = estado(jid);
    if (e.estado !== 'buscando' || esperarMs <= 0 || emCurso.size > 3) return e;
    let relogio;
    await Promise.race([e.pronto, new Promise((ok) => { relogio = setTimeout(ok, esperarMs); })]);
    clearTimeout(relogio);
    return estado(jid);
  }

  return { foto, quieta: () => fila };
}
