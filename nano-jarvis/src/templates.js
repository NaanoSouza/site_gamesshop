// Textos da régua. O dono edita pelo painel; o envio simulado e o e-mail usam o texto editado.
// No WhatsApp real, a Meta só aceita templates aprovados: o texto lá é o que foi aprovado na Meta, e
// daqui vão só as variáveis, sempre nesta ordem (TEMPLATE_PARAM_ORDER).
import { formatBr, formatBrl } from './dates.js';

export const TEMPLATE_VARIABLES = ['nome', 'quantidade', 'portas', 'vencimento', 'valor_necessario', 'saldo_atual', 'link_recarga'];
export const TEMPLATE_PARAM_ORDER = TEMPLATE_VARIABLES;

// Tom de utilidade (categoria "Utility" da Meta): informativo, sem oferta nem urgência promocional.
export const DEFAULT_TEMPLATES = {
  'D-7':
    'Olá, {{nome}}! Seus {{quantidade}} proxy(s) da ProxysEvo (portas {{portas}}) vencem em {{vencimento}}. ' +
    'Para a renovação automática acontecer, o saldo precisa ser de {{valor_necessario}}; seu saldo atual é {{saldo_atual}}. ' +
    'Recarga: {{link_recarga}}',
  'D-3':
    'Olá, {{nome}}. Lembrete: seus {{quantidade}} proxy(s) (portas {{portas}}) vencem em {{vencimento}}. ' +
    'Valor para renovar: {{valor_necessario}}. Saldo atual: {{saldo_atual}}. Recarga: {{link_recarga}}',
  'D-1':
    'Olá, {{nome}}. Seus {{quantidade}} proxy(s) (portas {{portas}}) vencem amanhã, {{vencimento}}. ' +
    'Valor para renovar: {{valor_necessario}}. Saldo atual: {{saldo_atual}}. Recarga: {{link_recarga}}',
  D0:
    'Olá, {{nome}}. Seus {{quantidade}} proxy(s) (portas {{portas}}) vencem hoje, {{vencimento}}. ' +
    'Valor para renovar: {{valor_necessario}}. Saldo atual: {{saldo_atual}}. Recarga: {{link_recarga}}',
  'D+1':
    'Olá, {{nome}}. Seus {{quantidade}} proxy(s) (portas {{portas}}) venceram em {{vencimento}} e estão suspensos. ' +
    'Recarregue {{valor_necessario}} para reativar o mesmo IP (saldo atual: {{saldo_atual}}). Recarga: {{link_recarga}}',
};

export const DEFAULT_EMAIL_SUBJECTS = {
  'D-7': 'Seus proxies vencem em {{vencimento}}',
  'D-3': 'Lembrete: seus proxies vencem em {{vencimento}}',
  'D-1': 'Seus proxies vencem amanhã ({{vencimento}})',
  D0: 'Seus proxies vencem hoje ({{vencimento}})',
  'D+1': 'Seus proxies estão suspensos: recarregue para manter o mesmo IP',
};

/** Variáveis de uma mensagem, já formatadas para leitura. */
export function buildVariables({ client, group, requiredCents, balanceCents, rechargeLink }) {
  const firstName = String(client.name || '').trim().split(/\s+/)[0] || 'cliente';
  return {
    nome: firstName,
    quantidade: String(group.quantity),
    portas: group.ports.length ? group.ports.join(', ') : '-',
    vencimento: formatBr(group.dueDate),
    valor_necessario: formatBrl(requiredCents),
    saldo_atual: formatBrl(balanceCents),
    link_recarga: rechargeLink,
  };
}

/** Troca {{variavel}} pelo valor; variável desconhecida fica vazia (nunca executa nada do texto). */
export function renderTemplate(text, vars) {
  return String(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : ''));
}

/** Variáveis usadas no texto que não existem (para o editor avisar). */
export function unknownVariables(text) {
  const found = [...String(text).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(found.filter((v) => !TEMPLATE_VARIABLES.includes(v)))];
}
