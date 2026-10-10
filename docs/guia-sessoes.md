# Central de Mensagens: guia para as sessões do Claude

Este guia sai no terminal com `msg guia`. Ele acompanha o código que está no ar: o que está aqui é o que a Central faz.

A Central é a fila das mensagens que o dono manda: WhatsApp e, quando ligados nesta instalação, e-mail e Discord. A sessão enfileira e o dono lê, edita e aprova no painel (http://127.0.0.1:4912). Depois de aprovada, a Central envia sozinha. **Nada sai sem aprovação**, e **aprovada não quer dizer enviada**: há 10 s para desfazer e a fila envia em intervalos.

## Antes de escrever

- **Só enfileire o que já é verdade.** A mensagem nasce junto com a entrega; nada de "vou ver e te mando".
- **Uma mensagem por destino.** Antes de criar, veja o que já está na fila: `msg list --status pendente`.
- **Já mandou isso?** `msg contexto <canal> "<destino>"` mostra a última do dono e a última da outra pessoa.
- **Quais canais existem aqui?** `msg saude` mostra os canais ligados. Canal desligado é recusado no `msg add`.

## Enfileirar

```
msg add -c whatsapp -p "DIRETORIA AURORA" -r "Otávio: perguntou do relatório" <<'EOF'
texto, parágrafo em uma linha só
EOF
```

| Canal | `-p` (destino) | O que mais |
|---|---|---|
| `whatsapp` | nome do grupo ou do contato, telefone ou JID | só o primeiro anexo vai |
| `email` | endereço(s), separados por vírgula | `-s` assunto (obrigatório), `--cc`, `--conta` (uma das contas do `config.json`; sem isso vai pela primeira) |
| `discord` | `"#canal"` | sai pelo bot configurado |

Sempre que der: `-r` (a quem ou a que responde, 1 linha) e `--cliente` (o nome do cliente, como está no `config.json`). `-x` explica por que a mensagem existe (só aparece no painel). `--em "+2h"` ou `--em "2026-10-06 09:00"` sugere horário (sai nessa hora depois que o dono aprovar). `--anexo arquivo` (repita para vários).

## Destino certo

- **Confira o nome exato antes**: `msg destinos whatsapp "Otávio"`. O destino ambíguo vira "a escolher" e o dono escolhe no painel.
- **WhatsApp procura nas conversas da ponte e na agenda do celular.** O nome salvo no celular serve, mesmo sem conversa gravada.
- **Telefone**: com ou sem 55 e com ou sem o 9 depois do DDD; vale o contato que existe (conta antiga de WhatsApp é registrada sem o 9). **Nunca digite número de cabeça nem copie de nota antiga:** confira com `msg destinos`. Número fora da agenda e sem conversa dá aviso no linter, e a ponte recusa número sem conta ("número sem WhatsApp").
- **Nome repetido**: um primeiro nome sozinho pode bater em duas pessoas. Use o nome completo ou o JID que `msg destinos` mostra (`55DDNNNNNNNN@s.whatsapp.net`).

## Formatação por canal

- **WhatsApp**: `*negrito*` com UM asterisco; lista com `- ` ou `1. `; linha em branco entre blocos. Nunca `**duplo**`, `#` título ou `>` citação.
- **E-mail**: texto simples, sem asterisco (aparece cru no Gmail). A assinatura da conta entra sozinha.
- **Discord**: markdown normal (`**negrito**`). Acima de 2.000 caracteres sai em partes.
- Em todos: parágrafo em uma linha só e acentos certos. O linter avisa formato do canal errado, palavra sem acento e expressão com cara de texto de máquina.

## Corrigir uma mensagem (a anterior nunca sai junto)

| Situação | O que fazer |
|---|---|
| Mesma sessão, mesmo destino, a anterior ainda não saiu | `msg add` de novo: **substitui sozinho**. A saída diz `↻ substituiu a #N` |
| Outra sessão, ou a anterior foi para o destino errado | `msg add ... --substitui <id>` |
| São duas mensagens diferentes de propósito para o mesmo destino | `msg add ... --tambem` |
| Desistiu de uma mensagem sua | `msg descartar <id> "motivo"` (o dono pode restaurar) |

"A anterior ainda não saiu" quer dizer pendente, aprovada esperando ou com erro. Se ela já saiu, a versão nova leva um aviso. O mesmo texto para o mesmo destino em 30 minutos não cria outra: o `msg add` devolve a que já existe. Quando a saída do `msg add` mostra `? parece a #N ... com outro destino`, a sessão mandou quase o mesmo texto para outro destino: se foi correção de destino, descarte a anterior como a linha indica.

## Uma depois da outra

Quando o dono pedir "manda X e depois Y" (ou a ordem importar), **não deixe a ordem numa nota**: marque na Central. Ele pode aprovar tudo de uma vez que a Central segura a de depois até a anterior sair.

```
msg add -c whatsapp -p "Otávio Ramos" -r "..." <<'EOF'      # sai a #485
primeiro o painel
EOF
msg add -c whatsapp -p "Otávio Ramos" --depois 485 <<'EOF'
depois a pauta
EOF
msg add -c whatsapp -p "Otávio Ramos" --depois-da-resposta 486 <<'EOF'
só depois que ele responder
EOF
```

- `--depois <id>`: sai depois que a `<id>` sair. Não substitui a anterior, mesmo sendo da mesma sessão e para o mesmo destino.
- `--depois-da-resposta <id>`: sai só depois que a pessoa responder à `<id>`. Só WhatsApp em conversa direta (grupo, e-mail e Discord são recusados).
- Mudar depois: `msg depois <id> <anterior>` (com `--resposta` para esperar a resposta) e `msg depois <id> --solta` para tirar a ordem.
- **Corrigir uma mensagem da sequência**: mande de novo com o **mesmo** `--depois` (troca a que está naquela posição) ou use `--substitui <id>`. Sem `--depois`, o "substitui sozinho" troca a sua mais recente para aquele destino, que pode ser outra da sequência: na dúvida, `--substitui`. A versão nova fica no mesmo lugar da sequência.
- Duas mensagens depois da mesma anterior, de propósito: a segunda leva `--tambem`.
- Se a anterior for descartada ou der erro, a de depois fica **bloqueada** (o `msg add`, o `msg status` e o painel mostram) e só o dono solta ou descarta.

## Acompanhar a resposta

A aba Acompanhar do painel mostra quem não respondeu ao dono e as promessas (dele e para ele). Pergunta com "?" em conversa direta entra sozinha depois de 24 h sem resposta; promessa ("te mando amanhã") é achada sozinha no que sai e no que chega.

- Use `--acompanhar` quando a resposta importa e a mensagem não é pergunta, ou vai para grupo: proposta, contrato, pedido de aprovação, cobrança de prazo. Com horas, quando o prazo é outro: `--acompanhar 48`. Só WhatsApp.
- Não use para aviso, agradecimento ou "segue o link": a aba é para o que precisa de volta.
- **Cobrar** (no painel) só cria um rascunho curto, **pendente**, como qualquer mensagem: nada sai sem o dono aprovar.
- `msg acompanhar` lista o que está parado (`--tudo` traz todas as promessas abertas). Útil antes de escrever para alguém que deve resposta ou entrega ao dono.

```
msg add -c whatsapp -p "Otávio Ramos" --acompanhar 48 <<'EOF'
Otávio, segue a proposta revisada. Consegue me dar um retorno até quinta?
EOF
```

## O linter

O `msg add` responde na hora com o que o linter achou.

- **Bloqueio (✗)**: o dono não consegue aprovar. Corrija e mande de novo com `--substitui <id>`.
  - `segredo`: token, senha ou chave no texto, no anexo, no nome do anexo ou num destinatário. Com cofre configurado, o texto também é comparado com os valores guardados nele; se o cofre não responde, bloqueia e confere de novo em 1 minuto.
  - `destino`: falta destino, destino ambíguo ou endereço de cópia inválido.
  - `assunto`: e-mail sem assunto.
  - `anexo`: credencial, arquivo compactado, mais de 20 MB ou arquivo sumido.
- **Aviso (!)**: o dono vê no painel e decide. Corrija o que for seu:
  - `duplicada`: outra pendente para o mesmo destino. As da mesma sequência (`--depois`) não contam.
  - `cliente_cruzado`: o destino é de um cliente e o texto fala de outro. Vale para os clientes do `config.json` e as pessoas do `pessoas.json`; sem eles, não avisa.
  - `acento`, `formato`, `tamanho`, `ia`.
  - `destino`: número fora da agenda, ou e-mail com cópia ou cópia oculta (para conferir quem recebe).
  - `horario`: madrugada ou fim de semana; o aviso sugere agendar para o próximo dia útil às 8h.
  - `versao`: substitui uma mensagem que já saiu ou que deu erro.
  - `licao`: o dono costuma corrigir isso (ex.: `costuma tirar "Espero que esteja bem" (4×)`). Acerte e mande de novo com `--substitui <id>` antes de ele precisar corrigir. As lições ativas estão no fim deste guia, em "Lições do dono".

## Depois de enfileirar

- No chat, só 1 ou 2 linhas: `#id → destino` e do que se trata. O texto fica na Central.
- **Antes de dizer "enviado"**: `msg status <id>`. Status: `pendente`, `aprovada`, `enviando`, `enviada`, `erro`, `descartada` ou `substituida`. Aprovada que sai depois de outra mostra o que espera (`depois da #485`, `espera Otávio responder à #485`).
- Se deu erro, o `msg status` mostra o motivo. O painel explica e oferece "Tentar de novo". Número sem WhatsApp quase sempre é dígito errado.

## Ler em vez de pedir print

- `msg ler whatsapp "grupo ou contato" -n 30` (as mensagens do dono aparecem com o nome dele ou como "Você")
- `msg ler discord "#canal" -n 20`
- `msg ler email "consulta" --conta X` (ou o id da thread)
- `msg entrada [--canal X] [--tudo]`: o que chegou e espera resposta
- `msg saude`: quais canais estão no ar (e o cofre e a cópia de segurança, se houver)
