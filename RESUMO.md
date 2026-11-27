# RESUMO — Régua de cobrança automática (Fase 1 do PRD Nano Jarvis)

Branch: `feature/regua-cobranca` · Pasta: `nano-jarvis/` · Nada foi publicado em produção e nenhum dado real foi lido ou alterado.

## ⚠️ Antes de tudo: duas descobertas importantes

1. **O código da ProxysEvo (painel, clientes, proxies, saldo) não está em nenhum repositório que eu consegui acessar.**
   - `site_gamesshop` (este repo) é só a página estática da loja de games.
   - `evospace` e `evohub` **consomem** a API de parceiro da ProxysEvo (`app.ativosevo.com`), mas não são a ProxysEvo.
   - `AtivosEvoPainel` é outro negócio (BMs, CNPJs, WABA).

   Por isso construí a régua como um **serviço separado** (`nano-jarvis/`) que lê os dados por uma "fonte de dados" plugável.
   Hoje ele roda com **dados fictícios** (`DATA_SOURCE=demo`). Para usar com dados reais, falta escrever **um arquivo**
   (`src/source/proxysevo.js`); o passo a passo está em `nano-jarvis/src/source/README.md`.
   A aba "Cobranças" também é um painel próprio do serviço (`/admin`), já que o painel admin da ProxysEvo não está acessível.
   Ela pode virar uma aba do painel real depois, chamando a mesma API.

2. **Este repositório (`site_gamesshop`) é PÚBLICO.** O código não tem senha nem dado de cliente, mas qualquer pessoa pode vê-lo.
   Se preferir, deixe o repositório privado no GitHub ou mova a pasta `nano-jarvis/` para um repositório privado.

## O que foi feito

**Regras de negócio** (`src/rules.js`, todas cobertas por testes):
- Rotina diária às **09h00 America/Sao_Paulo** (agendador embutido; se o servidor estava fora do ar às 9h, roda ao subir).
- Busca proxies **ativos/suspensos** que vencem nos próximos **7 dias** (data de São Paulo, não UTC).
- **Agrupa por cliente + data de vencimento**: uma mensagem por grupo, nunca uma por proxy.
- Valor necessário = **R$ 17,90 × quantidade** (`PROXY_PRICE_CENTS=1790`).
  Se o cliente tem vários vencimentos na semana, o valor é **cumulativo** (o saldo paga primeiro o que vence antes).
- **Saldo ≥ valor necessário → não envia** (igual também conta como suficiente). Saldo + bônus por padrão (`COUNT_BONUS_BALANCE`).
- **Lista "não cobrar" → não envia.**
- **Contas admin e de teste são ignoradas** (marcação na fonte de dados + listas `IGNORE_EMAILS`, `IGNORE_EMAIL_DOMAINS`, `IGNORE_CLIENT_IDS`).
- Etapas **D-7, D-3, D-1, D0** e **D+1 de recuperação**, que só sai se o proxy estiver suspenso ("recarregue para reativar o mesmo IP").
  - Janelas de recuperação de dia perdido: D-7 vale de 7 a 4 dias antes e D-3 de 3 a 2 dias. Se um dia falhar, a etapa sai no dia seguinte, desde que nenhuma posterior já tenha saído.
- **Para quando o cliente renova** (o vencimento do proxy mudou → ciclo "Renovado") **ou recarrega** (o saldo passou a cobrir → "Recarregou").
  Se o saldo cair de novo antes do vencimento, a régua volta a avisar.
- **Nunca a mesma etapa duas vezes**: o envio é reservado no banco **antes** de chamar a API, com chave única (cliente, vencimento, etapa, canal).
  Há também uma trava contra duas execuções ao mesmo tempo. Se o processo cair no meio de um envio, ele é marcado "incerto" e **não** é repetido.
- **Falha da API**: fica registrada e é tentada de novo na próxima execução (até `MAX_SEND_ATTEMPTS=3`), só no canal que falhou.

**Canais:**
- **WhatsApp Cloud API oficial da Meta**, em modo **SIMULADO** por padrão: só registra no log e no banco (status `simulado`).
  O modo real já está implementado (templates com as 7 variáveis: nome, quantidade, portas, vencimento, valor necessário, saldo atual, link de recarga).
  Ele só liga com `WHATSAPP_MODE=real` + credenciais. Sem credenciais, continua simulado mesmo que você peça "real".
- **E-mail** como reforço: simulado (só log e banco).
- **Webhook da Meta** (`/webhooks/whatsapp`): atualiza o status de entrega (enviado → entregue → lido / falhou) e trata o **opt-out da LGPD**.
  Quem responde "PARAR", "SAIR", "STOP" ou "CANCELAR" entra na lista "não cobrar" como opt-out. Exige assinatura válida da Meta (`WHATSAPP_APP_SECRET`).

**Painel admin — aba "Cobranças"** (`http://127.0.0.1:3780/admin`, protegido por `ADMIN_TOKEN`):
- Liga/desliga geral da régua. **Ela começa DESLIGADA**: nada sai até você ligar.
- Indicadores: em cobrança, renovaram, recarregaram, encerrados, lista "não cobrar", mensagens no mês, custo real e custo projetado se o WhatsApp simulado fosse real.
- **Histórico de envios** com filtros (etapa, status, cliente) e o texto de cada mensagem.
- **Vencimentos**: quem recebeu lembrete, quando, última etapa e quem já renovou ou recarregou.
- **"Não cobrar"** com motivo obrigatório, **"Voltar a cobrar"** e o histórico de quem mudou o quê.
- **Editor dos textos** de cada etapa, com validação das variáveis.
- **Prévia** (escolha uma data e veja o que sairia, sem enviar nada) e **"Rodar agora"**.
- **Execuções**: o resultado de cada rodada.

**Segurança:**
- O token é comparado em tempo constante e há bloqueio após 10 tentativas erradas.
- O painel recusa acesso se o `ADMIN_TOKEN` tiver menos de 16 caracteres.
- Nenhum `innerHTML` com dado do servidor (sem XSS), CSP restritiva, JSON obrigatório nos POST e limite de 64 KB no corpo.
- O servidor escuta só em `127.0.0.1` por padrão.
- O token da Meta nunca vai para o log nem para mensagens de erro, e o telefone aparece mascarado no log.
- A régua **só lê** a fonte de dados; nunca escreve nela.

**Testes:** 70 testes automatizados (`npm test`), todos passando. Cobrem regras, motor (régua completa, idempotência, execuções simultâneas, renovação, recarga, falhas e repetições), WhatsApp, webhook, API do painel e datas/fuso.

**Revisão crítica feita no final**, com correções:
- Botões do painel ficavam travados depois de uma ação.
- O custo do mês era contado a partir da meia-noite UTC, e não da de São Paulo.
- A memória do bloqueio de força bruta podia crescer sem limite.
- Um rótulo errado aparecia numa nova tentativa de envio.

## O que ficou pendente

1. **Fonte de dados real da ProxysEvo** (`src/source/proxysevo.js`): ler direto do banco com um usuário só de SELECT, ou criar um endpoint admin na ProxysEvo. Ver `nano-jarvis/src/source/README.md`.
2. **Meta**:
   - Verificar o número na Meta Business e confirmar o modo coexistência.
   - Criar e aprovar os 5 templates de Utilidade: `cobranca_d7`, `cobranca_d3`, `cobranca_d1`, `cobranca_d0` e `cobranca_recuperacao`, cada um com as 7 variáveis `{{1}}`…`{{7}}` nesta ordem: nome, quantidade, portas, vencimento, valor necessário, saldo atual, link de recarga.
   - Preencher as credenciais no `.env`.
3. **E-mail real** (SMTP, por exemplo com nodemailer): hoje é só simulado.
4. **Link de recarga** real em `RECHARGE_LINK` (coloquei `https://app.ativosevo.com/recarga` como palpite).
5. **Login do painel**: hoje é um único token compartilhado. Para vários admins, usar o login do painel da ProxysEvo.
6. **Deploy no servidor** (24h): rodar `npm start` com pm2/systemd atrás de HTTPS (Caddy/Nginx), com `HOST=0.0.0.0` só por trás do proxy HTTPS.
7. **Decisões de negócio para confirmar**:
   - O bônus conta para a renovação automática?
   - Cliente com `auto_renew` desligado deve ser avisado mesmo com saldo? Hoje segue o PRD à risca: com saldo, não avisa.
   - O preço é sempre R$ 17,90 ou o preço do plano de cada proxy?
8. Rodar **em paralelo com a rotina atual por uma semana** antes de desligar a antiga (PRD, passo 5).

## Passo a passo para testar amanhã na sua máquina

Precisa do **Node.js 22.5 ou mais novo** (`node --version`). Se for mais antigo, instale o 22 LTS em nodejs.org. Não há `npm install`.

```bash
git fetch origin
git checkout feature/regua-cobranca
cd nano-jarvis

# 1. Rodar os testes automatizados (deve mostrar "pass 70, fail 0")
npm test

# 2. Configurar
cp .env.example .env
#    abra o .env e preencha ADMIN_TOKEN com um texto longo, por exemplo o resultado de:
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
#    deixe WHATSAPP_MODE=simulado e DATA_SOURCE=demo

# 3. Criar os clientes fictícios (12 clientes cobrindo todos os cenários, com vencimentos relativos a hoje)
npm run seed

# 4. Ver o que sairia hoje, sem enviar nada
npm run regua -- --previa

# 5. Subir o painel
npm start
#    abra http://127.0.0.1:3780/admin e entre com o ADMIN_TOKEN
```

No painel:
1. Clique em **"Ver prévia"**: Ana (D-3), Elisa (D0), Diego (D+1), Gabriela (D-7) e Íris (D-1, só e-mail) recebem.
   Bruno, Fábio e João têm saldo; Carla está em "não cobrar"; as contas admin e de teste são ignoradas.
2. Ligue a **régua** (chave no topo) e clique em **"Rodar agora"**. Veja os envios em "Histórico de envios" (status `simulado`) e no terminal (`[whatsapp:SIMULADO] ...`).
3. Clique em **"Rodar agora"** de novo: nenhum envio novo (a mesma etapa nunca se repete).
4. Em **"Não cobrar"**, busque "elisa", marque com um motivo e depois clique em "Voltar a cobrar".
5. Em **"Textos"**, edite uma mensagem e salve; uma variável inexistente, como `{{xyz}}`, é recusada.
6. Para simular outros dias: escolha uma data na prévia, ou rode `npm run regua -- --previa --data=2026-12-01`.

Para começar do zero: `npm run seed -- --reset` (apaga só o histórico local da régua e recria os dados fictícios).

## Quando for ligar o WhatsApp de verdade

1. Com os templates aprovados, preencha no `.env`: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN`.
2. Configure o webhook na Meta: `https://SEU-DOMINIO/webhooks/whatsapp`, com o mesmo verify token.
3. Troque para `WHATSAPP_MODE=real` e reinicie. O painel passa a mostrar "WhatsApp REAL".
4. Só depois de ligar a fonte de dados real (`DATA_SOURCE=proxysevo`).
