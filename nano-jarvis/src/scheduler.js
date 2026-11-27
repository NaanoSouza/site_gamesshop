// Agendador diário embutido (sem cron do sistema): dispara a régua às CRON_HOUR:CRON_MINUTE no fuso da operação.
import { nextRunAt } from './dates.js';

export function startScheduler({ config, run, logger = console }) {
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
  schedule();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
