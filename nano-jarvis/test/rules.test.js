import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  stageForDays,
  groupProxies,
  requiredCents,
  cumulativeRequiredCents,
  availableBalanceCents,
  exclusionReason,
  decide,
  normalizeWhatsapp,
} from '../src/rules.js';
import { makeConfig, TODAY, dueAt } from './helpers.js';

const TZ = 'America/Sao_Paulo';
const config = makeConfig();

describe('etapas da régua', () => {
  test('D-7, D-3, D-1, D0 nos dias exatos', () => {
    assert.equal(stageForDays(7, { suspended: false }), 'D-7');
    assert.equal(stageForDays(3, { suspended: false }), 'D-3');
    assert.equal(stageForDays(1, { suspended: false }), 'D-1');
    assert.equal(stageForDays(0, { suspended: false }), 'D0');
  });
  test('janela de recuperação de dia perdido: 6..4 ainda é D-7, 2 ainda é D-3', () => {
    for (const d of [6, 5, 4]) assert.equal(stageForDays(d, { suspended: false }), 'D-7');
    assert.equal(stageForDays(2, { suspended: false }), 'D-3');
  });
  test('D+1 só com proxy suspenso', () => {
    assert.equal(stageForDays(-1, { suspended: true }), 'D+1');
    assert.equal(stageForDays(-2, { suspended: true }), 'D+1');
    assert.equal(stageForDays(-1, { suspended: false }), null);
  });
  test('fora da régua: mais de 7 dias antes ou mais de 2 depois', () => {
    assert.equal(stageForDays(8, { suspended: false }), null);
    assert.equal(stageForDays(-3, { suspended: true }), null);
  });
});

describe('agrupamento por cliente + vencimento', () => {
  const proxies = [
    { id: 'a', clientId: 'c1', port: 2, status: 'active', expiresAt: dueAt('2026-11-30') },
    { id: 'b', clientId: 'c1', port: 1, status: 'active', expiresAt: dueAt('2026-11-30') },
    { id: 'c', clientId: 'c1', port: 3, status: 'active', expiresAt: dueAt('2026-12-01') },
    { id: 'd', clientId: 'c2', port: 4, status: 'active', expiresAt: dueAt('2026-11-30') },
    { id: 'e', clientId: 'c2', port: 5, status: 'cancelled', expiresAt: dueAt('2026-11-30') },
    { id: 'f', clientId: 'c3', port: 6, status: 'active', expiresAt: dueAt('2026-12-05') }, // 8 dias: fora
    { id: 'g', clientId: 'c4', port: 7, status: 'suspended', expiresAt: dueAt('2026-11-26') },
  ];
  const groups = groupProxies(proxies, TODAY, TZ);

  test('uma entrada por cliente+data, com quantidade e portas ordenadas', () => {
    const c1 = groups.filter((g) => g.clientId === 'c1');
    assert.equal(c1.length, 2);
    assert.equal(c1[0].dueDate, '2026-11-30');
    assert.equal(c1[0].quantity, 2);
    assert.deepEqual(c1[0].ports, [1, 2]);
    assert.equal(c1[0].daysUntilDue, 3);
  });
  test('proxy cancelado não entra, nem vencimento fora dos 7 dias', () => {
    assert.equal(groups.find((g) => g.clientId === 'c2').quantity, 1);
    assert.equal(groups.find((g) => g.clientId === 'c3'), undefined);
  });
  test('suspenso marcado no grupo', () => {
    const g = groups.find((x) => x.clientId === 'c4');
    assert.equal(g.suspended, true);
    assert.equal(g.daysUntilDue, -1);
  });
  test('data de vencimento é a de São Paulo, não a de UTC', () => {
    // 02:00 UTC do dia 01/12 = 23:00 de 30/11 em São Paulo.
    const [g] = groupProxies([{ id: 'x', clientId: 'c9', port: 1, status: 'active', expiresAt: '2026-12-01T02:00:00.000Z' }], TODAY, TZ);
    assert.equal(g.dueDate, '2026-11-30');
  });
});

describe('valor necessário e saldo', () => {
  test('preço de referência R$ 17,90 × quantidade', () => {
    assert.equal(config.proxyPriceCents, 1790);
    assert.equal(requiredCents(3, 1790), 5370);
  });
  test('cumulativo: vencimento posterior soma os anteriores do mesmo cliente', () => {
    const g1 = { dueDate: '2026-11-29', quantity: 1 };
    const g2 = { dueDate: '2026-12-02', quantity: 2 };
    assert.equal(cumulativeRequiredCents(g1, [g1, g2], 1790), 1790);
    assert.equal(cumulativeRequiredCents(g2, [g1, g2], 1790), 5370);
  });
  test('bônus conta como saldo por padrão e pode ser desligado', () => {
    assert.equal(availableBalanceCents({ balanceCents: 1000, bonusBalanceCents: 800 }, true), 1800);
    assert.equal(availableBalanceCents({ balanceCents: 1000, bonusBalanceCents: 800 }, false), 1000);
  });
});

describe('exclusões', () => {
  test('admin e teste por marcação na fonte', () => {
    assert.equal(exclusionReason({ id: '1', isAdmin: true }, config), 'conta_admin');
    assert.equal(exclusionReason({ id: '1', role: 'ADMIN' }, config), 'conta_admin');
    assert.equal(exclusionReason({ id: '1', isTest: true }, config), 'conta_teste');
    assert.equal(exclusionReason({ id: '1', email: 'cliente@x.com' }, config), null);
  });
  test('teste por lista de e-mails, domínios e IDs na configuração', () => {
    const cfg = makeConfig({ IGNORE_EMAILS: 'qa@x.com', IGNORE_EMAIL_DOMAINS: 'teste.com', IGNORE_CLIENT_IDS: '42' });
    assert.equal(exclusionReason({ id: '1', email: 'QA@x.com' }, cfg), 'conta_teste');
    assert.equal(exclusionReason({ id: '1', email: 'joao@teste.com' }, cfg), 'conta_teste');
    assert.equal(exclusionReason({ id: '42', email: 'a@b.com' }, cfg), 'conta_teste');
  });
});

describe('decisão de envio', () => {
  const group = { clientId: 'c1', dueDate: '2026-11-30', daysUntilDue: 3, quantity: 2, suspended: false };
  const client = { id: 'c1', name: 'Ana', balanceCents: 0, bonusBalanceCents: 0 };
  const base = { group, clientGroups: [group], client, doNotCharge: false, sentStages: [], config };

  test('sem saldo → envia a etapa do dia', () => {
    const d = decide(base);
    assert.equal(d.action, 'send');
    assert.equal(d.stage, 'D-3');
    assert.equal(d.requiredCents, 3580);
  });
  test('NÃO cobra quem tem saldo suficiente (igual conta como suficiente)', () => {
    assert.equal(decide({ ...base, client: { ...client, balanceCents: 3580 } }).reason, 'saldo_suficiente');
    assert.equal(decide({ ...base, client: { ...client, balanceCents: 10000 } }).reason, 'saldo_suficiente');
    assert.equal(decide({ ...base, client: { ...client, balanceCents: 3579 } }).action, 'send');
  });
  test('NÃO cobra quem está na lista "não cobrar"', () => {
    assert.equal(decide({ ...base, doNotCharge: true }).reason, 'nao_cobrar');
  });
  test('ignora admin e teste mesmo sem saldo', () => {
    assert.equal(decide({ ...base, client: { ...client, isAdmin: true } }).reason, 'conta_admin');
    assert.equal(decide({ ...base, client: { ...client, isTest: true } }).reason, 'conta_teste');
  });
  test('nunca a mesma etapa duas vezes', () => {
    assert.equal(decide({ ...base, sentStages: ['D-3'] }).reason, 'etapa_ja_enviada');
  });
  test('etapa atrasada não sai depois de uma posterior', () => {
    const g = { ...group, daysUntilDue: 2 };
    assert.equal(decide({ ...base, group: g, clientGroups: [g], sentStages: ['D-1'] }).reason, 'etapa_posterior_ja_enviada');
  });
  test('dia sem etapa', () => {
    const g = { ...group, daysUntilDue: -1, suspended: false };
    assert.equal(decide({ ...base, group: g, clientGroups: [g] }).reason, 'sem_etapa_hoje');
  });
  test('cliente sumiu da fonte', () => {
    assert.equal(decide({ ...base, client: null }).reason, 'cliente_nao_encontrado');
  });
});

test('normaliza WhatsApp brasileiro para E.164', () => {
  assert.equal(normalizeWhatsapp('(11) 98888-7777'), '5511988887777');
  assert.equal(normalizeWhatsapp('+55 11 98888-7777'), '5511988887777');
  assert.equal(normalizeWhatsapp('1133334444'), '551133334444');
  assert.equal(normalizeWhatsapp('123'), null);
  assert.equal(normalizeWhatsapp(''), null);
});
