// "?" mostra os atalhos de todas as telas.
import { useRef } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { ui, useSel } from '../lib/loja';
import { devolverFoco } from '../lib/foco';
import { Tecla } from './ui';

export const LISTA_ATALHOS: { grupo: string; itens: [string[], string][] }[] = [
  {
    grupo: 'Triagem',
    itens: [
      [['J', 'K'], 'Próxima e anterior'],
      [['A'], 'Aprovar (10 s para desfazer)'],
      [['E'], 'Editar'],
      [['S'], 'Agendar (sugere o próximo horário útil)'],
      [['D'], 'Descartar: 1 a 5 escolhem o motivo, 0 sem motivo'],
      [['Z'], 'Desfazer a última aprovação ou descarte'],
      [['X'], 'Marcar para o lote'],
      [['⇧', 'A'], 'Aprovar o lote'],
      [['⇧', 'D'], 'Descartar o lote'],
    ],
  },
  {
    grupo: 'No editor',
    itens: [
      [['⌘', '↵'], 'Salvar e aprovar'],
      [['⌘', 'S'], 'Salvar sem aprovar'],
      [['Esc'], 'Sair sem salvar (o rascunho fica guardado)'],
      [['⌘', 'B'], 'Negrito no jeito do canal'],
      [['⌘', 'I'], 'Itálico no jeito do canal'],
    ],
  },
  {
    grupo: 'Fila, erros e descartadas',
    itens: [
      [['U'], 'Voltar para revisão'],
      [['N'], 'Enviar agora (sem esperar o horário)'],
      [['T'], 'Tentar de novo'],
      [['R'], 'Restaurar uma descartada'],
      [['C'], 'Copiar o texto de uma entregue'],
    ],
  },
  {
    grupo: 'Entrada',
    itens: [
      [['R'], 'Responder (citando a mensagem escolhida)'],
      [['I'], 'Não precisa de mim'],
      [['L'], 'Ler a conversa inteira'],
    ],
  },
  {
    grupo: 'Acompanhar',
    itens: [
      [['C'], 'Cobrar (cria um rascunho para revisar; não envia)'],
      [['F'], 'Cumpri ou Recebi'],
      [['I'], 'Não preciso ou Dispensar'],
      [['L'], 'Ler a conversa inteira'],
    ],
  },
  {
    grupo: 'Em qualquer tela',
    itens: [
      [['/'], 'Buscar'],
      [['⌘', 'K'], 'Comandos'],
      [['1', '9'], 'Trocar de aba (1 é Para revisar, 9 é Lições)'],
      [['I'], 'Abrir o contexto quando a tela é estreita'],
      [['?'], 'Esta lista'],
    ],
  },
];

export function Ajuda() {
  const aberta = useSel(ui, (e) => e.ajuda);
  const caixa = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={aberta} onOpenChange={(v) => { ui.set({ ajuda: v }); if (!v) devolverFoco(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="anima-aparece fixed inset-0 z-[400] bg-veu" />
        <Dialog.Content ref={caixa} tabIndex={-1} onOpenAutoFocus={(e) => { e.preventDefault(); caixa.current?.focus(); }} className="anima-sobe painel-flutuante fixed top-1/2 left-1/2 z-[401] max-h-[85dvh] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 outline-none">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-titulo font-extrabold">Atalhos</Dialog.Title>
            <Dialog.Close className="btn btn-fantasma btn-icone" aria-label="Fechar"><X size={17} strokeWidth={2} /></Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Todas as teclas da Central, por tela.</Dialog.Description>
          <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
            {LISTA_ATALHOS.map((g) => (
              <section key={g.grupo}>
                <h3 className="rotulo">{g.grupo}</h3>
                <dl className="flex flex-col">
                  {g.itens.map(([teclas, oque]) => (
                    <div key={oque} className="flex items-center justify-between gap-4 border-b border-line py-1.5 last:border-b-0">
                      <dt className="text-ui text-tx-2">{oque}</dt>
                      <dd className="flex flex-none items-center gap-1">
                        {teclas.map((t, i) => (
                          <span key={t} className="flex items-center gap-1">
                            {i > 0 && teclas[0] === '1' ? <span className="text-meta text-tx-3">a</span> : null}
                            <Tecla>{t}</Tecla>
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
