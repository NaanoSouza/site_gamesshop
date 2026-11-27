// `npm run regua` — roda a régua uma vez agora (respeita o liga/desliga do painel).
//   --previa            só mostra o que seria enviado, sem gravar nem enviar nada
//   --ligar             liga a régua antes de rodar (o mesmo que o liga/desliga do painel)
//   --data=AAAA-MM-DD   simula que hoje é essa data (útil para testar D-7, D-3...; só com --previa ou DATA_SOURCE=demo)
// Útil também para agendar por cron do sistema em vez do agendador embutido:
//   0 9 * * *  cd /caminho/nano-jarvis && TZ=America/Sao_Paulo npm run regua
import { createContext } from '../src/context.js';
import { runBilling } from '../src/engine.js';
import { SKIP_REASON_LABELS } from '../src/rules.js';
import { formatBrl } from '../src/dates.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--previa') || args.includes('--dry-run');
const dateArg = args.find((a) => a.startsWith('--data='))?.slice(7);
const ctx = createContext();

if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error('--data deve ser AAAA-MM-DD');
  process.exit(1);
}
if (dateArg && !dryRun && ctx.config.source !== 'demo') {
  console.error('--data sem --previa só é permitido com DATA_SOURCE=demo (para não registrar envios com data falsa em produção).');
  process.exit(1);
}
if (args.includes('--ligar') && !ctx.store.isEnabled()) {
  ctx.store.setEnabled(true, 'cli');
  console.log('Régua LIGADA (--ligar).');
}
const now = dateArg ? new Date(`${dateArg}T15:00:00.000Z`) : new Date();

const summary = await runBilling({ ...ctx, now, trigger: 'cli', dryRun });
console.log('');
console.log(`Régua de ${summary.runDate}${dryRun ? ' — PRÉVIA (nada foi enviado nem gravado)' : ''}: ${summary.status}`);
for (const d of summary.decisions || []) {
  const who = `${d.clientName || d.clientId} · vence ${d.dueDate} (${d.quantity} proxy) · necessário ${d.requiredCents != null ? formatBrl(d.requiredCents) : '-'} · saldo ${d.balanceCents != null ? formatBrl(d.balanceCents) : '-'}`;
  const what = d.action === 'send' ? `ENVIA ${d.stage} → ${d.channels.map((c) => `${c.channel}:${c.result}`).join(', ')}` : `não envia (${SKIP_REASON_LABELS[d.reason] || d.reason})`;
  console.log(` - ${who}: ${what}`);
}
ctx.db.close();
