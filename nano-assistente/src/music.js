// Músicas locais: indexa a pasta MUSICA_DIR e escolhe por nome (ou aleatória). O arquivo é servido ao
// painel por id (nunca por caminho), para o Nano poder pausar, pular e mudar o volume por voz.
import { readdirSync, statSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
import { normalize } from './intents.js';

export const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.webm': 'audio/webm' };
const MAX_FILES = 20_000;

export function createMusicLibrary(dir) {
  let tracks = [];
  const scan = () => {
    tracks = [];
    if (!dir) return;
    const walk = (d, depth) => {
      if (depth > 8 || tracks.length >= MAX_FILES) return;
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p, depth + 1);
        else if (e.isFile() && AUDIO_TYPES[extname(e.name).toLowerCase()]) {
          const title = basename(e.name, extname(e.name));
          tracks.push({ id: String(tracks.length + 1), path: p, title, search: normalize(`${relative(dir, d)} ${title}`) });
        }
        if (tracks.length >= MAX_FILES) return;
      }
    };
    walk(dir, 0);
  };
  scan();
  return {
    rescan: scan,
    count: () => tracks.length,
    get: (id) => tracks.find((t) => t.id === String(id)) || null,
    /** Por nome (todas as palavras precisam aparecer no nome do arquivo ou pasta) ou aleatória. Devolve fila embaralhada. */
    pick(query) {
      const words = normalize(query).split(' ').filter((w) => w.length > 1);
      const pool = words.length ? tracks.filter((t) => words.every((w) => t.search.includes(w))) : tracks;
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, 200).map((t) => ({ id: t.id, title: t.title }));
    },
    size(id) {
      const t = tracks.find((x) => x.id === String(id));
      return t ? statSync(t.path).size : 0;
    },
  };
}
