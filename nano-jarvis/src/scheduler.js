// Agendador diário embutido (sem cron do sistema): dispara a régua às CRON_HOUR:CRON_MINUTE no fuso da operação.
import { nextRunAt, localDate, localParts } from './dates.js';

/**
 * Se o servidor estava fora do ar no horário (ex.: reiniciou às 10h), roda ao subir — desde que ainda
 * não exista execução real da régua hoje. As janelas das etapas garantem que nada se repete.
 */
export function missedTodayRun({ now, config, store }) {
  const p = localParts(now, config.timezone);
  const passed = p.hour * 60 + p.minute >= config.cronHour * 60 + config.cronMinute;
  if (!passed) return false;
  const today = localDate(now, config.timezone);
  const row = store.db.prepare("SELECT 1 FROM runs WHERE run_date = ? AND dry_run = 0 AND trigger IN ('cron', 'manual', 'cli') AND error IS NULL LIMIT 1").get(today);
  return !row;
}

export function startScheduler({ config, run, store, logger = console }) {
  let timer = null;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    const now = new Date();
    const at = nextRunAt(now, config.cronHour, config.cronMinute, config.timezone);
    // setTimeout aceita no máximo ~24,8 dias; aqui é sempre < 2 dias.
    timer = setTimeout(async () => {
      try {
        await run();
      } catch (err) {
        logger.error(`[agendador] execução falhou: ${err.message}`);
      }
      schedule();
    }, at.getTime() - now.getTime());
    timer.unref?.();
    logger.info(`[agendador] próxima execução da régua: ${at.toLocaleString('pt-BR', { timeZone: config.timezone })} (${config.timezone})`);
  };
  if (store && missedTodayRun({ now: new Date(), config, store })) {
    logger.info('[agendador] a execução de hoje não aconteceu (servidor fora do ar no horário?): rodando agora.');
    run().catch((err) => logger.error(`[agendador] execução de recuperação falhou: ${err.message}`));
  }
  schedule();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
