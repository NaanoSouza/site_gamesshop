// Motor da régua: roda uma vez por dia (09h00 São Paulo) ou sob demanda pelo painel/CLI.
import { localDate, addDays, daysBetween } from './dates.js';
import { groupProxies, decide, LOOKAHEAD_DAYS, LOOKBEHIND_DAYS, BILLABLE_STATUSES } from './rules.js';
import { buildVariables, renderTemplate } from './templates.js';
import { randomUUID } from 'node:crypto';

/** Janela ISO larga (um dia de folga de cada lado); o corte exato por data local é feito em groupProxies. */
function isoWindow(today) {
  return {
    fromIso: `${addDays(today, -(LOOKBEHIND_DAYS + 1))}T00:00:00.000Z`,
    toIso: `${addDays(today, LOOKAHEAD_DAYS + 2)}T00:00:00.000Z`,
  };
}

/**
 * Fecha ciclos que não precisam mais de cobrança:
 * - renovado: todos os proxies do ciclo passaram a vencer depois da data do ciclo;
 * - encerrado: nenhum proxy do ciclo pode mais ser renovado (status final) ou já passou da recuperação.
 * Renovação parcial mantém o ciclo aberto; o grupo do dia é recalculado só com os proxies que faltam.
 */
async function resolveOpenCycles({ store, source, today, timeZone, dryRun }) {
  const result = { renovado: [], encerrado: [] };
  const open = store.openCycles();
  if (!open.length) return result;
  const allIds = [...new Set(open.flatMap((c) => c.proxy_ids))];
  const proxies = new Map((await source.getProxiesByIds(allIds)).map((p) => [String(p.id), p]));
  for (const c of open) {
    const list = c.proxy_ids.map((id) => proxies.get(String(id))).filter(Boolean);
    const renewed = list.length > 0 && list.every((p) => p.expiresAt && localDate(p.expiresAt, timeZone) > c.due_date);
    const pending = list.filter((p) => !(p.expiresAt && localDate(p.expiresAt, timeZone) > c.due_date));
    const dead = pending.every((p) => !BILLABLE_STATUSES.has(p.status)) || daysBetween(c.due_date, today) > LOOKBEHIND_DAYS;
    let status = null;
    if (renewed) status = 'renovado';
    else if (dead) status = 'encerrado';
    if (status) {
      result[status].push({ clientId: c.client_id, dueDate: c.due_date });
      if (!dryRun) store.resolveCycle(c.client_id, c.due_date, status);
    }
  }
  return result;
}

/** Reenvio manual de um envio que falhou ou ficou incerto (botão "Reenviar" do painel). */
export async function resendOne({ id, store, channels, logger = console }) {
  const row = store.getSendById(id);
  if (!row) return { ok: false, error: 'Envio não encontrado' };
  if (!['falhou', 'incerto'].includes(row.status)) return { ok: false, error: `Só dá para reenviar envio que falhou ou ficou incerto (este está "${row.status}")` };
  const channel = channels.find((c) => c.name === row.channel);
  if (!channel) return { ok: false, error: `Canal ${row.channel} não está ligado (CHANNELS)` };
  if (row.channel === 'whatsapp' && !channel.simulated && !row.variables) return { ok: false, error: 'Envio antigo sem variáveis salvas: não dá para remontar o template' };
  if (!store.claimManualResend(id)) return { ok: false, error: 'Outro reenvio deste item já está em andamento' };
  const variables = row.variables ? JSON.parse(row.variables) : {};
  const text = row.channel === 'email' && row.subject ? row.message.slice(row.subject.length + 2) : row.message;
  try {
    const r = await channel.send({ to: row.recipient, stage: row.stage, text, subject: row.subject || '', variables });
    store.finishSend(id, { status: r.status, providerMessageId: r.providerMessageId, costCents: r.costCents });
    logger.info(`[regua] reenvio manual ${id} (${row.channel}, ${row.stage}) → ${r.status}`);
    return { ok: true, status: r.status };
  } catch (err) {
    store.finishSend(id, { status: 'falhou', error: err.message });
    return { ok: false, error: `Falhou de novo: ${err.message}` };
  }
}

/**
 * Executa a régua para o dia de `now`.
 * @returns resumo com as decisões de cada grupo (cliente + vencimento).
 */
export async function runBilling({ now = new Date(), store, source, channels, config, trigger = 'manual', dryRun = false, logger = console }) {
  const timeZone = config.timezone;
  const today = localDate(now, timeZone);
  const summary = { runDate: today, trigger, dryRun, enabled: store.isEnabled(), sent: 0, failed: 0, wouldSend: 0, skipped: {}, decisions: [], cycles: {} };

  if (!dryRun && !summary.enabled) {
    summary.status = 'regua_desligada';
    const runId = store.startRun({ runDate: today, trigger, dryRun });
    store.finishRun(runId, summary);
    logger.info(`[regua] ${today}: régua desligada no painel, nada enviado.`);
    return summary;
  }

  const lockOwner = randomUUID();
  if (!dryRun && !store.acquireLock(lockOwner)) {
    summary.status = 'ja_em_execucao';
    logger.warn('[regua] outra execução está em andamento; esta foi ignorada.');
    return summary;
  }

  const runId = dryRun ? null : store.startRun({ runDate: today, trigger, dryRun });
  try {
    if (!dryRun) {
      const stale = store.markStalePendingAsUncertain();
      if (stale) logger.warn(`[regua] ${stale} envio(s) ficaram pendentes numa execução interrompida e foram marcados como "incerto" (não serão repetidos).`);
    }

    summary.cycles = await resolveOpenCycles({ store, source, today, timeZone, dryRun });

    const proxies = await source.listBillableProxies(isoWindow(today));
    const groups = groupProxies(proxies, today, timeZone);
    const clientIds = [...new Set(groups.map((g) => g.clientId))];
    const clients = await source.getClients(clientIds);
    const doNotCharge = store.doNotChargeIds();
    const templates = store.getTemplates();
    const subjects = store.getEmailSubjects();
    const openCycleKeys = new Set(store.openCycles().map((c) => `${c.client_id}|${c.due_date}`));
    summary.cycles.recarregado = [];

    const byClient = new Map();
    for (const g of groups) {
      if (!byClient.has(g.clientId)) byClient.set(g.clientId, []);
      byClient.get(g.clientId).push(g);
    }

    for (const group of groups) {
      const client = clients.get(group.clientId) || null;
      const key = `${group.clientId}|${group.dueDate}`;
      const sentStages = store.doneStages(group.clientId, group.dueDate, config.maxAttempts);
      const d = decide({
        group,
        clientGroups: byClient.get(group.clientId),
        client,
        doNotCharge: doNotCharge.has(group.clientId),
        sentStages,
        config,
      });
      const entry = {
        clientId: group.clientId,
        clientName: client?.name || null,
        dueDate: group.dueDate,
        daysUntilDue: group.daysUntilDue,
        quantity: group.quantity,
        ports: group.ports,
        action: d.action,
        reason: d.reason || null,
        stage: d.stage || null,
        requiredCents: d.requiredCents ?? null,
        balanceCents: d.balanceCents ?? null,
        channels: [],
      };
      summary.decisions.push(entry);

      // "Parar a régua assim que o cliente recarregar": ciclo aberto + saldo agora suficiente.
      if (d.reason === 'saldo_suficiente' && openCycleKeys.has(key)) {
        summary.cycles.recarregado.push({ clientId: group.clientId, dueDate: group.dueDate });
        if (!dryRun) store.resolveCycle(group.clientId, group.dueDate, 'recarregado');
      }

      // Etapa de hoje já enviada em algum canal: só tenta de novo canais que FALHARAM (nunca repete um que saiu).
      const retryOnly = d.reason === 'etapa_ja_enviada';
      if (d.action !== 'send' && !retryOnly) {
        summary.skipped[d.reason] = (summary.skipped[d.reason] || 0) + 1;
        continue;
      }

      const vars = buildVariables({ client, group, requiredCents: d.requiredCents, balanceCents: d.balanceCents, rechargeLink: config.rechargeLink });
      const text = renderTemplate(templates[d.stage], vars);
      const subject = renderTemplate(subjects[d.stage], vars);
      let anyRecipient = false;

      for (const channel of channels) {
        const to = channel.recipientFor(client);
        if (!to) {
          entry.channels.push({ channel: channel.name, result: 'sem_contato' });
          continue;
        }
        anyRecipient = true;
        if (retryOnly) {
          const prev = store.getSend(group.clientId, group.dueDate, d.stage, channel.name);
          if (!prev || prev.status !== 'falhou' || prev.attempts >= config.maxAttempts) continue;
        }
        if (dryRun) {
          entry.channels.push({ channel: channel.name, result: 'seria_enviado', text });
          summary.wouldSend += 1;
          continue;
        }
        const sendId = store.reserveSend({
          clientId: group.clientId,
          dueDate: group.dueDate,
          stage: d.stage,
          channel: channel.name,
          recipient: to,
          message: channel.name === 'email' ? `${subject}\n\n${text}` : text,
          subject,
          variables: vars,
          simulated: channel.simulated,
          runId,
          maxAttempts: config.maxAttempts,
        });
        if (sendId === null) {
          entry.channels.push({ channel: channel.name, result: 'ja_reservado' });
          continue;
        }
        try {
          const r = await channel.send({ to, stage: d.stage, text, subject, variables: vars });
          store.finishSend(sendId, { status: r.status, providerMessageId: r.providerMessageId, costCents: r.costCents });
          entry.channels.push({ channel: channel.name, result: r.status });
          summary.sent += 1;
        } catch (err) {
          store.finishSend(sendId, { status: 'falhou', error: err.message });
          entry.channels.push({ channel: channel.name, result: 'falhou', error: err.message });
          summary.failed += 1;
          logger.error(`[regua] falha ao enviar ${d.stage} (${channel.name}) para o cliente ${group.clientId}: ${err.message}`);
        }
      }

      if (!anyRecipient && !retryOnly) {
        entry.action = 'skip';
        entry.reason = 'sem_contato';
        summary.skipped.sem_contato = (summary.skipped.sem_contato || 0) + 1;
        continue;
      }
      if (retryOnly) {
        summary.skipped[d.reason] = (summary.skipped[d.reason] || 0) + 1;
        continue;
      }
      if (!dryRun) {
        store.upsertCycle({
          clientId: group.clientId,
          dueDate: group.dueDate,
          clientName: client?.name,
          quantity: group.quantity,
          ports: group.ports,
          proxyIds: group.proxyIds,
          requiredCents: d.requiredCents,
          balanceCents: d.balanceCents,
          lastStage: d.stage,
        });
      }
    }

    summary.status = 'ok';
    logger.info(
      `[regua] ${today}${dryRun ? ' (prévia)' : ''}: ${groups.length} grupo(s), ${dryRun ? `${summary.wouldSend} envio(s) previsto(s)` : `${summary.sent} envio(s)`}, ${summary.failed} falha(s), puladas: ${JSON.stringify(summary.skipped)}`,
    );
    if (!dryRun) store.finishRun(runId, summary);
    return summary;
  } catch (err) {
    summary.status = 'erro';
    summary.error = err.message;
    logger.error(`[regua] erro na execução: ${err.stack || err.message}`);
    if (!dryRun) store.finishRun(runId, summary, err.message);
    throw err;
  } finally {
    if (!dryRun) store.releaseLock(lockOwner);
  }
}
