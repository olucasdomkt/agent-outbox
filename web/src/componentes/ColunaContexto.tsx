// Coluna da direita: quem preparou, destino, o caso, verificações, a conversa com a pessoa, anexos e histórico.
import { useState, type ReactNode } from 'react';
import {
  CalendarClock, ChevronRight, CircleCheck, Download, ExternalLink, FolderOpen, GitBranch, Layers, OctagonX, PenLine, Repeat2, ShieldAlert, TriangleAlert,
} from 'lucide-react';
import { comParametro, urlSegura } from '../lib/url';
import { api, explicar } from '../lib/api';
import { agendar, trocarConta, trocarDestino } from '../lib/acoes';
import { avisar, dados, ui, useSel } from '../lib/loja';
import { useContexto, useEventos, useLint, usePrevia, useVersoes } from '../lib/consultas';
import { NOME_CANAL, TIPO_DESTINO, matiz } from '../lib/canais';
import { normCliente } from '../lib/clientes';
import { aspas, bytes, completa, curto, horaClara, hhmm, diaRelativo, quando } from '../lib/formato';
import { explicarErroEnvio } from '../lib/estado';
import { NOME_MOTIVO } from '../lib/motivos';
import { useAgora } from '../lib/tempo';
import { anexosLocais } from '../previas/local';
import { Miniatura } from './Miniatura';
import { ControleOrdem, useDepoisDesta } from './Ordem';
import { ControleAcompanhar } from './AcompanharResposta';
import { TrocarDestino } from './TrocarDestino';
import { Dica, Esqueleto, Etiqueta, Foto, Secao } from './ui';
import type { AnexoPrevia, ItemLint, Lint, Mensagem } from '../lib/tipos';

const EVENTO: Record<string, string> = {
  criada: 'Chegou', editada: 'Editada', aprovada: 'Aprovada', desaprovada: 'Voltou para revisão', desfeita: 'Desfeita',
  descartada: 'Descartada', restaurada: 'Restaurada', enviada: 'Entregue', erro: 'Erro no envio', retentar: 'Nova tentativa',
  aviso: 'Aviso', agendada: 'Agendada', substituida: 'Substituída',
  marcada: 'Na sequência', ordem: 'Sequência', liberada: 'Liberada', bloqueada: 'Bloqueada', solta: 'Solta da sequência',
  acompanhar: 'Acompanhar',
};

export function EtiquetaApp({ app }: { app: string }) {
  const h = matiz(app);
  return (
    <span className="etiqueta" style={{ background: `light-dark(oklch(0.95 0.035 ${h}), oklch(0.3 0.05 ${h}))`, color: `light-dark(oklch(0.45 0.12 ${h}), oklch(0.85 0.08 ${h}))` }}>
      {app}
    </span>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-1">
      <dt className="text-meta text-tx-3">{rotulo}</dt>
      <dd className="min-w-0 text-ui wrap-anywhere">{children}</dd>
    </div>
  );
}

function ItemVerificacao({ tipo, item, m }: { tipo: 'bloqueio' | 'aviso'; item: ItemLint; m: Mensagem }) {
  const Icone = tipo === 'bloqueio' ? OctagonX : TriangleAlert;
  return (
    <li className={`flex gap-2.5 rounded-item px-3 py-2.5 ${tipo === 'bloqueio' ? 'bg-danger-soft' : 'bg-warn-soft'}`}>
      <Icone size={16} strokeWidth={2} className={`mt-0.5 flex-none ${tipo === 'bloqueio' ? 'text-danger' : 'text-warn-icon'}`} aria-hidden />
      <div className="min-w-0">
        <p className={`text-ui ${tipo === 'bloqueio' ? 'font-semibold text-danger' : 'font-medium text-tx'}`}>
          <span className="sr-only">{tipo === 'bloqueio' ? 'Bloqueia: ' : 'Aviso: '}</span>{aspas(item.msg)}
        </p>
        {item.trecho && <p className="mt-1 break-words font-mono text-meta text-tx-2">{item.trecho}</p>}
        {item.regra === 'horario' && item.sugestao && m.status === 'pendente' && (
          <button type="button" className="btn btn-pequeno mt-2" onClick={() => agendar(m.id, item.sugestao!)}>
            <CalendarClock size={14} strokeWidth={2} aria-hidden /> Agendar para {quando(item.sugestao)}
          </button>
        )}
      </div>
    </li>
  );
}

// o que pode causar estrago vem primeiro; o lembrete de horário, por último
const PESO_REGRA: Record<string, number> = { segredo: 0, cliente_cruzado: 0, duplicada: 1, horario: 9 };
const peso = (x: ItemLint) => PESO_REGRA[x.regra] ?? 5;

function Verificacoes({ m, lint }: { m: Mensagem; lint: Lint | null }) {
  const clientes = useSel(dados, (e) => e.resumo?.clientes);
  if (!lint) return <Esqueleto linhas={2} />;
  // o bloqueio de destino já está explicado na seção Destino, com a saída
  const bloqueios = lint.bloqueios.filter((b) => b.regra !== 'destino');
  // no WhatsApp quem fala do tamanho é a prévia, que mede a altura real na tela do celular
  const avisos = lint.avisos.filter((a) => !(a.regra === 'tamanho' && m.canal === 'whatsapp')).sort((a, b) => peso(a) - peso(b));
  const regras = new Set([...lint.bloqueios, ...lint.avisos].map((x) => x.regra));
  const passou: string[] = [];
  if (!regras.has('segredo')) passou.push(lint.cofre ? 'Sem segredo (conferido com o cofre)' : 'Sem segredo no texto');
  if (!regras.has('destino')) passou.push('Destino definido');
  if (!regras.has('cliente_cruzado') && normCliente(m.cliente, m.app, clientes)) passou.push('Destino bate com o cliente');
  if (!regras.has('tamanho')) passou.push(`Tamanho bom para ${NOME_CANAL[m.canal]}`);
  if (!regras.has('acento') && !regras.has('ia')) passou.push('Acentos e tom sem alerta');
  return (
    <div className="flex flex-col gap-2">
      {(bloqueios.length > 0 || avisos.length > 0) && (
        <ul className="flex flex-col gap-1.5">
          {bloqueios.map((b, i) => <ItemVerificacao key={`b${i}`} tipo="bloqueio" item={b} m={m} />)}
          {avisos.map((a, i) => <ItemVerificacao key={`a${i}`} tipo="aviso" item={a} m={m} />)}
        </ul>
      )}
      {passou.length > 0 && (
        <ul className="flex flex-col gap-1 px-1 pt-1">
          {passou.map((p) => (
            <li key={p} className="flex items-center gap-2 text-ui text-tx-2">
              <CircleCheck size={15} strokeWidth={2} className="flex-none text-ok" aria-hidden /> {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Anexos({ m, anexos }: { m: Mensagem; anexos: AnexoPrevia[] }) {
  const pasta = async (i: number) => {
    try {
      await api.pasta(m.id, i);
    } catch (e) {
      avisar(explicar(e, m.id), 'erro');
    }
  };
  return (
    <ul className="flex flex-col gap-2">
      {anexos.map((a, i) => {
        const seguro = urlSegura(a.url);
        return (
          <li key={i} className="flex items-center gap-3">
            <Miniatura url={a.url} mime={a.mime} nome={a.nome} largura={96} className="size-12 flex-none overflow-hidden rounded-botao border border-line bg-surface-2 [&_img]:size-full [&_img]:object-cover [&_img]:object-top" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-ui font-semibold" title={a.caminho}>{a.nome}</p>
              <p className="flex items-center gap-2 text-meta text-tx-3">
                {a.bytes ? bytes(a.bytes) : 'tamanho não informado'}
                {m.canal === 'whatsapp' && (a.enviado === false ? <Etiqueta tom="aviso">não vai</Etiqueta> : <Etiqueta tom="ok">vai junto</Etiqueta>)}
              </p>
            </div>
            <div className="flex flex-none">
              {seguro ? (
                <>
                  <Dica texto="Abrir"><a className="btn btn-fantasma btn-icone" href={seguro} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${a.nome}`}><ExternalLink size={15} strokeWidth={1.75} /></a></Dica>
                  <Dica texto="Baixar"><a className="btn btn-fantasma btn-icone" href={comParametro(seguro, 'baixar', '1')} aria-label={`Baixar ${a.nome}`}><Download size={15} strokeWidth={1.75} /></a></Dica>
                </>
              ) : (
                <Dica texto="O endereço deste anexo não é http(s): a Central não abre"><span className="btn btn-fantasma btn-icone text-tx-3" role="img" aria-label={`${a.nome}: endereço recusado`}><ShieldAlert size={15} strokeWidth={1.75} /></span></Dica>
              )}
              <Dica texto="Mostrar na pasta"><button type="button" className="btn btn-fantasma btn-icone" onClick={() => pasta(i)} aria-label={`Mostrar ${a.nome} na pasta`}><FolderOpen size={15} strokeWidth={1.75} /></button></Dica>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Historico({ m }: { m: Mensagem }) {
  const { dados: d } = useEventos(m);
  const versoes = useVersoes(m).dados;
  const agora = useAgora(60_000);
  const editada = m.corpo !== m.corpo_original;
  return (
    <div className="flex flex-col gap-3">
      {(editada || (versoes && versoes.length > 1)) && (
        <div className="flex flex-wrap gap-2">
          {editada && (
            <button type="button" className="btn btn-pequeno" onClick={() => ui.set({ comparando: { id: m.id, contra: 'original' } })}>
              <PenLine size={14} strokeWidth={2} aria-hidden /> Ver o que você mudou
            </button>
          )}
          {versoes && versoes.length > 1 && (
            <button type="button" className="btn btn-pequeno" onClick={() => ui.set({ comparando: { id: m.id, contra: versoes[versoes.length - 2].id } })}>
              <Layers size={14} strokeWidth={2} aria-hidden /> Comparar com a versão {versoes.length - 1}
            </button>
          )}
        </div>
      )}
      {versoes && versoes.length > 1 && (
        <ol className="flex flex-col gap-1">
          {versoes.map((v, i) => (
            <li key={v.id} className="flex items-center gap-2 text-meta">
              <span className={`font-mono ${v.id === m.id ? 'font-bold text-tx' : 'text-tx-3'}`}>v{i + 1} #{v.id}</span>
              <span className="text-tx-3">{v.sessao_nome || ''}, {curto(v.criado_em, agora)}</span>
              {v.id !== m.id && <Etiqueta>{v.status === 'substituida' ? 'substituída' : v.status}</Etiqueta>}
            </li>
          ))}
        </ol>
      )}
      {d?.eventos ? (
        <ol className="relative flex flex-col gap-2.5 pl-4 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-line">
          {d.eventos.map((e, i) => (
            <li key={i} className="relative text-meta">
              <span className="absolute top-1.5 -left-4 size-[7px] rounded-full bg-line-strong" aria-hidden />
              <span className="font-semibold text-tx">{EVENTO[e.tipo] || e.tipo}</span>{' '}
              <span className="text-tx-3" title={completa(e.em)}>{diaRelativo(e.em, agora)} {hhmm(e.em)}</span>
              {e.detalhe && <span className="block break-words text-tx-2">{aspas(e.detalhe)}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <Esqueleto linhas={3} />
      )}
    </div>
  );
}

export function ColunaContexto({ m }: { m: Mensagem }) {
  const agora = useAgora(30_000);
  const lint = useLint(m);
  const ctx = useContexto(m).dados;
  const previa = usePrevia(m).dados;
  const canais = useSel(dados, (e) => e.resumo?.canais);
  const clientes = useSel(dados, (e) => e.resumo?.clientes);
  const [trocando, setTrocando] = useState(false);
  const editavel = ['pendente', 'erro', 'aprovada'].includes(m.status);
  const contas = canais?.find((c) => c.id === m.canal)?.contas || [];
  const cliente = normCliente(m.cliente, m.app, clientes);
  const anexos = previa && 'anexos' in previa && previa.anexos?.length ? previa.anexos : anexosLocais(m);
  const prazo = m.extra?.prazo;
  const erro = m.status === 'erro' ? explicarErroEnvio(m) : null;
  const semDestino = !m.destino_id;
  const depoisDesta = useDepoisDesta(m);
  const temSequencia = editavel || !!m.depois_de || depoisDesta.length > 0;

  return (
    <div className="flex flex-col">
      {erro && (
        <div className="m-4 mb-0 rounded-item border border-danger-line bg-danger-soft px-4 py-3">
          <p className="font-bold text-danger">{erro.oque}</p>
          <p className="mt-1 text-ui text-tx-2">{erro.fazer}</p>
          {m.ultimo_erro && <p className="mt-2 break-words font-mono text-meta text-tx-3">{m.ultimo_erro}</p>}
          {m.tentativas > 0 && <p className="mt-1 text-meta text-tx-3">{m.tentativas === 1 ? '1 tentativa' : `${m.tentativas} tentativas`} até agora</p>}
        </div>
      )}
      {m.status === 'descartada' && (
        <div className="m-4 mb-0 rounded-item border border-line bg-surface-2 px-4 py-3">
          <p className="font-bold">{m.motivo_codigo ? NOME_MOTIVO[m.motivo_codigo] : 'Descartada sem motivo'}</p>
          {m.motivo && <p className="mt-1 text-ui text-tx-2">{m.motivo}</p>}
        </div>
      )}
      {m.status === 'enviada' && (
        <div className="m-4 mb-0 rounded-item border border-ok-line bg-ok-soft px-4 py-3">
          <p className="font-bold text-ok">Entregue {m.enviado_em ? `${diaRelativo(m.enviado_em, agora)} às ${hhmm(m.enviado_em)}` : ''}</p>
          {m.resultado?.resumo && <p className="mt-1 text-ui text-tx-2">{String(m.resultado.resumo)}</p>}
        </div>
      )}

      <Secao titulo="Quem preparou">
        <p className="text-ui font-bold break-words">{m.sessao_nome || 'Sessão sem nome'}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {m.app && <EtiquetaApp app={m.app} />}
          {cliente && <Etiqueta tom="contorno">{cliente}</Etiqueta>}
        </div>
        {(m.origem?.repo || m.origem?.dir) && (
          <p className="mt-2 flex items-start gap-1.5 text-meta text-tx-3" title={m.origem?.dir}>
            <GitBranch size={13} strokeWidth={2} className="mt-px flex-none" aria-hidden />
            <span className="min-w-0 break-all font-mono">{m.origem?.repo || m.origem?.dir?.split('/').slice(-2).join('/')}{m.origem?.branch ? `@${m.origem.branch}` : ''}</span>
          </p>
        )}
        <p className="mt-1 text-meta text-tx-3" title={completa(m.criado_em)}>Chegou {horaClara(m.criado_em, agora)}</p>
      </Secao>

      <Secao
        titulo="Destino"
        acao={editavel && !trocando ? (
          semDestino
            ? <button type="button" className="btn btn-principal btn-pequeno" onClick={() => setTrocando(true)}>Escolher destino</button>
            : <button type="button" className="btn btn-fantasma btn-pequeno" onClick={() => setTrocando(true)}><Repeat2 size={14} strokeWidth={2} aria-hidden /> Trocar</button>
        ) : null}
      >
        {semDestino ? (
          <p className="text-ui font-semibold text-danger">
            A sessão pediu “{m.para_pedido || '?'}” e {m.candidatos?.length ? `${m.candidatos.length} destinos combinam` : 'não achei ninguém'}.
          </p>
        ) : (
          <dl>
            <Linha rotulo={NOME_CANAL[m.canal]}><span className="font-semibold">{m.destino_nome || m.destino_id}</span></Linha>
            {m.destino_tipo && <Linha rotulo="Tipo">{TIPO_DESTINO[m.destino_tipo] || m.destino_tipo}</Linha>}
            {m.para_pedido && m.para_pedido !== m.destino_nome && <Linha rotulo="A sessão pediu">“{m.para_pedido}”</Linha>}
          </dl>
        )}
        {semDestino && !trocando && m.candidatos && m.candidatos.length > 0 && editavel && (
          <ul className="mt-2 flex flex-col gap-1">
            {m.candidatos.slice(0, 6).map((d) => (
              <li key={d.id}>
                <button type="button" className="flex w-full items-center gap-2 rounded-botao border border-line-campo px-3 py-2 text-left hover:border-accent hover:bg-accent-soft" onClick={() => trocarDestino(m.id, d)}>
                  {m.canal === 'whatsapp' && <Foto jid={d.id} nome={d.nome} grupo={d.tipo === 'grupo'} tamanho={32} />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{d.nome}</span>
                    <span className="block text-meta text-tx-3">{[d.tipo ? TIPO_DESTINO[d.tipo] : null, d.detalhe?.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2')].filter(Boolean).join(', ')}</span>
                  </span>
                  <ChevronRight size={16} strokeWidth={2} className="flex-none text-tx-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {trocando && (
          <TrocarDestino m={m} onFechar={() => setTrocando(false)} onEscolher={async (d) => { setTrocando(false); await trocarDestino(m.id, d); }} />
        )}
        {contas.length > 1 && (
          <label className="mt-3 block">
            <span className="rotulo">Sai pela conta</span>
            <select className="campo h-8" value={m.conta || ''} disabled={!editavel} onChange={(e) => trocarConta(m.id, e.target.value)}>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
        )}
      </Secao>

      {temSequencia && (
        <Secao titulo="Sequência">
          <ControleOrdem m={m} />
        </Secao>
      )}

      {m.canal === 'whatsapp' && m.status !== 'descartada' && m.status !== 'substituida' && (
        <Secao titulo="Resposta">
          <ControleAcompanhar m={m} />
        </Secao>
      )}

      {(m.responder_a || prazo || m.contexto) && (
        <Secao titulo="O caso">
          <dl>
            {m.responder_a && <Linha rotulo="Responde a"><span className="break-words">{m.responder_a}</span></Linha>}
            {prazo !== undefined && prazo !== null && prazo !== '' && (
              <Linha rotulo="Prazo"><span className="font-semibold">{typeof prazo === 'number' ? quando(prazo, agora) : String(prazo)}</span></Linha>
            )}
          </dl>
          {m.contexto && <NotaLonga texto={m.contexto} />}
        </Secao>
      )}

      <Secao titulo="Verificações">
        <Verificacoes m={m} lint={lint} />
      </Secao>

      {ctx && (ctx.minhaUltima || ctx.deleUltima) && (
        <Secao titulo={`Com ${(m.destino_nome || 'essa pessoa').split(' ')[0]}`}>
          <div className="flex flex-col gap-2.5">
            {ctx.deleUltima && (
              <div>
                <p className="text-meta text-tx-3">{ctx.deleUltima.quem ? `${ctx.deleUltima.quem}, ` : 'Última dele(a), '}{diaRelativo(ctx.deleUltima.em, agora)} {hhmm(ctx.deleUltima.em)}</p>
                <p className="line-clamp-3 text-ui text-tx-2">{ctx.deleUltima.texto}</p>
              </div>
            )}
            {ctx.minhaUltima && (
              <div>
                <p className="text-meta text-tx-3">Sua última, {diaRelativo(ctx.minhaUltima.em, agora)} {hhmm(ctx.minhaUltima.em)}</p>
                <p className="line-clamp-3 text-ui text-tx-2">{ctx.minhaUltima.texto}</p>
              </div>
            )}
            {!ctx.confiavel && ctx.motivo && <p className="text-meta text-warn">{ctx.motivo}</p>}
          </div>
        </Secao>
      )}

      {anexos.length > 0 && (
        <Secao titulo={anexos.length === 1 ? 'Anexo' : `${anexos.length} anexos`}>
          <Anexos m={m} anexos={anexos} />
        </Secao>
      )}

      <Secao titulo="Histórico">
        <Historico m={m} />
      </Secao>
    </div>
  );
}

function NotaLonga({ texto }: { texto: string }) {
  const [aberta, setAberta] = useState(false);
  const longa = texto.length > 220;
  return (
    <div className="mt-2 rounded-item bg-surface-2 px-3 py-2.5">
      <p className="rotulo mb-1">Nota da sessão</p>
      <p className={`whitespace-pre-wrap text-ui text-tx-2 ${!aberta && longa ? 'line-clamp-4' : ''}`}>{texto}</p>
      {longa && (
        <button type="button" className="mt-1 text-meta font-semibold text-accent-tx hover:underline" onClick={() => setAberta((a) => !a)}>
          {aberta ? 'Mostrar menos' : 'Mostrar tudo'}
        </button>
      )}
    </div>
  );
}
