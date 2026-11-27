import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBilling, resendOne } from '../src/engine.js';
import { buildOwnerSummary, sendOwnerSummary } from '../src/summary.js';
import { makeEnv, makeConfig, fakeChannel, silentLogger, NOW, dueAt } from './helpers.js';

async function failedSend() {
  const env = makeEnv({ env: { MAX_SEND_ATTEMPTS: '1' } });
  env.addClient({ id: 'c1', name: 'Ana' });
  env.addProxy({ id: 'p1', clientId: 'c1', port: 10001, expiresAt: dueAt('2026-11-30') });
  const wa = fakeChannel('whatsapp', { failTimes: 1 });
  await runBilling({ store: env.store, source: env.source, config: env.config, channels: [wa], logger: silentLogger, now: NOW });
  const row = env.db.prepare('SELECT * FROM sends').get();
  return { env, wa, row };
}

test('reenvio manual de envio que falhou usa as variáveis salvas e só acontece uma vez', async () => {
  const { env, wa, row } = await failedSend();
  assert.equal(row.status, 'falhou');
  assert.equal(JSON.parse(row.variables).nome, 'Ana');
  const [a, b] = await Promise.all([
    resendOne({ id: row.id, store: env.store, channels: [wa], logger: silentLogger }),
    resendOne({ id: row.id, store: env.store, channels: [wa], logger: silentLogger }),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  assert.equal(wa.sent.length, 1);
  assert.equal(wa.sent[0].variables.portas, '10001');
  assert.equal(env.store.getSendById(row.id).status, 'simulado');
  const again = await resendOne({ id: row.id, store: env.store, channels: [wa], logger: silentLogger });
  assert.equal(again.ok, false); // já saiu: não reenvia
});

test('reenvio que falha de novo volta para "falhou"', async () => {
  const { env, wa, row } = await failedSend();
  wa.setFailures(1);
  const r = await resendOne({ id: row.id, store: env.store, channels: [wa], logger: silentLogger });
  assert.equal(r.ok, false);
  assert.equal(env.store.getSendById(row.id).status, 'falhou');
});

test('resumo do dono lista envios, renovações e não cobrados', () => {
  const text = buildOwnerSummary({
    runDate: '2026-11-27', status: 'ok', sent: 2, failed: 0,
    decisions: [{ action: 'send', clientName: 'Ana', stage: 'D-3', quantity: 3, dueDate: '2026-11-30', requiredCents: 5370, balanceCents: 1000 }],
    cycles: { renovado: [{}], recarregado: [], encerrado: [] },
    skipped: { saldo_suficiente: 4, etapa_ja_enviada: 1 },
  });
  assert.match(text, /27\/11\/2026/);
  assert.match(text, /Ana: D-3, 3 proxy\(s\), vence 30\/11\/2026, falta R\$ 43,70/);
  assert.match(text, /Renovaram: 1/);
  assert.match(text, /Saldo suficiente 4/);
  assert.doesNotMatch(text, /Etapa já enviada/);
  assert.match(buildOwnerSummary({ runDate: '2026-11-27', status: 'regua_desligada' }), /DESLIGADA/);
});

test('resumo vai por e-mail só com OWNER_EMAIL', async () => {
  const mail = fakeChannel('email', { recipient: () => 'x' });
  assert.deepEqual(await sendOwnerSummary({ summary: { runDate: '2026-11-27', status: 'regua_desligada' }, config: makeConfig(), logger: silentLogger, emailChannel: mail }), { sent: false });
  const r = await sendOwnerSummary({ summary: { runDate: '2026-11-27', status: 'regua_desligada' }, config: makeConfig({ OWNER_EMAIL: 'dono@x.com' }), logger: silentLogger, emailChannel: mail });
  assert.equal(r.sent, true);
  assert.equal(mail.sent[0].to, 'dono@x.com');
});
