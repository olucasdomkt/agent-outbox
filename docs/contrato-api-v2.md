# Contrato da API v2 (plataforma)

O que o servidor (`src/server.js`) responde e o que o painel (`web/`) e o `msg` esperam dele. O porquê do desenho está em `docs/spec-ux.md`.

Nos textos que a Central escreve, "o dono" é quem aprova: com `dono.nome` no `config.json`, entra o primeiro nome dele no lugar ("o Tobias costuma tirar…").

**Regras que não mudam:** tudo é aditivo. Nada que o `msg add` usa hoje muda de sentido. Toda escrita continua exigindo o cabeçalho `x-central: 1`. O servidor continua só em 127.0.0.1, com a checagem de Host.

## Modelo

Colunas novas em `mensagens` (migração idempotente, `ALTER TABLE ... ADD COLUMN` só se faltar):

| coluna | tipo | para quê |
|---|---|---|
| `liberar_em` | INTEGER (ms) | fim da janela de desfazer. O despachante só pega `status='aprovada' AND (liberar_em IS NULL OR liberar_em <= agora) AND (agendar_para IS NULL OR agendar_para <= agora)` |
| `substitui_id` | INTEGER | versão anterior da mesma mensagem |
| `motivo_codigo` | TEXT | `ja_mandei`, `tom`, `longo`, `destino`, `desatualizada`, `outro`, `auto_respondida` (este é o da varredura) |
| `motivo` | TEXT | texto livre do descarte |
| `lint` | TEXT (JSON) | último resultado do linter `{bloqueios, avisos}` |

Status: `pendente`, `aprovada`, `enviando`, `enviada`, `erro`, `descartada` e o novo `substituida`.

Arquivos fora do repositório, junto do banco: `~/.central-mensagens/config.json` (quem é o dono, canais, clientes, cofre e o que o painel ajusta) e `~/.central-mensagens/pessoas.json` (diretório de pessoas, opcional). Os dois formatos estão no README.

## Endpoints novos ou alterados

| método e rota | corpo | resposta |
|---|---|---|
| `POST /api/mensagens/:id/aprovar` | `{}` | `{ok, liberar_em}`. **422** `{erro:'bloqueada', bloqueios}` se o linter bloquear. **409** se não estiver `pendente` ou `erro` |
| `POST /api/mensagens/:id/desfazer` | `{}` | volta para `pendente` se ainda está `aprovada`, num UPDATE condicional atômico. **409** `{erro:'ja_saiu'}` se não está mais |
| `POST /api/mensagens/:id/descartar` | `{motivo_codigo, motivo?}` | `{ok}` |
| `POST /api/mensagens/:id/agendar` | `{quando}` (epoch ms ou null) | `{ok}` |
| `PATCH /api/mensagens/:id` | `{corpo?, assunto?, destino_id?, destino_nome?, anexos?, extra?}` | a mensagem com o `lint` atualizado. Editar uma `aprovada` (que ainda não está `enviando`) devolve ela para `pendente` |
| `POST /api/lote` | `{acao:'aprovar'\|'descartar'\|'desfazer', ids, motivo_codigo?}` | `{resultados:[{id, ok, erro?}]}` |
| `POST /api/lint` | `{canal, destino_id?, destino_nome?, cliente?, assunto?, corpo, id?}` | `{bloqueios:[{regra, msg, trecho?}], avisos:[{regra, msg, trecho?}]}` |
| `GET /api/mensagens/:id/previa` | | a mensagem como vai sair, montada pelo **mesmo código do envio** (ver abaixo) |
| `GET /api/mensagens/:id/versoes` | | `[{id, criado_em, status, corpo, sessao_nome}]`, da mais antiga para a mais nova |
| `GET /api/mensagens` | query `status, canal, cliente, q, limite` | lista. `q` busca em corpo, destino_nome, sessao_nome e responder_a |
| `GET /api/stream` | | SSE com os eventos `mensagem` (linha completa), `resumo`, `saude` e `entrada` (contagem). Pega mudanças de qualquer processo (`PRAGMA data_version` a cada 1 s), não só as escritas do próprio servidor |
| `GET /api/relatorio?dias=14` | | `{porCanal, porDia, descartesPorMotivo, descartesPorSessao:[{sessao, criadas, descartadas, motivoTop}], tempoAprovacaoMedianaMin, editadasPct}` |
| `GET/PUT /api/config` | | passa a ter `{sumirRespondidas, janelaDesfazerMs: 10000, assinaturas: {<conta>: texto}}` |
| `GET /api/pessoas` | | `[{nome, cliente?, apelidos?, emails?}]` |

### Prévia por canal (`/previa`)

- **whatsapp:** `{canal, para:{id, nome, tipo:'grupo'|'contato', participantes?}, corpo, mencoes:[{jid, numero, nome}], citar:{id, de, texto}|null, anexos:[{caminho, nome, bytes, mime, url}], contexto:[{id, de, eu, texto, em, midia?}]}`. `corpo` já vem com as menções trocadas e a citação automática aplicada.
- **email:** `{canal, conta:{id, email}, para, cc, assunto, corpo, assinatura, thread:[{de, em, trecho}]}`. A assinatura é a de `config.assinaturas[conta]`; se existir, o envio também a acrescenta.
- **discord:** `{canal, alvo:{id, nome, tipo:'canal'|'dm', servidor?}, corpo, partes:[string], bot:{nome}}`. `partes` é como o texto vai ser fatiado em 2.000 caracteres.

## Linter (`src/lint.js`, função pura mais os dados que ela consulta)

- **Bloqueia** (o aprovar recusa com 422):
  - `segredo`: padrões de token, chave, JWT, chave privada e `senha:`; com cofre configurado (`config.json` → `cofre.helper`), também os valores guardados nele, comparados só dentro do processo e nunca impressos.
  - `destino`: sem destino ou com destino ambíguo.
  - `assunto`: e-mail sem assunto.
- **Avisa:**
  - `duplicada`: outra pendente para o mesmo destino (as da mesma sequência, ligadas por `depois_de`, não contam).
  - `cliente_cruzado`: o cliente do destino é diferente do cliente citado no texto. Movido a dados: os clientes do `config.json` e as pessoas do `pessoas.json`; sem eles, não avisa.
  - `acento`: "nao", "voce", "entao", "tambem"...
  - `formato`: `**`, `#` ou `>` no WhatsApp; asterisco ou markdown no e-mail.
  - `tamanho`: WhatsApp acima de 600 e de 1.000 caracteres; Discord acima de 2.000.
  - `ia`: expressões com cara de texto de máquina (a lista está em `src/lint.js`; é gosto, edite à vontade).
  - `horario`: madrugada ou fim de semana, com sugestão de agendar.
  - `licao`: uma lição ativa do dono (seção "Lições", no fim). O item traz também `licao` (o id).

## CLI

- `msg add --substitui <id>`: cria uma nova versão. A anterior, se ainda `pendente`, vira `substituida`. Se já saiu, a nova ganha o aviso "substitui uma mensagem que já foi enviada".
- `msg status <id>` mostra "aprovada, sai em N s".

## Estático

- `/` serve `web/dist`. Sem o build, responde 503 com uma página que diz o comando (`npm run build:web`); a API e o `msg` funcionam do mesmo jeito.

## Modo prévia (só para teste)

`CENTRAL_DB=<cópia> CENTRAL_MODO=previa PORT=<porta livre>`: sem despachante, sem notificações e com o `enviar` de todos os canais lançando erro. **Nunca** apontar para `~/.central-mensagens/central.db`. Dois servidores no mesmo banco são dois despachantes, ou seja, envio em duplicado.

## Detalhes

O que as respostas trazem além do resumo acima.

### Respostas

- `aprovar`, `desfazer`, `descartar` e `agendar` devolvem **a linha inteira** mais `ok: true` (o `liberar_em` do contrato está nela). `PATCH` e `restaurar` devolvem a linha com o `lint` novo. `GET /api/mensagens/:id` traz também `eventos: [{em, tipo, detalhe}]`.
- Erro é sempre `{erro, ...dados}`: o 409 traz `status`, o 422 traz `bloqueios`. `desfazer` numa `pendente` não é erro (devolve a linha).
- `aprovar` aceita `{agendar_para}` opcional. Datas (`agendar_para`, `quando`) aceitam epoch ms, `"+30m"`, `"+2h"`, `"+1d"` ou `"2026-10-06 08:00"`; horário no passado = sem horário.
- `agendar`: `quando` é obrigatório (400 sem ele). Em `pendente` ou `erro` só grava o horário (quem manda sair é o aprovar); em `aprovada` reprograma, e `null` = sai já.
- `descartar` vale para `pendente`, `aprovada` e `erro`; `motivo_codigo` fora da lista = 400; `motivo` é cortado em 500 caracteres.
- `lote`: até 200 ids (repetido conta uma vez). Cada resultado é `{id, ok: true, status}` ou `{id, ok: false, erro, status?, bloqueios?}`; o aprovar em lote passa pelo mesmo linter.
- `PATCH`: `extra` é **mesclado** no que já existe (chave com `null` apaga); `anexos` novos passam pela validação e viram cópia da Central (lista vazia apaga); `conta` desconhecida = 400. Editar uma `aprovada` que ainda não saiu devolve para `pendente`.
- Nova versão (`substitui_id`, `msg add --substitui`): a anterior vira `substituida` se estiver `pendente` **ou `aprovada` esperando** (as duas nunca saem). Se a anterior já saiu, a nova ganha o aviso `versao`; se a anterior deu erro, o aviso pede para conferir se ela saiu. `substitui_id` que não existe = 404.
- `atualizado_em` é a versão da linha e só cresce: toda escrita grava `MAX(agora, atualizado_em + 1)`. Serve de chave de "mudou" (o SSE usa).
- `GET /api/mensagens`: `status` aceita lista separada por vírgula; `limite` vai de 1 a 2000 (padrão 200).
- `relatorio`: a coorte são as mensagens **criadas** nos últimos `dias` (1 a 365), cada uma com o status de agora. Vem também `dias`, `desde` e `total`; `porCanal[]` = `{canal, criadas, enviadas, descartadas, erros, abertas, editadas, tamanhoMedio, aprovacaoMedianaMin}`; `porDia[]` = `{dia, canal, criadas, enviadas, descartadas}`; `descartesPorMotivo[]` = `{motivo_codigo, n}` (`null` = descarte sem código).
- `config`: o `GET` traz também `senhasDeCliente` (só leitura; muda à mão no `config.json`). `PUT` e `POST` aceitam `janelaDesfazerMs` (0 a 60000), `assinaturas` (`{conta: texto}`, só contas de e-mail conhecidas, até 2000 caracteres, texto vazio apaga) e `sumirRespondidas`.
- `pessoas`: o conteúdo do `pessoas.json`. Sem o arquivo, lista vazia (o linter segue sem diretório).
- `resumo` traz `modo` (`normal` ou `previa`), `dono` (o nome do `config.json`, ou `null`), `clientes` (os nomes dos clientes do `config.json`) e `canais` (só os ligados: o WhatsApp sempre; e-mail e Discord depois de configurados). Canal desligado não aparece no painel e é recusado no `POST /api/mensagens`.
- `previa` a mais: no WhatsApp, `citar` traz também `sender` e `automatica` (true = a Central escolheu a mensagem citada; não veio em `extra.citar`) e cada anexo traz `enviado`; no e-mail vêm `bcc`, `html`, `anexos[]` e, quando o fio não pôde ser lido, `threadAviso` no lugar de `thread`.
- Migração: descarte de antes da v2 ganha `motivo` (copiado do evento) e, se foi a varredura do "já respondi", `motivo_codigo = 'auto_respondida'`. Os outros ficam com `motivo_codigo` nulo.

### `/api/saude` e o evento `saude` do SSE

Além de um par por canal vem a chave **`segredos`**, o estado do cofre do linter (nunca um valor): `{ok, idadeMin, total, falhas: [nomes], erro, bloqueia, lendo, desligado?}`. `bloqueia: true` = o linter barra toda mensagem até conseguir ler o cofre. `desligado: true` = nenhum cofre configurado: o linter confere só os padrões de texto e nada fica barrado por isso. **`segredos` não é canal**: a interface trata à parte (o `msg saude` mostra como "cofre do linter").

A chave **`copia`** é a saúde da cópia de segurança, para quem tem um script de cópia; também não é canal: `{estado, ok, aviso, resumo, erro?, ultimoOk?}` (`src/copia.js`, lida na hora, fora do cache de 15 s). A Central não copia nada: só lê o arquivo de estado que o seu script grava (`~/.central-mensagens/copia-estado.json`, trocável por `CENTRAL_BACKUP_ESTADO`; `criarApp({copiaEstado})` nos testes; o formato está no README):
- `desligada` ("Cópia de segurança: ainda não ligada"): o arquivo não existe ou nunca houve uma cópia que deu certo de verdade.
- `ok` ("Cópia de segurança: hoje 03h41"): o último `ultimo_ok` tem menos de 36 h (fuso de São Paulo; "ontem 03h41", "04/10 03h41").
- `falhou` (aviso, com o erro): a última execução de verdade falhou, ou o arquivo não pôde ser lido.
- `atrasada` (aviso): o último ok passou de 36 h.
- Execução de teste (`seco: true`) não conta: vale o `ultimo_ok`, que o script só grava em execução de verdade.

### Linter

- Resultado: `{bloqueios, avisos, cofre}`, com `cofre: true` quando os valores do cofre entraram na conferência. Cada item: `{regra, msg, trecho?, naoChecou?, sugestao?}`.
  - `naoChecou: true`: não deu para conferir (cofre, anexo). O despachante trata como passageiro e tenta de novo.
  - `sugestao` (só no `horario`): epoch ms do próximo horário útil (dia de semana, 8h), para o botão "agendar".
  - `trecho` nunca traz valor de segredo: palavra com cara de credencial vira `••••`, e nome de anexo ou destinatário que contém segredo some de todos os motivos.
- Regras a mais: `anexo` (bloqueia ou avisa), `versao` (aviso) e `destino` também como aviso de cópia oculta (Cco) no e-mail.
- O que é varrido atrás de segredo é **o que o canal manda**, pelo mesmo `montar()` do envio (`canal.saida(m)`); o motivo diz onde: `no texto` (WhatsApp já com as menções trocadas), `no texto (com a assinatura)` (e-mail), `no texto como aparece no e-mail` (HTML sem as tags), `no assunto`, `na citação`, `no destinatário`, `no nome do anexo` (`no nome do anexo N` no e-mail), `na parte N do Discord` e `no anexo <nome>` (conteúdo do anexo de texto). Sem destino ainda, valem os campos da linha.
- Antes de varrer: sem caracteres invisíveis (categoria Cf, como U+200B a U+200D, U+2060, U+FEFF e U+00AD), NFKC (largura total vira ASCII) e homógrafos cirílicos e gregos comuns. Valor do cofre também é achado com separador entre os caracteres (espaço, quebra, ponto).
- Falha fechado, sempre bloqueio `segredo`:
  - cofre que não respondeu em 15 s;
  - qualquer nome do cofre sem leitura (a leitura anterior vale até 1 h; nome novo sem leitura bloqueia);
  - erro dentro do linter;
  - anexo não conferido;
  - texto (assunto + corpo) ou qualquer pedaço que sai acima de 200 mil caracteres (este sem `naoChecou`: tentar de novo não muda nada).
- `POST /api/lint` aceita também `conta`, `anexos`, `extra`, `candidatos` e `agendar_para`. Com `id`, parte da linha do banco e troca só o que veio.

### Anexos

- Uma validação só (`src/anexos.js`), na criação, na edição, no linter, no download e no envio:
  - caminho absoluto de arquivo comum (atalho é seguido até o arquivo real);
  - recusa nome ou pasta de credencial (`.env`, `id_rsa`, `.pem`, `.key`, `.kdbx`, `credentials.json`, `~/.ssh`, `~/.aws`, `~/.claude.json`...), mesmo que o arquivo nem exista; Keynote (`.key`) também cai aqui, e a mensagem pede para exportar em PDF;
  - recusa compactado, chave privada ou token dentro do arquivo e mais de 20 MB somados, em qualquer canal.
- Na criação, a recusa é **400** com o motivo e a mensagem não é criada. A Central guarda uma cópia em `~/.central-mensagens/anexos/<id>/` e a linha passa a apontar para ela.
- Na prévia, o WhatsApp marca `enviado: true` só no primeiro anexo, e o e-mail traz o `mime` do envio.
- `GET /api/mensagens/:id/anexo/:i` (`?baixar` = download): **403** se o arquivo não passa mais na validação, 404 se sumiu. Vai com CSP `sandbox` (menos PDF).
- O e-mail sai com o anexo em base64 lido pela Central. O WhatsApp lê uma cópia de vida curta em `~/.central-mensagens/envio/`, apagada depois do envio.

### Foto de perfil do WhatsApp

- `GET /api/fotos/whatsapp/:jid` (contato `@s.whatsapp.net`, número escondido `@lid` ou grupo `@g.us`): **200** com a miniatura JPEG, **204** sem foto (ou foto escondida), **202** enquanto a Central ainda pergunta ao WhatsApp (o painel tenta de novo). **400** para o que não é JID e **403** para pedido de outro site (`Sec-Fetch-Site`). Só pergunta ao WhatsApp por quem já tem conversa ou contato na agenda, ou é destino de mensagem da fila; o resto é 204.
- A pergunta vai para a ponte (`GET 127.0.0.1:8080/api/avatar?jid=`, que devolve a URL da miniatura no CDN do WhatsApp) e a Central baixa e guarda em `~/.central-mensagens/fotos/whatsapp/`: uma por vez, só JPEG de até 512 KB vindo de `*.whatsapp.net` por https. Foto vale 7 dias e renova por trás; "sem foto" vale 1 dia; ponte fora do ar tenta de novo em 5 min sem marcar "sem foto". O código da ponte está em `ponte/main.go`.

### Envio

- O despachante confere de novo, com o mesmo linter, o texto relido do banco na hora de enviar. Bloqueio vira `ultimo_erro` "barrada pelo linter na hora de enviar: ..."; se todos os bloqueios forem `naoChecou`, ele tenta de novo dentro da janela de retentativa (6 h).
- Despachante sem essa conferência não sobe.

## Ordem entre mensagens

Por quê: quando várias mensagens para a mesma pessoa têm de sair numa ordem (uma delas só depois da resposta), a ordem não pode morar numa nota: aprovando em lote, elas podiam sair trocadas.

### Modelo

| coluna | tipo | para quê |
|---|---|---|
| `depois_de` | INTEGER | a anterior: esta só sai depois que ela estiver `enviada` |
| `espera_resposta` | INTEGER 0/1 (padrão 0) | além disso, só sai depois que a pessoa responder à anterior |
| `respondida_em` | INTEGER (ms) | quando a pessoa respondeu (gravado pelo despachante; libera a de depois uma vez só) |

- O despachante só pega uma aprovada com `depois_de` quando a anterior está `enviada` e, com `espera_resposta`, quando `respondida_em` foi gravado. A mesma condição está no `marcarEnviando` (trava no SQL). Não há intervalo extra: o intervalo de cada canal já espaça os envios.
- Resposta: a cada volta, o despachante pergunta à fonte de respostas (injetada; o servidor passa `canal.ultimaRecebida`, que lê só em modo leitura o `messages.db` da ponte) quando a pessoa mandou a última mensagem na conversa direta, pelo telefone e pelo `@lid`. Mensagem recebida depois do `enviado_em` da anterior libera. Vale também com os envios pausados (o painel mostra; nada sai até retomar).
- `espera_resposta` só vale quando a anterior é WhatsApp em conversa direta. Nos outros casos: **400**.
- **Versão nova da anterior:** quando a anterior vira `substituida`, o `depois_de` de quem espera por ela (inclusive a descartada, que pode ser restaurada) passa para a versão nova, na hora da troca (escolhido no lugar de seguir a cadeia de `substitui_id` em toda leitura: um lugar só, e o despachante continua em SQL simples). Marcar `depois_de` de uma mensagem que já foi substituída grava a versão viva.
- **Versão nova da de depois:** sem `depois_de` no pedido, a versão nova herda a ordem (e a resposta já recebida) da que ela substitui, para a ordem que o dono marcou não sumir numa correção. O "substitui sozinho" (mesma sessão, mesmo destino) com `depois_de` só troca a mensagem da mesma posição, a que também sai depois da mesma anterior: "manda X e depois Y" nunca troca X por Y.
- **Anterior descartada ou com erro:** a de depois não sai e fica `bloqueada`. Nunca libera sozinha: o dono solta (`depois_de: null`) ou descarta. Restaurar a anterior ou tentar de novo faz voltar a esperar por ela.
- Validação (no repositório, a API devolve o código): a anterior existe (**404**), não é a própria nem a versão que esta substitui (**400**), não fecha ciclo, direto ou indireto (**400**, "as duas ficariam esperando uma pela outra"), e não está descartada no momento de marcar (**400**). Mudar a ordem de quem já saiu (enviada, enviando, descartada, substituída) é **409**.
- Eventos: `marcada` ("sai depois da #485", "sai só depois que Otávio responder à #485"), `liberada` ("a #485 saiu: liberada", "Otávio respondeu à #485: liberada"), `bloqueada` ("a #485 foi descartada; esta esperava por ela", "a #485 deu erro; ..."), `solta` ("saiu da sequência: não espera mais a #485") e `ordem` (informativo: a anterior saiu e agora falta a resposta, a anterior ganhou versão nova, versão nova que manteve a sequência). Toda mudança na anterior que muda o estado de quem espera por ela muda também a versão (`atualizado_em`) da de depois: o SSE leva o estado novo ao painel.

### API

| método e rota | corpo | resposta |
|---|---|---|
| `POST /api/mensagens` | também `depois_de` (485 ou `"#485"`) e `espera_resposta` (bool) | a linha, com `aguardando` |
| `PATCH /api/mensagens/:id` (ou `PUT`, a mesma rota) | `{depois_de?, espera_resposta?}`, sozinhos ou junto da edição | a linha. `depois_de: null` solta (e zera `espera_resposta`); campo ausente mantém o que está. Só a ordem **não** devolve a aprovada para revisão: ela só atrasa a saída |
| `GET /api/mensagens` e `GET /api/mensagens/:id` (e o SSE) | | cada linha traz `aguardando` (abaixo) |

`aguardando` é `null` (não espera nada) ou `{id, motivo, status, quem}`:
- `motivo: 'anterior'`: a anterior (`id`) ainda não saiu;
- `motivo: 'resposta'`: a anterior saiu e falta `quem` (o `destino_nome` dela) responder;
- `motivo: 'bloqueada'`: a anterior foi descartada ou deu erro (`status` diz qual); só o dono solta ou descarta.
- `status` é o da anterior na hora da leitura. Para mensagem que não espera mais (enviada, descartada), `aguardando` é `null`.

Aprovar uma de depois antes da anterior é permitido: ela fica `aprovada` com `aguardando` até a vez dela.

### CLI

- `msg add ... --depois <id>` e `msg add ... --depois-da-resposta <id>` (só WhatsApp em conversa direta).
- `msg depois <id> <anterior> [--resposta]` marca; `msg depois <id> --solta` tira a ordem (PUT).
- A saída do `msg add` mostra `↳ depois da #485` (ou `↳ espera Otávio responder à #485`, `↳ BLOQUEADA: ...`), e o `msg list`/`msg status` acrescentam a mesma informação à linha.

### Painel

- Lista (computador e celular): selo discreto embaixo do texto, "depois da #485", "depois da #485 e da resposta", "espera Otávio responder" ou, em vermelho, "bloqueada: a #485 foi descartada". Na aprovada quem diz é o selo de estado ("Aprovada, esperando a #485", também na prévia do WhatsApp), e na aba Na fila ela vem depois das que estão livres.
- Barra de decisão: uma linha com o que ela espera. Bloqueada vira caixa vermelha com **Soltar** (o Descartar continua na barra).
- Seção "Sequência" do contexto (no celular, dentro do editor e do detalhe): **Sai depois de…** sugere primeiro as que ainda não saíram para o mesmo destino (as criadas antes desta na frente), depois as duas últimas que já saíram para ele, e aceita o número de qualquer outra. "Só depois que Otávio responder" aparece quando é WhatsApp em conversa direta. Com a ordem marcada: a anterior (com link), onde a espera está agora, Trocar, Soltar e quem sai depois desta.
- Aprovar uma de depois: a faixa de desfazer diz "Depois da #485. Dá para desfazer por mais 10 s." no lugar de "Sai em 10 s".

### Estático e segurança

- Toda página servida leva esta CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`.
  - Para a interface: **nada de script inline nem fonte ou CSS de CDN** (Google Fonts é barrado); a fonte vai junto no build.
  - Arquivos em `/assets/` (hash do Vite) têm cache imutável; o resto vai com `no-cache`. Rota sem extensão cai no `index.html`.
- O modo prévia recusa subir:
  - sem `CENTRAL_DB`, com o banco de verdade ou com qualquer arquivo na pasta dele (`~/.central-mensagens/`);
  - sem `PORT`, ou na porta 4912.

## Acompanhar

Por quê: pergunta que ficou sem resposta e promessa feita no meio da conversa (dos dois lados) só existem na conversa, e somem. A aba mostra o que está parado do lado de lá e o que foi prometido. Precisão vale mais que cobertura: na dúvida, não entra.

### Modelo

| onde | o quê |
|---|---|
| `mensagens.acompanhar` | INTEGER (horas) ou NULL. Marcada: se a pessoa não responder nesse tempo depois do envio, entra na aba. Só WhatsApp (conversa direta ou grupo); e-mail e Discord: **400**. A versão nova herda a marca. Mudar a marca não reabre a aprovada (evento `acompanhar`). |
| tabela `promessas` | `chave` UNIQUE (origem + id da mensagem), `origem` (`central` ou `whatsapp`), `sentido` (`minha` = o dono prometeu, `dele` = prometeram a ele), `canal`, `destino_id` (no WhatsApp, sempre o telefone), `destino_nome`, `mensagem_id` (a da Central), `trecho` (o compromisso, ex. "te mando"), `frase` (a frase em volta, até 160), `em`, `prazo`, `prazo_dito` (o texto do prazo, NULL = sem prazo), `status` (`aberta`, `cumprida`, `recebida`, `dispensada`), `fechada_em`, `cobranca_id` |

**Esperando eles** (WhatsApp, calculado na leitura, sem tabela): a última fala da conversa é do dono (pela Central ou pelo celular, telefone e `@lid` juntos), tem pergunta de verdade (link, citação e "tudo bem?" não contam) ou é uma enviada marcada, e o prazo passou (24 h depois da última fala dele; a marcada usa as horas dela). "A pessoa respondeu" é a mesma leitura da ordem entre mensagens (`whatsapp.ultimaRecebida`), e empate conta como resposta. Fora: grupo (a não ser a marcada; aí qualquer fala de outra pessoa conta como resposta), o próprio número do dono (telefone e `@lid`), conversa com a última fala dele há mais de 14 dias, e o que o dono dispensou (**Não preciso**: grava em `vistos` a chave `acompanhar:whatsapp:<telefone>` com o `em` do item; volta quando chega mensagem nova na conversa). Ponte parada há mais de 12 h ou sem banco: a lista não traz nenhum item do WhatsApp e `erros.whatsapp` diz por quê.

**Promessas**: uma por mensagem (a primeira frase com compromisso). Do dono: o que a Central enviou (qualquer canal), na hora do envio (o despachante chama `aoEnviar`) e na varredura; e o que ele mandou pelo celular em conversa direta. Para ele: o que chegou em conversa direta, de contato com nome na agenda. Detector (`src/acompanhar.js`):
- forte, vale sem prazo: "te mando/envio/retorno/aviso/confirmo/respondo/encaminho", "vou te mandar/enviar/passar...", "vou mandar ... pra você", "eu aviso", "volto a falar", "te dou um retorno" (e as formas no plural);
- fraco, só com prazo dito no mesmo pedaço da frase: "vou ver/resolver/fazer...", "resolvo/faço/mando/vejo...", "te ligo/te falo/te passo";
- não entra: frase que termina em "?", condição ("se você quiser", "quando puder", "qualquer coisa"), dúvida ("acho que", "talvez"), negação logo antes, citação (linha com `>` e trecho entre aspas), terceira pessoa ("ele disse que te manda"), o que é agora ("já te mando", "te mando agora", "calma que te mando"), entrega na própria mensagem sem prazo dito (anexo, link, "segue", "em anexo") ou logo depois pelo celular (arquivo, link ou texto longo da mesma pessoa em até 10 min), "te aviso que...", "te mando um abraço", "te vejo amanhã".
- Prazo, no fuso de São Paulo e contado de quando a mensagem saiu: hoje, ainda hoje, fim do dia, mais tarde, à noite = 18h (23h59 se já passou das 18h); amanhã = 18h; amanhã cedo = 10h; de manhã = o próximo 10h; dia da semana = o próximo, 18h; "até 10/10" ou "dia 10" = esse dia, 18h; semana que vem = segunda, 18h; "às 15h" = hoje; sem prazo = 48 h.
- Varredura a cada 10 min (e 5 s depois de subir, também no modo prévia, que só grava na cópia): só o que é novo desde a passada anterior (a Central pelo `enviado_em`, a ponte pelo `rowid`), no máximo 14 dias para trás; a ponte espera 10 min antes de ler uma mensagem (para ver se o arquivo veio logo depois). A chave não deixa duplicar, e a mensagem que a Central mandou e que aparece também na ponte vira uma promessa só (mesmo trecho, mesmo destino, até 30 min de diferença).

### API

| método e rota | corpo | resposta |
|---|---|---|
| `GET /api/acompanhar[?tudo=1]` | | `{itens, contagem: {total, esperando, promessas}, erros}`. Sem `tudo`: promessa aberta que vence em até 12 h ou venceu há até 7 dias. Ordem do prazo (atrasadas primeiro, depois as mais antigas) |
| `POST /api/acompanhar/cobrar` | `{chave}` | a mensagem criada: **pendente**, com rascunho curto ("Oi, Otávio! Conseguiu ver?"; promessa para ele: "Conseguiu mandar?" ou "Alguma novidade?"; grupo: "Oi, pessoal! Conseguiram ver?"), `extra.acompanhar = chave`, `sessao_nome: 'painel'`. Nunca aprova. Se já existe cobrança desse item que ainda não saiu, devolve ela com `ja: true`. Item que não está mais na aba: **404**; promessa do dono: **400** |
| `POST /api/entrada/visto` | `{chave, em}` | o **Não preciso** do Esperando eles (o mesmo da Entrada) |
| `POST /api/promessas/:id/cumpri` · `recebi` · `dispensar` · `reabrir` | | a promessa. Cumpri só na do dono, Recebi só na feita a ele (**400** no contrário); reabrir é o Desfazer |
| `POST /api/promessas/:id/adiar` | `{horas?}` (padrão 24, de 1 a 720) | a promessa, com prazo = o mais tarde entre o prazo e agora, mais as horas |
| `POST /api/mensagens` e `PATCH /api/mensagens/:id` | também `acompanhar` (horas, `true` = 24, `"48h"`; `null` tira) | a linha |
| SSE `acompanhar` | | `contagem`, ao conectar e a cada 60 s |

Item: `{chave, tipo: 'esperando'|'promessa', canal, conta, destino: {id, nome, tipo}, em, prazo, atrasada, texto, cobranca: {id, status}|null}`; o Esperando eles traz `pergunta` e `marcada: {id, horas}|null`; a promessa traz `promessa: {id, sentido, trecho, prazo_dito, origem, mensagem_id}` e `minhaUltimaEm` (a última mensagem do dono para aquele destino, pelo celular ou pela Central).

### CLI

- `msg add ... --acompanhar [horas]` marca (padrão 24 h; "48" ou "72h"). A saída mostra `↳ acompanhando: ...`.
- `msg acompanhar [--tudo]` lista o Esperando resposta e as Promessas, com prazo e a cobrança que já está na Central.

### Painel

- Entrada com duas abas no topo da lista: **Chegou** e **Acompanhar** (com o contador), no computador e no celular; `#acompanhar` abre direto. No topo, a pílula da Entrada leva os dois contadores.
- Lista em duas seções, Esperando eles e Promessas, cada item com foto, nome, o trecho, há quanto tempo e o prazo (vermelho quando venceu).
- Detalhe: Esperando eles tem **Cobrar** (C), **Não preciso** (I) e **Ler a conversa** (L); promessa do dono tem **Cumpri**, **Adiar 1 dia** e **Dispensar**, com "última mensagem sua para ele: há 3 h"; promessa feita a ele tem **Cobrar** e **Recebi**. Cumpri, Recebi e Dispensar têm Desfazer.
- Mensagem de WhatsApp (contexto no computador; editor e detalhe no celular): **Acompanhar a resposta** liga e desliga a marca.

## Lições

Por quê: parte das mensagens sai com texto diferente do que a sessão escreveu, e muito descarte fica sem motivo. O Relatório conta isso, mas nada voltava para as sessões. Lição é o que o dono sempre corrige, devolvido como aviso antes de ele precisar corrigir de novo.

### Sugestões (`src/licoes.js`, só leitura)

- Matéria: as mensagens `enviada`, `aprovada` ou `enviando` com `corpo != corpo_original`, dos últimos 90 dias (no máximo 400, as mais novas).
- Diferença por palavras (LCS sobre a palavra sem acento, minúscula e sem pontuação na ponta; prefixo e sufixo iguais saem da conta): blocos `tirado`, `trocado` e `acrescentado`.
- Família: textos originais quase iguais (70% das palavras de 4 letras ou mais do menor aparecem no outro, como o "já mandei" do `util.js`) contam como uma mensagem só. Sugestão só a partir de **2 famílias**; a contagem mostrada é de mensagens.
- Tipos:
  - `evitar`: trecho de 2 a 6 palavras que sumiu do texto final, dentro de uma frase, com uma palavra que o dono mexeu e uma de conteúdo (4 letras ou mais, em minúscula), sem palavra de ligação nem nome próprio nas pontas e que não é só data ou dia da semana. Pedaço de um trecho já sugerido (contido nele, ou das mesmas mensagens com palavra em comum) não vira outra sugestão. Até 12.
  - `trocar`: troca de até 3 palavras por até 3, a mesma em 2 famílias; troca só de data, dia, hora, saudação do horário ou palavra de ligação não conta (o prazo que mudou não é lição). Até 8.
  - `regra` com `padrao`: `saudacao_tirada`, `saudacao_acrescentada`, `fecho_tirado` ("Qualquer dúvida...", "Bom fim de semana!"), `emoji_tirado`, `negrito_duplo` (`**`) e `encurtado` (ficou com 85% do tamanho ou menos; a nota traz a média de corte).
- Cada sugestão: `{chave, tipo, trecho, por, padrao, nome, nota, canal, contagem, familias, sessoes, evidencias: [{id, antes, depois}], texto, avisa}`. `canal` só quando todas as evidências são do mesmo canal; `evidencias` são até 4, das mais novas, com algumas palavras em volta; `texto` é o aviso como a sessão vai ler; `avisa: false` = só aparece no guia (o `encurtado` e a regra sem trecho).
- Descartes: por canal e por sessão (as 10 maiores), `{nome, n, semMotivo, motivos: [{codigo, n}], exemplos}`, com `codigo` = o do painel, `escrito` (só texto livre que diz algo) ou `null` (sem motivo; "descartada pela sessão" e a varredura automática não contam como texto).

### Modelo

| tabela | colunas |
|---|---|
| `licoes` | `id`, `tipo` (`evitar`, `trocar`, `regra`), `trecho`, `por`, `padrao`, `canal` (NULL = todos), `nota`, `contagem`, `evidencias` (JSON), `chave` UNIQUE (a sugestão de onde veio; NULL = escrita à mão), `ativa` (0/1), `criado_em`, `atualizado_em` |
| `licoes_disparos` | `licao_id`, `mensagem_id`, `em`; chave (`licao_id`, `mensagem_id`): a lição avisou nessa mensagem |

Lição nunca é apagada: desliga. A sugestão ignorada fica em `estado.licoes_ignoradas` (lista de chaves).

### Linter

- Lição ativa vira **aviso** `{regra: 'licao', licao, msg}`, nunca bloqueio, e lição com defeito só deixa de avisar. Vale no canal dela (ou em todos).
- `evitar`, `trocar` e regra com trecho: o trecho aparece no texto (sem acento, sem caixa, palavra inteira; trecho sem letra nem número, como `**`, é procurado como está).
- Padrões: `saudacao_acrescentada` avisa quando não há saudação nos primeiros 60 caracteres **e** a Central não mandou nada para o destino nas últimas 12 h; `saudacao_tirada` quando há; `fecho_tirado` quando a última frase é fecho; `emoji_tirado` com emoji; `negrito_duplo` com `**` (não repete o aviso de formato do WhatsApp). `encurtado` não avisa.
- Texto: `o dono costuma tirar "Espero que esteja bem" (4×)`, `o dono costuma trocar "planilha" por "tabela" (3×)`, `o dono costuma abrir com "bom dia" ou "boa tarde" na primeira mensagem do dia (4×)`; a nota vem depois de dois-pontos. Regra escrita à mão: a própria nota.
- Disparo: toda vez que o resultado do linter é gravado na mensagem (`msg add`, edição, aprovar, despachante), cada lição que avisou conta uma vez para aquela mensagem. A conferência ao vivo do editor (`POST /api/lint`) não conta. **Corrigida pela sessão**: a lição avisou numa mensagem que a sessão substituiu por uma versão nova (`--substitui` ou o "substitui sozinho") em que ela não avisou mais.

### API

| método e rota | corpo | resposta |
|---|---|---|
| `GET /api/licoes` | | `{janelaDias, sugestoes, licoes, edicoes: {total, encurtadas, encurtadoPct}, descartes: {total, semMotivo, porCanal, porSessao}}`. Sem as sugestões que já viraram lição ou foram ignoradas |
| `GET /api/licoes?ativas=1` | | `{licoes}`: só as ativas (o `msg guia` usa) |
| `POST /api/licoes` | `{chave}` (virar sugestão), com `tipo`, `trecho`, `por`, `canal`, `nota`, `ativa` por cima; ou sem `chave`, escrita à mão | a lição. Falta trecho (evitar, trocar), `por` (trocar) ou a regra: **400**; canal fora da lista: **400**; sugestão que não existe mais: **404**; sugestão que já virou lição: **409** |
| `PATCH /api/licoes/:id` | qualquer um de `tipo`, `trecho`, `por`, `canal`, `nota`, `ativa` | a lição. Não existe: **404** |
| `POST /api/licoes/ignorar` | `{chave, desfazer?}` | `{ok}` |

Lição: `{id, tipo, trecho, por, padrao, nome, canal, nota, contagem, evidencias, chave, ativa, criado_em, atualizado_em, texto, avisa, disparos, corrigidas}`.

### CLI

- `msg guia`: depois do guia fixo, "## Lições do dono" com as ativas, uma por linha, com um exemplo (`ex.: #226 "antes" → "depois"`). Central fora do ar: o guia sai inteiro e a seção diz que ela não respondeu.
- `msg add`: o aviso sai como os outros, `! aviso (licao): o dono costuma tirar "..." (4×)`.
- `msg saude`: uma linha a mais para a cópia (`●` em dia, `○` não ligada, `!` falhou ou atrasou).
- `msg descartar` continua sem código obrigatório.

### Painel

- Tela **Lições** (`#licoes`, ícone de capelo no topo, item da paleta com o atalho 9 e "Mais" no celular). Própria, e não dentro do Relatório: aqui se decide, lá só se lê número.
  - **Sugestões**: o que fazer ("Tirar “Espero que esteja bem”"), quantas vezes, o canal, como a sessão vai ler e até 2 evidências (com "ver todos") com o que saiu riscado e o que entrou marcado. Botões **Virar lição**, **Editar** (trecho, por, porquê e canal antes de virar) e **Ignorar** (com Desfazer).
  - **Lições ativas**: liga e desliga, editar, quantas vezes avisou e em quantas a sessão corrigiu sozinha; as desligadas ficam recolhidas. **Nova lição** escreve à mão (evitar, trocar ou regra).
  - **O que vai para o lixo**: descartes por canal e por sessão, com o motivo mais comum e um motivo escrito.
- Descartar no computador: 1 a 5 escolhem o motivo; **sem motivo deixou de ser o padrão**: é o 0 ou o botão "Sem motivo" (Enter sozinho não descarta mais). Texto no campo + Enter descarta com ele.
- Saúde no topo: a dica lista a cópia depois dos canais; com aviso, um triângulo ao lado dos canais. Ajustes ganha o bloco "Cópia de segurança".
