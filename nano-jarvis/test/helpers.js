import { openDb } from '../src/db.js';
import { createStore } from '../src/store.js';
import { createDemoSource } from '../src/source/demo.js';
import { loadConfig } from '../src/config.js';

export const silentLogger = { info() {}, warn() {}, error() {} };

export function makeConfig(env = {}) {
  return loadConfig({ DB_PATH: ':memory:', SCHEDULER_ENABLED: 'false', ...env });
}

/** "Hoje" fixo dos testes: 27/11/2026 ao meio-dia de São Paulo. */
export const TODAY = '2026-11-27';
export const NOW = new Date('2026-11-27T15:00:00.000Z');
export const nowFor = (ymd) => new Date(`${ymd}T15:00:00.000Z`);
export const dueAt = (ymd) => `${ymd}T18:00:00.000Z`;

export function makeEnv({ env, enabled = true } = {}) {
  const config = makeConfig(env);
  const db = openDb(':memory:');
  const store = createStore(db);
  const source = createDemoSource(db);
  if (enabled) store.setEnabled(true, 'teste');
  const addClient = (c) =>
    db
      .prepare('INSERT INTO demo_clients (id, name, email, whatsapp, balance_cents, bonus_balance_cents, is_admin, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, c.name || `Cliente ${c.id}`, c.email ?? `${c.id}@exemplo.com.br`, c.whatsapp ?? '11988887777', c.balance ?? 0, c.bonus ?? 0, c.admin ? 1 : 0, c.test ? 1 : 0);
  const addProxy = (p) =>
    db.prepare('INSERT INTO demo_proxies (id, client_id, port, status, expires_at) VALUES (?, ?, ?, ?, ?)').run(p.id, p.clientId, p.port ?? 10000, p.status || 'active', p.expiresAt);
  const setBalance = (id, cents) => db.prepare('UPDATE demo_clients SET balance_cents = ? WHERE id = ?').run(cents, id);
  const setProxy = (id, fields) => {
    if (fields.expiresAt) db.prepare('UPDATE demo_proxies SET expires_at = ? WHERE id = ?').run(fields.expiresAt, id);
    if (fields.status) db.prepare('UPDATE demo_proxies SET status = ? WHERE id = ?').run(fields.status, id);
  };
  return { config, db, store, source, addClient, addProxy, setBalance, setProxy };
}

/** Canal falso que grava o que "enviou" e pode falhar sob demanda. */
export function fakeChannel(name = 'whatsapp', { failTimes = 0, recipient } = {}) {
  let failuresLeft = failTimes;
  const sent = [];
  return {
    name,
    simulated: true,
    sent,
    recipientFor: recipient || ((c) => (c.whatsapp ? String(c.whatsapp).replace(/\D/g, '') : null)),
    async send(msg) {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error('falha simulada da API');
      }
      sent.push(msg);
      return { status: 'simulado', providerMessageId: null, costCents: 0 };
    },
    setFailures(n) {
      failuresLeft = n;
    },
  };
}
