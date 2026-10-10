// Painéis de decisão em uma tecla: motivo do descarte (1 a 5; 0 ou o botão para sem motivo, que não é o padrão: o
// motivo é o que vira lição para as sessões) e horário do agendamento.
import { useEffect, useRef, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { MOTIVOS } from '../lib/motivos';
import { descartar, agendar } from '../lib/acoes';
import { sugestoesAgendar, paraInputLocal, proximoUtil } from '../lib/horario';
import { api, explicar } from '../lib/api';
import { avisar, dados, gravarMensagens } from '../lib/loja';
import { devolverFoco } from '../lib/foco';
import { quando } from '../lib/formato';
import { Tecla } from './ui';

function useFoco<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return ref;
}

// o painel escuta o teclado da janela inteira enquanto está aberto (mesmo se o foco ficou fora dele)
function useTeclas(fn: (e: KeyboardEvent) => boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (ref.current(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
}

// fecha ao clicar fora
function useFora(ref: React.RefObject<HTMLElement | null>, fechar: () => void) {
  useEffect(() => {
    const f = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) fechar(); };
    const t = window.setTimeout(() => document.addEventListener('pointerdown', f), 0);
    return () => { window.clearTimeout(t); document.removeEventListener('pointerdown', f); };
  }, [ref, fechar]);
}

export function PainelDescartar({ ids, onFechar: fecharPainel, className = '' }: { ids: number[]; onFechar: () => void; className?: string }) {
  const raiz = useFoco<HTMLDivElement>();
  const campo = useRef<HTMLInputElement>(null);
  const [texto, setTexto] = useState('');
  const onFechar = () => { fecharPainel(); devolverFoco(); };
  useFora(raiz, onFechar);
  const fazer = (codigo: (typeof MOTIVOS)[number]['codigo'] | null, livre?: string) => {
    onFechar();
    void descartar(ids, livre ? 'outro' : codigo, livre);
  };
  useTeclas((e) => {
    const noCampo = document.activeElement === campo.current;
    if (e.key === 'Escape') { onFechar(); return true; }
    if (noCampo) {
      // Enter no campo só descarta com o que foi escrito; vazio não descarta
      if (e.key === 'Enter') { const livre = campo.current?.value.trim(); if (livre) fazer(null, livre); return true; }
      return false;
    }
    const m = MOTIVOS.find((x) => x.tecla === e.key);
    if (m) { fazer(m.codigo); return true; }
    if (e.key === '0') { fazer(null); return true; }
    if ((e.key === 'Enter' || e.key === ' ') && (document.activeElement as HTMLElement | null)?.closest('button')) return false;
    if (e.key === 'Enter') return true; // sem motivo não é mais o padrão: Enter sozinho não descarta
    if (e.key === 'Tab') return false;
    if (e.key.length === 1) campo.current?.focus();
    return false;
  });
  return (
    <div
      ref={raiz}
      tabIndex={-1}
      role="dialog"
      aria-label={ids.length > 1 ? `Por que descartar as ${ids.length}?` : 'Por que descartar?'}
      className={`painel-flutuante anima-sobe w-[23rem] max-w-[calc(100vw-2rem)] p-2 outline-none ${className}`}
    >
      <p className="px-2 pt-1 pb-2 font-bold">{ids.length > 1 ? `Por que descartar as ${ids.length}?` : 'Por que descartar?'}</p>
      <ul className="flex flex-col">
        {MOTIVOS.map((m) => (
          <li key={m.codigo}>
            <button type="button" className="flex w-full items-center gap-3 rounded-botao px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => fazer(m.codigo)}>
              <Tecla className="min-w-6">{m.tecla}</Tecla>
              <span className="min-w-0">
                <span className="block font-semibold">{m.nome}</span>
                <span className="block text-meta text-tx-3">{m.dica}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1 border-t border-line px-2 pt-2.5 pb-1">
        <div className="flex gap-2">
          <input
            ref={campo}
            className="campo h-8 min-w-0 flex-1"
            placeholder="Ou escreva o motivo"
            aria-label="Outro motivo"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {texto.trim() ? (
            <button type="button" className="btn btn-pequeno h-8 flex-none" onClick={() => fazer(null, texto.trim())}>Descartar</button>
          ) : (
            <button type="button" className="btn btn-fantasma btn-pequeno h-8 flex-none text-tx-2" onClick={() => fazer(null)}>
              Sem motivo <Tecla>0</Tecla>
            </button>
          )}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-tx-3">
          O motivo vira lição para as sessões <span aria-hidden>·</span> <Tecla>Esc</Tecla> volta
        </p>
      </div>
    </div>
  );
}

export function PainelAgendar({ id, onFechar: fecharPainel, className = '' }: { id: number; onFechar: () => void; className?: string }) {
  const raiz = useFoco<HTMLDivElement>();
  const onFechar = () => { fecharPainel(); devolverFoco(); };
  const m = dados.get().msgs[id];
  const agora = Date.now();
  const sugestoes = sugestoesAgendar(agora);
  const [livre, setLivre] = useState(paraInputLocal(m?.agendar_para && m.agendar_para > agora ? m.agendar_para : proximoUtil(agora)));
  useFora(raiz, onFechar);
  useTeclas((e) => {
    if (e.key === 'Escape') { onFechar(); return true; }
    if ((document.activeElement as HTMLElement | null)?.tagName === 'INPUT') return false;
    const n = Number(e.key);
    if (n >= 1 && n <= sugestoes.length) { void fazer(sugestoes[n - 1].quando); return true; }
    if (e.key === 'Enter' && sugestoes[0] && !(document.activeElement as HTMLElement | null)?.closest('button, form')) { void fazer(sugestoes[0].quando); return true; }
    return false;
  });
  const fazer = async (q: number) => {
    onFechar();
    if (!m) return;
    if (m.status === 'aprovada') {
      // já aprovada: só muda o horário
      try {
        const r = await api.agendar(id, q);
        gravarMensagens([r]);
        avisar(`A #${id} agora sai ${quando(q)}.`, 'ok');
      } catch (e) {
        avisar(explicar(e, id), 'erro');
      }
      return;
    }
    void agendar(id, q);
  };
  return (
    <div
      ref={raiz}
      tabIndex={-1}
      role="dialog"
      aria-label="Agendar o envio"
      className={`painel-flutuante anima-sobe w-[23rem] max-w-[calc(100vw-2rem)] p-2 outline-none ${className}`}
    >
      <p className="flex items-center gap-2 px-2 pt-1 pb-2 font-bold"><CalendarClock size={16} strokeWidth={2} aria-hidden /> Quando sai?</p>
      <ul className="flex flex-col">
        {sugestoes.map((s, i) => (
          <li key={s.quando}>
            <button type="button" className={`flex w-full items-center gap-3 rounded-botao px-2 py-2 text-left hover:bg-surface-2 ${i === 0 ? 'bg-accent-soft hover:bg-accent-soft' : ''}`} onClick={() => fazer(s.quando)}>
              <Tecla className="min-w-6">{i + 1}</Tecla>
              <span className="font-semibold">{s.rotulo}</span>
              <span className="ml-auto text-ui text-tx-2 tabular">{s.detalhe}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-1 flex items-end gap-2 border-t border-line px-2 pt-2.5 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new Date(livre).getTime();
          if (!Number.isFinite(q) || q < Date.now()) { avisar('Esse horário já passou. Escolha um no futuro.', 'erro'); return; }
          void fazer(q);
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="rotulo">Outro horário</span>
          <input type="datetime-local" className="campo h-8 tabular" value={livre} min={paraInputLocal(agora)} onChange={(e) => setLivre(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-pequeno h-8">Agendar</button>
      </form>
      <p className="px-2 pt-2 pb-1 text-meta text-tx-3">
        <Tecla>Enter</Tecla> escolhe a primeira. {m?.status === 'pendente' ? 'Agendar já aprova (com os 10 s de desfazer).' : ''}
      </p>
    </div>
  );
}
