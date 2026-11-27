// Regras de negócio da régua, como funções puras (sem banco, sem rede) para serem testadas isoladamente.
import { localDate, daysBetween } from './dates.js';

/**
 * Etapas da régua, em ordem. `minDays..maxDays` é a janela (dias até o vencimento) em que a etapa vale.
 * A janela existe para não perder aviso se a rotina de um dia falhar (servidor fora do ar): no dia
 * seguinte a etapa atrasada ainda sai, desde que nenhuma etapa posterior já tenha saído.
 * - D-7: de 7 a 4 dias antes   - D-3: 3 ou 2 dias antes   - D-1: véspera   - D0: dia do vencimento
 * - D+1: recuperação, 1 ou 2 dias depois, só com o proxy SUSPENSO (a ProxysEvo segura o IP por 2 dias).
 */
export const STAGES = [
  { code: 'D-7', minDays: 4, maxDays: 7, recovery: false },
  { code: 'D-3', minDays: 2, maxDays: 3, recovery: false },
  { code: 'D-1', minDays: 1, maxDays: 1, recovery: false },
  { code: 'D0', minDays: 0, maxDays: 0, recovery: false },
  { code: 'D+1', minDays: -2, maxDays: -1, recovery: true },
];
export const STAGE_CODES = STAGES.map((s) => s.code);
export const LOOKAHEAD_DAYS = 7;
export const LOOKBEHIND_DAYS = 2;

/** Status de proxy que ainda podem ser renovados (o resto já foi encerrado/cancelado). */
export const BILLABLE_STATUSES = new Set(['active', 'suspended']);

export function stageIndex(code) {
  return STAGE_CODES.indexOf(code);
}

/** Etapa que vale para um vencimento a `daysUntilDue` dias, ou null se hoje não há etapa. */
export function stageForDays(daysUntilDue, { suspended }) {
  const stage = STAGES.find((s) => daysUntilDue >= s.minDays && daysUntilDue <= s.maxDays);
  if (!stage) return null;
  if (stage.recovery && !suspended) return null;
  return stage.code;
}

/**
 * Agrupa proxies cobráveis por cliente + data de vencimento local (uma mensagem por grupo, não por proxy).
 * Só entram proxies ativos/suspensos que vencem de hoje-2 até hoje+7.
 */
export function groupProxies(proxies, today, timeZone) {
  const groups = new Map();
  for (const p of proxies) {
    if (!BILLABLE_STATUSES.has(p.status)) continue;
    if (!p.expiresAt || p.clientId === undefined || p.clientId === null) continue;
    const dueDate = localDate(p.expiresAt, timeZone);
    const days = daysBetween(today, dueDate);
    if (days > LOOKAHEAD_DAYS || days < -LOOKBEHIND_DAYS) continue;
    const key = `${p.clientId}|${dueDate}`;
    if (!groups.has(key)) {
      groups.set(key, { clientId: String(p.clientId), dueDate, daysUntilDue: days, proxies: [] });
    }
    groups.get(key).proxies.push(p);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      quantity: g.proxies.length,
      ports: [...new Set(g.proxies.map((p) => p.port).filter((x) => x !== undefined && x !== null))].sort((a, b) => a - b),
      proxyIds: g.proxies.map((p) => String(p.id)).sort(),
      suspended: g.proxies.some((p) => p.status === 'suspended'),
    }))
    .sort((a, b) => a.clientId.localeCompare(b.clientId) || a.dueDate.localeCompare(b.dueDate));
}

/** Valor necessário de um grupo: preço de referência × quantidade. */
export function requiredCents(quantity, priceCents) {
  return quantity * priceCents;
}

/**
 * Valor que o saldo precisa cobrir para renovar este grupo. Se o cliente tem outros vencimentos
 * ANTES (ou no mesmo dia) deste dentro da janela, o saldo vai ser consumido por eles primeiro; por isso
 * o valor é cumulativo. Ex.: saldo R$ 20, 1 proxy vence dia 1 e 1 vence dia 5 → o do dia 5 precisa R$ 35,80.
 */
export function cumulativeRequiredCents(group, clientGroups, priceCents) {
  const qty = clientGroups.filter((g) => g.dueDate <= group.dueDate).reduce((sum, g) => sum + g.quantity, 0);
  return requiredCents(qty, priceCents);
}

export function availableBalanceCents(client, countBonus) {
  const base = Number(client.balanceCents) || 0;
  const bonus = countBonus ? Number(client.bonusBalanceCents) || 0 : 0;
  return base + bonus;
}

/** Conta de admin ou de teste: nunca recebe cobrança. */
export function exclusionReason(client, config) {
  if (client.isAdmin || String(client.role || '').toLowerCase() === 'admin') return 'conta_admin';
  if (client.isTest) return 'conta_teste';
  const email = String(client.email || '').toLowerCase();
  const domain = email.includes('@') ? email.split('@').pop() : '';
  if (config.ignoreClientIds?.includes(String(client.id).toLowerCase())) return 'conta_teste';
  if (email && config.ignoreEmails?.includes(email)) return 'conta_teste';
  if (domain && config.ignoreEmailDomains?.includes(domain)) return 'conta_teste';
  return null;
}

/**
 * Decide o que fazer com um grupo hoje.
 * @param {object} p
 * @param {object} p.group           grupo de groupProxies
 * @param {object[]} p.clientGroups  todos os grupos do mesmo cliente (para o saldo cumulativo)
 * @param {object|null} p.client     cliente da fonte de dados
 * @param {boolean} p.doNotCharge    cliente na lista "não cobrar"
 * @param {string[]} p.sentStages    etapas já registradas (enviadas, pendentes ou incertas) deste vencimento
 * @param {object} p.config
 * @returns {{action:'send', stage:string, requiredCents:number, balanceCents:number} | {action:'skip', reason:string, stage?:string, requiredCents?:number, balanceCents?:number}}
 */
export function decide({ group, clientGroups, client, doNotCharge, sentStages, config }) {
  if (!client) return { action: 'skip', reason: 'cliente_nao_encontrado' };
  const excluded = exclusionReason(client, config);
  if (excluded) return { action: 'skip', reason: excluded };
  if (doNotCharge) return { action: 'skip', reason: 'nao_cobrar' };

  const required = cumulativeRequiredCents(group, clientGroups, config.proxyPriceCents);
  const balance = availableBalanceCents(client, config.countBonusBalance);
  if (balance >= required) return { action: 'skip', reason: 'saldo_suficiente', requiredCents: required, balanceCents: balance };

  const stage = stageForDays(group.daysUntilDue, { suspended: group.suspended });
  if (!stage) return { action: 'skip', reason: 'sem_etapa_hoje', requiredCents: required, balanceCents: balance };

  // Idempotência: a mesma etapa nunca sai duas vezes, e uma etapa atrasada não sai depois de uma posterior.
  const idx = stageIndex(stage);
  if (sentStages.includes(stage)) return { action: 'skip', reason: 'etapa_ja_enviada', stage, requiredCents: required, balanceCents: balance };
  if (sentStages.some((s) => stageIndex(s) > idx)) return { action: 'skip', reason: 'etapa_posterior_ja_enviada', stage, requiredCents: required, balanceCents: balance };

  return { action: 'send', stage, requiredCents: required, balanceCents: balance };
}

/** Normaliza telefone brasileiro para E.164 sem "+": "(11) 98888-7777" -> "5511988887777". */
export function normalizeWhatsapp(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 15) return null;
  return digits;
}

export const SKIP_REASON_LABELS = {
  cliente_nao_encontrado: 'Cliente não encontrado',
  conta_admin: 'Conta admin',
  conta_teste: 'Conta de teste',
  nao_cobrar: 'Lista "não cobrar"',
  saldo_suficiente: 'Saldo suficiente',
  sem_etapa_hoje: 'Sem etapa hoje',
  etapa_ja_enviada: 'Etapa já enviada',
  etapa_posterior_ja_enviada: 'Etapa posterior já enviada',
  sem_contato: 'Sem WhatsApp/e-mail válido',
};
