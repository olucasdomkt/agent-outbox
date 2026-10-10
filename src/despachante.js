// Despachante: a cada tick pega UMA mensagem aprovada cuja hora chegou e envia pelo canal.
// "Hora chegou" = janela de desfazer vencida (liberar_em) e horário agendado (se houver).
// Respeita a pausa geral, o intervalo entre envios de cada canal (anti-ban do WhatsApp)
// e o teto diário. Falha de conexão volta para a fila; falha definitiva vira "erro".
// Antes de enviar, o linter confere de novo o texto relido do banco (última trava contra segredo).
// Mensagem que sai depois de outra só é pega quando a anterior saiu (e a pessoa respondeu, se pedido).
import { notificar } from './notificar.js';

const inicioDoDia = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

// agora: relógio injetável (o mesmo do repo nos testes da janela de desfazer)
// conferir: o linter completo, obrigatório (o servidor passa o mesmo do aprovar: cofre, diretório, anexos).
// Despachante sem linter não sobe: não existe envio sem a última conferência.
// respostas: de onde vem a resposta da pessoa para o "só depois que ela responder" (o servidor passa a ponte do
// WhatsApp; os testes, uma fonte falsa). Sem ela, quem espera resposta fica esperando.
// aoEnviar: chamado com a mensagem que acabou de sair (o servidor procura promessa nela, para a aba Acompanhar).
export function iniciarDespachante({ repo, canais, config, log = console.log, agora = Date.now, conferir, respostas = null, aoEnviar = null }) {
  if (typeof conferir !== 'function') throw new Error('despachante sem conferir: passe o linter do servidor');
  const liberadoEm = {}; // canal -> timestamp a partir do qual pode enviar de novo
  let ocupado = false;

  // Cofre fora do ar volta para a fila (tenta de novo); segredo achado vira erro e não sai.
  async function barrarNoEnvio(m) {
    let r;
    try {
      r = await conferir(m);
    } catch (e) {
      r = { bloqueios: [{ regra: 'segredo', msg: `não consegui verificar segredos: ${e.message}`, naoChecou: true }], avisos: [] };
    }
    if (!r.bloqueios.length) return false;
    const motivo = `barrada pelo linter na hora de enviar: ${r.bloqueios.map((b) => b.msg).join('; ')}`;
    repo.salvarLint(m.id, r);
    const res = repo.marcarFalha(m.id, motivo, {
      transitorio: r.bloqueios.every((b) => b.naoChecou), janelaMs: config.retentarPorMin * 60e3,
    });
    log(`[envio] #${m.id} ${m.canal} barrada (${res}): ${motivo}`);
    if (res === 'erro') notificar(`Barrada #${m.id} → ${m.destino_nome}`, motivo);
    return true;
  }

  async function tick() {
    if (ocupado) return;
    // a pessoa respondeu: libera quem esperava por isso (também com os envios pausados, para o painel mostrar)
    if (respostas) {
      try {
        const ids = repo.conferirRespostas(respostas);
        if (ids.length) log(`[ordem] liberada(s) pela resposta: ${ids.map((i) => `#${i}`).join(', ')}`);
      } catch (e) {
        log('[ordem]', e.message);
      }
    }
    if (repo.getEstado('pausado', false)) return;
    const t = agora();
    const bloqueados = Object.keys(canais).filter((id) => {
      const c = canais[id];
      if ((liberadoEm[id] || 0) > t) return true;
      return c.tetoDia && repo.enviadasDesde(id, inicioDoDia()) >= c.tetoDia;
    });
    const proxima = repo.proximaParaEnviar(t, bloqueados);
    if (!proxima) return;
    // UPDATE condicional: se o dono desfez ou editou neste meio-tempo, não pega
    if (!repo.marcarEnviando(proxima.id)) return;
    // relê depois da trava: sai o texto que está no banco agora, não o lido antes dela
    const m = repo.obter(proxima.id);
    const canal = canais[m.canal];
    if (!canal) { repo.marcarFalha(m.id, `canal desconhecido: ${m.canal}`); return; }
    ocupado = true;
    try {
      if (await barrarNoEnvio(m)) return;
      try {
        const r = await canal.enviar(m);
        repo.marcarEnviada(m.id, r);
        log(`[envio] #${m.id} ${m.canal} → ${m.destino_nome}: ${r.resumo}`);
        try { aoEnviar?.(repo.obter(m.id)); } catch (e) { log('[acompanhar]', e.message); }
      } catch (e) {
        const res = repo.marcarFalha(m.id, e.message, { transitorio: !!e.transitorio, janelaMs: config.retentarPorMin * 60e3 });
        log(`[envio] #${m.id} ${m.canal} falhou (${res}): ${e.message}`);
        if (res === 'erro') notificar(`Falhou #${m.id} → ${m.destino_nome}`, e.message);
      } finally {
        liberadoEm[m.canal] = agora() + (canal?.pausaEntreEnviosMs?.() || 0);
      }
    } finally {
      ocupado = false;
    }
  }

  const timer = setInterval(() => tick().catch((e) => log('[despachante]', e)), config.tickMs);
  return { tick, parar: () => clearInterval(timer) };
}
