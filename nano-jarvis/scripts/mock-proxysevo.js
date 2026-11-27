// `npm run mock-proxysevo` — servidor LOCAL que imita o endpoint interno da ProxysEvo
// (docs/endpoint-proxysevo.md) usando os dados fictícios das tabelas demo_*. Só para teste.
import { createServer } from 'node:http';
import { loadDotEnv, loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { createDemoSource } from '../src/source/demo.js';

loadDotEnv();
const config = loadConfig();
const db = openDb(config.dbPath);
const demo = createDemoSource(db);
const PORT = Number(process.env.MOCK_PORT || 3781);
const TOKEN = process.env.MOCK_TOKEN || 'mock-token-local';

const snakeProxy = (p) => ({ id: p.id, user_id: p.clientId, port: p.port, status: p.status, expires_at: p.expiresAt });
const snakeClient = (c) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  whatsapp: c.whatsapp,
  balance_cents: c.balanceCents,
  bonus_balance_cents: c.bonusBalanceCents,
  is_admin: c.isAdmin,
  is_test: c.isTest,
});

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: 'unauthorized' });
  const ids = url.searchParams.get('ids')?.split(',').filter(Boolean);
  if (req.method === 'GET' && url.pathname === '/regua/proxies') {
    const list = ids
      ? await demo.getProxiesByIds(ids)
      : await demo.listBillableProxies({ fromIso: url.searchParams.get('from'), toIso: url.searchParams.get('to') });
    return json(200, { proxies: list.map(snakeProxy) });
  }
  if (req.method === 'GET' && url.pathname === '/regua/clients') {
    const list = ids ? [...(await demo.getClients(ids)).values()] : await demo.searchClients(url.searchParams.get('q') || '', Number(url.searchParams.get('limit')) || 20);
    return json(200, { clients: list.map(snakeClient) });
  }
  return json(404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`Mock da ProxysEvo em http://127.0.0.1:${PORT} (token: ${TOKEN})`));
