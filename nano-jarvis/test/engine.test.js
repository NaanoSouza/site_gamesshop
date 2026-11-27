import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runBilling } from '../src/engine.js';
import { makeEnv, fakeChannel, silentLogger, NOW, nowFor, dueAt } from './helpers.js';

const run = (env, channels, opts = {}) => runBilling({ store: env.store, source: env.source, config: env.config, channels, logger: silentLogger, now: NOW, ...opts });
const sends = (env) => env.db.prepare('SELECT * FROM sends ORDER BY id').all();
const cycle = (env, clientId, dueDate) => env.db.prepare('SELECT * FROM cycles WHERE client_id = ? AND due_date = ?').get(clientId, dueDate);

describe('motor da régua', () => {
  test('régua desligada não envia nada', async () => {
    const env = makeEnv({ enabled: false });
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel();
    const s = await run(env, [wa]);
    assert.equal(s.status, 'regua_desligada');
    assert.equal(wa.sent.length, 0);
    assert.equal(sends(env).length, 0);
  });

  test('uma mensagem por cliente+vencimento, com as variáveis certas', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1', name: 'Ana Souza', balance: 1000 });
    for (const [id, port] of [['p1', 10002], ['p2', 10001], ['p3', 10003]]) env.addProxy({ id, clientId: 'c1', port, expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel();
    await run(env, [wa]);
    assert.equal(wa.sent.length, 1);
    const m = wa.sent[0];
    assert.equal(m.stage, 'D-3');
    assert.equal(m.variables.nome, 'Ana');
    assert.equal(m.variables.quantidade, '3');
    assert.equal(m.variables.portas, '10001, 10002, 10003');
    assert.equal(m.variables.vencimento, '30/11/2026');
    assert.equal(m.variables.valor_necessario, 'R$ 53,70');
    assert.equal(m.variables.saldo_atual, 'R$ 10,00');
    assert.match(m.text, /53,70/);
    assert.equal(sends(env)[0].status, 'simulado');
  });

  test('não cobra saldo suficiente, "não cobrar", admin e teste', async () => {
    const env = makeEnv();
    env.addClient({ id: 'rico', balance: 5000 });
    env.addClient({ id: 'dnc' });
    env.addClient({ id: 'adm', admin: true });
    env.addClient({ id: 'tst', test: true });
    for (const c of ['rico', 'dnc', 'adm', 'tst']) env.addProxy({ id: `p-${c}`, clientId: c, expiresAt: dueAt('2026-11-28') });
    env.store.addDoNotCharge({ clientId: 'dnc', reason: 'combinado', actor: 'teste' });
    const wa = fakeChannel();
    const s = await run(env, [wa]);
    assert.equal(wa.sent.length, 0);
    assert.deepEqual(s.skipped, { saldo_suficiente: 1, nao_cobrar: 1, conta_admin: 1, conta_teste: 1 });
  });

  test('rodar duas vezes no mesmo dia não repete a etapa', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel();
    await run(env, [wa]);
    await run(env, [wa]);
    await run(env, [wa], { now: nowFor('2026-11-28') }); // D-2: ainda janela do D-3, já enviado
    assert.equal(wa.sent.length, 1);
    assert.equal(sends(env).length, 1);
  });

  test('duas execuções simultâneas não duplicam (trava + UNIQUE)', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel();
    await Promise.all([run(env, [wa]), run(env, [wa]), run(env, [wa])]);
    assert.equal(wa.sent.length, 1);
  });

  test('régua completa D-7 → D-3 → D-1 → D0 → D+1, uma de cada', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-12-04') });
    const wa = fakeChannel();
    for (let day = 27; day <= 30; day++) await run(env, [wa], { now: nowFor(`2026-11-${day}`) });
    for (let day = 1; day <= 4; day++) await run(env, [wa], { now: nowFor(`2026-12-0${day}`) });
    // suspenso no dia seguinte ao vencimento
    env.setProxy('p1', { status: 'suspended' });
    await run(env, [wa], { now: nowFor('2026-12-05') });
    await run(env, [wa], { now: nowFor('2026-12-06') });
    assert.deepEqual(wa.sent.map((m) => m.stage), ['D-7', 'D-3', 'D-1', 'D0', 'D+1']);
  });

  test('D+1 não sai se o proxy não foi suspenso', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', status: 'active', expiresAt: dueAt('2026-11-26') });
    const wa = fakeChannel();
    await run(env, [wa]);
    assert.equal(wa.sent.length, 0);
  });

  test('para a régua quando o cliente RENOVA', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-28') });
    const wa = fakeChannel();
    await run(env, [wa]); // D-1
    env.setProxy('p1', { expiresAt: dueAt('2026-12-28') }); // renovou 30 dias
    const s = await run(env, [wa], { now: nowFor('2026-11-28') });
    assert.equal(wa.sent.length, 1);
    assert.equal(cycle(env, 'c1', '2026-11-28').status, 'renovado');
    assert.equal(s.cycles.renovado.length, 1);
  });

  test('para a régua quando o cliente RECARREGA', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1', balance: 0 });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-28') });
    const wa = fakeChannel();
    await run(env, [wa]); // D-1
    env.setBalance('c1', 2000);
    await run(env, [wa], { now: nowFor('2026-11-28') }); // D0: tem saldo, não envia
    assert.equal(wa.sent.length, 1);
    assert.equal(cycle(env, 'c1', '2026-11-28').status, 'recarregado');
  });

  test('ciclo recarregado reabre se o saldo cair de novo antes do vencimento', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1', balance: 0 });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel();
    await run(env, [wa]); // D-3
    env.setBalance('c1', 2000);
    await run(env, [wa], { now: nowFor('2026-11-28') });
    assert.equal(cycle(env, 'c1', '2026-11-30').status, 'recarregado');
    env.setBalance('c1', 0); // gastou o saldo em outra coisa
    await run(env, [wa], { now: nowFor('2026-11-29') }); // D-1
    assert.deepEqual(wa.sent.map((m) => m.stage), ['D-3', 'D-1']);
    assert.equal(cycle(env, 'c1', '2026-11-30').status, 'em_cobranca');
  });

  test('cliente marcado "não cobrar" no meio da régua para de receber', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel();
    await run(env, [wa]);
    env.store.addDoNotCharge({ clientId: 'c1', reason: 'pediu', actor: 'teste' });
    await run(env, [wa], { now: nowFor('2026-11-29') });
    assert.equal(wa.sent.length, 1);
  });

  test('ciclo encerrado quando passa da recuperação sem renovar', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-27') });
    const wa = fakeChannel();
    await run(env, [wa]); // D0
    env.setProxy('p1', { status: 'expired' });
    await run(env, [wa], { now: nowFor('2026-11-30') });
    assert.equal(cycle(env, 'c1', '2026-11-27').status, 'encerrado');
  });

  test('falha da API: registra, tenta de novo na próxima execução e para no limite', async () => {
    const env = makeEnv({ env: { MAX_SEND_ATTEMPTS: '3' } });
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel('whatsapp', { failTimes: 10 });
    for (let i = 0; i < 5; i++) await run(env, [wa]);
    const [row] = sends(env);
    assert.equal(row.status, 'falhou');
    assert.equal(row.attempts, 3);
    assert.match(row.error, /falha simulada/);
  });

  test('falha seguida de sucesso: envia uma vez só', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel('whatsapp', { failTimes: 1 });
    await run(env, [wa]);
    await run(env, [wa]);
    await run(env, [wa]);
    assert.equal(wa.sent.length, 1);
    const [row] = sends(env);
    assert.equal(row.status, 'simulado');
    assert.equal(row.attempts, 2);
  });

  test('um canal falhou e outro saiu: só o que falhou é retentado', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel('whatsapp', { failTimes: 1 });
    const email = fakeChannel('email', { recipient: (c) => c.email });
    await run(env, [wa, email]);
    await run(env, [wa, email]);
    assert.equal(wa.sent.length, 1);
    assert.equal(email.sent.length, 1);
  });

  test('envio que ficou "pendente" (processo caiu) vira "incerto" e não é repetido', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const old = new Date(Date.now() - 3600_000).toISOString();
    env.db
      .prepare("INSERT INTO sends (client_id, due_date, stage, channel, status, attempts, message, created_at, updated_at) VALUES ('c1', '2026-11-30', 'D-3', 'whatsapp', 'pendente', 1, 'x', ?, ?)")
      .run(old, old);
    const wa = fakeChannel();
    await run(env, [wa]);
    assert.equal(wa.sent.length, 0);
    assert.equal(sends(env)[0].status, 'incerto');
  });

  test('cliente sem WhatsApp válido não gera envio', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1', whatsapp: '' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel();
    const s = await run(env, [wa]);
    assert.equal(s.skipped.sem_contato, 1);
    assert.equal(sends(env).length, 0);
  });

  test('prévia não envia nem grava nada', async () => {
    const env = makeEnv({ enabled: false });
    env.addClient({ id: 'c1' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel();
    const s = await run(env, [wa], { dryRun: true });
    assert.equal(s.decisions[0].action, 'send');
    assert.equal(s.wouldSend, 1);
    assert.equal(wa.sent.length, 0);
    assert.equal(sends(env).length, 0);
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM cycles').get().n, 0);
  });

  test('saldo cobre o primeiro vencimento mas não os dois: cobra só o segundo', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1', balance: 2000 });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-29') });
    env.addProxy({ id: 'p2', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const wa = fakeChannel();
    await run(env, [wa]);
    assert.equal(wa.sent.length, 1);
    assert.equal(wa.sent[0].stage, 'D-3');
    assert.equal(wa.sent[0].variables.valor_necessario, 'R$ 35,80');
  });

  test('a fonte de dados nunca é alterada pela régua', async () => {
    const env = makeEnv();
    env.addClient({ id: 'c1', balance: 100 });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const before = JSON.stringify([env.db.prepare('SELECT * FROM demo_clients').all(), env.db.prepare('SELECT * FROM demo_proxies').all()]);
    await run(env, [fakeChannel()]);
    const after = JSON.stringify([env.db.prepare('SELECT * FROM demo_clients').all(), env.db.prepare('SELECT * FROM demo_proxies').all()]);
    assert.equal(after, before);
  });
});
