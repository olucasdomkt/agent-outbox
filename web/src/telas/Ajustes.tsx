// Ajustes: envios (pausa, janela de desfazer, varredura do que você já mandou), saúde dos canais e da cópia de
// segurança, assinaturas de e-mail por conta, tema e atalhos.
import { useEffect, useState } from 'react';
import { Switch } from 'radix-ui';
import { CircleAlert, CircleCheck, DatabaseBackup, Monitor, Moon, Sun } from 'lucide-react';
import { api, explicar } from '../lib/api';
import { alternarPausa, salvarConfig } from '../lib/acoes';
import { avisar, dados, useSel } from '../lib/loja';
import { Glifo, NOME_CANAL, useCanais } from '../lib/canais';
import { horaClara, plural } from '../lib/formato';
import { lerTema, aplicarTema, type Tema } from '../lib/tema';
import { Tecla } from '../componentes/ui';
import { LISTA_ATALHOS } from '../componentes/Ajuda';

export function Interruptor({ ligado, onMudar, rotulo, id }: { ligado: boolean; onMudar: (v: boolean) => void; rotulo: string; id: string }) {
  return (
    <Switch.Root
      id={id}
      checked={ligado}
      onCheckedChange={onMudar}
      aria-label={rotulo}
      className="relative h-6 w-11 flex-none rounded-full bg-line-strong transition-colors data-[state=checked]:bg-accent"
    >
      <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-surface shadow-1 transition-transform duration-200 data-[state=checked]:translate-x-[1.375rem]" />
    </Switch.Root>
  );
}

function Bloco({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-7 last:border-b-0 md:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <h2 className="text-sub font-extrabold">{titulo}</h2>
        {descricao && <p className="mt-1 text-ui text-tx-2">{descricao}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

function Assinatura({ conta, nome }: { conta: string; nome: string }) {
  const atual = useSel(dados, (e) => e.config?.assinaturas?.[conta] ?? '');
  const [texto, setTexto] = useState(atual);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setTexto(atual), [atual]);
  const mudou = texto !== atual;
  return (
    <div className="rounded-painel border border-line bg-surface p-4">
      <p className="flex items-center gap-2 font-semibold"><Glifo canal="email" tamanho={14} /> {nome}</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className="rotulo">Assinatura</span>
          <textarea className="campo min-h-28 text-ui" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Seu nome&#10;Cargo, empresa" />
        </label>
        <div>
          <span className="rotulo">Como sai no Gmail</span>
          <div className="gm rounded-item px-4 py-3 shadow-none">
            <p className="text-[var(--gm-text)]">…fim da mensagem.</p>
            {texto ? <p className="gm-assinatura m-0 mt-2">{'-- \n'}{texto}</p> : <p className="mt-2 text-[var(--gm-meta)]">Sem assinatura nesta conta.</p>}
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        {mudou && <button type="button" className="btn btn-fantasma btn-pequeno" onClick={() => setTexto(atual)}>Desfazer mudança</button>}
        <button
          type="button"
          className="btn btn-pequeno"
          disabled={!mudou || salvando}
          onClick={async () => {
            setSalvando(true);
            const ok = await salvarConfig({ assinaturas: { ...(dados.get().config?.assinaturas || {}), [conta]: texto } });
            setSalvando(false);
            if (ok) avisar(`Assinatura de ${nome} salva.`, 'ok');
          }}
        >
          Salvar assinatura
        </button>
      </div>
    </div>
  );
}

export function TelaAjustes() {
  const config = useSel(dados, (e) => e.config);
  const resumo = useSel(dados, (e) => e.resumo);
  const saude = useSel(dados, (e) => e.saude);
  const canais = useCanais();
  const [tema, setTema] = useState<Tema>(lerTema());
  const [varrendo, setVarrendo] = useState(false);
  const contasEmail = resumo?.canais.find((c) => c.id === 'email')?.contas || [];
  const janela = config?.janelaDesfazerMs ?? 10_000;
  const sumir = config?.sumirRespondidas ?? resumo?.sumirRespondidas ?? true;

  const varrer = async () => {
    setVarrendo(true);
    try {
      const r = await api.varrer();
      avisar(r.sumiram.length ? `${plural(r.sumiram.length, 'mensagem saiu', 'mensagens saíram')} da fila: você já tinha mandado.` : 'Nada na fila que você já tenha mandado.', 'ok');
    } catch (e) {
      avisar(explicar(e), 'erro');
    } finally {
      setVarrendo(false);
    }
  };

  return (
    <div className="rolagem h-full bg-bg">
      <div className="mx-auto max-w-[60rem] px-6 pt-6 pb-16">
        <h1 className="text-titulo font-extrabold tracking-[-0.01em] max-[760px]:sr-only">Ajustes</h1>

        <Bloco titulo="Envios" descricao="Valem para todos os canais e todas as sessões.">
          <div className="flex items-start justify-between gap-4 rounded-painel border border-line bg-surface p-4">
            <div>
              <label htmlFor="pausa" className="font-semibold">Pausar todos os envios</label>
              <p className="text-ui text-tx-2">Nada sai enquanto estiver pausado. Você continua aprovando, e a fila espera.</p>
            </div>
            <Interruptor id="pausa" ligado={!!resumo?.pausado} onMudar={() => alternarPausa()} rotulo="Pausar todos os envios" />
          </div>
          <div className="rounded-painel border border-line bg-surface p-4">
            <p className="font-semibold">Janela de desfazer</p>
            <p className="text-ui text-tx-2">Quanto tempo a mensagem aprovada espera antes de sair. Durante a janela, Z desfaz. O recomendado é 10 s.</p>
            <div className="mt-3 flex rounded-botao segmentos bg-surface-3 p-0.5 sm:inline-flex" role="group" aria-label="Janela de desfazer">
              {[5000, 10_000, 30_000].map((ms) => (
                <button key={ms} type="button" aria-pressed={janela === ms} onClick={() => salvarConfig({ janelaDesfazerMs: ms })} className={`flex-1 rounded-[6px] px-5 py-1.5 text-ui font-semibold whitespace-nowrap ${janela === ms ? 'bg-surface text-tx shadow-1' : 'text-tx-2'}`}>
                  {ms / 1000} s
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-painel border border-line bg-surface p-4">
            <div>
              <label htmlFor="sumir" className="font-semibold">Some o que eu já respondi</label>
              <p className="text-ui text-tx-2">Se você mandou à mão um texto parecido para o mesmo destino, a sugestão da sessão sai da fila sozinha (fica nas descartadas com o motivo).</p>
              <button type="button" className="btn btn-pequeno mt-3" disabled={varrendo} onClick={varrer}>{varrendo ? 'Procurando…' : 'Procurar agora'}</button>
            </div>
            <Interruptor id="sumir" ligado={sumir} onMudar={(v) => salvarConfig({ sumirRespondidas: v })} rotulo="Some o que eu já respondi" />
          </div>
        </Bloco>

        <Bloco titulo="Canais" descricao="Saúde de cada canal ligado, atualizada a cada minuto. E-mail e Discord entram quando você configura (README).">
          <ul className="grid gap-3 sm:grid-cols-2">
            {canais.map((c) => {
              const s = saude?.[c];
              const ok = !s || s.ok;
              return (
                <li key={c} className={`rounded-painel border bg-surface p-4 ${ok ? 'border-line' : 'border-danger-line'}`}>
                  <p className="flex items-center gap-2 font-semibold">
                    <Glifo canal={c} tamanho={16} /> {NOME_CANAL[c]}
                    <span className={`ml-auto inline-flex items-center gap-1 text-meta font-bold ${ok ? 'text-ok' : 'text-danger'}`}>
                      {ok ? <CircleCheck size={14} strokeWidth={2.2} aria-hidden /> : <CircleAlert size={14} strokeWidth={2.2} aria-hidden />}
                      {s ? (ok ? 'no ar' : 'fora') : 'sem notícia'}
                    </span>
                  </p>
                  <p className="mt-1.5 text-ui text-tx-2">{s?.resumo || 'A Central ainda não conferiu este canal.'}</p>
                  {s?.acao && !ok && <p className="mt-1 text-ui font-semibold text-tx">{s.acao}</p>}
                  {s?.ultimaMensagem && <p className="mt-1 text-meta text-tx-3">Última mensagem {horaClara(Date.parse(s.ultimaMensagem))}</p>}
                </li>
              );
            })}
          </ul>
        </Bloco>

        <Bloco titulo="Cópia de segurança" descricao="Opcional. Se você tem um script de cópia, a Central mostra aqui como ele terminou (README).">
          {(() => {
            const c = saude?.copia;
            const rotulo = !c ? 'sem notícia' : { ok: 'em dia', falhou: 'falhou', atrasada: 'atrasada', desligada: 'não ligada' }[c.estado];
            return (
              <div className={`rounded-painel border bg-surface p-4 ${c?.aviso ? 'border-warn-line' : 'border-line'}`}>
                <p className="flex items-center gap-2 font-semibold">
                  <DatabaseBackup size={16} strokeWidth={2} className="text-tx-3" aria-hidden /> Última cópia
                  <span className={`ml-auto inline-flex items-center gap-1 text-meta font-bold ${c?.aviso ? 'text-warn' : c?.estado === 'ok' ? 'text-ok' : 'text-tx-3'}`}>
                    {c?.aviso ? <CircleAlert size={14} strokeWidth={2.2} aria-hidden /> : c?.estado === 'ok' ? <CircleCheck size={14} strokeWidth={2.2} aria-hidden /> : null}
                    {rotulo}
                  </span>
                </p>
                <p className="mt-1.5 text-ui break-words text-tx-2">{c?.resumo || 'A Central ainda não conferiu a cópia.'}</p>
              </div>
            );
          })()}
        </Bloco>

        {contasEmail.length > 0 && (
          <Bloco titulo="Assinaturas de e-mail" descricao="Entram no fim de todo e-mail que sai pela conta. A prévia mostra igual ao Gmail.">
            {contasEmail.map((c) => <Assinatura key={c.id} conta={c.id} nome={c.nome} />)}
          </Bloco>
        )}

        <Bloco titulo="Aparência" descricao="Segue o sistema por padrão. As prévias acompanham (WhatsApp, Gmail e Discord também têm modo escuro).">
          <div className="flex rounded-botao segmentos bg-surface-3 p-0.5 sm:inline-flex sm:self-start" role="group" aria-label="Tema">
            {([['sistema', 'Sistema', Monitor], ['claro', 'Claro', Sun], ['escuro', 'Escuro', Moon]] as const).map(([v, rotulo, Icone]) => (
              <button key={v} type="button" aria-pressed={tema === v} onClick={() => { aplicarTema(v); setTema(v); }} className={`flex flex-1 items-center justify-center gap-2 rounded-[6px] px-4 py-1.5 text-ui font-semibold ${tema === v ? 'bg-surface text-tx shadow-1' : 'text-tx-2'}`}>
                <Icone size={15} strokeWidth={2} aria-hidden /> {rotulo}
              </button>
            ))}
          </div>
        </Bloco>

        <Bloco titulo="Atalhos" descricao="Tudo dá para fazer sem mouse. ? mostra esta lista em qualquer tela.">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {LISTA_ATALHOS.flatMap((g) => g.itens).map(([teclas, oque]) => (
              <div key={`${teclas.join('')}${oque}`} className="flex items-center justify-between gap-3 border-b border-line py-1.5">
                <dt className="text-ui text-tx-2">{oque}</dt>
                <dd className="flex flex-none gap-1">{teclas.map((t) => <Tecla key={t}>{t}</Tecla>)}</dd>
              </div>
            ))}
          </dl>
        </Bloco>

      </div>
    </div>
  );
}
