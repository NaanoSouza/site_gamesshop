# Fonte de dados: como ligar a régua aos dados reais da ProxysEvo

A régua não sabe onde moram os clientes, os proxies e o saldo da ProxysEvo: ela lê por uma
**fonte de dados** com 4 funções, todas **só de leitura**. Hoje existe só a fonte `demo` (dados fictícios).
Para produção, crie `src/source/proxysevo.js` e registre em `src/source/index.js` (`DATA_SOURCE=proxysevo`).

## O contrato

```js
export function createProxysEvoSource(config) {
  return {
    name: 'proxysevo',

    // Proxies com status 'active' ou 'suspended' e expires_at em [fromIso, toIso).
    async listBillableProxies({ fromIso, toIso }) { /* -> Proxy[] */ },

    // Proxies pelo id, em QUALQUER status (a régua usa para saber se renovou ou foi encerrado).
    async getProxiesByIds(ids) { /* -> Proxy[] */ },

    // Clientes pelo id -> Map<string, Client>
    async getClients(ids) { /* -> Map */ },

    // Busca para o painel marcar "não cobrar" (nome, e-mail ou id).
    async searchClients(query, limit) { /* -> Client[] */ },
  };
}
```

Formatos:

```js
Proxy  = { id, clientId, port, status: 'active' | 'suspended' | 'expired' | 'cancelled' | ..., expiresAt: '2026-11-30T18:00:00.000Z' }
Client = { id, name, email, whatsapp, balanceCents, bonusBalanceCents, isAdmin, isTest }
```

- `status`: só `active` e `suspended` são cobrados. Mapeie os nomes do banco da ProxysEvo para estes.
- `expiresAt`: instante ISO (com fuso). A régua converte para a data de São Paulo.
- `balanceCents` / `bonusBalanceCents`: em centavos. O bônus conta como saldo (`COUNT_BONUS_BALANCE=true`),
  porque a cotação da API de parceiro usa saldo + bônus. Se a renovação automática NÃO usar bônus, mude para `false`.
- `isAdmin` / `isTest`: como a ProxysEvo marca essas contas. Se não houver campo, use
  `IGNORE_EMAILS`, `IGNORE_EMAIL_DOMAINS` ou `IGNORE_CLIENT_IDS` no `.env`.

## Dois jeitos de implementar

1. **Leitura direta do banco da ProxysEvo** (o mais simples se a régua rodar no mesmo servidor):
   crie um usuário de banco **só com SELECT** nas tabelas de usuários e proxies e faça as 4 consultas.
   Exemplo (ajuste nomes de tabela/coluna):

   ```sql
   SELECT id, user_id AS client_id, port, status, expires_at
     FROM proxies
    WHERE status IN ('active', 'suspended') AND expires_at >= $1 AND expires_at < $2;
   ```

2. **Endpoint interno na ProxysEvo**: a API de parceiro atual (`/users/{user}/proxies`) é por cliente e
   não lista todos os vencimentos. Seria preciso um endpoint admin, ex. `GET /admin/expiring?from=&to=`,
   protegido por token, que devolva proxies + dono + saldo.

Qualquer que seja o caminho, a régua **nunca escreve** na fonte: renovar e recarregar continuam
sendo da ProxysEvo. A régua só observa (o vencimento mudou = renovou; o saldo subiu = recarregou).
