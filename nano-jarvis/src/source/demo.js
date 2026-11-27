// Fonte de dados de DEMONSTRAÇÃO: lê clientes e proxies fictícios das tabelas demo_* do banco da régua.
// Serve para testar a régua sem tocar em dado real. Para produção, veja src/source/README.md.

const toClient = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  whatsapp: r.whatsapp,
  balanceCents: r.balance_cents,
  bonusBalanceCents: r.bonus_balance_cents,
  isAdmin: Boolean(r.is_admin),
  isTest: Boolean(r.is_test),
});
const toProxy = (r) => ({ id: r.id, clientId: r.client_id, port: r.port, status: r.status, expiresAt: r.expires_at });

export function createDemoSource(db) {
  return {
    name: 'demo',
    async listBillableProxies({ fromIso, toIso }) {
      return db
        .prepare("SELECT * FROM demo_proxies WHERE status IN ('active', 'suspended') AND expires_at >= ? AND expires_at < ?")
        .all(fromIso, toIso)
        .map(toProxy);
    },
    async getProxiesByIds(ids) {
      if (!ids.length) return [];
      const marks = ids.map(() => '?').join(',');
      return db.prepare(`SELECT * FROM demo_proxies WHERE id IN (${marks})`).all(...ids.map(String)).map(toProxy);
    },
    async getClients(ids) {
      const map = new Map();
      if (!ids.length) return map;
      const marks = ids.map(() => '?').join(',');
      for (const r of db.prepare(`SELECT * FROM demo_clients WHERE id IN (${marks})`).all(...ids.map(String))) map.set(String(r.id), toClient(r));
      return map;
    },
    async searchClients(query, limit = 20) {
      const q = `%${String(query).replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      return db
        .prepare("SELECT * FROM demo_clients WHERE name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?")
        .all(q, q, q, limit)
        .map(toClient);
    },
  };
}
