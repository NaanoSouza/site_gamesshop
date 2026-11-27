import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHttpSource, normalizeClient, normalizeProxy } from '../src/source/http.js';
import { sendMail, buildMessage, encodeHeader } from '../src/channels/smtp.js';
import { createEmailChannel } from '../src/channels/email.js';
import { makeConfig, silentLogger } from './helpers.js';

const cfg = (env = {}) => makeConfig({ DATA_SOURCE: 'proxysevo', PROXYSEVO_ADMIN_URL: 'https://px.exemplo.com/interno', PROXYSEVO_ADMIN_TOKEN: 'tok-secreto', ...env });

describe('fonte de dados HTTP da ProxysEvo', () => {
  test('exige URL e token, e https fora de localhost', () => {
    assert.throws(() => createHttpSource(makeConfig({ DATA_SOURCE: 'proxysevo' })), /PROXYSEVO_ADMIN_URL/);
    assert.throws(() => createHttpSource(cfg({ PROXYSEVO_ADMIN_URL: 'http://px.exemplo.com' })), /https/);
    assert.doesNotThrow(() => createHttpSource(cfg({ PROXYSEVO_ADMIN_URL: 'http://127.0.0.1:3781' })));
  });

  test('normaliza snake_case, camelCase e saldo em reais', () => {
    assert.deepEqual(normalizeProxy({ id: 1, user_id: 7, port: '10001', status: 'ACTIVE', expires_at: '2026-11-30T18:00:00Z' }), {
      id: '1', clientId: '7', port: 10001, status: 'active', expiresAt: '2026-11-30T18:00:00Z',
    });
    const c = normalizeClient({ id: 7, nome: 'Ana', saldo: 10.5, bonus: '2', is_admin: 1 });
    assert.equal(c.balanceCents, 1050);
    assert.equal(c.bonusBalanceCents, 200);
    assert.equal(c.isAdmin, true);
  });

  test('chama as rotas com Bearer, em lotes de 100 ids', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: new URL(url), auth: init.headers.Authorization });
      const ids = new URL(url).searchParams.get('ids')?.split(',') || [];
      return { ok: true, status: 200, json: async () => ({ clients: ids.map((id) => ({ id, name: `C${id}`, balance_cents: 0 })) }) };
    };
    const src = createHttpSource(cfg(), { fetchImpl });
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    const map = await src.getClients(ids);
    assert.equal(map.size, 250);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url.pathname, '/interno/regua/clients');
    assert.equal(calls[0].auth, 'Bearer tok-secreto');
  });

  test('erro HTTP não vaza o token', async () => {
    const src = createHttpSource(cfg(), { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
    await assert.rejects(src.listBillableProxies({ fromIso: 'a', toIso: 'b' }), (e) => /HTTP 500/.test(e.message) && !e.message.includes('tok-secreto'));
  });
});

/** Servidor SMTP falso (sem TLS, só localhost) que grava a conversa. */
function fakeSmtp({ starttls = false, authOk = true } = {}) {
  const log = [];
  let data = null;
  const server = net.createServer((s) => {
    let inData = false;
    let buf = '';
    s.write('220 fake ESMTP\r\n');
    s.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; s.write('250 2.0.0 Ok: queued as ABC\r\n'); } else data.push(line);
          continue;
        }
        log.push(line);
        if (line.startsWith('EHLO')) s.write(`250-fake\r\n${starttls ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`);
        else if (line.startsWith('AUTH')) s.write(authOk ? '235 ok\r\n' : '535 bad credentials\r\n');
        else if (line.startsWith('MAIL') || line.startsWith('RCPT')) s.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; data = []; s.write('354 go\r\n'); }
        else if (line === 'QUIT') { s.write('221 bye\r\n'); s.end(); }
      }
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, log, getData: () => data })));
}

describe('e-mail por SMTP', () => {
  test('envia com AUTH, cabeçalho UTF-8 e corpo base64', async () => {
    const { server, port, log, getData } = await fakeSmtp();
    const msg = buildMessage({ from: 'ProxysEvo <nao-responda@exemplo.com>', to: 'ana@exemplo.com', subject: 'Seus proxies vencem amanhã', text: 'Olá, Ana.\n.linha com ponto' });
    await sendMail({ host: '127.0.0.1', port, secure: false, user: 'u', pass: 'p', from: 'ProxysEvo <nao-responda@exemplo.com>', to: 'ana@exemplo.com', allowInsecure: true }, msg);
    server.close();
    assert.ok(log.includes('MAIL FROM:<nao-responda@exemplo.com>'));
    assert.ok(log.includes('RCPT TO:<ana@exemplo.com>'));
    const data = getData().join('\n');
    assert.match(data, /Subject: =\?UTF-8\?B\?/);
    const body = Buffer.from(data.split('\n\n').pop().replace(/\n/g, ''), 'base64').toString('utf8');
    assert.equal(body, 'Olá, Ana.\n.linha com ponto');
  });

  test('recusa servidor sem TLS se não for teste em localhost', async () => {
    const { server, port } = await fakeSmtp();
    await assert.rejects(sendMail({ host: '127.0.0.1', port, secure: false, from: 'a@b.com', to: 'c@d.com', allowInsecure: false }, 'x'), /sem TLS/);
    server.close();
  });

  test('erro de autenticação não mostra a senha', async () => {
    const { server, port } = await fakeSmtp({ authOk: false });
    await assert.rejects(
      sendMail({ host: '127.0.0.1', port, secure: false, user: 'u', pass: 'senha-super', from: 'a@b.com', to: 'c@d.com', allowInsecure: true }, 'x'),
      (e) => /AUTH \*\*\*/.test(e.message) && !e.message.includes('senha-super') && !e.message.includes(Buffer.from('\0u\0senha-super').toString('base64')),
    );
    server.close();
  });

  test('canal e-mail: simulado por padrão, real com SMTP configurado', async () => {
    assert.equal(createEmailChannel(makeConfig(), { logger: silentLogger }).simulated, true);
    const sent = [];
    const ch = createEmailChannel(makeConfig({ EMAIL_MODE: 'real', SMTP_HOST: 'smtp.x.com', SMTP_FROM: 'a@x.com' }), { logger: silentLogger, send: async (o, m) => sent.push({ o, m }) });
    assert.equal(ch.simulated, false);
    const r = await ch.send({ to: 'ana@x.com', stage: 'D0', subject: 'Assunto', text: 'Texto' });
    assert.equal(r.status, 'enviado');
    assert.equal(sent[0].o.to, 'ana@x.com');
    assert.equal(ch.recipientFor({ email: 'invalido' }), null);
    assert.equal(encodeHeader('abc'), 'abc');
  });
});
