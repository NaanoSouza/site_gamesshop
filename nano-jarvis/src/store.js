// Acesso ao banco da régua. Tudo que o motor e o painel leem/gravam passa por aqui.
import { DEFAULT_TEMPLATES, DEFAULT_EMAIL_SUBJECTS } from './templates.js';
import { STAGE_CODES } from './rules.js';
import { tx } from './db.js';

const nowIso = () => new Date().toISOString();
// Envios que contam como "etapa feita" (não serão repetidos).
export const OK_STATUSES = ['pendente', 'simulado', 'enviado', 'entregue', 'lido', 'incerto'];

export function createStore(db) {
  const getSetting = (key, fallback) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  };
  const setSetting = (key, value) => {
    db.prepare(
      'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    ).run(key, JSON.stringify(value), nowIso());
  };

  return {
    db,

    // ---------- Liga/desliga e textos ----------
    // A régua começa DESLIGADA: só envia depois que o dono liga no painel.
    isEnabled: () => getSetting('regua_enabled', false) === true,
    setEnabled(enabled, actor) {
      setSetting('regua_enabled', Boolean(enabled));
      setSetting('regua_enabled_changed', { by: actor || null, at: nowIso(), enabled: Boolean(enabled) });
    },
    enabledChange: () => getSetting('regua_enabled_changed', null),
    getTemplates() {
      const saved = getSetting('templates', {});
      const out = {};
      for (const code of STAGE_CODES) out[code] = typeof saved[code] === 'string' && saved[code].trim() ? saved[code] : DEFAULT_TEMPLATES[code];
      return out;
    },
    getEmailSubjects() {
      const saved = getSetting('email_subjects', {});
      const out = {};
      for (const code of STAGE_CODES) out[code] = typeof saved[code] === 'string' && saved[code].trim() ? saved[code] : DEFAULT_EMAIL_SUBJECTS[code];
      return out;
    },
    setTemplates(templates) {
      const clean = {};
      for (const code of STAGE_CODES) {
        if (typeof templates?.[code] === 'string') clean[code] = templates[code].slice(0, 1024);
      }
      setSetting('templates', { ...getSetting('templates', {}), ...clean });
    },
    resetTemplates: () => setSetting('templates', {}),

    // ---------- Lista "não cobrar" ----------
    isDoNotCharge: (clientId) => Boolean(db.prepare('SELECT 1 FROM do_not_charge WHERE client_id = ?').get(String(clientId))),
    doNotChargeIds: () => new Set(db.prepare('SELECT client_id FROM do_not_charge').all().map((r) => r.client_id)),
    listDoNotCharge: () => db.prepare('SELECT * FROM do_not_charge ORDER BY created_at DESC').all(),
    addDoNotCharge({ clientId, clientName, reason, origin = 'admin', actor }) {
      const id = String(clientId);
      tx(db, () => {
        db.prepare(
          `INSERT INTO do_not_charge (client_id, client_name, reason, origin, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(client_id) DO UPDATE SET reason = excluded.reason, origin = excluded.origin, client_name = COALESCE(excluded.client_name, do_not_charge.client_name)`,
        ).run(id, clientName || null, reason, origin, actor || null, nowIso());
        db.prepare('INSERT INTO do_not_charge_log (client_id, action, reason, origin, actor, at) VALUES (?, ?, ?, ?, ?, ?)').run(
          id,
          'nao_cobrar',
          reason,
          origin,
          actor || null,
          nowIso(),
        );
      });
    },
    removeDoNotCharge({ clientId, actor }) {
      const id = String(clientId);
      return tx(db, () => {
        const res = db.prepare('DELETE FROM do_not_charge WHERE client_id = ?').run(id);
        if (res.changes > 0) {
          db.prepare('INSERT INTO do_not_charge_log (client_id, action, reason, origin, actor, at) VALUES (?, ?, ?, ?, ?, ?)').run(
            id,
            'voltar_a_cobrar',
            null,
            'admin',
            actor || null,
            nowIso(),
          );
        }
        return res.changes > 0;
      });
    },
    doNotChargeLog: (limit = 100) => db.prepare('SELECT * FROM do_not_charge_log ORDER BY id DESC LIMIT ?').all(limit),

    // ---------- Ciclos ----------
    upsertCycle(c) {
      const now = nowIso();
      db.prepare(
        `INSERT INTO cycles (client_id, due_date, client_name, quantity, ports, proxy_ids, required_cents, balance_cents, status, last_stage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'em_cobranca', ?, ?, ?)
         ON CONFLICT(client_id, due_date) DO UPDATE SET
           client_name = excluded.client_name, quantity = excluded.quantity, ports = excluded.ports, proxy_ids = excluded.proxy_ids,
           required_cents = excluded.required_cents, balance_cents = excluded.balance_cents,
           last_stage = COALESCE(excluded.last_stage, cycles.last_stage), updated_at = excluded.updated_at,
           -- Cliente tinha recarregado, mas o saldo caiu de novo e a régua voltou a enviar: o ciclo reabre.
           status = CASE WHEN cycles.status = 'recarregado' THEN 'em_cobranca' ELSE cycles.status END,
           resolved_at = CASE WHEN cycles.status = 'recarregado' THEN NULL ELSE cycles.resolved_at END`,
      ).run(
        c.clientId,
        c.dueDate,
        c.clientName || null,
        c.quantity,
        JSON.stringify(c.ports),
        JSON.stringify(c.proxyIds),
        c.requiredCents,
        c.balanceCents,
        c.lastStage || null,
        now,
        now,
      );
    },
    openCycles: () =>
      db
        .prepare("SELECT * FROM cycles WHERE status = 'em_cobranca'")
        .all()
        .map((r) => ({ ...r, ports: JSON.parse(r.ports), proxy_ids: JSON.parse(r.proxy_ids) })),
    resolveCycle(clientId, dueDate, status) {
      db.prepare("UPDATE cycles SET status = ?, resolved_at = ?, updated_at = ? WHERE client_id = ? AND due_date = ? AND status = 'em_cobranca'").run(
        status,
        nowIso(),
        nowIso(),
        clientId,
        dueDate,
      );
    },
    listCycles({ status, limit = 200 } = {}) {
      const rows = status
        ? db.prepare('SELECT * FROM cycles WHERE status = ? ORDER BY due_date DESC, client_id LIMIT ?').all(status, limit)
        : db.prepare('SELECT * FROM cycles ORDER BY due_date DESC, client_id LIMIT ?').all(limit);
      return rows.map((r) => ({ ...r, ports: JSON.parse(r.ports), proxy_ids: JSON.parse(r.proxy_ids) }));
    },

    // ---------- Envios ----------
    /** Etapas já feitas de um ciclo (qualquer canal com envio não falho, ou falho sem tentativas restantes). */
    doneStages(clientId, dueDate, maxAttempts) {
      const rows = db.prepare('SELECT stage, status, attempts FROM sends WHERE client_id = ? AND due_date = ?').all(clientId, dueDate);
      return [...new Set(rows.filter((r) => OK_STATUSES.includes(r.status) || r.attempts >= maxAttempts).map((r) => r.stage))];
    },
    getSend: (clientId, dueDate, stage, channel) =>
      db.prepare('SELECT * FROM sends WHERE client_id = ? AND due_date = ? AND stage = ? AND channel = ?').get(clientId, dueDate, stage, channel),
    /**
     * Reserva o envio ANTES de chamar a API. Se outra execução já reservou (UNIQUE), devolve null e não envia.
     * Também pega de volta um envio que falhou, se ainda há tentativas.
     */
    reserveSend({ clientId, dueDate, stage, channel, recipient, message, subject, variables, simulated, runId, maxAttempts }) {
      const now = nowIso();
      return tx(db, () => {
        const existing = db.prepare('SELECT * FROM sends WHERE client_id = ? AND due_date = ? AND stage = ? AND channel = ?').get(clientId, dueDate, stage, channel);
        if (!existing) {
          const res = db
            .prepare(
              `INSERT INTO sends (client_id, due_date, stage, channel, recipient, status, simulated, attempts, message, subject, variables, run_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'pendente', ?, 1, ?, ?, ?, ?, ?, ?)`,
            )
            .run(clientId, dueDate, stage, channel, recipient, simulated ? 1 : 0, message, subject ?? null, variables ? JSON.stringify(variables) : null, runId ?? null, now, now);
          return Number(res.lastInsertRowid);
        }
        if (existing.status === 'falhou' && existing.attempts < maxAttempts) {
          const res = db
            .prepare(
              `UPDATE sends SET status = 'pendente', attempts = attempts + 1, recipient = ?, message = ?, subject = ?, variables = ?, simulated = ?, run_id = ?, error = NULL, updated_at = ?
               WHERE id = ? AND status = 'falhou'`,
            )
            .run(recipient, message, subject ?? null, variables ? JSON.stringify(variables) : null, simulated ? 1 : 0, runId ?? null, now, existing.id);
          return res.changes ? existing.id : null;
        }
        return null;
      });
    },
    finishSend(id, { status, providerMessageId, error, costCents }) {
      db.prepare('UPDATE sends SET status = ?, provider_message_id = ?, error = ?, cost_cents = ?, updated_at = ? WHERE id = ?').run(
        status,
        providerMessageId || null,
        error ? String(error).slice(0, 500) : null,
        costCents || 0,
        nowIso(),
        id,
      );
    },
    getSendById: (id) => db.prepare('SELECT * FROM sends WHERE id = ?').get(id),
    /**
     * Reenvio manual pelo painel: só de envio que FALHOU ou ficou INCERTO. Troca o status para "pendente"
     * de forma atômica (dois cliques não reenviam duas vezes).
     */
    claimManualResend(id) {
      const res = db
        .prepare("UPDATE sends SET status = 'pendente', attempts = attempts + 1, error = NULL, updated_at = ? WHERE id = ? AND status IN ('falhou', 'incerto')")
        .run(nowIso(), id);
      return res.changes > 0;
    },
    /** Envio que ficou "pendente" (processo caiu no meio): não sabemos se saiu, então não repete. */
    markStalePendingAsUncertain(olderThanMs = 10 * 60_000) {
      const limit = new Date(Date.now() - olderThanMs).toISOString();
      return db
        .prepare("UPDATE sends SET status = 'incerto', error = 'processo interrompido durante o envio; não reenviado para não duplicar', updated_at = ? WHERE status = 'pendente' AND updated_at < ?")
        .run(nowIso(), limit).changes;
    },
    /** Atualização de status vinda do webhook da Meta. Nunca rebaixa (lido não volta a entregue). */
    updateDeliveryStatus(providerMessageId, status, error) {
      const rank = { enviado: 1, entregue: 2, lido: 3, falhou: 4 };
      const row = db.prepare('SELECT id, status FROM sends WHERE provider_message_id = ?').get(providerMessageId);
      if (!row) return false;
      if (status !== 'falhou' && (rank[row.status] || 0) >= rank[status]) return false;
      db.prepare('UPDATE sends SET status = ?, error = COALESCE(?, error), updated_at = ? WHERE id = ?').run(status, error || null, nowIso(), row.id);
      return true;
    },
    listSends({ limit = 200, offset = 0, clientId, stage, status } = {}) {
      const where = [];
      const args = [];
      if (clientId) {
        where.push('client_id = ?');
        args.push(String(clientId));
      }
      if (stage) {
        where.push('stage = ?');
        args.push(stage);
      }
      if (status) {
        where.push('status = ?');
        args.push(status);
      }
      const sql = `SELECT * FROM sends ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ? OFFSET ?`;
      return db.prepare(sql).all(...args, limit, offset);
    },
    costSummary(sinceIso) {
      return db
        .prepare(
          `SELECT channel, COUNT(*) AS total, COALESCE(SUM(cost_cents), 0) AS cost_cents, COALESCE(SUM(simulated), 0) AS simulated
           FROM sends WHERE created_at >= ? AND status NOT IN ('falhou') GROUP BY channel`,
        )
        .all(sinceIso);
    },

    // ---------- Execuções ----------
    startRun({ runDate, trigger, dryRun }) {
      const res = db.prepare('INSERT INTO runs (run_date, trigger, dry_run, started_at) VALUES (?, ?, ?, ?)').run(runDate, trigger, dryRun ? 1 : 0, nowIso());
      return Number(res.lastInsertRowid);
    },
    finishRun(id, summary, error) {
      db.prepare('UPDATE runs SET finished_at = ?, summary = ?, error = ? WHERE id = ?').run(nowIso(), JSON.stringify(summary), error || null, id);
    },
    listRuns: (limit = 30) =>
      db
        .prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?')
        .all(limit)
        .map((r) => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : null })),

    /** Trava entre processos (cron + botão + CLI): só uma execução por vez. Expira sozinha em 15 min. */
    acquireLock(owner, ttlMs = 15 * 60_000) {
      return tx(db, () => {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'run_lock'").get();
        const current = row ? JSON.parse(row.value) : null;
        if (current && current.expiresAt > Date.now()) return false;
        setSetting('run_lock', { owner, expiresAt: Date.now() + ttlMs });
        return true;
      });
    },
    releaseLock(owner) {
      tx(db, () => {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'run_lock'").get();
        if (row && JSON.parse(row.value).owner === owner) db.prepare("DELETE FROM settings WHERE key = 'run_lock'").run();
      });
    },
  };
}
