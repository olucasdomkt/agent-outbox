# Central de Mensagens: o desenho do painel

Por que o painel é como é. O formato do que o servidor responde está em `docs/contrato-api-v2.md`.

**Resumo:** o cartão mostra a mensagem como quem recebe vai vê-la, com o contexto que você precisa para decidir em um toque: prévia fiel de cada canal, atalhos de teclado, 10 s para desfazer e motivo de descarte com uma tecla.

## 1. Os problemas que o desenho resolve

1. **Descarte sem motivo não ensina nada.** Se a mensagem vai para o lixo e ninguém diz por quê, as sessões repetem o mesmo erro. O motivo tem que custar uma tecla.
2. **Sessão escreve longo demais para WhatsApp.** Cinco parágrafos no celular é muito. O tamanho tem que aparecer antes de você abrir o cartão.
3. **Trava de segurança não pode depender do olho.** Senha indo para o destino errado, ou assunto de um cliente indo para outro, tem que ser barrado ou avisado pela máquina.
4. **Versão refeita não é mensagem nova.** A mesma mensagem corrigida é um cartão só, com histórico.
5. **Decidir tem que ser rápido.** Ler texto cru, imaginar como fica no celular e conferir o destino a cada cartão é o que deixa a aprovação lenta.

## 2. Princípios

- **O cartão é a mensagem como o destinatário vai ver.** Balão de WhatsApp, e-mail com assunto e assinatura, mensagem do Discord. Texto cru só no modo edição.
- **Uma decisão por cartão, em uma tecla.** Aprovar, editar, agendar e descartar não exigem mouse.
- **Nada é irreversível sem uma janela.** Aprovar abre 10 s de "desfazer" antes de sair de verdade.
- **"Aprovada" e "enviada" nunca se parecem.** São cor, ícone e lugar diferentes.
- **A máquina barra o que é perigoso; você decide o que é gosto.** Segredo no texto bloqueia. Mensagem longa, falta de acento e cliente cruzado só avisam.
- **Cada canal tem a sua cara.** Formatação, prévia e regras vêm do canal, não de um modelo genérico.

## 3. Estados

```
Para revisar → Aprovada (sai em 0:09, desfazível) → Na fila (aguardando intervalo ou horário) → Enviando → Entregue ✓
                                                                                            ↘ Erro (com o motivo e "tentar de novo")
Descartada (com motivo)   ·   Substituída (vira versão anterior dentro do mesmo cartão)
```

- Na aba "Para revisar" só fica o que espera você. Ao aprovar, o cartão sai da lista com uma faixa "Sai em 10 s · Desfazer (Z)".
- "Entregue" só aparece quando o canal confirmou: o WhatsApp devolveu o id, o Gmail devolveu o id da mensagem, o Discord aceitou.

## 4. Layout

**Computador (três colunas):**

```
┌ Fila ───────────────┬ Prévia ──────────────────────────────┬ Contexto ─────────────┐
│ ● Noemi · DIRETORIA │  [balões da conversa, últimas 6]     │ De: sessão AURORA     │
│   WhatsApp · 2 min  │  ┌────────────────────────────┐      │ Cliente: Aurora       │
│ ○ Otávio · WhatsApp │  │ ▎Noemi: quando fica pronto?│ ←cita│ Responde: Noemi 09:26 │
│ ○ Clara · e-mail    │  │ @Noemi, sai até sexta, com │      │ Prazo: hoje 18h       │
│                     │  │ *os números de setembro*   │      │ ⚠ 612 caracteres      │
│  agrupado por       │  └────────────────────────────┘      │ ✓ sem segredo         │
│  cliente/destino    │  [A aprovar] [E editar] [S agendar]  │ ✓ destino = cliente   │
└─────────────────────┴──────────────────────────────────────┴───────────────────────┘
```

- **Fila:** agrupada por cliente e depois por destino. Duas pendentes para o mesmo destino aparecem juntas, com o aviso de duplicada.
- **Prévia:** no canal certo, com o contexto real da conversa em cima (balões de quem falou) e a resposta em baixo.
- **Contexto:** origem (sessão, repositório, cliente), "responde a", prazo e o resultado do linter em lista curta.
- **Celular:** uma coluna. Deslizar para a direita aprova, para a esquerda descarta (abre os motivos), toque edita. É o mesmo servidor, que só escuta em 127.0.0.1: para abrir de outro aparelho é preciso um túnel com login, por sua conta.
- **Tema:** claro e escuro seguem o sistema. Contraste AA, foco visível, tudo acessível por teclado, leitor de tela anuncia o estado ("aprovada, sai em 9 segundos").

## 5. Atalhos (triagem)

| tecla | ação |
|---|---|
| J / K | próximo / anterior |
| A | aprovar (abre 10 s para desfazer) |
| E | editar (Esc sai sem salvar, Cmd+Enter salva e aprova) |
| S | agendar (sugere o próximo horário útil) |
| D | descartar: abre os motivos com 1 a 5 |
| X | marcar para lote; Shift+A aprova o lote, Shift+D descarta o lote |
| Z | desfazer a última ação dentro da janela |
| / | buscar |
| ? | mostra os atalhos |

**Motivos de descarte em uma tecla:** 1 já mandei · 2 tom errado · 3 longo demais · 4 destino ou cliente errado · 5 não é mais verdade · 0 sem motivo (não é o padrão: Enter sozinho não descarta). O que você descarta e corrige volta para as sessões pela tela Lições (`docs/contrato-api-v2.md`).

## 6. Cada canal

### WhatsApp
- **Prévia fiel em balão verde**, renderizando a formatação nativa: `*negrito*`, `_itálico_`, `~tachado~`, ` ```mono``` `, listas com "- " e "1. ", e quebra de linha como o celular mostra.
- **Citação:** o balão citado aparece em cima da resposta, como no app. Clique em outro balão do contexto para trocar a citação. Mensagem de grupo sem citação recebe a citação automática.
- **Menções:** "@Nome" aparece em azul na prévia. Se o nome não bate com ninguém do grupo, fica sublinhado em vermelho com a dica "ninguém com esse nome aqui".
- **Grupo × conversa direta:** etiqueta clara e número de participantes. Em grupo, a prévia mostra quem mais vai ler.
- **Anexos:** miniatura (imagem, primeira página do PDF, ícone do resto), nome e tamanho.
- **Avisos:** "você já disse isso" (a varredura do que você mandou à mão) e madrugada ou fim de semana com "agendar para seg 8h?".

### E-mail
- Prévia como no Gmail: conta remetente, para/cc, assunto, conversa anterior recolhida e a assinatura da conta.
- Linter: asterisco ou markdown vira alerta ("vai aparecer cru no Gmail"). Assunto vazio bloqueia.

### Discord
- Markdown renderizado (`**negrito**`, listas, código), canal com # ou conversa privada, e alerta se passar de 2.000 caracteres (o limite do Discord fatia a mensagem).

## 7. Editor

- **Barra de formatação por canal:** Cmd+B vira `*x*` no WhatsApp, `**x**` no Discord e não faz nada no e-mail. O mesmo vale para itálico e lista.
- **Prévia ao vivo** ao lado do texto. Contador com a referência do canal (WhatsApp: verde até 600, amarelo até 1.000, vermelho acima).
- **Linter em duas camadas:**
  - **Bloqueia** (não deixa aprovar): segredo no texto (senha, token, chave; padrões de texto mais os valores do cofre, se houver); destino vazio ou ambíguo; e-mail sem assunto; anexo perigoso.
  - **Avisa:** outra pendente para o mesmo destino; destino de um cliente com conteúdo de outro; texto sem acento ("nao", "voce"); `**duplo**`, `#` ou `>` no WhatsApp; markdown no e-mail; expressões com cara de texto de máquina; texto longo para o canal; madrugada e fim de semana; as suas lições.
- **Versões:** quando uma sessão refaz a mensagem para o mesmo destino, ela entra como nova versão do mesmo cartão, com a diferença entre as versões, em vez de virar um cartão novo.

## 8. O que não pode quebrar

- **Despachante:** a janela de 10 s não pode virar envio duplicado. Uma mensagem aprovada fica com `liberar_em` e o despachante ignora o que ainda não venceu. Cancelar é uma escrita atômica que só funciona se a mensagem ainda não está em `enviando`.
- **Contrato do `msg add`:** todas as sessões usam. Tudo o que for novo é opcional e aditivo. Nenhum parâmetro existente muda de sentido.
- **Prévia = envio:** a prévia usa o mesmo texto que vai para o canal, depois de passar pelas mesmas transformações (menções, citação, assinatura). Não pode existir um caminho para a prévia e outro para o envio.
- **Leitura pesada:** o contexto da conversa vem do banco da ponte. Ler balões para dezenas de cartões não pode travar o painel: há cache, e só o cartão aberto é carregado.

## 9. Escolhas feitas

1. **Desfazer em 10 s** (5 s e 30 s em Ajustes). 10 s mantém a fila andando; 30 s dá mais tempo para o arrependimento, mas segura tudo.
2. **Motivo de descarte em uma tecla**, com "sem motivo" possível mas nunca o padrão. É o motivo que alimenta o relatório e as lições.
3. **Só em 127.0.0.1.** É isso que protege a Central: não há login. Acesso de fora exige um túnel com autenticação.
4. **"Entregue" basta.** A Central mostra que o canal aceitou a mensagem; não mostra "lido".
5. **Versões pela flag `--substitui <id>`** e, da mesma sessão para o mesmo destino, sozinha. Deduzir só pelo destino erra quando há duas conversas diferentes com a mesma pessoa.
