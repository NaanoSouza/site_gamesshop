# Nano Jarvis — régua de cobrança (Fase 1)

Lembra automaticamente os clientes da ProxysEvo de que os proxies vão vencer (D-7, D-3, D-1, D0) e
manda uma mensagem de recuperação no D+1, depois da suspensão. Só para quem **não** tem saldo suficiente.

- Node.js 22.5 ou mais novo, **sem dependências** (`npm install` não é necessário).
- Banco próprio em SQLite (`data/nano-jarvis.db`), criado sozinho.
- O WhatsApp fica **simulado** por padrão: as mensagens só vão para o log e para o banco.

```bash
cp .env.example .env        # e preencha ADMIN_TOKEN
npm test                    # testes automatizados
npm run seed                # dados fictícios para testar
npm run regua -- --previa   # o que sairia hoje (não envia nem grava)
npm start                   # painel em http://127.0.0.1:3780/admin + agendador das 09h00
```

| Arquivo | O que faz |
|---|---|
| `src/rules.js` | Regras de negócio (etapas, agrupamento, saldo, exclusões, decisão) — funções puras |
| `src/engine.js` | Execução diária: busca, decide, reserva, envia, registra, fecha ciclos |
| `src/store.js`, `src/db.js` | Banco da régua (envios, ciclos, "não cobrar", configurações, execuções) |
| `src/source/` | Fonte de dados (clientes/proxies/saldo). Hoje: `demo`. Ver `src/source/README.md` |
| `src/channels/` | WhatsApp Cloud API (simulado/real) e e-mail (simulado) |
| `src/webhook.js` | Webhook da Meta: status de entrega e opt-out ("PARAR") |
| `src/app.js`, `src/web/` | API e painel admin, aba "Cobranças" |
| `src/scheduler.js` | Agendador diário 09h00 America/Sao_Paulo |

Detalhes, pendências e o passo a passo de teste: veja `RESUMO.md` na raiz do repositório.
