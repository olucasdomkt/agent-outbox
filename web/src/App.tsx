// Casca da Central: barra de cima + a aba aberta no computador; uma coluna com abas embaixo no celular.
import { useEffect, useMemo, useRef } from 'react';
import { Tooltip } from 'radix-ui';
import { dados, ehVistaLista, ui, useSel } from './lib/loja';
import { useTeclado } from './lib/teclado';
import { useMidia, CONSULTA_CELULAR } from './lib/midia';
import { Topo, FaixaPausa, useContagens } from './componentes/Topo';
import { FaixaDesfazer, Avisos, Anunciador } from './componentes/Faixas';
import { Paleta } from './componentes/Paleta';
import { Ajuda } from './componentes/Ajuda';
import { Protegido } from './componentes/Protegido';
import { TelaMensagens } from './telas/Mensagens';
import { TelaEntrada, filtrarEntrada } from './telas/Entrada';
import { TelaAcompanhar, filtrarAcompanhar } from './telas/Acompanhar';
import { TelaRelatorio } from './telas/Relatorio';
import { TelaAjustes } from './telas/Ajustes';
import { TelaLicoes } from './telas/Licoes';
import { TelaCelular } from './telas/Celular';

export function App() {
  const vista = useSel(ui, (e) => e.vista);
  const celular = useMidia(CONSULTA_CELULAR);
  const buscaRef = useRef<HTMLInputElement>(null);
  const n = useContagens();

  const ganchos = useMemo(() => ({
    focarBusca: () => {
      const el = buscaRef.current;
      if (!el) return;
      el.focus();
      el.select();
    },
    itensEntrada: () => filtrarEntrada(dados.get().entrada, ui.get().verTudo, ui.get().busca),
    responderEntrada: () => ui.set((s) => ({ respondendo: s.sel.entrada || null })),
    lerEntrada: () => ui.set((s) => ({ lerConversa: s.lerConversa === s.sel.entrada ? null : s.sel.entrada || null })),
    itensAcompanhar: () => filtrarAcompanhar(dados.get().acompanhar, ui.get().busca),
  }), []);
  useTeclado(ganchos);

  // a aba do navegador mostra quantas esperam você
  useEffect(() => {
    const pendentes = n.revisar || 0;
    document.title = pendentes ? `(${pendentes}) Central de Mensagens` : 'Central de Mensagens';
  }, [n.revisar]);

  // trocar de aba limpa a busca e a seleção em lote
  useEffect(() => { ui.set({ busca: '', marcadas: [], respondendo: null }); }, [vista]);

  let conteudo: React.ReactNode;
  if (ehVistaLista(vista)) conteudo = <TelaMensagens key={vista} vista={vista} buscaRef={buscaRef} />;
  else if (vista === 'entrada') conteudo = <TelaEntrada buscaRef={buscaRef} />;
  else if (vista === 'acompanhar') conteudo = <TelaAcompanhar buscaRef={buscaRef} />;
  else if (vista === 'relatorio') conteudo = <TelaRelatorio />;
  else if (vista === 'licoes') conteudo = <TelaLicoes />;
  else conteudo = <TelaAjustes />;

  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {celular ? (
        <Protegido rotulo="Esta tela" chave={vista}><TelaCelular /></Protegido>
      ) : (
        <div className="flex h-dvh min-h-0 flex-col">
          <a href="#conteudo" className="sr-only-foco fixed top-2 left-2 z-[700] rounded-botao bg-accent px-3 py-2 font-bold text-accent-fg">Pular para o conteúdo</a>
          <Topo />
          <FaixaPausa />
          <div id="conteudo" className="min-h-0 flex-1" tabIndex={-1}><Protegido rotulo="Esta tela" chave={vista}>{conteudo}</Protegido></div>
        </div>
      )}
      <FaixaDesfazer celular={celular} />
      <Avisos />
      <Anunciador />
      <Paleta />
      <Ajuda />
    </Tooltip.Provider>
  );
}
