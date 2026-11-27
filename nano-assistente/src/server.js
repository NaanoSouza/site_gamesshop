// `npm start` — sobe o Nano em http://127.0.0.1:3790 (só neste computador).
import { createServer } from 'node:http';
import { loadDotEnv, loadConfig } from './config.js';
import { createAgenda } from './agenda.js';
import { createMusicLibrary } from './music.js';
import { createSystem } from './system.js';
import { createReguaClient } from './regua.js';
import { createLlm } from './llm.js';
import { createBrain } from './brain.js';
import { createApp } from './app.js';

loadDotEnv();
const config = loadConfig();
const logger = console;
const agenda = createAgenda(config.dataDir);
const music = createMusicLibrary(config.musicaDir);
const system = createSystem({ platform: config.platform, logger });
const regua = createReguaClient(config.regua);
const llm = createLlm(config, { logger });
const brain = createBrain({ config, agenda, music, system, regua, llm, logger });
const app = createApp({ config, agenda, music, brain, logger });

createServer(app.handler)
  .on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.info(`[nano] já tem um Nano rodando em http://127.0.0.1:${config.port} — use aquele.`);
      process.exit(0);
    }
    throw err;
  })
  .listen(config.port, '127.0.0.1', () => {
    logger.info(`[nano] pronto em http://127.0.0.1:${config.port}`);
    logger.info(`[nano] músicas locais: ${music.count()} · conversa livre (Claude): ${llm ? 'ligada' : 'desligada'} · régua: ${regua.enabled ? 'ligada' : 'desligada'}`);
  });
