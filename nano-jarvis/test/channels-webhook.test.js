import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createWhatsappChannel, buildTemplatePayload, templateName } from '../src/channels/whatsapp.js';
import { verifySignature, handleVerify, handleEvent, isOptOutText } from '../src/webhook.js';
import { renderTemplate, unknownVariables, DEFAULT_TEMPLATES, TEMPLATE_VARIABLES } from '../src/templates.js';
import { nextRunAt, localDate, formatBrl, daysBetween } from '../src/dates.js';
import { STAGE_CODES } from '../src/rules.js';
import { makeConfig, makeEnv, silentLogger } from './helpers.js';

const vars = { nome: 'Ana', quantidade: '2', portas: '1, 2', vencimento: '30/11/2026', valor_necessario: 'R$ 35,80', saldo_atual: 'R$ 0,00', link_recarga: 'https://x' };

describe('WhatsApp', () => {
  test('modo simulado é o padrão e não chama a rede', async () => {
    let called = false;
    const ch = createWhatsappChannel(makeConfig(), { fetchImpl: () => (called = true), logger: silentLogger });
    assert.equal(ch.simulated, true);
    const r = await ch.send({ to: '5511988887777', stage: 'D-3', text: 't', variables: vars });
    assert.equal(r.status, 'simulado');
    assert.equal(called, false);
  });

  test('WHATSAPP_MODE=real sem credenciais continua simulado', () => {
    const ch = createWhatsappChannel(makeConfig({ WHATSAPP_MODE: 'real' }), { logger: silentLogger });
    assert.equal(ch.simulated, true);
  });

  test('modo real monta o template da Cloud API com as 7 variáveis na ordem', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.123' }] }) };
    };
    const cfg = makeConfig({ WHATSAPP_MODE: 'real', WHATSAPP_PHONE_NUMBER_ID: '999', WHATSAPP_ACCESS_TOKEN: 'segredo-token' });
    const ch = createWhatsappChannel(cfg, { fetchImpl, logger: silentLogger });
    assert.equal(ch.simulated, false);
    const r = await ch.send({ to: '5511988887777', stage: 'D+1', text: 't', variables: vars });
    assert.equal(r.status, 'enviado');
    assert.equal(r.providerMessageId, 'wamid.123');
    assert.equal(calls[0].url, 'https://graph.facebook.com/v21.0/999/messages');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer segredo-token');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.template.name, 'cobranca_recuperacao');
    assert.equal(body.template.language.code, 'pt_BR');
    assert.deepEqual(body.template.components[0].parameters.map((p) => p.text), TEMPLATE_VARIABLES.map((k) => vars[k]));
  });

  test('erro da Meta vira mensagem sem o token', async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 132001, message: 'Template name does not exist' } }) });
    const cfg = makeConfig({ WHATSAPP_MODE: 'real', WHATSAPP_PHONE_NUMBER_ID: '999', WHATSAPP_ACCESS_TOKEN: 'segredo-token' });
    const ch = createWhatsappChannel(cfg, { fetchImpl, logger: silentLogger });
    await assert.rejects(ch.send({ to: '55', stage: 'D0', text: 't', variables: vars }), (err) => {
      assert.match(err.message, /132001/);
      assert.doesNotMatch(err.message, /segredo-token/);
      return true;
    });
  });

  test('nomes de template por etapa', () => {
    assert.deepEqual(STAGE_CODES.map((s) => templateName('cobranca_', s)), ['cobranca_d7', 'cobranca_d3', 'cobranca_d1', 'cobranca_d0', 'cobranca_recuperacao']);
    assert.equal(buildTemplatePayload({ to: '1', stage: 'D-7', variables: vars, config: makeConfig().whatsapp }).type, 'template');
  });
});

describe('webhook da Meta', () => {
  const secret = 'app-secret';
  const sign = (raw) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  test('assinatura válida, inválida e ausente', () => {
    const raw = Buffer.from('{"a":1}');
    assert.equal(verifySignature(raw, sign(raw), secret), true);
    assert.equal(verifySignature(raw, sign(Buffer.from('{"a":2}')), secret), false);
    assert.equal(verifySignature(raw, undefined, secret), false);
    assert.equal(verifySignature(raw, sign(raw), ''), false); // sem app secret, recusa sempre
  });

  test('verificação do endpoint (GET)', () => {
    const q = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '42' });
    assert.equal(handleVerify(q, 'vt'), '42');
    assert.equal(handleVerify(q, 'outro'), null);
    assert.equal(handleVerify(q, ''), null);
  });

  test('status de entrega atualiza o envio e nunca rebaixa', () => {
    const env = makeEnv();
    const now = new Date().toISOString();
    env.db
      .prepare("INSERT INTO sends (client_id, due_date, stage, channel, recipient, status, attempts, message, provider_message_id, created_at, updated_at) VALUES ('c1','2026-11-30','D-3','whatsapp','5511988887777','enviado',1,'x','wamid.1',?,?)")
      .run(now, now);
    const ev = (status) => ({ entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status }] } }] }] });
    handleEvent(ev('read'), env.store, silentLogger);
    handleEvent(ev('delivered'), env.store, silentLogger);
    assert.equal(env.db.prepare('SELECT status FROM sends').get().status, 'lido');
  });

  test('cliente responde PARAR → entra na lista "não cobrar" como opt-out', () => {
    const env = makeEnv();
    const now = new Date().toISOString();
    env.db
      .prepare("INSERT INTO sends (client_id, due_date, stage, channel, recipient, status, attempts, message, created_at, updated_at) VALUES ('c7','2026-11-30','D-3','whatsapp','5511988887777','enviado',1,'x',?,?)")
      .run(now, now);
    const out = handleEvent({ entry: [{ changes: [{ value: { messages: [{ from: '5511988887777', type: 'text', text: { body: ' Parar ' } }] } }] }] }, env.store, silentLogger);
    assert.equal(out.optOuts, 1);
    const row = env.db.prepare('SELECT * FROM do_not_charge WHERE client_id = ?').get('c7');
    assert.equal(row.origin, 'opt_out');
  });

  test('palavras de opt-out', () => {
    for (const t of ['PARAR', 'sair', 'Stop', 'cancelar']) assert.equal(isOptOutText(t), true);
    assert.equal(isOptOutText('quero parar de receber depois'), false);
  });
});

describe('textos e datas', () => {
  test('renderiza variáveis e deixa vazio o que não existe', () => {
    assert.equal(renderTemplate('Oi {{nome}}, {{ quantidade }} {{x}}!', vars), 'Oi Ana, 2 !');
    assert.deepEqual(unknownVariables('{{nome}} {{saldo}}'), ['saldo']);
  });
  test('textos padrão só usam variáveis conhecidas e todos têm valor e link', () => {
    for (const code of STAGE_CODES) {
      assert.deepEqual(unknownVariables(DEFAULT_TEMPLATES[code]), []);
      assert.match(DEFAULT_TEMPLATES[code], /\{\{valor_necessario\}\}/);
      assert.match(DEFAULT_TEMPLATES[code], /\{\{link_recarga\}\}/);
    }
    assert.match(DEFAULT_TEMPLATES['D+1'], /mesmo IP/);
  });
  test('próxima execução às 09h00 de São Paulo (12h00 UTC)', () => {
    assert.equal(nextRunAt(new Date('2026-11-27T11:00:00Z'), 9, 0, 'America/Sao_Paulo').toISOString(), '2026-11-27T12:00:00.000Z');
    assert.equal(nextRunAt(new Date('2026-11-27T12:00:00Z'), 9, 0, 'America/Sao_Paulo').toISOString(), '2026-11-28T12:00:00.000Z');
  });
  test('data local, diferença de dias e moeda', () => {
    assert.equal(localDate('2026-11-28T02:30:00Z', 'America/Sao_Paulo'), '2026-11-27');
    assert.equal(daysBetween('2026-11-27', '2026-12-04'), 7);
    assert.equal(formatBrl(1790), 'R$ 17,90');
    assert.equal(formatBrl(123456), 'R$ 1.234,56');
  });
});
