// Configuração do Nano: arquivo .env na pasta do assistente (opcional) + variáveis de ambiente.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadDotEnv(path = join(ROOT, '.env')) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** "trabalho=C:\Trabalho; projetos=D:\Projetos" → { trabalho: 'C:\\Trabalho', projetos: 'D:\\Projetos' } */
export function parseAliases(v) {
  const out = {};
  for (const part of String(v || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const target = part.slice(eq + 1).trim();
    if (name && target) out[name] = target;
  }
  return out;
}

export function loadConfig(env = process.env) {
  return {
    port: Number.parseInt(env.PORT || '3790', 10) || 3790,
    dataDir: env.DATA_DIR || join(ROOT, 'data'),
    nome: (env.SEU_NOME || '').trim(),
    platform: env.NANO_PLATFORM || process.platform,
    home: env.NANO_HOME || os.homedir(),
    pastas: parseAliases(env.PASTAS),
    sites: parseAliases(env.SITES),
    musicaDir: env.MUSICA_DIR || '',
    // Onde tocar quando pedir uma música que não está na pasta: youtube | spotify
    musicaOnline: (env.MUSICA_ONLINE || 'youtube').toLowerCase() === 'spotify' ? 'spotify' : 'youtube',
    regua: { url: (env.REGUA_URL || '').replace(/\/+$/, ''), token: env.REGUA_TOKEN || '' },
    claude: { enabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN), model: env.NANO_MODELO || 'claude-opus-5-5' },
  };
}
