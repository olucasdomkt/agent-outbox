// Chegou | Acompanhar: as duas abas da Entrada (o que espera você e o que você espera), com o contador de cada uma.
import { irPara } from '../lib/acoes';
import { dados, ui, useSel } from '../lib/loja';
import { numero } from '../lib/formato';

export function TrocaEntrada({ celular = false }: { celular?: boolean }) {
  const vista = useSel(ui, (e) => e.vista);
  const chegou = useSel(dados, (e) => e.entradaContagem?.precisa ?? 0);
  const parado = useSel(dados, (e) => e.acompanharContagem?.total ?? 0);
  return (
    <div className="flex border-b border-line" role="tablist" aria-label="Entrada">
      {([['entrada', 'Chegou', chegou], ['acompanhar', 'Acompanhar', parado]] as const).map(([v, rotulo, n]) => {
        const ativa = vista === v;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={ativa}
            onClick={() => irPara(v)}
            className={`relative flex items-center justify-center gap-1.5 px-2.5 pt-1 pb-2 text-ui font-semibold ${celular ? 'min-h-11 flex-1' : ''} ${ativa ? 'text-tx' : 'text-tx-3 hover:text-tx'}`}
          >
            {rotulo}
            {n ? <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-meta leading-none font-bold tabular ${ativa ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-tx-2'}`}>{numero(n)}</span> : null}
            {ativa && <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}
