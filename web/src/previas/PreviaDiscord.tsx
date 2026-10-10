// Discord: markdown renderizado, canal com # ou conversa privada, e o corte de 2.000 caracteres à mostra.
import { AtSign, Bot, Hash } from 'lucide-react';
import { TextoDiscord } from '../lib/discord';
import { hhmm } from '../lib/formato';
import { useAgora } from '../lib/tempo';
import { fatiar } from './local';
import type { Mensagem, PreviaDiscord as P } from '../lib/tipos';

export function PreviaDiscord({ m, previa, corpo }: { m: Mensagem; previa: P; corpo?: string }) {
  const agora = useAgora(30_000);
  const partes = corpo !== undefined ? fatiar(corpo) : previa.partes?.length ? previa.partes : fatiar(previa.corpo ?? m.corpo);
  const alvo = previa.alvo || { id: m.destino_id || '', nome: '', tipo: 'canal' as const };
  const dm = alvo.tipo === 'dm' || String(alvo.id).startsWith('dm:');
  const quando = m.status === 'enviada' && m.enviado_em ? m.enviado_em : agora;
  const hora = `Hoje às ${hhmm(quando)}`;
  const nome = (alvo.nome || m.destino_nome || 'destino a escolher').replace(/^#/, '');
  return (
    <div className="dc" aria-label={`Prévia no Discord para ${nome}`}>
      <div className="dc-topo">
        {dm ? <AtSign size={20} strokeWidth={2} className="text-[var(--dc-meta)]" aria-hidden /> : <Hash size={20} strokeWidth={2} className="text-[var(--dc-meta)]" aria-hidden />}
        <span className="truncate">{nome}</span>
        <span className="servidor">{dm ? 'Mensagem privada' : alvo.servidor || 'Servidor'}</span>
      </div>
      <div className="dc-corpo">
        <div className="dc-msg">
          <span className="dc-avatar" aria-hidden><Bot size={20} strokeWidth={2} /></span>
          <div className="min-w-0">
            <div className="dc-cab">
              <span className="dc-nome">{previa.bot?.nome || 'Bot'}</span>
              <span className="dc-app">APP</span>
              <span className="dc-hora">{hora}</span>
            </div>
            <TextoDiscord texto={partes[0] || ''} />
          </div>
        </div>
        {partes.slice(1).map((p, i) => (
          <div key={i}>
            <div className="dc-corte" role="separator">o Discord corta aqui: parte {i + 2} de {partes.length}</div>
            <div className="dc-parte">
              <span className="dc-parte-n tabular">{hhmm(quando)}</span>
              <TextoDiscord texto={p} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
