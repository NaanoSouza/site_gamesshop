// Ponto de entrada: `npm start`. Sobe o painel/API e o agendador diário da régua.
import { createServer } from 'node:http';
import { createContext } from './context.js';
import { createApp } from './app.js';
import { startScheduler } from './scheduler.js';

const ctx = createContext();
const { config, logger } = ctx;
const app = createApp(ctx);

if (!config.adminToken || config.adminToken.length < 16) {
  logger.warn('[servidor] ADMIN_TOKEN não definido (ou com menos de 16 caracteres): o painel vai recusar acesso até você definir no .env.');
}
logger.info(`[servidor] fonte de dados: ${ctx.source.name} · canais: ${ctx.channels.map((c) => `${c.name}${c.simulated ? ' (SIMULADO)' : ' (REAL)'}`).join(', ')}`);
logger.info(`[servidor] régua ${ctx.store.isEnabled() ? 'LIGADA' : 'DESLIGADA'} (liga/desliga no painel, aba Cobranças)`);

const server = createServer(app.handler);
server.listen(config.port, config.host, () => {
  logger.info(`[servidor] painel em http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}/admin`);
});

const scheduler = config.schedulerEnabled
  ? startScheduler({ config, logger, store: ctx.store, run: () => app.runOnce({ trigger: 'cron', dryRun: false }) })
  : (logger.info('[agendador] desligado (SCHEDULER_ENABLED=false)'), null);

const shutdown = () => {
  scheduler?.stop();
  server.close(() => {
    ctx.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
