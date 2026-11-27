// Canal e-mail (reforço do WhatsApp). Nesta fase é SEMPRE simulado: registra no log e no banco.
// Para ligar de verdade, troque o corpo de send() por um envio SMTP (ex.: nodemailer) — ver RESUMO.md.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createEmailChannel(config, { logger = console } = {}) {
  return {
    name: 'email',
    simulated: true,
    recipientFor: (client) => {
      const email = String(client.email || '').trim();
      return EMAIL_RE.test(email) ? email : null;
    },
    async send({ to, stage, subject, text }) {
      logger.info(`[email:SIMULADO] para ${to.replace(/^(.).*(@.*)$/, '$1***$2')} etapa ${stage} — ${subject}: ${text}`);
      return { status: 'simulado', providerMessageId: null, costCents: 0 };
    },
  };
}
