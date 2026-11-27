// Servidor HTTP (só módulos do Node): painel admin "Cobranças", API do painel e webhook da Meta.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';
import { runBilling } from './engine.js';
import { verifySignature, handleVerify, handleEvent } from './webhook.js';
import { nextRunAt, localDate } from './dates.js';
import { STAGE_CODES, SKIP_REASON_LABELS } from './rules.js';
import { DEFAULT_TEMPLATES, TEMPLATE_VARIABLES, unknownVariables } from './templates.js';

const MAX_BODY = 64 * 1024;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Cache-Control': 'no-store',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const isString = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': isString ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(isString ? body : JSON.stringify(body));
}

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Corpo da requisição grande demais');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Envie JSON (Content-Type: application/json)');
  const raw = await readRaw(req);
  if (!raw.length) return {};
  try {
    const v = JSON.parse(raw.toString('utf8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

function tokenMatches(given, expected) {
  // Compara os hashes para o tempo não depender do tamanho nem do conteúdo.
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

/** Limita tentativas de token errado por IP (força bruta). */
function createAuthLimiter({ max = 10, windowMs = 15 * 60_000 } = {}) {
  const hits = new Map();
  return {
    blocked(ip) {
      const h = hits.get(ip);
      if (!h) return false;
      if (Date.now() - h.first > windowMs) {
        hits.delete(ip);
        return false;
      }
      return h.count >= max;
    },
    fail(ip) {
      const h = hits.get(ip);
      if (!h || Date.now() - h.first > windowMs) hits.set(ip, { first: Date.now(), count: 1 });
      else h.count += 1;
    },
    ok(ip) {
      hits.delete(ip);
    },
  };
}

const STATIC = {
  '/admin': ['index.html', 'text/html; charset=utf-8'],
  '/admin/': ['index.html', 'text/html; charset=utf-8'],
  '/admin/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/admin/app.css': ['app.css', 'text/css; charset=utf-8'],
};

export function createApp({ config, store, source, channels, logger = console }) {
  const webDir = join(config.root, 'src', 'web');
  const limiter = createAuthLimiter();
  let running = false;

  const runOnce = async ({ trigger, dryRun, now }) => {
    if (!dryRun && running) throw new HttpError(409, 'A régua já está rodando');
    if (!dryRun) running = true;
    try {
      return await runBilling({ now: now || new Date(), store, source, channels, config, trigger, dryRun, logger });
    } finally {
      if (!dryRun) running = false;
    }
  };

  const requireAdmin = (req) => {
    const ip = req.socket.remoteAddress || '?';
    if (!config.adminToken || config.adminToken.length < 16) throw new HttpError(503, 'Defina ADMIN_TOKEN (mínimo 16 caracteres) no .env para usar o painel');
    if (limiter.blocked(ip)) throw new HttpError(429, 'Muitas tentativas com token errado. Aguarde 15 minutos.');
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !tokenMatches(token, config.adminToken)) {
      limiter.fail(ip);
      throw new HttpError(401, 'Token do painel inválido');
    }
    limiter.ok(ip);
    return 'admin';
  };

  const parseDateParam = (v) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, 'Data deve ser AAAA-MM-DD');
    // Meio-dia de São Paulo daquele dia (evita cair no dia anterior/seguinte por fuso).
    return new Date(`${v}T15:00:00.000Z`);
  };

  const routes = {
    'GET /api/cobrancas/overview': async () => {
      const now = new Date();
      const monthStart = `${localDate(now, config.timezone).slice(0, 7)}-01T00:00:00.000Z`;
      const cycles = store.db.prepare('SELECT status, COUNT(*) AS n FROM cycles GROUP BY status').all();
      return {
        enabled: store.isEnabled(),
        enabledChange: store.enabledChange(),
        dataSource: source.name,
        channels: channels.map((c) => ({ name: c.name, simulated: c.simulated })),
        whatsappMode: channels.find((c) => c.name === 'whatsapp')?.simulated === false ? 'real' : 'simulado',
        schedule: config.schedulerEnabled
          ? { time: `${String(config.cronHour).padStart(2, '0')}:${String(config.cronMinute).padStart(2, '0')}`, timezone: config.timezone, next: nextRunAt(now, config.cronHour, config.cronMinute, config.timezone).toISOString() }
          : null,
        priceCents: config.proxyPriceCents,
        costsThisMonth: store.costSummary(monthStart),
        // Quanto as mensagens de WhatsApp simuladas do mês custariam na API real (para avaliar o volume).
        projectedWhatsappCostCents: (store.costSummary(monthStart).find((c) => c.channel === 'whatsapp')?.simulated || 0) * config.whatsapp.costCentsPerMessage,
        cycles: Object.fromEntries(cycles.map((r) => [r.status, r.n])),
        doNotChargeCount: store.listDoNotCharge().length,
        lastRuns: store.listRuns(10).map((r) => ({ ...r, summary: r.summary ? { ...r.summary, decisions: undefined } : null })),
        stages: STAGE_CODES,
        skipReasonLabels: SKIP_REASON_LABELS,
      };
    },
    'GET /api/cobrancas/sends': async (_req, url) => {
      const q = url.searchParams;
      const limit = Math.min(Math.max(Number.parseInt(q.get('limit') || '100', 10) || 100, 1), 500);
      const offset = Math.max(Number.parseInt(q.get('offset') || '0', 10) || 0, 0);
      return { sends: store.listSends({ limit, offset, clientId: q.get('clientId') || undefined, stage: q.get('stage') || undefined, status: q.get('status') || undefined }) };
    },
    'GET /api/cobrancas/cycles': async (_req, url) => ({ cycles: store.listCycles({ status: url.searchParams.get('status') || undefined }) }),
    'GET /api/cobrancas/nao-cobrar': async () => ({ list: store.listDoNotCharge(), log: store.doNotChargeLog(50) }),
    'POST /api/cobrancas/nao-cobrar': async (req, _url, actor) => {
      const body = await readJson(req);
      const clientId = String(body.clientId ?? '').trim();
      const reason = String(body.reason ?? '').trim();
      if (!clientId || clientId.length > 100) throw new HttpError(400, 'Informe o cliente');
      if (!reason) throw new HttpError(400, 'Informe o motivo');
      if (reason.length > 300) throw new HttpError(400, 'Motivo muito longo (máx. 300 caracteres)');
      const client = (await source.getClients([clientId])).get(clientId);
      if (!client) throw new HttpError(404, 'Cliente não encontrado na fonte de dados');
      store.addDoNotCharge({ clientId, clientName: client.name, reason, origin: 'admin', actor });
      logger.info(`[painel] cliente ${clientId} marcado como "não cobrar".`);
      return { ok: true };
    },
    'DELETE /api/cobrancas/nao-cobrar': async (_req, url, actor) => {
      const clientId = String(url.searchParams.get('clientId') || '').trim();
      if (!clientId) throw new HttpError(400, 'Informe o cliente');
      const removed = store.removeDoNotCharge({ clientId, actor });
      if (!removed) throw new HttpError(404, 'Cliente não está na lista "não cobrar"');
      logger.info(`[painel] cliente ${clientId} voltou a ser cobrado.`);
      return { ok: true };
    },
    'POST /api/cobrancas/toggle': async (req, _url, actor) => {
      const body = await readJson(req);
      if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled deve ser true ou false');
      store.setEnabled(body.enabled, actor);
      logger.info(`[painel] régua ${body.enabled ? 'LIGADA' : 'DESLIGADA'}.`);
      return { enabled: store.isEnabled() };
    },
    'GET /api/cobrancas/templates': async () => ({ templates: store.getTemplates(), defaults: DEFAULT_TEMPLATES, variables: TEMPLATE_VARIABLES, stages: STAGE_CODES }),
    'PUT /api/cobrancas/templates': async (req) => {
      const body = await readJson(req);
      const templates = body.templates;
      if (!templates || typeof templates !== 'object') throw new HttpError(400, 'Envie { templates: { "D-7": "..." } }');
      const warnings = {};
      for (const code of STAGE_CODES) {
        if (templates[code] === undefined) continue;
        if (typeof templates[code] !== 'string' || !templates[code].trim()) throw new HttpError(400, `Texto da etapa ${code} vazio`);
        if (templates[code].length > 1024) throw new HttpError(400, `Texto da etapa ${code} passa de 1024 caracteres (limite da Meta)`);
        const unknown = unknownVariables(templates[code]);
        if (unknown.length) warnings[code] = unknown;
      }
      if (Object.keys(warnings).length) throw new HttpError(400, `Variável desconhecida: ${Object.entries(warnings).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ')}`);
      store.setTemplates(templates);
      return { templates: store.getTemplates() };
    },
    'POST /api/cobrancas/templates/reset': async () => {
      store.resetTemplates();
      return { templates: store.getTemplates() };
    },
    'POST /api/cobrancas/preview': async (req) => {
      const body = await readJson(req);
      return runOnce({ trigger: 'manual', dryRun: true, now: parseDateParam(body.date) });
    },
    'POST /api/cobrancas/run': async (req) => {
      await readJson(req);
      return runOnce({ trigger: 'manual', dryRun: false });
    },
    'GET /api/clientes': async (_req, url) => {
      const q = String(url.searchParams.get('q') || '').trim();
      if (q.length < 2) return { clients: [] };
      const list = await source.searchClients(q.slice(0, 100), 20);
      const dnc = store.doNotChargeIds();
      return { clients: list.map((c) => ({ id: c.id, name: c.name, email: c.email, isAdmin: c.isAdmin, isTest: c.isTest, doNotCharge: dnc.has(String(c.id)) })) };
    },
  };

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(res, 302, 'Redirecionando', { Location: '/admin' });
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        return send(res, 200, readFileSync(join(webDir, file)), { 'Content-Type': type });
      }

      if (url.pathname === '/webhooks/whatsapp') {
        if (req.method === 'GET') {
          const challenge = handleVerify(url.searchParams, config.whatsapp.verifyToken);
          return challenge === null ? send(res, 403, 'Token de verificação inválido') : send(res, 200, challenge);
        }
        if (req.method === 'POST') {
          const raw = await readRaw(req);
          if (!verifySignature(raw, req.headers['x-hub-signature-256'], config.whatsapp.appSecret)) return send(res, 401, 'Assinatura inválida');
          let payload;
          try {
            payload = JSON.parse(raw.toString('utf8'));
          } catch {
            return send(res, 400, 'JSON inválido');
          }
          return send(res, 200, handleEvent(payload, store, logger));
        }
      }

      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return send(res, 404, { error: 'Não encontrado' });
      const actor = requireAdmin(req);
      return send(res, 200, await route(req, url, actor));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) logger.error(`[http] ${req.method} ${url.pathname}: ${err.stack || err.message}`);
      return send(res, status, { error: status === 500 ? 'Erro interno' : err.message });
    }
  }

  return { handler, runOnce };
}
