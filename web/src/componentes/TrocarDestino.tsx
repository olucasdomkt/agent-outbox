// Busca de destino (grupo, contato, canal ou e-mail) para trocar o destino de uma mensagem.
import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { TIPO_DESTINO } from '../lib/canais';
import type { Destino, Mensagem } from '../lib/tipos';
import { Foto } from './ui';

// no celular o campo não ganha foco sozinho: o teclado subiria por cima da prévia antes de a pessoa decidir
export function TrocarDestino({ m, onEscolher, onFechar, autoFoco = true }: { m: Mensagem; onEscolher: (d: Destino) => void; onFechar: () => void; autoFoco?: boolean }) {
  const [q, setQ] = useState(m.para_pedido || '');
  const [lista, setLista] = useState<Destino[] | null>(m.candidatos || null);
  const [ativo, setAtivo] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const idLista = useId();

  useEffect(() => { if (autoFoco) { campo.current?.focus(); campo.current?.select(); } }, [autoFoco]);
  useEffect(() => {
    if (!q.trim()) return;
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await api.destinos(m.canal, q.trim(), m.conta);
        if (!ctl.signal.aborted) { setLista(r); setAtivo(0); }
      } catch { if (!ctl.signal.aborted) setLista([]); }
      finally { if (!ctl.signal.aborted) setBuscando(false); }
    }, 220);
    return () => { ctl.abort(); window.clearTimeout(t); };
  }, [q, m.canal, m.conta]);

  const opcoes = lista || [];
  const email = m.canal === 'email' && /@.+\./.test(q.trim());
  return (
    <div className="mt-2 rounded-item border border-line bg-surface p-2" role="group" aria-label="Trocar o destino">
      <label className="relative block">
        <Search size={15} strokeWidth={2} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-tx-3" aria-hidden />
        <input
          ref={campo}
          className="campo h-9 pl-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={m.canal === 'email' ? 'Nome ou e-mail' : 'Grupo, contato ou canal'}
          aria-label="Procurar destino"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={opcoes.length > 0}
          aria-controls={idLista}
          aria-activedescendant={opcoes[ativo] ? `${idLista}-${ativo}` : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFechar(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((a) => Math.min(opcoes.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (opcoes[ativo]) onEscolher(opcoes[ativo]);
              else if (email) onEscolher({ id: q.trim(), nome: q.trim(), tipo: 'email' });
            }
          }}
        />
      </label>
      {opcoes.length > 0 && (
      <ul id={idLista} className="mt-1.5 max-h-60 overflow-y-auto" role="listbox" aria-label="Destinos encontrados">
        {opcoes.map((d, i) => (
          <li key={d.id} role="presentation">
            <button
              type="button"
              id={`${idLista}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === ativo}
              className={`flex w-full items-center gap-2.5 rounded-botao px-2.5 py-1.5 text-left ${i === ativo ? 'bg-accent-soft' : 'hover:bg-surface-2'}`}
              onMouseEnter={() => setAtivo(i)}
              onClick={() => onEscolher(d)}
            >
              {m.canal === 'whatsapp' && <Foto jid={d.id} nome={d.nome} grupo={d.tipo === 'grupo'} tamanho={32} />}
              <span className="flex min-w-0 flex-col items-start">
                <span className="font-semibold">{d.nome}</span>
                <span className="text-meta text-tx-3">{[d.tipo ? TIPO_DESTINO[d.tipo] || d.tipo : null, d.detalhe?.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2')].filter(Boolean).join(', ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      )}
      {!opcoes.length && (
        <p className="px-2.5 pt-2 pb-1 text-meta text-tx-3" role="status">
          {buscando ? 'Procurando…' : email ? `Enter usa ${q.trim()}` : q.trim() ? 'Nada com esse nome.' : 'Digite para procurar.'}
        </p>
      )}
    </div>
  );
}
