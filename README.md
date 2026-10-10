# Central de Mensagens

Fila local para tudo que as suas sessões do Claude Code querem que você mande. A sessão escreve a mensagem e enfileira (`msg add`); você lê, edita e aprova num painel em `http://127.0.0.1:4912`; a Central envia. Sai por WhatsApp (por uma ponte local, que vem junto) e, se você ligar, por e-mail e Discord. **Nada sai sem você aprovar.**

Feito pelo Lucas Lacerda.

```
sessão do Claude Code ── msg add ──▶ Central (fila em SQLite) ── você aprova no painel ──▶ ponte ──▶ WhatsApp
```

O que vem junto:

- **Para revisar**: cada mensagem aparece como o destinatário vai ver (balão de WhatsApp, e-mail, Discord), com atalhos de teclado (`?` mostra todos), 10 s para desfazer e motivo de descarte em uma tecla.
- **Linter**: barra segredo no texto, destino faltando e e-mail sem assunto; avisa duplicada, formatação errada para o canal, texto longo, palavra sem acento, expressão com cara de texto de máquina, madrugada e fim de semana. As listas de palavras (`SEM_ACENTO`, `EXPRESSOES_IA`, `RAIZES_IA` em `src/lint.js`) são gosto: edite ou esvazie.
- **Entrada**: o que chegou e ainda espera resposta sua.
- **Acompanhar**: quem não respondeu e as promessas feitas nas conversas, suas e dos outros.
- **Lições**: o que você sempre corrige volta para as sessões pelo `msg guia`.
- **Ordem**: "manda esta e, depois, aquela", ou só depois que a pessoa responder.

## Antes de instalar: os riscos

Leia isto antes de parear o seu WhatsApp.

- **Não é a API oficial do WhatsApp.** A ponte usa o [whatsmeow](https://github.com/tulir/whatsmeow), que fala o protocolo do WhatsApp Web como se fosse mais um aparelho conectado à sua conta. O WhatsApp não autoriza cliente não oficial e pode restringir ou banir o número. **O risco é seu.**
- **O que diminui o risco, sem zerar:** uso pessoal, uma conversa por vez. A Central não faz disparo em massa: só envia o que você aprovou, espera de 6 a 10 s entre um envio e outro e para em 80 envios por dia (`intervaloMinMs`, `jitterMs` e `tetoDia` em `src/config.js`).
- **Nada sai sem aprovação.** Toda mensagem nasce pendente. Aprovar abre 10 s para desfazer. O botão **Pausar envios** segura a fila inteira.
- **Não tem login.** A Central (4912) e a ponte (8080) só escutam em `127.0.0.1`; é isso que as protege. Quem usa a sua máquina com o seu usuário alcança as duas. Não exponha essas portas; se quiser abrir o painel de outro aparelho, ponha um túnel com autenticação na frente.
- **Os dados ficam em claro no disco**, em `~/.central-mensagens/`: a fila, os anexos e as conversas que a ponte gravou. O arquivo `ponte/store/whatsapp.db` é a sessão do seu WhatsApp: quem o copia fala como você. Trate a pasta como você trata as suas chaves.

## Requisitos

- macOS ou Linux. Windows, só pelo WSL (veja [Linux e Windows](#linux-e-windows)).
- **Node.js 20 ou mais novo**, com npm.
- **Go 1.26 ou mais novo e um compilador C** (a ponte usa SQLite por CGO). macOS: `xcode-select --install`. Debian/Ubuntu: `sudo apt install build-essential`. Com Go 1.21 ou mais novo, o próprio `go` baixa a versão que o `go.mod` pede, desde que o `GOTOOLCHAIN` não esteja travado em `local`.
- Um celular com o WhatsApp que vai ser pareado.
- Opcional: um gerenciador de processos (pm2, systemd, launchd) para deixar tudo no ar; `uv` (para ter o `uvx`) se for ligar o e-mail.

## Instalação

### 1. Clone e rode o instalador

Clone este repositório (o endereço está no botão **Code** desta página), entre na pasta e rode:

```bash
./instalar.sh
```

Ele confere os requisitos, instala as dependências (`npm ci` na raiz e em `web/`), constrói o painel, compila a ponte para `~/.central-mensagens/ponte/ponte-whatsapp`, cria um `~/.central-mensagens/config.json` inicial (se não existir) e instala o comando `msg` em `~/.local/bin` ou `~/bin`. Não sobe processo nenhum e não envia nada. Pode rodar de novo quantas vezes quiser. `./instalar.sh --sem-ponte` pula a parte do Go.

Se ele avisar que a pasta do `msg` não está no `PATH`, ponha a linha que ele mostra no `~/.zshrc` ou no `~/.bashrc`.

### 2. Diga quem é você

Edite `~/.central-mensagens/config.json`:

```json
{
  "dono": { "nome": "Seu Nome", "whatsapp": "5511999990099" },
  "clientes": []
}
```

O nome entra nos textos que as sessões leem ("o Fulano aprova" no lugar de "o dono aprova") e é como a Entrada percebe que citaram você num grupo. O número é o seu, com 55 e DDD. O resto do arquivo está em [Configuração](#configuração). O `msg` relê o arquivo a cada chamada; a Central lê na subida, então reinicie depois de mexer.

### 3. Suba a ponte e pareie o WhatsApp

```bash
cd ~/.central-mensagens/ponte
./ponte-whatsapp
```

Ela desenha um QR no terminal. No celular: WhatsApp → Aparelhos conectados → Conectar um aparelho. Você tem 3 minutos; se passar, rode de novo. Depois de pareada ela baixa o histórico recente e fica gravando o que chega e o que sai. Deixe rodando. Mais sobre ela em [`ponte/README.md`](ponte/README.md).

### 4. Suba a Central

Em outro terminal, na pasta do repositório:

```bash
npm start
```

Tem que aparecer `[central] no ar em http://127.0.0.1:4912 · banco ... · canais: whatsapp`.

### 5. Abra o painel

http://127.0.0.1:4912 (ou `msg abrir`). Vazio, por enquanto. `msg saude` diz se a ponte está no ar.

### 6. Mande a primeira mensagem, para você mesmo

Troque pelo seu número:

```bash
msg add -c whatsapp -p "5511999990099" -t "Teste da Central: se chegou no meu WhatsApp, funcionou."
```

A mensagem aparece em **Para revisar**. Aprove com a tecla `A`, espere os 10 s de desfazer e confira:

```bash
msg status 1     # pendente → aprovada → enviada
```

O linter pode avisar que o número não está na agenda; é só aviso. Se der erro, `msg status` mostra o motivo.

## Deixar no ar

Qualquer gerenciador de processos serve. Com o pm2, a partir da pasta do repositório:

```bash
pm2 start src/server.js --name central-mensagens
pm2 start ~/.central-mensagens/ponte/ponte-whatsapp --name ponte-whatsapp --interpreter none --cwd ~/.central-mensagens/ponte
pm2 save
```

- **Pareie antes**, no terminal (passo 3). Debaixo de um gerenciador o QR só aparece no log.
- A ponte tem que rodar sempre da mesma pasta (`--cwd`): é lá que ela cria o `store/`.
- A ponte escreve na saída o texto de toda mensagem que passa por ela. No pm2 isso vai para `~/.pm2/logs/`.
- Se o WhatsApp desconectar o aparelho, a ponte volta a pedir o QR e fica reiniciando. Pare o processo, rode à mão, pareie de novo e devolva ao gerenciador.
- Subir duas Centrais na mesma porta não quebra nada: a segunda sai sem tocar na fila.

## Ligar nas sessões do Claude Code

Cole no seu `~/.claude/CLAUDE.md` (ou no `CLAUDE.md` de um projeto) e ajuste ao seu gosto:

```markdown
# Central de Mensagens

Mensagem que eu vou mandar (WhatsApp; e-mail e Discord quando estiverem ligados) vai para a Central (http://127.0.0.1:4912), onde eu edito, aprovo e ela envia sozinha. Não sai como arquivo ou bloco de texto para eu copiar e colar.

- Antes do primeiro `msg add` da sessão, leia `msg guia` (canais, destino, formatação, como corrigir, linter, status). Opções: `msg --help`.
- Enfileirar: `msg add -c whatsapp -p "<destino>" -r "<a quem ou ao que responde>" <<'EOF' ... EOF`. O destino pode ser um nome aproximado; se for ambíguo, eu escolho no painel.
- No chat, só 1 ou 2 linhas: `#id → destino` e do que se trata. O texto inteiro fica na Central.
- Mensagem corrigida: a anterior sai da fila. Da mesma sessão para o mesmo destino, mandar de novo já substitui; nos outros casos, `--substitui <id>`. Nunca deixe duas versões na fila.
- Antes de dizer "enviado", confira `msg status <id>`. Aprovada não é enviada.
- Em vez de pedir print de conversa: `msg ler whatsapp "<grupo ou contato>"`.
```

Para a sessão não pedir permissão a cada chamada, libere o comando nas permissões do Claude Code (`Bash(msg:*)`).

O `msg guia` imprime `docs/guia-sessoes.md` com o seu nome no lugar de "dono" e, no fim, as suas lições ativas. O `msg` anota de onde veio cada mensagem para o painel mostrar: o título da sessão (lido de `~/.claude/projects/`), a pasta, o repositório e o ramo.

## Configuração

Tudo em `~/.central-mensagens/config.json`. Sem o arquivo a Central sobe do mesmo jeito: só o WhatsApp, textos neutros, sem cofre.

```json
{
  "dono": { "nome": "Seu Nome", "whatsapp": "5511999990099" },
  "clientes": [
    { "nome": "Aurora", "termos": ["Grupo Aurora"] },
    { "nome": "Boreal", "familia": "Aurora" }
  ],
  "cofre": { "helper": "~/bin/meu-cofre" },
  "email": { "contas": ["voce@exemplo.com"] },
  "discord": { "donoId": "123456789012345678" },
  "whatsapp": { "store": "~/.central-mensagens/ponte/store", "ponte": "http://127.0.0.1:8080" }
}
```

| chave | para que serve |
|---|---|
| `dono.nome` | Seu nome. O primeiro nome entra nos avisos, no `msg` e no guia das sessões. Vazio: "o dono" |
| `dono.whatsapp` | Seu número (55 + DDD + número). Depois de pareada, a Central usa o número da própria sessão; este vale enquanto ela não existe |
| `clientes` | Para o aviso de **cliente cruzado** (o destino é de um cliente e o texto fala de outro). `nome` é o que as sessões passam em `--cliente`; `termos` são outros jeitos de o cliente aparecer num texto ou no nome de um grupo; `familia` junta clientes que podem aparecer um na conversa do outro. Vazio: a regra não dispara |
| `cofre.helper` | Executável do seu cofre de segredos. Veja [Cofre](#cofre-opcional) |
| `email.contas` | Liga o e-mail. Veja [E-mail](#e-mail) |
| `discord` | Liga o Discord. Veja [Discord](#discord) |
| `whatsapp.store` | Pasta `store/` da ponte, se ela não rodar em `~/.central-mensagens/ponte` |
| `whatsapp.ponte` | Endereço da ponte, se você trocou a porta |
| `janelaDesfazerMs`, `assinaturas` | Gravadas pelo painel (Ajustes): a janela de desfazer e a assinatura de cada conta de e-mail |
| `senhasDeCliente` | Só à mão: `{ "NOME_NO_COFRE": "Cliente" }` libera aquele segredo do cofre para ir ao cliente indicado (vira aviso; para qualquer outro destino continua bloqueio) |

Caminho pode começar com `~`. O painel grava no mesmo arquivo sem mexer nas chaves que não são dele.

### pessoas.json (opcional)

`~/.central-mensagens/pessoas.json` diz de que cliente cada pessoa é, para o aviso de cliente cruzado valer também em conversa direta:

```json
[
  { "nome": "Helena Duarte", "cliente": "Aurora", "apelidos": ["Lena"], "emails": ["helena@exemplo.com"] }
]
```

Escrito à mão. Sem o arquivo, a regra olha só o nome do destino e o `--cliente` da sessão.

## Canais opcionais

Os dois existem no código e ficam **desligados até você configurar**: canal desligado não aparece no painel e é recusado no `msg add`. Os dois só foram usados na máquina do autor, com as contas dele; trate o que segue como ponto de partida, não como receita testada.

Os segredos de canal são lidos pelo nome, na hora do uso: primeiro a variável de ambiente com aquele nome no processo da Central, depois o cofre, se houver. Não ponha segredo no `config.json`.

### E-mail

Sai pelo Gmail, através do projeto [workspace-mcp](https://github.com/taylorwilsdon/google_workspace_mcp). A Central sobe `uvx workspace-mcp --transport streamable-http --tools gmail --single-user` na porta 8792 quando precisa e desliga depois de 10 minutos sem uso. Os logins do Google ficam com ele, em `~/.google_workspace_mcp/`; a Central nunca lê esses arquivos.

1. Instale o `uv` (para ter o `uvx`).
2. Crie um cliente OAuth no Google Cloud com a API do Gmail ligada e faça o login de cada conta uma vez pelo próprio workspace-mcp (a documentação dele explica).
3. Dê à Central o cliente OAuth: `GOOGLE_WORKSPACE_OAUTH_CLIENT_ID` e `GOOGLE_WORKSPACE_OAUTH_CLIENT_SECRET`, como variáveis de ambiente ou com esses nomes no cofre.
4. Liste as contas em `config.json` → `"email": { "contas": ["voce@exemplo.com"] }` e reinicie a Central. A primeira é a conta padrão; as sessões escolhem outra com `--conta`.

### Discord

Sai por um bot seu, pela API REST do Discord.

1. Crie uma aplicação com bot no portal de desenvolvedores do Discord e convide-o para o seu servidor com permissão de ver os canais, ler o histórico e enviar mensagens.
2. Dê à Central o token: `DISCORD_BOT_TOKEN`, como variável de ambiente ou com esse nome no cofre.
3. Ponha em `config.json` → `"discord": { "donoId": "<o seu id de usuário no Discord>" }` e reinicie. O id serve para a Entrada saber quais mensagens são suas; `"discord": {}` também liga, sem isso.

O destino é `"#canal"` ou o nome de uma pessoa do servidor (vira conversa privada com o bot). Texto com mais de 2.000 caracteres sai em partes.

## Cofre (opcional)

Sem cofre, o linter acha segredo pelo formato do texto (`sk-...`, `ghp_...`, JWT, chave privada, `senha: ...`, `?token=` em link e parecidos). O `msg saude` mostra "sem cofre configurado" e nada fica barrado por isso.

Com cofre, ele também compara cada mensagem com os valores que você guarda, para pegar a senha que não tem cara de senha. O cofre é um executável seu, apontado em `cofre.helper` (ou na variável `CENTRAL_SECRET_BIN`), que responde a dois comandos em até 10 s cada:

```
<helper> list        um nome por linha, em MAIÚSCULAS_COM_UNDERSCORE; sai com 0
<helper> get NOME    o valor na saída padrão; sai com 0 (outro código = não tem esse nome)
```

Um script de 10 linhas em volta do Keychain do macOS, do `pass` ou do `secret-tool` resolve. Os valores ficam só na memória da Central e nunca são gravados nem impressos. **Com cofre configurado, a Central falha fechado:** se o helper não responder, toda mensagem fica bloqueada ("não consegui verificar segredos") até ele voltar.

## Dados, cópia de segurança e atualização

Nada do que é seu fica no repositório. Tudo mora em `~/.central-mensagens/`:

| caminho | o que é |
|---|---|
| `central.db` | a fila, o histórico, as lições e as promessas (SQLite) |
| `config.json`, `pessoas.json` | a sua configuração |
| `anexos/`, `envio/`, `fotos/` | cópia dos anexos, área de passagem para a ponte e miniaturas de perfil |
| `ponte/ponte-whatsapp` | o binário da ponte |
| `ponte/store/` | a sessão do WhatsApp (`whatsapp.db`) e as conversas (`messages.db`) |

**Cópia de segurança:** pare a Central e a ponte e copie a pasta inteira. Com elas no ar, copie cada banco com `sqlite3 <banco> ".backup <destino>"`, que é seguro com o banco em uso. Guarde a cópia como guardaria uma senha.

Se você tiver um script de cópia, o painel e o `msg saude` mostram a saúde dela. A Central não copia nada; só lê o arquivo `~/.central-mensagens/copia-estado.json`, que o seu script grava ao terminar:

```json
{ "quando": 1760000000000, "ok": true, "erro": "", "seco": false, "ultimo_ok": 1760000000000 }
```

`quando`, `ok` e `erro` são da última execução (milissegundos desde 1970); `ultimo_ok` é a última que deu certo; `seco: true` marca execução de teste, que não conta. Sem o arquivo aparece "ainda não ligada", sem alarme. Mais de 36 h sem uma que deu certo vira aviso.

**Atualizar:**

```bash
git pull
./instalar.sh
```

Depois reinicie a Central e a ponte. O banco ganha sozinho as colunas novas na subida.

## Linux e Windows

Foi escrita e usada em macOS. Em Linux o caminho é o mesmo e o código não depende de nada do macOS para funcionar, mas ninguém rodou lá ainda. O que muda:

- O aviso nativo de mensagem nova usa a Central de Notificações do macOS; em Linux não faz nada. O painel aberto mostra o que chegou.
- `msg abrir` e o "mostrar na pasta" dos anexos usam `xdg-open`.
- Datas e horários (aviso de madrugada, "hoje 03h41") saem no fuso de São Paulo.

Windows: só pelo WSL, com tudo dentro dele (a Central, a ponte e as sessões do Claude Code que chamam o `msg`). Não testado.

## Desenvolvimento

```bash
npm test                          # canal falso, cofre falso e banco em memória: nada sai de verdade
npm --prefix web run typecheck    # tsc do painel
npm run build:web                 # painel em web/dist
```

Sem `web/dist` a Central sobe do mesmo jeito e a página diz o comando que falta. Os testes de `test/copia-real.test.js` só rodam se existir uma cópia do banco em `$TMPDIR/central-copia.db` (ou em `CENTRAL_DB_COPIA`); sem ela, pulam.

Para mexer no painel com os seus dados sem risco de enviar nada, use o **modo prévia** numa cópia do banco: sem despachante, sem notificação e com todo envio recusado.

```bash
cp ~/.central-mensagens/central.db "$TMPDIR/central-copia.db"
CENTRAL_DB="$TMPDIR/central-copia.db" CENTRAL_MODO=previa PORT=4990 node src/server.js
```

O servidor recusa subir em prévia apontando para o banco de verdade, para a pasta dele ou para a porta 4912.

| variável | efeito |
|---|---|
| `PORT` | porta da Central (padrão 4912) |
| `CENTRAL_URL` | onde o `msg` procura a Central (padrão `http://127.0.0.1:4912`) |
| `CENTRAL_DB` | caminho do banco; `config.json` e `pessoas.json` são lidos da mesma pasta |
| `CENTRAL_MODO=previa` | servidor de teste, sem envio |
| `CENTRAL_NOTIFICAR=0` | desliga o aviso nativo do macOS |
| `CENTRAL_PONTE`, `CENTRAL_PONTE_STORE` | endereço e pasta `store/` da ponte (ganham do `config.json`) |
| `CENTRAL_SECRET_BIN` | helper do cofre (ganha do `config.json`) |
| `CENTRAL_PESSOAS`, `CENTRAL_BACKUP_ESTADO` | outro caminho para o `pessoas.json` e para o estado da cópia |
| `CENTRAL_UVX` | caminho do `uvx`, se ele não estiver nos lugares de sempre |

O que tem em cada pasta:

```
bin/msg.js    o comando das sessões
src/          servidor HTTP, fila em SQLite, linter, despachante, canais, lições, acompanhar
web/          o painel (React, Vite, Tailwind); o build vai para web/dist
ponte/        a ponte do WhatsApp (Go)
docs/         guia das sessões (o que o msg guia imprime), contrato da API e o desenho do painel
test/         node --test
```

## Origem da ponte

A pasta `ponte/` é derivada do `whatsapp-bridge` do projeto [lharries/whatsapp-mcp](https://github.com/lharries/whatsapp-mcp), de Luke Harries, sob licença MIT (`ponte/LICENSE`). O que mudou em relação ao original está em [`ponte/README.md`](ponte/README.md).
