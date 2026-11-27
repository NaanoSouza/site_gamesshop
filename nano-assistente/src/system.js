// Ações no computador: abrir pasta e abrir link (navegador, Spotify). Sem shell: só spawn com
// argumentos separados, e só para pastas que existem e links http(s)/spotify — nada de comando livre.
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { normalize } from './intents.js';

/** Pastas conhecidas do usuário, com os nomes que costumam ter no Windows, Mac e Linux (e OneDrive). */
export function knownFolders(home) {
  const c = (...names) => names.flatMap((n) => [join(home, n), join(home, 'OneDrive', n)]);
  return {
    downloads: c('Downloads'),
    documentos: c('Documents', 'Documentos'),
    'area de trabalho': c('Desktop', 'Área de Trabalho', 'Area de Trabalho'),
    desktop: c('Desktop', 'Área de Trabalho'),
    imagens: c('Pictures', 'Imagens'),
    fotos: c('Pictures', 'Imagens'),
    musicas: c('Music', 'Músicas'),
    videos: c('Videos', 'Movies', 'Vídeos'),
    'pasta pessoal': [home],
    usuario: [home],
  };
}

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Acha a pasta pelo nome falado: primeiro os apelidos do .env (PASTAS), depois as pastas conhecidas.
 * Devolve o caminho ou null. Nunca aceita um caminho falado/digitado direto.
 */
export function resolveFolder(name, { pastas, home }) {
  const q = normalize(name);
  if (!q) return null;
  const aliases = Object.entries(pastas || {}).map(([k, v]) => [normalize(k), v]);
  const known = Object.entries(knownFolders(home)).map(([k, v]) => [k, v]);
  for (const [k, target] of aliases) if (k === q) return isAbsolute(target) && isDir(target) ? target : null;
  for (const [k, targets] of known) if (k === q) return targets.find(isDir) || null;
  // aproximado: "pasta do trabalho novo" casa com "trabalho"
  for (const [k, target] of aliases) if (q.includes(k) || k.includes(q)) return isAbsolute(target) && isDir(target) ? target : null;
  for (const [k, targets] of known) if (q.includes(k)) return targets.find(isDir) || null;
  return null;
}

export function folderNames({ pastas }) {
  return [...Object.keys(pastas || {}), 'downloads', 'documentos', 'área de trabalho', 'imagens', 'músicas', 'vídeos'];
}

/** Comando do sistema para abrir algo com o programa padrão. */
export function openerFor(platform) {
  if (platform === 'win32') return 'explorer.exe';
  if (platform === 'darwin') return 'open';
  return 'xdg-open';
}

export function isSafeUrl(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'spotify:'].includes(u.protocol);
  } catch {
    return false;
  }
}

export function createSystem({ platform, spawnImpl = spawn, logger = console }) {
  const opener = openerFor(platform);
  const launch = (target) =>
    new Promise((resolve, reject) => {
      const child = spawnImpl(opener, [target], { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
      child.on?.('error', reject);
      child.unref?.();
      // explorer.exe devolve código 1 mesmo quando abre; não dá para confiar no código de saída.
      setTimeout(resolve, 50);
    });
  return {
    async openFolder(path) {
      if (!isAbsolute(path) || !existsSync(path) || !isDir(path)) throw new Error('Pasta não encontrada');
      logger.info(`[nano] abrindo pasta ${path}`);
      await launch(path);
    },
    async openUrl(url) {
      if (!isSafeUrl(url)) throw new Error('Link não permitido');
      logger.info(`[nano] abrindo ${url}`);
      await launch(url);
    },
  };
}
