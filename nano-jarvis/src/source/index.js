// Escolhe a fonte de dados de clientes/proxies/saldo pela variável DATA_SOURCE.
//
// Contrato que toda fonte precisa cumprir (SÓ LEITURA — a régua nunca altera dados da ProxysEvo):
//   listBillableProxies({ fromIso, toIso }) -> Proxy[]   proxies 'active'/'suspended' com expires_at em [fromIso, toIso)
//   getProxiesByIds(ids)                     -> Proxy[]   qualquer status (para saber se renovou/encerrou)
//   getClients(ids)                          -> Map<id, Client>
//   searchClients(query, limit)              -> Client[]  (busca do painel para marcar "não cobrar")
// Proxy  = { id, clientId, port, status: 'active'|'suspended'|'expired'|'cancelled'|..., expiresAt: ISO }
// Client = { id, name, email, whatsapp, balanceCents, bonusBalanceCents, isAdmin, isTest, role? }
import { createDemoSource } from './demo.js';

export function createSource(config, db) {
  switch (config.source) {
    case 'demo':
      return createDemoSource(db);
    // case 'proxysevo': return createProxysEvoSource(config); // ver src/source/README.md
    default:
      throw new Error(`DATA_SOURCE desconhecida: "${config.source}". Use "demo" ou implemente a fonte da ProxysEvo (src/source/README.md).`);
  }
}
