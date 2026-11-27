// Configuração lida de variáveis de ambiente (e de um arquivo .env opcional na pasta do projeto).
// Nada de segredo tem valor padrão: sem credenciais da Meta, o envio fica sempre simulado.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Lê KEY=VALOR de um .env simples, sem sobrescrever variáveis já definidas no ambiente. */
export function loadDotEnv(path = join(ROOT, '.env')) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const list = (v) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const int = (v, d) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'sim', 'yes', 'on'].includes(String(v).toLowerCase()));

export function loadConfig(env = process.env) {
  const whatsappMode = (env.WHATSAPP_MODE || 'simulado').toLowerCase();
  return {
    root: ROOT,
    port: int(env.PORT, 3780),
    host: env.HOST || '127.0.0.1',
    dbPath: env.DB_PATH || join(ROOT, 'data', 'nano-jarvis.db'),
    timezone: env.TZ_REGUA || 'America/Sao_Paulo',
    cronHour: int(env.CRON_HOUR, 9),
    cronMinute: int(env.CRON_MINUTE, 0),
    schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
    adminToken: env.ADMIN_TOKEN || '',
    // Preço de referência por proxy (R$ 17,90). Em centavos para não ter erro de arredondamento.
    proxyPriceCents: int(env.PROXY_PRICE_CENTS, 1790),
    // A cotação da ProxysEvo usa saldo + bônus para pagar; por isso o bônus conta como saldo por padrão.
    countBonusBalance: bool(env.COUNT_BONUS_BALANCE, true),
    rechargeLink: env.RECHARGE_LINK || 'https://app.ativosevo.com/recarga',
    ignoreEmails: list(env.IGNORE_EMAILS),
    ignoreEmailDomains: list(env.IGNORE_EMAIL_DOMAINS),
    ignoreClientIds: list(env.IGNORE_CLIENT_IDS),
    channels: list(env.CHANNELS || 'whatsapp'),
    maxAttempts: int(env.MAX_SEND_ATTEMPTS, 3),
    source: (env.DATA_SOURCE || 'demo').toLowerCase(),
    smtp: {
      mode: (env.EMAIL_MODE || 'simulado').toLowerCase() === 'real' ? 'real' : 'simulado',
      host: env.SMTP_HOST || '',
      port: int(env.SMTP_PORT, 587),
      // true = TLS direto (porta 465). false = STARTTLS (porta 587), obrigatório fora de localhost.
      secure: bool(env.SMTP_SECURE, false),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.SMTP_FROM || '',
      allowInsecure: bool(env.SMTP_ALLOW_INSECURE_LOCALHOST, false),
    },
    proxysevo: {
      baseUrl: env.PROXYSEVO_ADMIN_URL || '',
      token: env.PROXYSEVO_ADMIN_TOKEN || '',
    },
    whatsapp: {
      // "simulado" (padrão): só registra no log e no banco. "real": chama a Cloud API da Meta.
      mode: whatsappMode === 'real' ? 'real' : 'simulado',
      apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
      appSecret: env.WHATSAPP_APP_SECRET || '',
      verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
      templateLanguage: env.WHATSAPP_TEMPLATE_LANG || 'pt_BR',
      templatePrefix: env.WHATSAPP_TEMPLATE_PREFIX || 'cobranca_',
      // Estimativa de custo por mensagem de utilidade, em centavos de real (ajuste com a tabela da Meta/BSP).
      costCentsPerMessage: int(env.WHATSAPP_COST_CENTS, 5),
    },
  };
}
