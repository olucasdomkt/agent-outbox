// "Acompanhar a resposta": se a pessoa não responder no prazo depois que a mensagem sair, ela entra na aba Acompanhar.
// Só WhatsApp (é de lá que a Central lê a resposta); ligar ou mudar não devolve a aprovada para revisão.
import { acompanharResposta } from '../lib/acoes';
import { dados, useSel } from '../lib/loja';
import type { Mensagem } from '../lib/tipos';

const PRAZOS = [24, 48, 72];

export function ControleAcompanhar({ m: aberta }: { m: Mensagem }) {
  // a linha viva da loja: no celular quem abre guarda a mensagem do momento do toque
  const m = useSel(dados, (e) => e.msgs[aberta.id]) || aberta;
  if (m.canal !== 'whatsapp' || m.status === 'descartada' || m.status === 'substituida') return null;
  const horas = m.acompanhar ?? null;
  const quem = m.destino_tipo === 'grupo' || m.destino_id?.endsWith('@g.us') ? 'ninguém do grupo' : (m.destino_nome || 'a pessoa').split(' ')[0];
  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-2 text-ui">
        <input
          type="checkbox"
          className="mt-0.5 size-4 flex-none accent-[var(--accent)]"
          checked={!!horas}
          onChange={(ev) => void acompanharResposta(m.id, ev.target.checked ? 24 : null)}
        />
        <span>Avisar no Acompanhar se {quem} não responder</span>
      </label>
      {horas ? (
        <div className="ml-6 flex flex-wrap items-center gap-1.5 text-meta text-tx-2" role="group" aria-label="Em quanto tempo sem resposta">
          em
          {PRAZOS.map((h) => (
            <button key={h} type="button" aria-pressed={horas === h} className={`btn btn-pequeno ${horas === h ? '' : 'btn-fantasma'}`} onClick={() => void acompanharResposta(m.id, h)}>
              {h} h
            </button>
          ))}
          {!PRAZOS.includes(horas) && <span className="font-semibold text-tx">{horas} h</span>}
        </div>
      ) : null}
    </div>
  );
}
