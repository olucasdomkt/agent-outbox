// Prévia montada só com a mensagem, para quando /previa ainda não respondeu (ou falhou)
// e para o editor ao vivo. O que só o servidor sabe (contexto, participantes) fica vazio.
import { urlAnexo } from '../lib/api';
import { dados } from '../lib/loja';
import type { AnexoPrevia, Mensagem, Previa } from '../lib/tipos';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf',
  csv: 'text/csv', txt: 'text/plain', html: 'text/html', mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', ogg: 'audio/ogg',
};

export function anexosLocais(m: Mensagem): AnexoPrevia[] {
  return (m.anexos || []).map((caminho, i) => {
    const nome = String(caminho).split('/').pop() || caminho;
    const ext = nome.split('.').pop()?.toLowerCase() || '';
    return { caminho, nome, bytes: 0, mime: MIME[ext] || 'application/octet-stream', url: urlAnexo(m.id, i), enviado: m.canal === 'whatsapp' ? i === 0 : true };
  });
}

export function fatiar(texto: string, max = 1990) {
  if (texto.length <= max) return [texto];
  const partes: string[] = [];
  let atual = '';
  for (const par of texto.split(/\n\n/)) {
    const bloco = atual ? `${atual}\n\n${par}` : par;
    if (bloco.length <= max) { atual = bloco; continue; }
    if (atual) partes.push(atual);
    if (par.length <= max) { atual = par; continue; }
    for (let i = 0; i < par.length; i += max) partes.push(par.slice(i, i + max));
    atual = '';
  }
  if (atual) partes.push(atual);
  return partes;
}

export function previaLocal(m: Mensagem): Previa {
  const anexos = anexosLocais(m);
  if (m.canal === 'whatsapp') {
    return {
      canal: 'whatsapp',
      para: { id: m.destino_id || '', nome: m.destino_nome || m.para_pedido || 'Destino a escolher', tipo: m.destino_tipo === 'grupo' ? 'grupo' : 'contato' },
      corpo: m.corpo, mencoes: [], citar: m.extra?.citar || null, anexos, contexto: [],
    };
  }
  if (m.canal === 'email') {
    const canal = dados.get().resumo?.canais.find((c) => c.id === 'email');
    return {
      canal: 'email',
      conta: { id: m.conta || '', email: canal?.contas.find((c) => c.id === m.conta)?.nome || m.conta || '' },
      para: m.destino_id || m.para_pedido || '', cc: (m.extra?.cc as string) || null, assunto: m.assunto || '', corpo: m.corpo,
      assinatura: dados.get().config?.assinaturas?.[m.conta || ''] || '', thread: [], anexos,
    };
  }
  return {
    canal: 'discord',
    alvo: { id: m.destino_id || '', nome: m.destino_nome || m.para_pedido || '', tipo: String(m.destino_id || '').startsWith('dm:') || m.destino_tipo === 'pessoa' ? 'dm' : 'canal' },
    corpo: m.corpo, partes: fatiar(m.corpo), bot: { nome: 'Bot' },
  };
}
