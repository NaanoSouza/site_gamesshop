// Integração com a régua de cobrança (nano-jarvis): pergunta ao painel como estão as cobranças.
import { localYmd } from './util.js';

const TIMEOUT_MS = 8000;

export function createReguaClient({ url, token }, { fetchImpl = globalThis.fetch } = {}) {
  const enabled = Boolean(url && token);
  async function get(path) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(`${url}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`a régua respondeu HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      throw new Error(err?.name === 'AbortError' ? 'a régua não respondeu' : err.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    enabled,
    /** Resumo falado das cobranças: estado da régua, lembretes de hoje e quem renovou. */
    async resumo(now = new Date()) {
      if (!enabled) return null;
      const [o, s] = await Promise.all([get('/api/cobrancas/overview'), get('/api/cobrancas/sends?limit=200')]);
      const today = localYmd(now);
      const hoje = (s.sends || []).filter((x) => localYmd(new Date(x.created_at)) === today && x.channel === 'whatsapp');
      const clientes = new Set(hoje.map((x) => x.client_id)).size;
      const falhas = hoje.filter((x) => x.status === 'falhou').length;
      const c = o.cycles || {};
      const partes = [];
      if (!o.enabled) partes.push('A régua de cobrança está desligada.');
      partes.push(clientes ? `Hoje a régua avisou ${clientes} ${clientes === 1 ? 'cliente' : 'clientes'} sobre vencimento.` : 'Hoje a régua ainda não mandou lembretes.');
      if (falhas) partes.push(`${falhas} ${falhas === 1 ? 'envio falhou' : 'envios falharam'}, vale olhar o painel.`);
      partes.push(`${c.em_cobranca || 0} em cobrança, ${c.renovado || 0} já renovaram e ${c.recarregado || 0} recarregaram.`);
      if (o.whatsappMode !== 'real') partes.push('Lembrando: o WhatsApp ainda está em modo simulado.');
      return partes.join(' ');
    },
  };
}
