// Webhook da Meta (WhatsApp Cloud API): status de entrega e opt-out (LGPD) por resposta "PARAR".
// Só é aceito com a assinatura X-Hub-Signature-256 válida (WHATSAPP_APP_SECRET). Sem app secret configurado,
// o POST é recusado: ninguém consegue forjar status ou tirar cliente da régua.
import { createHmac, timingSafeEqual } from 'node:crypto';

const STATUS_MAP = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' };
export const OPT_OUT_WORDS = ['parar', 'sair', 'stop', 'cancelar', 'descadastrar'];

export function verifySignature(rawBody, header, appSecret) {
  if (!appSecret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(rawBody).digest('hex'), 'utf8');
  const got = Buffer.from(header.slice(7), 'utf8');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** GET de verificação da Meta: devolve o challenge se o verify token bate. */
export function handleVerify(query, verifyToken) {
  if (!verifyToken) return null;
  const token = query.get('hub.verify_token') || '';
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (query.get('hub.mode') === 'subscribe' && a.length === b.length && timingSafeEqual(a, b)) return query.get('hub.challenge') || '';
  return null;
}

export function isOptOutText(text) {
  const t = String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  return OPT_OUT_WORDS.includes(t);
}

/** Processa o corpo (já com assinatura conferida). */
export function handleEvent(payload, store, logger = console) {
  const out = { statuses: 0, optOuts: 0 };
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const s of value.statuses || []) {
        const status = STATUS_MAP[s?.status];
        if (!status || !s?.id) continue;
        const err = status === 'falhou' ? (s.errors || []).map((e) => `${e.code}: ${e.title || e.message || ''}`).join('; ').slice(0, 300) : null;
        if (store.updateDeliveryStatus(String(s.id), status, err)) out.statuses += 1;
      }
      for (const m of value.messages || []) {
        if (m?.type !== 'text' || !isOptOutText(m?.text?.body)) continue;
        const from = String(m.from || '').replace(/\D/g, '');
        const row = store.db
          .prepare("SELECT client_id FROM sends WHERE channel = 'whatsapp' AND recipient = ? ORDER BY id DESC LIMIT 1")
          .get(from);
        if (!row) continue;
        if (!store.isDoNotCharge(row.client_id)) {
          store.addDoNotCharge({ clientId: row.client_id, reason: 'Cliente pediu para sair dos lembretes (respondeu PARAR)', origin: 'opt_out', actor: 'whatsapp' });
          out.optOuts += 1;
          logger.info(`[webhook] cliente ${row.client_id} saiu dos lembretes (opt-out).`);
        }
      }
    }
  }
  return out;
}
