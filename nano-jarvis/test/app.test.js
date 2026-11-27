import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/app.js';
import { makeEnv, fakeChannel, silentLogger, dueAt } from './helpers.js';

const TOKEN = 'token-de-teste-com-mais-de-16';

describe('API do painel Cobranças', () => {
  let server;
  let base;
  let env;
  const call = (method, path, { body, token = TOKEN, headers = {} } = {}) =>
    fetch(base + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });

  before(async () => {
    env = makeEnv({ enabled: false, env: { ADMIN_TOKEN: TOKEN, WHATSAPP_APP_SECRET: 'segredo-app' } });
    env.addClient({ id: 'c1', name: 'Ana Souza' });
    env.addProxy({ id: 'p1', clientId: 'c1', expiresAt: dueAt('2026-11-30') });
    const app = createApp({ config: env.config, store: env.store, source: env.source, channels: [fakeChannel()], logger: silentLogger });
    server = createServer(app.handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('sem token ou com token errado: 401', async () => {
    assert.equal((await call('GET', '/api/cobrancas/overview', { token: '' })).status, 401);
    assert.equal((await call('GET', '/api/cobrancas/overview', { token: 'errado' })).status, 401);
  });

  test('painel estático com cabeçalhos de segurança', async () => {
    const res = await call('GET', '/admin', { token: '' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.match(await res.text(), /Cobranças/);
  });

  test('visão geral: régua começa desligada e WhatsApp simulado', async () => {
    const o = await (await call('GET', '/api/cobrancas/overview')).json();
    assert.equal(o.enabled, false);
    assert.equal(o.whatsappMode, 'simulado');
    assert.equal(o.priceCents, 1790);
  });

  test('liga/desliga', async () => {
    assert.equal((await call('POST', '/api/cobrancas/toggle', { body: { enabled: 'sim' } })).status, 400);
    const r = await (await call('POST', '/api/cobrancas/toggle', { body: { enabled: true } })).json();
    assert.equal(r.enabled, true);
    assert.equal(env.store.isEnabled(), true);
    await call('POST', '/api/cobrancas/toggle', { body: { enabled: false } });
    assert.equal(env.store.isEnabled(), false);
  });

  test('"Não cobrar" exige motivo e cliente existente; "Voltar a cobrar" remove', async () => {
    assert.equal((await call('POST', '/api/cobrancas/nao-cobrar', { body: { clientId: 'c1', reason: '' } })).status, 400);
    assert.equal((await call('POST', '/api/cobrancas/nao-cobrar', { body: { clientId: 'nao-existe', reason: 'x' } })).status, 404);
    assert.equal((await call('POST', '/api/cobrancas/nao-cobrar', { body: { clientId: 'c1', reason: 'Combinado por fora' } })).status, 200);
    assert.equal(env.store.isDoNotCharge('c1'), true);
    const list = await (await call('GET', '/api/cobrancas/nao-cobrar')).json();
    assert.equal(list.list[0].client_name, 'Ana Souza');
    assert.equal((await call('DELETE', '/api/cobrancas/nao-cobrar?clientId=c1')).status, 200);
    assert.equal(env.store.isDoNotCharge('c1'), false);
    assert.equal((await call('DELETE', '/api/cobrancas/nao-cobrar?clientId=c1')).status, 404);
    const log = (await (await call('GET', '/api/cobrancas/nao-cobrar')).json()).log;
    assert.deepEqual(log.map((l) => l.action), ['voltar_a_cobrar', 'nao_cobrar']);
  });

  test('editor de textos valida variáveis e tamanho', async () => {
    assert.equal((await call('PUT', '/api/cobrancas/templates', { body: { templates: { 'D-7': 'Oi {{inexistente}}' } } })).status, 400);
    assert.equal((await call('PUT', '/api/cobrancas/templates', { body: { templates: { 'D-7': 'x'.repeat(1025) } } })).status, 400);
    const ok = await (await call('PUT', '/api/cobrancas/templates', { body: { templates: { 'D-7': 'Oi {{nome}}, vence {{vencimento}}' } } })).json();
    assert.equal(ok.templates['D-7'], 'Oi {{nome}}, vence {{vencimento}}');
    const reset = await (await call('POST', '/api/cobrancas/templates/reset', { body: {} })).json();
    assert.notEqual(reset.templates['D-7'], 'Oi {{nome}}, vence {{vencimento}}');
  });

  test('POST sem JSON é recusado (415) e corpo gigante (413)', async () => {
    assert.equal((await call('POST', '/api/cobrancas/toggle', { body: 'enabled=true', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.equal((await call('POST', '/api/cobrancas/toggle', { body: JSON.stringify({ x: 'a'.repeat(70_000) }) })).status, 413);
  });

  test('prévia por data e execução respeitando o liga/desliga', async () => {
    const p = await (await call('POST', '/api/cobrancas/preview', { body: { date: '2026-11-27' } })).json();
    assert.equal(p.decisions[0].stage, 'D-3');
    assert.equal((await call('POST', '/api/cobrancas/preview', { body: { date: '27/11/2026' } })).status, 400);
    const r = await (await call('POST', '/api/cobrancas/run', { body: {} })).json();
    assert.equal(r.status, 'regua_desligada');
  });

  test('busca de clientes', async () => {
    const r = await (await call('GET', '/api/clientes?q=ana')).json();
    assert.equal(r.clients[0].id, 'c1');
  });

  test('webhook recusa POST sem assinatura válida', async () => {
    const raw = JSON.stringify({ entry: [] });
    assert.equal((await call('POST', '/webhooks/whatsapp', { token: '', body: raw })).status, 401);
    const sig = `sha256=${createHmac('sha256', 'segredo-app').update(raw).digest('hex')}`;
    assert.equal((await call('POST', '/webhooks/whatsapp', { token: '', body: raw, headers: { 'X-Hub-Signature-256': sig } })).status, 200);
  });

  test('força bruta no token: bloqueia depois de 10 erros', async () => {
    for (let i = 0; i < 10; i++) await call('GET', '/api/cobrancas/overview', { token: `errado-${i}` });
    assert.equal((await call('GET', '/api/cobrancas/overview')).status, 429);
  });
});

test('sem ADMIN_TOKEN configurado o painel recusa (503)', async () => {
  const env = makeEnv({ env: { ADMIN_TOKEN: '' } });
  const app = createApp({ config: env.config, store: env.store, source: env.source, channels: [fakeChannel()], logger: silentLogger });
  const server = createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/cobrancas/overview`, { headers: { Authorization: 'Bearer qualquer' } });
  assert.equal(res.status, 503);
  server.close();
});
