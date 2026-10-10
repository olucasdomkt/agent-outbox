// Cmd+K: ir para qualquer aba, agir na mensagem aberta, pausar, trocar o tema ou pular para uma mensagem.
import { Command } from 'cmdk';
import {
  ArrowRight, CalendarClock, Check, Keyboard, Monitor, Moon, Pause, Pencil, Play, Search, Sun, Trash, Undo2,
} from 'lucide-react';
import { useMemo } from 'react';
import { api, explicar } from '../lib/api';
import { alternarPausa, aprovar, desfazer, irPara } from '../lib/acoes';
import { avisar, dados, ehVistaLista, ui, useSel } from '../lib/loja';
import { Glifo, NOME_CANAL } from '../lib/canais';
import { curto, plural } from '../lib/formato';
import { aplicarTema } from '../lib/tema';
import { devolverFoco } from '../lib/foco';
import { textoLimpo } from '../lib/whatsapp';
import { ABAS } from './Topo';
import { Tecla } from './ui';
import type { Mensagem, Vista } from '../lib/tipos';

const VISTA_DO_STATUS: Record<string, Vista> = {
  pendente: 'revisar', aprovada: 'fila', enviando: 'fila', enviada: 'enviadas', erro: 'erro', descartada: 'descartadas',
};

function Item({ onSelect, children, valor, atalho }: { onSelect: () => void; children: React.ReactNode; valor: string; atalho?: string }) {
  return (
    <Command.Item
      value={valor}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-botao px-3 py-2 text-ui data-[selected=true]:bg-accent-soft data-[selected=true]:text-tx"
    >
      {children}
      {atalho && <Tecla className="ml-auto">{atalho}</Tecla>}
    </Command.Item>
  );
}

export function Paleta() {
  const aberta = useSel(ui, (e) => e.paleta);
  const msgs = useSel(dados, (e) => e.msgs);
  const pausado = useSel(dados, (e) => !!e.resumo?.pausado);
  const vista = useSel(ui, (e) => e.vista);
  const selId = useSel(ui, (e) => (ehVistaLista(e.vista) ? e.sel[e.vista] : undefined));
  const atual: Mensagem | undefined = selId ? msgs[Number(selId)] : undefined;
  const fechar = () => { ui.set({ paleta: false }); devolverFoco(); };
  const fazer = (f: () => void) => () => { fechar(); f(); };

  const lista = useMemo(() => {
    const vivas = Object.values(msgs).filter((m) => ['pendente', 'aprovada', 'enviando', 'erro'].includes(m.status));
    const outras = Object.values(msgs).filter((m) => !vivas.includes(m) && m.status !== 'substituida').sort((a, b) => b.atualizado_em - a.atualizado_em).slice(0, 120);
    return [...vivas.sort((a, b) => b.criado_em - a.criado_em), ...outras];
  }, [msgs]);

  return (
    <Command.Dialog
      open={aberta}
      onOpenChange={(v) => { ui.set({ paleta: v }); if (!v) devolverFoco(); }}
      label="Comandos"
      overlayClassName="anima-aparece fixed inset-0 z-[400] bg-veu"
      contentClassName="anima-sobe painel-flutuante fixed top-[12vh] left-1/2 z-[401] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden"
      loop
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Search size={17} strokeWidth={2} className="text-tx-3" aria-hidden />
        <Command.Input className="h-12 w-full bg-transparent text-ler outline-none placeholder:text-tx-3" placeholder="Ir para, fazer ou procurar uma mensagem" />
        <Tecla>Esc</Tecla>
      </div>
      <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-ui text-tx-2">Nada com isso. Tente o nome de quem recebe, um trecho do texto ou o número da mensagem.</Command.Empty>

        {atual && ['pendente', 'erro'].includes(atual.status) && (
          <Command.Group heading={`Na #${atual.id}, para ${atual.destino_nome || 'destino a escolher'}`} className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-tx-3">
            <Item valor="aprovar" atalho="A" onSelect={fazer(() => void aprovar([atual.id]))}><Check size={16} strokeWidth={2.2} aria-hidden /> Aprovar</Item>
            <Item valor="editar" atalho="E" onSelect={fazer(() => ui.set({ editando: atual.id }))}><Pencil size={16} strokeWidth={2} aria-hidden /> Editar</Item>
            <Item valor="agendar" atalho="S" onSelect={fazer(() => ui.set({ painel: { tipo: 'agendar', ids: [atual.id] } }))}><CalendarClock size={16} strokeWidth={2} aria-hidden /> Agendar</Item>
            <Item valor="descartar" atalho="D" onSelect={fazer(() => ui.set({ painel: { tipo: 'descartar', ids: [atual.id] } }))}><Trash size={16} strokeWidth={2} aria-hidden /> Descartar</Item>
          </Command.Group>
        )}

        <Command.Group heading="Ir para" className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-tx-3">
          {[...ABAS, { vista: 'relatorio' as Vista, rotulo: 'Relatório' }, { vista: 'ajustes' as Vista, rotulo: 'Ajustes' }, { vista: 'licoes' as Vista, rotulo: 'Lições' }].map((a, i) => (
            <Item key={a.vista} valor={`ir ${a.rotulo}`} atalho={String(i + 1)} onSelect={fazer(() => irPara(a.vista))}>
              <ArrowRight size={16} strokeWidth={2} aria-hidden className={vista === a.vista ? 'text-accent' : 'text-tx-3'} /> {a.rotulo}
            </Item>
          ))}
          <Item valor="ir acompanhar promessas sem resposta cobrar" onSelect={fazer(() => irPara('acompanhar'))}>
            <ArrowRight size={16} strokeWidth={2} aria-hidden className={vista === 'acompanhar' ? 'text-accent' : 'text-tx-3'} /> Acompanhar (quem não respondeu e promessas)
          </Item>
        </Command.Group>

        <Command.Group heading="Central" className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-tx-3">
          <Item valor="desfazer a última" atalho="Z" onSelect={fazer(() => void desfazer())}><Undo2 size={16} strokeWidth={2} aria-hidden /> Desfazer a última</Item>
          <Item valor={pausado ? 'retomar envios' : 'pausar envios'} onSelect={fazer(() => void alternarPausa())}>
            {pausado ? <Play size={16} strokeWidth={2} aria-hidden /> : <Pause size={16} strokeWidth={2} aria-hidden />} {pausado ? 'Retomar os envios' : 'Pausar todos os envios'}
          </Item>
          <Item
            valor="procurar o que eu já mandei varrer"
            onSelect={fazer(async () => {
              try {
                const r = await api.varrer();
                avisar(r.sumiram.length ? `${plural(r.sumiram.length, 'mensagem saiu', 'mensagens saíram')} da fila: você já tinha mandado.` : 'Nada na fila que você já tenha mandado.', 'ok');
              } catch (e) { avisar(explicar(e), 'erro'); }
            })}
          >
            <Search size={16} strokeWidth={2} aria-hidden /> Tirar da fila o que eu já mandei à mão
          </Item>
          <Item valor="tema seguir o sistema" onSelect={fazer(() => aplicarTema('sistema'))}><Monitor size={16} strokeWidth={2} aria-hidden /> Tema: seguir o sistema</Item>
          <Item valor="tema claro" onSelect={fazer(() => aplicarTema('claro'))}><Sun size={16} strokeWidth={2} aria-hidden /> Tema claro</Item>
          <Item valor="tema escuro" onSelect={fazer(() => aplicarTema('escuro'))}><Moon size={16} strokeWidth={2} aria-hidden /> Tema escuro</Item>
          <Item valor="atalhos teclas ajuda" atalho="?" onSelect={fazer(() => ui.set({ ajuda: true }))}><Keyboard size={16} strokeWidth={2} aria-hidden /> Ver os atalhos</Item>
        </Command.Group>

        <Command.Group heading="Mensagens" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-meta [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-tx-3">
          {lista.map((m) => (
            <Item
              key={m.id}
              valor={`#${m.id} ${m.destino_nome || ''} ${m.sessao_nome || ''} ${textoLimpo(m.corpo).slice(0, 140)}`}
              onSelect={fazer(() => irPara(VISTA_DO_STATUS[m.status] || 'revisar', m.id))}
            >
              <Glifo canal={m.canal} tamanho={15} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate font-semibold">{m.destino_nome || 'Sem destino'}</span>
                  <span className="font-mono text-meta text-tx-3">#{m.id}</span>
                </span>
                <span className="block truncate text-meta text-tx-3">{NOME_CANAL[m.canal]}, {curto(m.criado_em)}: {textoLimpo(m.corpo).slice(0, 90)}</span>
              </span>
            </Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
