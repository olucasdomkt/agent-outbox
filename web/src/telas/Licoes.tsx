// Lições: o que você sempre corrige nas mensagens das sessões vira aviso para elas (src/licoes.js).
// Sugestões com a evidência (antes → depois) para virar lição, editar ou ignorar; as lições com liga/desliga,
// quantas vezes avisaram e quantas a sessão corrigiu sozinha; e o que vai para o lixo, por canal e por sessão.
// Tela própria (não dentro do Relatório): aqui se decide, o Relatório só mostra números.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, TriangleAlert } from 'lucide-react';
import { api, ErroApi, explicar } from '../lib/api';
import { avisar } from '../lib/loja';
import { NOME_CANAL, useCanais } from '../lib/canais';
import { NOME_MOTIVO } from '../lib/motivos';
import { aspas, numero, plural } from '../lib/formato';
import { diffPalavras } from '../lib/diff';
import { Esqueleto, Etiqueta, Vazio } from '../componentes/ui';
import { Interruptor } from './Ajustes';
import type { CamposLicao, Canal, EvidenciaLicao, GrupoDescarte, Licao, RespostaLicoes, SugestaoLicao, TipoLicao } from '../lib/tipos';

// a Central explica o que faltou (trecho, "por", canal); o resto, o texto de sempre
const motivo = (e: unknown) => (e instanceof ErroApi && e.status >= 400 && e.status < 500 && e.corpo.erro ? `Não deu: ${e.corpo.erro}.` : explicar(e));
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Base = Pick<Licao, 'tipo' | 'trecho' | 'por' | 'nota' | 'nome' | 'padrao' | 'canal'>;
function titulo(l: Base) {
  if (l.tipo === 'evitar') return `Tirar “${l.trecho}”`;
  if (l.tipo === 'trocar') return `Trocar “${l.trecho}” por “${l.por}”`;
  return maiuscula(l.nome || l.nota || `evitar “${l.trecho}”`);
}

// antes → depois numa linha só: o que saiu riscado, o que entrou marcado
function Evidencia({ e }: { e: EvidenciaLicao }) {
  const trechos = useMemo(() => diffPalavras(e.antes, e.depois), [e]);
  return (
    <li className="flex gap-2.5">
      <span className="flex-none pt-0.5 font-mono text-meta text-tx-3">#{e.id}</span>
      <p className="min-w-0 text-ui break-words text-tx-2">
        {trechos.map((t, i) => (t.tipo === 'igual' ? <span key={i}>{t.texto}</span>
          : t.tipo === 'menos' ? <del key={i} className="diff-menos">{t.texto}</del>
            : <ins key={i} className="diff-mais">{t.texto}</ins>))}
      </p>
    </li>
  );
}

interface Rascunho { tipo: TipoLicao; trecho: string; por: string; nota: string; canal: Canal | '' }
const rascunhoDe = (l?: Base): Rascunho => ({
  tipo: l?.tipo || 'regra', trecho: l?.trecho || '', por: l?.por || '', nota: l?.nota || '', canal: l?.canal || '',
});
const TIPOS: [TipoLicao, string][] = [['evitar', 'Evitar'], ['trocar', 'Trocar'], ['regra', 'Regra']];

// O mesmo formulário para escrever à mão (escolhe o tipo), editar a sugestão antes de virar lição e editar a lição.
// Padrão (saudação, fecho...) não tem trecho: só o porquê e o canal.
function FormLicao({ inicial, tipoFixo = false, rotulo, onSalvar, onCancelar }: {
  inicial: Base | undefined; tipoFixo?: boolean; rotulo: string; onSalvar: (c: CamposLicao) => Promise<boolean>; onCancelar: () => void;
}) {
  const [r, setR] = useState<Rascunho>(() => rascunhoDe(inicial));
  const [salvando, setSalvando] = useState(false);
  const canais = useCanais();
  const padrao = inicial?.padrao || null;
  const campo = (k: keyof Rascunho) => ({
    value: r[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setR((x) => ({ ...x, [k]: e.target.value })),
  });
  const id = (k: string) => `licao-${k}-${inicial?.trecho || inicial?.padrao || 'nova'}`;
  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    const ok = await onSalvar({
      tipo: r.tipo, nota: r.nota.trim() || null, canal: r.canal || null,
      ...(padrao ? {} : { trecho: r.trecho.trim() || null, por: r.tipo === 'trocar' ? r.por.trim() || null : null }),
    });
    setSalvando(false);
    if (ok) onCancelar();
  };
  const regraLivre = r.tipo === 'regra' && !padrao;
  return (
    <form className="mt-3 flex flex-col gap-3 rounded-item border border-line bg-surface-2 p-3" onSubmit={salvar}>
      {!tipoFixo && (
        <div className="flex rounded-botao segmentos bg-surface-3 p-0.5 sm:self-start" role="group" aria-label="Tipo da lição">
          {TIPOS.map(([t, nome]) => (
            <button key={t} type="button" aria-pressed={r.tipo === t} onClick={() => setR((x) => ({ ...x, tipo: t }))} className={`flex-1 rounded-[6px] px-4 py-1.5 text-ui font-semibold ${r.tipo === t ? 'bg-surface text-tx shadow-1' : 'text-tx-2'}`}>
              {nome}
            </button>
          ))}
        </div>
      )}
      {regraLivre && (
        <label htmlFor={id('nota')} className="block">
          <span className="rotulo">A regra</span>
          <input id={id('nota')} className="campo" placeholder="ex.: sem “Att.” no fim: assine com o nome" {...campo('nota')} />
        </label>
      )}
      {!padrao && (
        <label htmlFor={id('trecho')} className="block">
          <span className="rotulo">{r.tipo === 'evitar' ? 'O trecho que a sessão não deve escrever' : r.tipo === 'trocar' ? 'Trocar isto' : 'Avisar quando aparecer (opcional)'}</span>
          <input id={id('trecho')} className="campo" placeholder={`ex.: ${r.tipo === 'trocar' ? 'planilha' : r.tipo === 'evitar' ? 'Espero que esteja bem' : 'Att.'}`} {...campo('trecho')} />
          {regraLivre && <span className="mt-1 block text-meta text-tx-3">Sem isso, a regra só aparece no guia das sessões.</span>}
        </label>
      )}
      {r.tipo === 'trocar' && !padrao && (
        <label htmlFor={id('por')} className="block">
          <span className="rotulo">Por isto</span>
          <input id={id('por')} className="campo" placeholder="ex.: tabela" {...campo('por')} />
        </label>
      )}
      {!regraLivre && (
        <label htmlFor={id('nota')} className="block">
          <span className="rotulo">Por quê (opcional, vai junto do aviso)</span>
          <input id={id('nota')} className="campo" placeholder="ex.: vá direto ao assunto" {...campo('nota')} />
        </label>
      )}
      <label htmlFor={id('canal')} className="block sm:max-w-[16rem]">
        <span className="rotulo">Vale para</span>
        <select id={id('canal')} className="campo" {...campo('canal')}>
          <option value="">Todos os canais</option>
          {canais.map((c) => <option key={c} value={c}>{NOME_CANAL[c]}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-fantasma btn-pequeno" onClick={onCancelar}>Cancelar</button>
        <button type="submit" className="btn btn-principal btn-pequeno" disabled={salvando}>{salvando ? 'Salvando…' : rotulo}</button>
      </div>
    </form>
  );
}

function CartaoSugestao({ s, onFeito }: { s: SugestaoLicao; onFeito: () => void }) {
  const [editando, setEditando] = useState(false);
  const [todas, setTodas] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const virar = async (campos: CamposLicao = {}) => {
    setOcupado(true);
    try {
      await api.criarLicao({ chave: s.chave, ...campos });
      avisar('Virou lição: as sessões passam a ver esse aviso.', 'ok');
      onFeito();
      return true;
    } catch (e) {
      avisar(motivo(e), 'erro');
      return false;
    } finally {
      setOcupado(false);
    }
  };
  const ignorar = async () => {
    try {
      await api.ignorarSugestao(s.chave);
      onFeito();
      avisar('Sugestão ignorada.', 'info', {
        rotulo: 'Desfazer', fazer: () => void api.ignorarSugestao(s.chave, true).then(onFeito, (e) => avisar(motivo(e), 'erro')),
      });
    } catch (e) {
      avisar(motivo(e), 'erro');
    }
  };
  const exemplos = todas ? s.evidencias : s.evidencias.slice(0, 2);
  return (
    <li className="rounded-painel border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <p className="min-w-0 font-semibold break-words">{titulo(s)}</p>
        <span className="flex flex-none items-center gap-1.5">
          <Etiqueta tom="acento" titulo={`Você corrigiu isso em ${plural(s.contagem, 'mensagem', 'mensagens')}`}>{s.contagem}×</Etiqueta>
          {s.canal && <Etiqueta>{NOME_CANAL[s.canal]}</Etiqueta>}
        </span>
      </div>
      <p className="mt-1 text-meta break-words text-tx-3">
        <span className="font-semibold">A sessão vai ler:</span> {aspas(s.texto)}{s.avisa ? '' : ' (só no guia: a máquina não confere isso sozinha)'}
      </p>
      <ul className="mt-3 flex flex-col gap-2" aria-label="Onde você corrigiu">
        {exemplos.map((e) => <Evidencia key={e.id} e={e} />)}
      </ul>
      {s.evidencias.length > 2 && (
        <button type="button" className="btn btn-fantasma btn-pequeno mt-1 -ml-2" aria-expanded={todas} onClick={() => setTodas((v) => !v)}>
          {todas ? 'Menos exemplos' : `Ver os ${s.evidencias.length} exemplos`}
        </button>
      )}
      {editando ? (
        <FormLicao inicial={s} tipoFixo rotulo="Salvar como lição" onSalvar={virar} onCancelar={() => setEditando(false)} />
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-principal btn-pequeno" disabled={ocupado} onClick={() => void virar()}>Virar lição</button>
          <button type="button" className="btn btn-pequeno" onClick={() => setEditando(true)}><Pencil size={13} strokeWidth={2} aria-hidden /> Editar</button>
          <button type="button" className="btn btn-fantasma btn-pequeno" onClick={() => void ignorar()}>Ignorar</button>
        </div>
      )}
    </li>
  );
}

const uso = (l: Licao) => (!l.avisa ? 'Só no guia das sessões (msg guia): a máquina não confere isso sozinha.'
  : !l.disparos ? 'Ainda não avisou nenhuma mensagem.'
    : `Avisou em ${plural(l.disparos, 'mensagem', 'mensagens')}${l.corrigidas ? `; em ${numero(l.corrigidas)} a sessão corrigiu sozinha antes de você ver` : ''}.`);

function LinhaLicao({ l, onMudou }: { l: Licao; onMudou: (nova: Licao) => void }) {
  const [editando, setEditando] = useState(false);
  const salvar = async (campos: CamposLicao) => {
    try {
      onMudou(await api.editarLicao(l.id, campos));
      return true;
    } catch (e) {
      avisar(motivo(e), 'erro');
      return false;
    }
  };
  const alternar = async (ativa: boolean) => {
    if (await salvar({ ativa })) avisar(ativa ? 'Lição ligada: volta a avisar as sessões.' : 'Lição desligada: não avisa mais.', 'ok');
  };
  return (
    <li className="rounded-painel border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`min-w-0 ${l.ativa ? '' : 'text-tx-2'}`}>
          <p className="font-semibold break-words">{titulo(l)}</p>
          <p className="mt-1 text-meta break-words text-tx-3"><span className="font-semibold">A sessão lê:</span> {aspas(l.texto)}</p>
          <p className="mt-1.5 text-meta text-tx-2">
            {l.canal ? `Só ${NOME_CANAL[l.canal]}. ` : ''}{uso(l)}
          </p>
        </div>
        <Interruptor id={`licao-${l.id}`} ligado={l.ativa} onMudar={(v) => void alternar(v)} rotulo={`Lição: ${titulo(l)}`} />
      </div>
      {editando ? (
        <FormLicao inicial={l} tipoFixo rotulo="Salvar" onSalvar={salvar} onCancelar={() => setEditando(false)} />
      ) : (
        <button type="button" className="btn btn-fantasma btn-pequeno mt-2 -ml-2" onClick={() => setEditando(true)}>
          <Pencil size={13} strokeWidth={2} aria-hidden /> Editar
        </button>
      )}
    </li>
  );
}

const nomeMotivo = (c: GrupoDescarte['motivos'][number]['codigo']) => (c === null ? 'sem motivo' : c === 'escrito' ? 'motivo escrito' : NOME_MOTIVO[c].toLowerCase());
function GrupoDescartes({ rotulo, grupos, nome = (g) => g.nome }: { rotulo: string; grupos: GrupoDescarte[]; nome?: (g: GrupoDescarte) => string }) {
  return (
    <div className="min-w-0 rounded-painel border border-line bg-surface px-4 py-3">
      <h3 className="rotulo">{rotulo}</h3>
      <ul className="flex flex-col">
        {grupos.map((g) => (
          <li key={g.nome} className="border-b border-line py-2 last:border-b-0">
            <p className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-semibold" title={nome(g)}>{nome(g)}</span>
              <span className="flex-none text-ui tabular">{numero(g.n)}</span>
            </p>
            <p className="text-meta text-tx-2">{g.motivos.slice(0, 3).map((m) => `${nomeMotivo(m.codigo)} ${numero(m.n)}`).join(' · ')}</p>
            {g.exemplos[0] && <p className="mt-0.5 truncate text-meta text-tx-3" title={g.exemplos.join('\n')}>“{g.exemplos[0]}”</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TelaLicoes() {
  const [r, setR] = useState<RespostaLicoes | null>(null);
  const [erro, setErro] = useState(false);
  const [nova, setNova] = useState(false);
  const [verDesligadas, setVerDesligadas] = useState(false);
  const carregar = useCallback(() => {
    api.licoes().then((x) => { setR(x); setErro(false); }, () => setErro(true));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const trocar = (l: Licao) => setR((x) => x && { ...x, licoes: x.licoes.map((y) => (y.id === l.id ? l : y)) });
  const criar = async (campos: CamposLicao) => {
    try {
      await api.criarLicao(campos);
      avisar('Lição criada: as sessões passam a ver esse aviso.', 'ok');
      carregar();
      return true;
    } catch (e) {
      avisar(motivo(e), 'erro');
      return false;
    }
  };
  const ativas = r?.licoes.filter((l) => l.ativa) || [];
  const desligadas = r?.licoes.filter((l) => !l.ativa) || [];
  const vazio = 'rounded-painel border border-dashed border-line-strong px-4 py-5 text-ui text-tx-2';

  return (
    <div className="rolagem h-full bg-bg">
      <div className="mx-auto flex max-w-[60rem] flex-col gap-9 px-4 pt-6 pb-16 sm:px-6">
        <header>
          <h1 className="text-titulo font-extrabold tracking-[-0.01em] max-[760px]:sr-only">Lições</h1>
          <p className="mt-1 text-ui text-tx-2">O que você sempre corrige vira aviso para as sessões (no msg add, no painel e no fim do msg guia), antes de a mensagem chegar a você. Aviso nunca bloqueia.</p>
          {r && r.edicoes.total > 0 && (
            <p className="mt-1 text-meta text-tx-3">
              Nos últimos {r.janelaDias} dias você editou {plural(r.edicoes.total, 'mensagem', 'mensagens')} antes de sair
              {r.edicoes.encurtadas ? `; ${numero(r.edicoes.encurtadas)} ficaram em média ${r.edicoes.encurtadoPct}% mais curtas` : ''}.
            </p>
          )}
        </header>

        {erro && !r && <Vazio titulo="Não consegui carregar as lições." icone={<TriangleAlert size={22} strokeWidth={1.75} />}>A Central não respondeu a /api/licoes. Tente de novo em instantes.</Vazio>}
        {!r && !erro && <div className="rounded-painel border border-line bg-surface p-6"><Esqueleto linhas={5} /></div>}

        {r && (
          <>
            <section aria-labelledby="titulo-sugestoes">
              <h2 id="titulo-sugestoes" className="text-sub font-extrabold">
                Sugestões {r.sugestoes.length > 0 && <span className="font-semibold text-tx-3">{r.sugestoes.length}</span>}
              </h2>
              <p className="mt-0.5 text-ui text-tx-2">Saem do que você corrigiu em 2 mensagens ou mais. A mesma mensagem mandada a vários grupos conta uma vez.</p>
              {r.sugestoes.length ? (
                <ul className="mt-3 flex flex-col gap-3">{r.sugestoes.map((s) => <CartaoSugestao key={s.chave} s={s} onFeito={carregar} />)}</ul>
              ) : (
                <p className={`mt-3 ${vazio}`}>Nenhuma sugestão nova. Quando você corrigir a mesma coisa em 2 mensagens, ela aparece aqui.</p>
              )}
            </section>

            <section aria-labelledby="titulo-ativas">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="titulo-ativas" className="text-sub font-extrabold">
                    Lições ativas {ativas.length > 0 && <span className="font-semibold text-tx-3">{ativas.length}</span>}
                  </h2>
                  <p className="mt-0.5 text-ui text-tx-2">Desligue a que não serve mais; ela para de avisar e sai do guia.</p>
                </div>
                {!nova && (
                  <button type="button" className="btn btn-pequeno" onClick={() => setNova(true)}><Plus size={14} strokeWidth={2.2} aria-hidden /> Nova lição</button>
                )}
              </div>
              {nova && <FormLicao inicial={undefined} rotulo="Criar lição" onSalvar={criar} onCancelar={() => setNova(false)} />}
              {ativas.length ? (
                <ul className="mt-3 flex flex-col gap-3">{ativas.map((l) => <LinhaLicao key={l.id} l={l} onMudou={trocar} />)}</ul>
              ) : (
                !nova && <p className={`mt-3 ${vazio}`}>Nenhuma ainda. Vire uma sugestão em lição ou escreva uma à mão (ex.: “sem Att. no fim: assine com o nome”).</p>
              )}
              {desligadas.length > 0 && (
                <>
                  <button type="button" className="btn btn-fantasma btn-pequeno mt-3 -ml-2" aria-expanded={verDesligadas} onClick={() => setVerDesligadas((v) => !v)}>
                    {verDesligadas ? 'Esconder as desligadas' : `Ver as desligadas (${desligadas.length})`}
                  </button>
                  {verDesligadas && <ul className="mt-2 flex flex-col gap-3">{desligadas.map((l) => <LinhaLicao key={l.id} l={l} onMudou={trocar} />)}</ul>}
                </>
              )}
            </section>

            {r.descartes.total > 0 && (
              <section aria-labelledby="titulo-lixo">
                <h2 id="titulo-lixo" className="text-sub font-extrabold">O que vai para o lixo</h2>
                <p className="mt-0.5 text-ui text-tx-2">
                  {plural(r.descartes.total, 'descarte', 'descartes')} em {r.janelaDias} dias, {numero(r.descartes.semMotivo)} sem motivo. Daqui sai a lição que você escreve à mão.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <GrupoDescartes rotulo="Por canal" grupos={r.descartes.porCanal} nome={(g) => NOME_CANAL[g.nome as Canal] || g.nome} />
                  <GrupoDescartes rotulo="Por sessão" grupos={r.descartes.porSessao.slice(0, 6)} />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
