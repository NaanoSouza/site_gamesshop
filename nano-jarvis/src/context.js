// Monta as peças (config, banco, fonte de dados, canais) usadas pelo servidor e pelos scripts.
import { loadDotEnv, loadConfig } from './config.js';
import { openDb } from './db.js';
import { createStore } from './store.js';
import { createSource } from './source/index.js';
import { createWhatsappChannel } from './channels/whatsapp.js';
import { createEmailChannel } from './channels/email.js';

export function createChannels(config, logger = console) {
  const out = [];
  for (const name of config.channels) {
    if (name === 'whatsapp') out.push(createWhatsappChannel(config, { logger }));
    else if (name === 'email') out.push(createEmailChannel(config, { logger }));
    else throw new Error(`Canal desconhecido em CHANNELS: "${name}" (use whatsapp e/ou email)`);
  }
  if (!out.length) throw new Error('CHANNELS vazio: configure pelo menos "whatsapp"');
  return out;
}

export function createContext({ env, logger = console } = {}) {
  if (!env) loadDotEnv();
  const config = loadConfig(env || process.env);
  const db = openDb(config.dbPath);
  const store = createStore(db);
  const source = createSource(config, db);
  const channels = createChannels(config, logger);
  return { config, db, store, source, channels, logger };
}
