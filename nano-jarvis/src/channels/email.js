// Canal e-mail (reforço do WhatsApp, custo zero).
// "simulado" (padrão): só registra no log e no banco. "real": EMAIL_MODE=real + SMTP_HOST/SMTP_FROM.
import { sendMail, buildMessage } from './smtp.js';

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function createEmailChannel(config, { logger = console, send = sendMail } = {}) {
  const smtp = config.smtp;
  const realReady = smtp.mode === 'real' && smtp.host && smtp.from;
  if (smtp.mode === 'real' && !realReady) logger.warn('[email] EMAIL_MODE=real mas faltam SMTP_HOST/SMTP_FROM: ficando em modo simulado.');
  const simulated = !realReady;
  const mask = (to) => to.replace(/^(.).*(@.*)$/, '$1***$2');

  return {
    name: 'email',
    simulated,
    recipientFor: (client) => {
      const email = String(client.email || '').trim();
      return EMAIL_RE.test(email) ? email : null;
    },
    async send({ to, stage, subject, text }) {
      if (simulated) {
        logger.info(`[email:SIMULADO] para ${mask(to)} etapa ${stage} — ${subject}: ${text}`);
        return { status: 'simulado', providerMessageId: null, costCents: 0 };
      }
      const message = buildMessage({ from: smtp.from, to, subject, text });
      const reply = await send({ ...smtp, to }, message);
      logger.info(`[email] enviado para ${mask(to)} etapa ${stage}`);
      void reply;
      return { status: 'enviado', providerMessageId: null, costCents: 0 };
    },
  };
}
