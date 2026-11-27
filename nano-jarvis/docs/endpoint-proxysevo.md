# Endpoint interno que a ProxysEvo precisa expor para a régua

A régua roda com `DATA_SOURCE=proxysevo` e lê os dados por **3 rotas GET, só de leitura**, protegidas por token.
Quem desenvolve a ProxysEvo implementa essas rotas (de preferência acessíveis só pelo servidor da régua).

```
PROXYSEVO_ADMIN_URL=https://app.ativosevo.com/interno     # base das rotas abaixo
PROXYSEVO_ADMIN_TOKEN=<token longo e aleatório>            # enviado como Authorization: Bearer <token>
```

Sem o token certo, as rotas devem responder **401**. Todas devolvem JSON.

## 1. Proxies que vencem numa janela

`GET /regua/proxies?from=2026-11-24T00:00:00.000Z&to=2026-12-06T00:00:00.000Z&status=active,suspended`

Devolve os proxies com `status` em `active`/`suspended` e `expires_at` em `[from, to)`.

```json
{ "proxies": [
  { "id": "px_123", "user_id": "u_42", "port": 10001, "status": "active", "expires_at": "2026-11-30T18:00:00Z" }
] }
```

## 2. Proxies pelo id (qualquer status)

`GET /regua/proxies?ids=px_123,px_124` (até 100 ids por chamada) → mesmo formato.
A régua usa para saber se o proxy **renovou** (o `expires_at` mudou para depois do vencimento) ou foi **encerrado**.
Proxies encerrados devem vir com `status` diferente de `active`/`suspended` (ex.: `expired`, `cancelled`).

## 3. Clientes

`GET /regua/clients?ids=u_42,u_43` (até 100 ids) e `GET /regua/clients?q=ana&limit=20` (busca por nome, e-mail ou id).

```json
{ "clients": [
  { "id": "u_42", "name": "Ana Souza", "email": "ana@exemplo.com", "whatsapp": "+55 11 98888-7777",
    "balance_cents": 1000, "bonus_balance_cents": 0, "is_admin": false, "is_test": false }
] }
```

- Saldo em **centavos** (`balance_cents`). Se só houver em reais, mande `balance` (ex.: `10.5`) que a régua converte.
- `is_admin` / `is_test`: como a ProxysEvo identifica essas contas.

Nomes alternativos aceitos: `client_id`/`clientId`/`userId`, `expiresAt`, `phone`/`telefone`, `nome`, `saldo`, `bonus`.

## Exemplo de implementação (Node/Express + SQL; adapte aos nomes reais)

```js
const auth = (req, res, next) =>
  req.get('authorization') === `Bearer ${process.env.REGUA_TOKEN}` ? next() : res.status(401).end();

app.get('/interno/regua/proxies', auth, async (req, res) => {
  const { ids, from, to } = req.query;
  const rows = ids
    ? await db.query('SELECT id, user_id, port, status, expires_at FROM proxies WHERE id = ANY($1)', [ids.split(',').slice(0, 100)])
    : await db.query(
        "SELECT id, user_id, port, status, expires_at FROM proxies WHERE status IN ('active','suspended') AND expires_at >= $1 AND expires_at < $2",
        [from, to],
      );
  res.json({ proxies: rows });
});

app.get('/interno/regua/clients', auth, async (req, res) => {
  const { ids, q } = req.query;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = ids
    ? await db.query('SELECT id, name, email, whatsapp, balance_cents, bonus_balance_cents, is_admin, is_test FROM users WHERE id = ANY($1)', [ids.split(',').slice(0, 100)])
    : await db.query(
        "SELECT id, name, email, whatsapp, balance_cents, bonus_balance_cents, is_admin, is_test FROM users WHERE name ILIKE $1 OR email ILIKE $1 OR id::text = $2 LIMIT $3",
        [`%${q}%`, q, limit],
      );
  res.json({ clients: rows });
});
```

## Testar sem a ProxysEvo

`npm run mock-proxysevo` sobe um servidor local que responde exatamente este contrato com os dados fictícios
(`npm run seed` antes). Em outro terminal, rode a régua com:

```
DATA_SOURCE=proxysevo PROXYSEVO_ADMIN_URL=http://127.0.0.1:3781 PROXYSEVO_ADMIN_TOKEN=mock-token-local npm run regua -- --previa
```
