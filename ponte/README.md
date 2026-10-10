# Ponte do WhatsApp

É o processo que conversa com o WhatsApp. A Central fala com ele por HTTP em `127.0.0.1:8080` para enviar e lê os bancos dele (só leitura) para saber quem são os seus contatos e o que foi dito em cada conversa.

## De onde veio

Do `whatsapp-bridge` do projeto [lharries/whatsapp-mcp](https://github.com/lharries/whatsapp-mcp), de Luke Harries, licença MIT (o arquivo `LICENSE` desta pasta é o dele). Por baixo usa o [whatsmeow](https://github.com/tulir/whatsmeow), que implementa o protocolo do WhatsApp Web. **Não é a API oficial do WhatsApp.**

## O que foi acrescentado ao original

Tudo em `main.go`:

- `POST /api/send` aceita `reply_to_id`, `reply_to_sender` e `reply_to_text`: a mensagem sai citando outra, como quando você responde arrastando no celular.
- `POST /api/send` aceita `mentions` (lista de JIDs): `@numero` no texto vira marcação de verdade.
- `GET /api/avatar?jid=<jid>`: devolve o endereço da miniatura da foto de perfil de um contato ou grupo (a Central baixa e guarda).
- O servidor HTTP escuta só em `127.0.0.1`, nunca na rede.
- Ajustes no download de mídia e uma linha `QR_CODE_RAW:` com o conteúdo do QR, para quem quiser gerar a imagem por fora.

## Compilar e rodar

O `instalar.sh` da raiz já compila. À mão, é isto (precisa de Go e de um compilador C, por causa do SQLite):

```bash
mkdir -p ~/.central-mensagens/ponte
cd ponte
CGO_ENABLED=1 go build -o ~/.central-mensagens/ponte/ponte-whatsapp .
cd ~/.central-mensagens/ponte
./ponte-whatsapp
```

Na primeira vez ela desenha um QR no terminal: no celular, WhatsApp → Aparelhos conectados → Conectar um aparelho. Você tem 3 minutos; se passar, ela fecha e é só rodar de novo. Depois de pareada, baixa o histórico recente e passa a gravar tudo que chega e sai.

**Rode sempre da mesma pasta.** Ela cria `store/` na pasta de onde foi chamada:

| arquivo | o que é |
|---|---|
| `store/whatsapp.db` | a sessão do aparelho conectado. Quem tem este arquivo fala como você no WhatsApp: trate como senha |
| `store/messages.db` | conversas e mensagens (texto) que a ponte viu |

A Central procura esses dois arquivos em `~/.central-mensagens/ponte/store`. Se a ponte rodar em outro lugar, aponte em `~/.central-mensagens/config.json` → `whatsapp.store`.

## Bom saber

- A porta 8080 está fixa na última linha útil do `main()` (`startRESTServer(client, messageStore, 8080)`). Se ela estiver ocupada na sua máquina, troque ali, compile de novo e ponha o endereço novo em `config.json` → `whatsapp.ponte`.
- A ponte escreve no terminal o texto de toda mensagem que passa por ela. Se rodar por um gerenciador de processos, esse texto vai para o log dele.
- Se o WhatsApp desconectar o aparelho (acontece depois de muito tempo parada, ou se você remover o aparelho no celular), a ponte volta a pedir o QR. Rode-a no terminal, pareie de novo e devolva ao gerenciador de processos.
- Ela não tem autenticação: quem alcança `127.0.0.1:8080` na sua máquina envia mensagem como você. Por isso só escuta em loopback; não exponha essa porta.
