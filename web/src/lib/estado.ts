// Como cada estado aparece (spec, seção 3): "aprovada" e "entregue" nunca se parecem.
import { NOME_MOTIVO } from './motivos';
import { ha, quando, regressiva } from './formato';
import { esperaDe } from './ordem';
import type { Mensagem } from './tipos';

export type Tom = 'neutro' | 'acento' | 'aviso' | 'perigo' | 'ok';
export type IconeEstado = 'revisar' | 'janela' | 'agendada' | 'fila' | 'espera' | 'tentativa' | 'enviando' | 'entregue' | 'erro' | 'descartada' | 'versao';

export interface Estado { texto: string; tom: Tom; icone: IconeEstado }

export function estadoDe(m: Mensagem, agora = Date.now()): Estado {
  switch (m.status) {
    case 'pendente':
      return m.agendar_para && m.agendar_para > agora
        ? { texto: `Para revisar, sai ${quando(m.agendar_para, agora)} quando aprovar`, tom: 'neutro', icone: 'revisar' }
        : { texto: 'Para revisar', tom: 'neutro', icone: 'revisar' };
    case 'aprovada': {
      // esperar outra mensagem vem antes de qualquer horário: enquanto espera, nada sai
      const espera = esperaDe(m);
      if (espera) return { texto: espera.aprovada, tom: espera.motivo === 'bloqueada' ? 'perigo' : 'acento', icone: espera.motivo === 'bloqueada' ? 'erro' : 'espera' };
      if (m.liberar_em && m.liberar_em > agora) return { texto: `Aprovada, sai em ${regressiva(m.liberar_em - agora)}`, tom: 'acento', icone: 'janela' };
      if (m.agendar_para && m.agendar_para > agora) return { texto: `Agendada para ${quando(m.agendar_para, agora)}`, tom: 'acento', icone: 'agendada' };
      if (m.proxima_tentativa && m.proxima_tentativa > agora) {
        return { texto: `Nova tentativa ${quando(m.proxima_tentativa, agora)}${m.tentativas ? ` (${m.tentativas + 1}ª)` : ''}`, tom: 'aviso', icone: 'tentativa' };
      }
      return { texto: 'Na fila, sai no próximo intervalo', tom: 'acento', icone: 'fila' };
    }
    case 'enviando':
      return { texto: 'Enviando agora', tom: 'acento', icone: 'enviando' };
    case 'enviada':
      return { texto: m.enviado_em ? `Entregue ${ha(m.enviado_em, agora)}` : 'Entregue', tom: 'ok', icone: 'entregue' };
    case 'erro':
      return { texto: 'Não saiu', tom: 'perigo', icone: 'erro' };
    case 'descartada':
      return { texto: m.motivo_codigo ? `Descartada: ${NOME_MOTIVO[m.motivo_codigo].toLowerCase()}` : m.motivo ? `Descartada: ${m.motivo}` : 'Descartada sem motivo', tom: 'neutro', icone: 'descartada' };
    case 'substituida':
      return { texto: 'Substituída por uma versão nova', tom: 'neutro', icone: 'versao' };
  }
}

// erro técnico em português de gente: o que houve e o que fazer
export function explicarErroEnvio(m: Mensagem): { oque: string; fazer: string } {
  const e = String(m.ultimo_erro || '').toLowerCase();
  // a ponte respondeu, o número é que não tem conta: quase sempre um dígito errado
  if (/sem whatsapp|no lid found/.test(e)) {
    return { oque: 'Esse número não tem WhatsApp.', fazer: 'Confira os dígitos (com e sem o 9 depois do DDD): troque o destino pelo contato certo e tente de novo.' };
  }
  if (/econnrefused|fora do ar|desconectad|bridge|8080|fetch failed/.test(e)) {
    return { oque: 'A ponte do WhatsApp não respondeu.', fazer: 'Veja em Ajustes se o WhatsApp está no ar e tente de novo.' };
  }
  if (/ponte recusou/.test(e)) {
    return { oque: 'O WhatsApp recusou o envio.', fazer: 'O motivo técnico está abaixo. Se for o destino, troque e tente de novo.' };
  }
  if (/logar|login|auth|token|401|403|invalid_grant/.test(e)) {
    return { oque: 'A conta precisa entrar de novo.', fazer: 'Refaça o login da conta e tente de novo.' };
  }
  if (/interromp|timeout|tempo/.test(e)) {
    return { oque: 'O envio foi interrompido no meio.', fazer: 'Confira na conversa se chegou antes de tentar de novo, para não mandar duas vezes.' };
  }
  if (/destino|not found|404|chat/.test(e)) {
    return { oque: 'O destino não foi encontrado.', fazer: 'Troque o destino e tente de novo.' };
  }
  return { oque: m.ultimo_erro || 'O canal recusou sem dizer o motivo.', fazer: 'Tente de novo. Se falhar outra vez, veja a saúde do canal.' };
}
