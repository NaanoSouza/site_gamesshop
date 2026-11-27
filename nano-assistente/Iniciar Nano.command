#!/bin/bash
# Mac: clique duas vezes para iniciar o Nano.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "O Nano precisa do Node.js 22 ou mais novo. Abrindo o site para baixar..."
  open "https://nodejs.org/pt"
  exit 1
fi
[ -f .env ] || cp .env.example .env
[ -d node_modules ] || npm install --no-audit --no-fund
node src/server.js &
sleep 2
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app=http://127.0.0.1:3790
else
  open "http://127.0.0.1:3790"
fi
wait
