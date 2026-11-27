// Servidor local do Nano (só 127.0.0.1). Serve a tela do assistente e a API usada por ela.
// Proteções: só aceita Host 127.0.0.1/localhost (contra DNS rebinding) e, em POST/DELETE, exige o
// cabeçalho X-Nano (um site qualquer aberto no navegador não consegue mandar o Nano abrir pastas).
import { readFileSync, createReadStream } from 'node:fs';
import { join, extname } from 'node:path';
import { ROOT } from './config.js';
import { AUDIO_TYPES } from './music.js';
import { localYmd, addDaysYmd } from './util.js';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
};
const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; media-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApp({ config, agenda, music, brain, logger = console }) {
  const webDir = join(ROOT, 'web');
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);

  const send = (res, status, body, type) => {
    const isBuf = Buffer.isBuffer(body) || typeof body === 'string';
    res.writeHead(status, { ...HEADERS, 'Cache-Control': 'no-store', 'Content-Type': type || (isBuf ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8') });
    res.end(isBuf ? body : JSON.stringify(body));
  };

  async function readJson(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Envie JSON');
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 32 * 1024) throw new HttpError(413, 'Grande demais');
      chunks.push(c);
    }
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
      return v;
    } catch {
      throw new HttpError(400, 'JSON inválido');
    }
  }

  function agendaView() {
    const today = localYmd();
    const proximos = [];
    for (let i = 0; i < 7; i++) {
      const ymd = addDaysYmd(today, i);
      for (const c of agenda.compromissosDoDia(ymd)) proximos.push({ ...c, dia: ymd });
    }
    return { hoje: today, tarefas: agenda.tarefas(today), proximos };
  }

  function streamMusic(req, res, id) {
    const track = music.get(id);
    if (!track) throw new HttpError(404, 'Música não encontrada');
    const size = music.size(id);
    const type = AUDIO_TYPES[extname(track.path).toLowerCase()] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, { ...HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      return createReadStream(track.path, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    return createReadStream(track.path).pipe(res);
  }

  const routes = {
    'GET /api/status': () => ({
      nome: config.nome,
      claude: config.claude.enabled,
      regua: Boolean(config.regua.url && config.regua.token),
      musicas: music.count(),
      musicaOnline: config.musicaOnline,
      pastas: Object.keys(config.pastas),
    }),
    'POST /api/comando': async (req) => {
      const body = await readJson(req);
      const texto = String(body.texto || '').slice(0, 500);
      if (!texto.trim()) throw new HttpError(400, 'Fale alguma coisa');
      return brain.handle(texto, { requireWake: Boolean(body.escuta), seguimento: Boolean(body.seguimento) });
    },
    'POST /api/resumo': async () => ({ fala: await brain.minhasCoisas(new Date()) }),
    'GET /api/agenda': () => agendaView(),
    'POST /api/agenda/tarefa': async (req) => {
      const b = await readJson(req);
      agenda.addTarefa({ texto: b.texto, diaria: b.diaria });
      return agendaView();
    },
    'POST /api/agenda/tarefa/concluir': async (req) => {
      const b = await readJson(req);
      if (!agenda.concluirTarefa({ id: String(b.id || ''), today: localYmd() })) throw new HttpError(404, 'Tarefa não encontrada');
      return agendaView();
    },
    'POST /api/agenda/tarefa/desmarcar': async (req) => {
      const b = await readJson(req);
      if (!agenda.desmarcarTarefa({ id: String(b.id || '') })) throw new HttpError(404, 'Tarefa não encontrada');
      return agendaView();
    },
    'POST /api/agenda/tarefa/remover': async (req) => {
      const b = await readJson(req);
      if (!agenda.removerTarefa(String(b.id || ''))) throw new HttpError(404, 'Tarefa não encontrada');
      return agendaView();
    },
    'POST /api/agenda/compromisso': async (req) => {
      const b = await readJson(req);
      try {
        agenda.addCompromisso({ titulo: b.titulo, data: b.data, hora: b.hora || null, repeticao: b.repeticao || 'nenhuma', avisarMin: b.avisarMin ?? 30 });
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      return agendaView();
    },
    'POST /api/agenda/compromisso/remover': async (req) => {
      const b = await readJson(req);
      if (!agenda.removerCompromisso(String(b.id || ''))) throw new HttpError(404, 'Compromisso não encontrado');
      return agendaView();
    },
  };

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!allowedHosts.has(String(req.headers.host || ''))) throw new HttpError(403, 'Host não permitido');
      if (req.method !== 'GET') {
        if (req.headers['x-nano'] !== '1') throw new HttpError(403, 'Requisição recusada');
        const origin = req.headers.origin;
        if (origin && !allowedHosts.has(origin.replace(/^https?:\/\//, ''))) throw new HttpError(403, 'Origem não permitida');
      }
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        return send(res, 200, readFileSync(join(webDir, file)), type);
      }
      const m = url.pathname.match(/^\/api\/musica\/(\d+)$/);
      if (req.method === 'GET' && m) return streamMusic(req, res, m[1]);
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) throw new HttpError(404, 'Não encontrado');
      return send(res, 200, await route(req, url));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) logger.error(`[nano] ${req.method} ${url.pathname}: ${err.stack || err.message}`);
      return send(res, status, { error: status === 500 ? 'Erro interno' : err.message });
    }
  }
  return { handler };
}
