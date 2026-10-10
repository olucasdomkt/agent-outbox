// Saúde da cópia de segurança, para quem tem um script de cópia: a Central não copia nada, só lê o estado que o
// script grava em ~/.central-mensagens/copia-estado.json (ou no caminho de CENTRAL_BACKUP_ESTADO):
//   { "quando": ms, "ok": true|false, "erro": "texto", "seco": false, "ultimo_ok": ms }
// quando, ok e erro são da última execução; seco = execução de teste, que não conta: vale o último ok de verdade,
// que o script guarda à parte em ultimo_ok. Sem o arquivo, a cópia aparece como "ainda não ligada".
import fs from 'node:fs';

const LIMITE_MS = 36 * 3600e3; // cópia diária: 36 h sem ok = ficou um dia para trás
const SP = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// "hoje 03h41", "ontem 03h41" ou "04/10 03h41", no fuso de São Paulo
export function quandoSP(ms, agora = Date.now()) {
  const p = (t) => Object.fromEntries(SP.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const dia = (x) => `${x.day}/${x.month}`;
  const a = p(ms);
  const hora = `${a.hour}h${a.minute}`;
  if (dia(a) === dia(p(agora))) return `hoje ${hora}`;
  if (dia(a) === dia(p(agora - 864e5))) return `ontem ${hora}`;
  return `${dia(a)} ${hora}`;
}

// estado: ok | falhou | atrasada | desligada. aviso = merece atenção (falhou ou atrasou).
export function saudeDaCopia(arquivo, agora = Date.now()) {
  const desligada = { estado: 'desligada', ok: true, aviso: false, resumo: 'Cópia de segurança: ainda não ligada' };
  const falhou = (detalhe, extra = {}) => ({ estado: 'falhou', ok: false, aviso: true, resumo: `Cópia de segurança: ${detalhe}`, ...extra });
  try {
    let e;
    try {
      e = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return desligada;
      throw err;
    }
    const ultimoOk = Number(e?.ultimo_ok) || null;
    if (e && !e.seco && e.ok === false) {
      const erro = String(e.erro || 'sem detalhe').slice(0, 200);
      return falhou(`falhou${e.quando ? ` ${quandoSP(e.quando, agora)}` : ''}: ${erro}`, { erro, quando: e.quando ?? null, ultimoOk });
    }
    if (!ultimoOk) return desligada;
    if (agora - ultimoOk > LIMITE_MS) {
      return { estado: 'atrasada', ok: false, aviso: true, resumo: `Cópia de segurança: a última que deu certo foi ${quandoSP(ultimoOk, agora)} (mais de 36 h)`, ultimoOk };
    }
    return { estado: 'ok', ok: true, aviso: false, resumo: `Cópia de segurança: ${quandoSP(ultimoOk, agora)}`, ultimoOk };
  } catch (err) {
    return falhou('não consegui ler o estado da cópia', { erro: err.message });
  }
}
