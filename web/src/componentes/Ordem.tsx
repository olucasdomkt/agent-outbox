// Ordem entre mensagens no painel: o selo da lista ("depois da #485"), o aviso da barra de decisão e o controle
// "Sai depois de" do detalhe. Quem decide a ordem é a Central; quem solta uma bloqueada é só você.
import { useMemo, useState } from 'react';
import { Ban, CornerDownRight, MessageCircleReply, Unlink } from 'lucide-react';
import { abrirMensagem, esperarResposta, marcarDepois, soltarDaSequencia } from '../lib/acoes';
import { dados, useSel } from '../lib/loja';
import { conversaDireta, esperaDe, primeiroNome, sugestoesDeAnterior, VIVAS } from '../lib/ordem';
import { textoLimpo } from '../lib/whatsapp';
import type { Mensagem, Status } from '../lib/tipos';

const SITUACAO: Record<Status, string> = {
  pendente: 'para revisar', aprovada: 'aprovada', enviando: 'saindo agora', enviada: 'já saiu', erro: 'com erro',
  descartada: 'descartada', substituida: 'substituída',
};
const ICONE = { anterior: CornerDownRight, resposta: MessageCircleReply, bloqueada: Ban } as const;

// quem sai depois desta (as que ainda não saíram), na ordem
export function useDepoisDesta(m: Mensagem) {
  const msgs = useSel(dados, (e) => e.msgs);
  return useMemo(() => Object.values(msgs).filter((x) => x.depois_de === m.id && VIVAS.includes(x.status)).sort((a, b) => a.id - b.id), [msgs, m.id]);
}

// selo discreto da lista: some quando não espera nada
export function SeloOrdem({ m, className = '' }: { m: Mensagem; className?: string }) {
  const e = esperaDe(m);
  if (!e) return null;
  const Icone = ICONE[e.motivo];
  return (
    <span className={`flex min-w-0 items-center gap-1 text-meta font-semibold ${e.motivo === 'bloqueada' ? 'text-danger' : 'text-accent-tx'} ${className}`}>
      <Icone size={12} strokeWidth={2.2} className="flex-none" aria-hidden />
      <span className="truncate">{e.curto}</span>
    </span>
  );
}

// aviso em cima da barra de decisão (Aprovar, Editar...): o que esta espera para sair; bloqueada traz o Soltar
export function AvisoOrdem({ m }: { m: Mensagem }) {
  const e = esperaDe(m);
  if (!e) return null;
  if (e.motivo === 'bloqueada') {
    return (
      <div className="anima-aparece mb-2.5 flex flex-col items-start gap-2 rounded-item border border-danger-line bg-danger-soft px-3 py-2.5" role="status">
        <p className="flex items-start gap-2 text-ui font-semibold text-danger">
          <Ban size={15} strokeWidth={2.2} className="mt-0.5 flex-none" aria-hidden /> {e.longo}
        </p>
        <button type="button" className="btn btn-pequeno" onClick={() => void soltarDaSequencia(m.id)}>
          <Unlink size={14} strokeWidth={2} aria-hidden /> Soltar
        </button>
      </div>
    );
  }
  const Icone = ICONE[e.motivo];
  return (
    <p className="anima-aparece mb-2.5 flex items-start gap-2 text-ui text-tx-2">
      <Icone size={15} strokeWidth={2} className="mt-0.5 flex-none text-accent-tx" aria-hidden /> {e.longo}
    </p>
  );
}

const Numero = ({ id, existe }: { id: number; existe: boolean }) => (existe
  ? <button type="button" className="font-mono font-semibold text-accent-tx hover:underline" onClick={() => abrirMensagem(id)}>#{id}</button>
  : <span className="font-mono font-semibold">#{id}</span>);

// "Sai depois de": mostra a anterior (com a situação dela), deixa trocar, soltar e esperar a resposta.
// Lê a linha viva da loja: no celular quem abre guarda a mensagem do momento do toque.
export function ControleOrdem({ m: aberta }: { m: Mensagem }) {
  const msgs = useSel(dados, (e) => e.msgs);
  const m = msgs[aberta.id] || aberta;
  const depois = useDepoisDesta(m);
  const [escolhendo, setEscolhendo] = useState(false);
  const editavel = m.status === 'pendente' || m.status === 'aprovada' || m.status === 'erro';
  const anterior = m.depois_de ? msgs[m.depois_de] : undefined;
  const e = esperaDe(m);
  const bloqueada = e?.motivo === 'bloqueada';
  // anterior fora da tela (já saiu faz tempo): a Central confere se a resposta vale para ela
  const podeEsperar = anterior ? conversaDireta(anterior) : conversaDireta(m) || !!m.espera_resposta;
  const quem = primeiroNome(anterior?.destino_nome || m.aguardando?.quem || m.destino_nome);
  if (!editavel && !m.depois_de && !depois.length) return null;
  // onde a espera está agora (a regra já aparece na linha de cima)
  const agora = !e ? (m.espera_resposta ? `${quem} respondeu: esta está liberada.` : `A #${m.depois_de} já saiu: esta está liberada.`)
    : e.motivo === 'resposta' ? `A #${m.depois_de} já saiu. Esperando ${quem} responder.`
      : `Esperando a #${m.depois_de} sair${m.espera_resposta ? `; depois, a resposta de ${quem}` : ''}.`;

  return (
    <div className="flex flex-col gap-2">
      {m.depois_de ? (
        <>
          <div className="flex items-start gap-2">
            <CornerDownRight size={15} strokeWidth={2} className="mt-0.5 flex-none text-tx-3" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-ui">
                {editavel ? 'Sai depois da ' : 'Saía depois da '}<Numero id={m.depois_de} existe={!!anterior} />
                {anterior && <span className="text-tx-3"> ({SITUACAO[anterior.status]})</span>}
              </p>
              {anterior && <p className="truncate text-meta text-tx-3">{textoLimpo(anterior.corpo)}</p>}
            </div>
          </div>
          {editavel && (
            <p className={`text-meta font-semibold ${bloqueada ? 'text-danger' : e ? 'text-accent-tx' : 'text-ok'}`} role={bloqueada ? 'status' : undefined}>
              {bloqueada ? e.longo : agora}
            </p>
          )}
          {editavel && podeEsperar && !bloqueada && !escolhendo && (
            <label className="flex cursor-pointer items-start gap-2 text-ui">
              <input type="checkbox" className="mt-0.5 size-4 flex-none accent-[var(--accent)]" checked={!!m.espera_resposta} onChange={(ev) => void esperarResposta(m.id, ev.target.checked)} />
              <span>Só depois que {quem} responder</span>
            </label>
          )}
          {editavel && !escolhendo && (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="btn btn-pequeno" onClick={() => setEscolhendo(true)}>Trocar</button>
              <button type="button" className={`btn btn-pequeno ${bloqueada ? '' : 'btn-fantasma'}`} onClick={() => void soltarDaSequencia(m.id)}>
                <Unlink size={14} strokeWidth={2} aria-hidden /> Soltar
              </button>
            </div>
          )}
        </>
      ) : editavel && !escolhendo ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-ui text-tx-3">Sai sem esperar outra.</p>
          <button type="button" className="btn btn-pequeno flex-none" onClick={() => setEscolhendo(true)}>
            <CornerDownRight size={14} strokeWidth={2} aria-hidden /> Sai depois de…
          </button>
        </div>
      ) : null}
      {escolhendo && <Escolher m={m} onFechar={() => setEscolhendo(false)} />}
      {depois.length > 0 && (
        <p className="text-meta text-tx-2">
          Depois desta sai {depois.map((x, i) => (
            <span key={x.id}>{i ? ', ' : ''}<Numero id={x.id} existe />{x.espera_resposta ? ' (depois da resposta)' : ''}</span>
          ))}.
        </p>
      )}
    </div>
  );
}

function Escolher({ m, onFechar }: { m: Mensagem; onFechar: () => void }) {
  const msgs = useSel(dados, (e) => e.msgs);
  const sugestoes = useMemo(() => sugestoesDeAnterior(m, msgs), [m, msgs]);
  const direta = conversaDireta(m);
  const [espera, setEspera] = useState(!!m.espera_resposta);
  const [numero, setNumero] = useState('');
  const [indo, setIndo] = useState(false);
  const digitado = Number(numero.replace(/\D/g, '')) || 0;
  const marcar = async (id: number) => {
    if (indo) return;
    setIndo(true);
    const r = await marcarDepois(m.id, id, direta && espera);
    setIndo(false);
    if (r) onFechar();
  };
  return (
    <div className="anima-aparece flex flex-col gap-2 rounded-item border border-line bg-surface-2 p-2.5">
      <p className="rotulo mb-0">Sai depois de qual?</p>
      {direta && (
        <label className="flex cursor-pointer items-start gap-2 text-ui">
          <input type="checkbox" className="mt-0.5 size-4 flex-none accent-[var(--accent)]" checked={espera} onChange={(ev) => setEspera(ev.target.checked)} />
          <span>Só depois que {primeiroNome(m.destino_nome)} responder</span>
        </label>
      )}
      {sugestoes.length ? (
        <ul className="flex flex-col gap-1">
          {sugestoes.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                disabled={indo}
                aria-pressed={x.id === m.depois_de}
                className="flex w-full items-start gap-2 rounded-botao border border-line-campo bg-surface px-2.5 py-1.5 text-left hover:border-accent hover:bg-accent-soft disabled:opacity-50 aria-pressed:border-accent"
                onClick={() => void marcar(x.id)}
              >
                <span className="font-mono text-meta leading-5 font-bold">#{x.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui text-tx-2">{textoLimpo(x.corpo) || 'sem texto'}</span>
                  <span className="block text-meta text-tx-3">{SITUACAO[x.status]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-tx-3">Nenhuma outra para {m.destino_nome || 'este destino'} na fila. Diga o número abaixo.</p>
      )}
      <form className="flex gap-1.5" onSubmit={(ev) => { ev.preventDefault(); if (digitado) void marcar(digitado); }}>
        <input
          className="campo h-8 text-ui"
          inputMode="numeric"
          placeholder="Outra: o número, ex. 485"
          aria-label="Número da mensagem anterior"
          value={numero}
          onChange={(ev) => setNumero(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onFechar(); } }}
        />
        <button type="submit" className="btn btn-pequeno h-8 flex-none" disabled={!digitado || indo}>Marcar</button>
      </form>
      <button type="button" className="btn btn-fantasma btn-pequeno self-start" onClick={onFechar}>Cancelar</button>
    </div>
  );
}
