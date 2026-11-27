import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missedTodayRun } from '../src/scheduler.js';
import { makeEnv } from './helpers.js';

test('recupera a execução do dia se o servidor subiu depois das 09h e ainda não rodou', () => {
  const env = makeEnv();
  const at = (hhmmUtc) => new Date(`2026-11-27T${hhmmUtc}:00.000Z`);
  // 08h59 em São Paulo = 11h59 UTC: ainda não é hora.
  assert.equal(missedTodayRun({ now: at('11:59'), config: env.config, store: env.store }), false);
  // 10h em São Paulo, sem execução hoje: recupera.
  assert.equal(missedTodayRun({ now: at('13:00'), config: env.config, store: env.store }), true);
  // Depois de uma execução real hoje: não roda de novo.
  const id = env.store.startRun({ runDate: '2026-11-27', trigger: 'cron', dryRun: false });
  env.store.finishRun(id, { status: 'ok' });
  assert.equal(missedTodayRun({ now: at('13:00'), config: env.config, store: env.store }), false);
});
