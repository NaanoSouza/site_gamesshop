// Canal WhatsApp — Cloud API oficial da Meta (nada de API não oficial).
// Modo "simulado" (padrão): não chama a Meta; só registra no log e no banco.
// Modo "real": exige WHATSAPP_MODE=real + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN, e templates
// aprovados na Meta (categoria Utilidade) com os nomes de templateName() e as 7 variáveis na ordem de
// TEMPLATE_PARAM_ORDER. O token nunca aparece em log nem em mensagem de erro.
import { TEMPLATE_PARAM_ORDER } from '../templates.js';
import { normalizeWhatsapp } from '../rules.js';

const STAGE_SLUG = { 'D-7': 'd7', 'D-3': 'd3', 'D-1': 'd1', D0: 'd0', 'D+1': 'recuperacao' };
const TIMEOUT_MS = 15_000;

export function templateName(prefix, stage) {
  return `${prefix}${STAGE_SLUG[stage]}`;
}

/** Corpo da chamada /messages com template (exportado para teste). */
export function buildTemplatePayload({ to, stage, variables, config }) {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName(config.templatePrefix, stage),
      language: { code: config.templateLanguage },
      components: [
        {
          type: 'body',
          parameters: TEMPLATE_PARAM_ORDER.map((k) => ({ type: 'text', text: String(variables[k] ?? '') })),
        },
      ],
    },
  };
}

export function createWhatsappChannel(config, { fetchImpl = globalThis.fetch, logger = console } = {}) {
  const wa = config.whatsapp;
  const realReady = wa.mode === 'real' && wa.phoneNumberId && wa.accessToken;
  if (wa.mode === 'real' && !realReady) {
    logger.warn('[whatsapp] WHATSAPP_MODE=real mas faltam WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN: ficando em modo simulado.');
  }
  const simulated = !realReady;

  return {
    name: 'whatsapp',
    simulated,
    recipientFor: (client) => normalizeWhatsapp(client.whatsapp),
    async send({ to, stage, text, variables }) {
      if (simulated) {
        logger.info(`[whatsapp:SIMULADO] para ${maskPhone(to)} etapa ${stage}: ${text}`);
        return { status: 'simulado', providerMessageId: null, costCents: 0 };
      }
      const url = `https://graph.facebook.com/${encodeURIComponent(wa.apiVersion)}/${encodeURIComponent(wa.phoneNumberId)}/messages`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${wa.accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildTemplatePayload({ to, stage, variables, config: wa })),
          signal: ctrl.signal,
        });
      } catch (err) {
        throw new Error(err?.name === 'AbortError' ? 'Meta não respondeu a tempo (timeout)' : 'falha de rede ao chamar a Meta');
      } finally {
        clearTimeout(timer);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = body?.error || {};
        throw new Error(`Meta recusou (HTTP ${res.status}${e.code ? `, código ${e.code}` : ''}): ${String(e.message || 'sem detalhe').slice(0, 200)}`);
      }
      const id = body?.messages?.[0]?.id || null;
      logger.info(`[whatsapp] enviado para ${maskPhone(to)} etapa ${stage} (id ${id})`);
      return { status: 'enviado', providerMessageId: id, costCents: wa.costCentsPerMessage };
    },
  };
}

export function maskPhone(phone) {
  const s = String(phone || '');
  return s.length > 6 ? `${s.slice(0, 4)}*****${s.slice(-2)}` : '***';
}
