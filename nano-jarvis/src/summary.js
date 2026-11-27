// Resumo diário para o dono: o que a régua fez hoje. Vai para o log e, se OWNER_EMAIL estiver
// configurado, por e-mail (real ou simulado, conforme o canal de e-mail).
import { formatBr, formatBrl } from './dates.js';
import { SKIP_REASON_LABELS } from './rules.js';
import { createEmailChannel } from './channels/email.js';

export function buildOwnerSummary(summary) {
  const lines = [`Régua de cobrança — ${formatBr(summary.runDate)}`, ''];
  if (summary.status === 'regua_desligada') return `${lines[0]}\n\nA régua está DESLIGADA no painel: nenhum lembrete foi enviado.`;
  if (summary.status === 'erro') return `${lines[0]}\n\nA execução FALHOU: ${summary.error}. Confira o painel.`;
  const sent = (summary.decisions || []).filter((d) => d.action === 'send');
  lines.push(`Lembretes enviados: ${summary.sent} mensagem(ns) para ${sent.length} cliente(s). Falhas: ${summary.failed}.`);
  for (const d of sent) lines.push(`- ${d.clientName || d.clientId}: ${d.stage}, ${d.quantity} proxy(s), vence ${formatBr(d.dueDate)}, falta ${formatBrl(Math.max(0, (d.requiredCents || 0) - (d.balanceCents || 0)))}`);
  const c = summary.cycles || {};
  lines.push('', `Renovaram: ${(c.renovado || []).length} · Recarregaram: ${(c.recarregado || []).length} · Encerrados sem renovar: ${(c.encerrado || []).length}`);
  const skipped = Object.entries(summary.skipped || {}).filter(([k]) => !['etapa_ja_enviada', 'sem_etapa_hoje'].includes(k));
  if (skipped.length) lines.push(`Não cobrados hoje: ${skipped.map(([k, v]) => `${SKIP_REASON_LABELS[k] || k} ${v}`).join(' · ')}`);
  return lines.join('\n');
}

export async function sendOwnerSummary({ summary, config, logger = console, emailChannel }) {
  const text = buildOwnerSummary(summary);
  logger.info(`[resumo do dia]\n${text}`);
  if (!config.ownerEmail) return { sent: false };
  const ch = emailChannel || createEmailChannel(config, { logger });
  try {
    await ch.send({ to: config.ownerEmail, stage: 'resumo', subject: `Régua de cobrança — ${formatBr(summary.runDate)}`, text });
    return { sent: true };
  } catch (err) {
    logger.error(`[resumo do dia] falha ao enviar e-mail ao dono: ${err.message}`);
    return { sent: false, error: err.message };
  }
}
