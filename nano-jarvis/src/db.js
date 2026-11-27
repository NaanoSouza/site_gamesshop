// Banco próprio da régua (SQLite embutido no Node, sem dependência externa).
// Guarda só o que é da régua: configurações, lista "não cobrar", ciclos de cobrança, envios e execuções.
// Os dados de clientes/proxies/saldo vêm da fonte de dados (src/source) e NUNCA são alterados daqui.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE do_not_charge (
    client_id TEXT PRIMARY KEY,
    client_name TEXT,
    reason TEXT NOT NULL,
    origin TEXT NOT NULL DEFAULT 'admin', -- admin | opt_out (cliente pediu para sair, LGPD)
    created_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE do_not_charge_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    action TEXT NOT NULL, -- nao_cobrar | voltar_a_cobrar
    reason TEXT,
    origin TEXT,
    actor TEXT,
    at TEXT NOT NULL
  );

  -- Um ciclo = um cliente + uma data de vencimento (o grupo que recebe uma mensagem por etapa).
  CREATE TABLE cycles (
    client_id TEXT NOT NULL,
    due_date TEXT NOT NULL,
    client_name TEXT,
    quantity INTEGER NOT NULL,
    ports TEXT NOT NULL,
    proxy_ids TEXT NOT NULL,
    required_cents INTEGER NOT NULL,
    balance_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'em_cobranca', -- em_cobranca | renovado | recarregado | encerrado
    last_stage TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    PRIMARY KEY (client_id, due_date)
  );

  -- Cada envio de cada etapa por canal. O UNIQUE é a garantia final de "nunca a mesma etapa duas vezes".
  CREATE TABLE sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    due_date TEXT NOT NULL,
    stage TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT,
    status TEXT NOT NULL, -- pendente | simulado | enviado | entregue | lido | falhou | incerto
    simulated INTEGER NOT NULL DEFAULT 1,
    attempts INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL,
    error TEXT,
    provider_message_id TEXT,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    run_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (client_id, due_date, stage, channel)
  );
  CREATE INDEX sends_created ON sends (created_at);
  CREATE INDEX sends_provider ON sends (provider_message_id);

  CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date TEXT NOT NULL,
    trigger TEXT NOT NULL, -- cron | manual | cli
    dry_run INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    summary TEXT,
    error TEXT
  );

  -- Dados de demonstração (fonte "demo"). Na produção a fonte é o banco/API da ProxysEvo.
  CREATE TABLE demo_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    whatsapp TEXT,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    bonus_balance_cents INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_test INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE demo_proxies (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    port INTEGER,
    status TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  `,
];

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get();
  let version = row ? row.version : 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      version += 1;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

/** Roda `fn` numa transação. */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
