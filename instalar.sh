#!/usr/bin/env bash
# Instala (ou atualiza) a Central de Mensagens nesta máquina. Pode rodar quantas vezes quiser:
# não apaga dado nenhum, não sobe nem derruba processo e não envia nada.
#
#   ./instalar.sh              dependências, painel, ponte do WhatsApp e o comando msg
#   ./instalar.sh --sem-ponte  pula a ponte (você já tem uma rodando, ou não tem Go agora)
#
# O que ele NÃO faz: parear o WhatsApp (precisa do seu celular) e deixar a Central no ar.
# Os próximos passos saem no fim e estão no README.md.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DADOS="$HOME/.central-mensagens"
COM_PONTE=1
for arg in "$@"; do
  case "$arg" in
    --sem-ponte) COM_PONTE=0 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "opção desconhecida: $arg (veja ./instalar.sh --help)" >&2; exit 2 ;;
  esac
done

passo() { printf '\n==> %s\n' "$1"; }
falta() { printf 'falta: %s\n' "$1" >&2; exit 1; }

passo "Conferindo o que precisa estar instalado"
command -v node >/dev/null 2>&1 || falta "Node.js 20 ou mais novo (https://nodejs.org)"
command -v npm >/dev/null 2>&1 || falta "npm (vem com o Node.js)"
NODE_MAIOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAIOR" -ge 20 ] || falta "Node.js 20 ou mais novo (aqui é o $(node -v))"
echo "node $(node -v), npm $(npm -v)"
if [ "$COM_PONTE" = 1 ]; then
  command -v go >/dev/null 2>&1 || falta "Go, para compilar a ponte do WhatsApp (https://go.dev/dl). Sem ela agora: ./instalar.sh --sem-ponte"
  command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v clang >/dev/null 2>&1 \
    || falta "um compilador C, que a ponte usa pelo SQLite (macOS: xcode-select --install; Debian/Ubuntu: sudo apt install build-essential)"
  go version
fi

passo "Dependências da Central (npm ci)"
cd "$RAIZ"
npm ci --no-audit --no-fund

passo "Painel (npm run build:web)"
npm run build:web

passo "Pasta de dados: $DADOS"
mkdir -p "$DADOS/ponte"
chmod 700 "$DADOS"
if [ ! -e "$DADOS/config.json" ]; then
  printf '{\n  "dono": { "nome": "", "whatsapp": "" },\n  "clientes": []\n}\n' > "$DADOS/config.json"
  chmod 600 "$DADOS/config.json"
  echo "criei $DADOS/config.json (preencha o seu nome e o seu número)"
else
  echo "config.json já existe: não mexi"
fi

if [ "$COM_PONTE" = 1 ]; then
  passo "Ponte do WhatsApp (go build; a primeira vez baixa as dependências e demora alguns minutos)"
  # compila ao lado e troca no fim: assim dá para atualizar com a ponte antiga ainda rodando
  (cd "$RAIZ/ponte" && CGO_ENABLED=1 go build -o "$DADOS/ponte/ponte-whatsapp.novo" .)
  mv -f "$DADOS/ponte/ponte-whatsapp.novo" "$DADOS/ponte/ponte-whatsapp"
  echo "binário em $DADOS/ponte/ponte-whatsapp"
fi

passo "Comando msg"
BIN=""
for candidato in "$HOME/.local/bin" "$HOME/bin"; do
  case ":$PATH:" in *":$candidato:"*) BIN="$candidato"; break ;; esac
done
NO_PATH=1 # 1 = a pasta escolhida já está no PATH
if [ -z "$BIN" ]; then BIN="$HOME/.local/bin"; NO_PATH=0; fi
mkdir -p "$BIN"
rm -f "$BIN/msg" # se for um atalho antigo, escrever por cima alteraria o arquivo para onde ele aponta
printf '#!/bin/sh\nexec node "%s/bin/msg.js" "$@"\n' "$RAIZ" > "$BIN/msg"
chmod +x "$BIN/msg"
echo "msg instalado em $BIN/msg"
if [ "$NO_PATH" = 0 ]; then
  echo "ATENÇÃO: $BIN não está no seu PATH. Ponha esta linha no ~/.zshrc ou no ~/.bashrc e abra outro terminal:"
  echo "  export PATH=\"$BIN:\$PATH\""
fi

passo "Pronto. O que falta é com você"
cat <<FIM
1. Preencha o seu nome e o seu número em $DADOS/config.json
2. Suba a ponte e leia o QR com o celular (WhatsApp → Aparelhos conectados → Conectar um aparelho):
     cd $DADOS/ponte && ./ponte-whatsapp
3. Em outro terminal, suba a Central:
     cd $RAIZ && npm start
4. Abra http://127.0.0.1:4912
5. Mande a primeira mensagem para o seu próprio número (ela só sai depois que você aprovar no painel):
     msg add -c whatsapp -p "55DDDNUMERO" -t "Teste da Central"

Se você está atualizando: reinicie a Central e a ponte para valerem as versões novas.
O README.md explica cada passo, como deixar tudo no ar e como ligar as sessões do Claude Code.
FIM
