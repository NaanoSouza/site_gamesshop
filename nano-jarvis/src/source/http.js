// Fonte de dados REAL via HTTP: lê clientes/proxies/saldo de um endpoint interno da ProxysEvo.
// O contrato que a ProxysEvo precisa expor está em docs/endpoint-proxysevo.md. Só leitura (GET).
// O token mora só em PROXYSEVO_ADMIN_TOKEN e nunca aparece em log ou mensagem de erro.

const TIMEOUT_MS = 20_000;
const CHUNK = 100;

const pick = (o, ...keys) => {
  for (const k of keys) if (o?.[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const toCents = (o, centsKeys, reaisKeys) => {
  const c = pick(o, ...centsKeys);
  if (c !== undefined) return Math.round(Number(c)) || 0;
  const r = pick(o, ...reaisKeys);
  return r !== undefined ? Math.round(Number(r) * 100) || 0 : 0;
};

export function normalizeProxy(p) {
  return {
    id: String(p.id),
    clientId: String(pick(p, 'client_id', 'clientId', 'user_id', 'userId')),
    port: pick(p, 'port') !== undefined ? Number(p.port) : null,
    status: String(pick(p, 'status') || '').toLowerCase(),
    expiresAt: pick(p, 'expires_at', 'expiresAt'),
  };
}

export function normalizeClient(c) {
  return {
    id: String(c.id),
    name: pick(c, 'name', 'nome') || '',
    email: pick(c, 'email') || '',
    whatsapp: pick(c, 'whatsapp', 'phone', 'telefone') || '',
    balanceCents: toCents(c, ['balance_cents', 'balanceCents'], ['balance', 'saldo']),
    bonusBalanceCents: toCents(c, ['bonus_balance_cents', 'bonusBalanceCents'], ['bonus_balance', 'bonus']),
    isAdmin: Boolean(pick(c, 'is_admin', 'isAdmin')),
    isTest: Boolean(pick(c, 'is_test', 'isTest')),
    role: pick(c, 'role'),
  };
}

export function createHttpSource(config, { fetchImpl = globalThis.fetch } = {}) {
  const base = String(config.proxysevo.baseUrl || '').replace(/\/+$/, '');
  const token = config.proxysevo.token;
  if (!base || !token) throw new Error('DATA_SOURCE=proxysevo exige PROXYSEVO_ADMIN_URL e PROXYSEVO_ADMIN_TOKEN no .env');
  if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(base)) {
    throw new Error('PROXYSEVO_ADMIN_URL precisa ser https:// (http só para localhost)');
  }

  async function get(path, params) {
    const url = `${base}${path}?${new URLSearchParams(params)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: ctrl.signal });
    } catch (err) {
      throw new Error(`ProxysEvo não respondeu (${err?.name === 'AbortError' ? 'timeout' : 'falha de rede'}) em ${path}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`ProxysEvo respondeu HTTP ${res.status} em ${path}`);
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new Error(`Resposta inválida da ProxysEvo em ${path}`);
    return body;
  }

  async function byIds(path, key, ids, normalize) {
    const out = [];
    const unique = [...new Set(ids.map(String))];
    for (let i = 0; i < unique.length; i += CHUNK) {
      const body = await get(path, { ids: unique.slice(i, i + CHUNK).join(',') });
      for (const item of body[key] || []) out.push(normalize(item));
    }
    return out;
  }

  return {
    name: 'proxysevo',
    async listBillableProxies({ fromIso, toIso }) {
      const body = await get('/regua/proxies', { from: fromIso, to: toIso, status: 'active,suspended' });
      if (!Array.isArray(body.proxies)) throw new Error('Resposta da ProxysEvo sem "proxies"');
      return body.proxies.map(normalizeProxy);
    },
    async getProxiesByIds(ids) {
      return ids.length ? byIds('/regua/proxies', 'proxies', ids, normalizeProxy) : [];
    },
    async getClients(ids) {
      const map = new Map();
      if (!ids.length) return map;
      for (const c of await byIds('/regua/clients', 'clients', ids, normalizeClient)) map.set(c.id, c);
      return map;
    },
    async searchClients(query, limit = 20) {
      const body = await get('/regua/clients', { q: String(query), limit: String(limit) });
      return (body.clients || []).map(normalizeClient).slice(0, limit);
    },
  };
}
