// Datas de calendário no fuso da operação (America/Sao_Paulo). Toda a régua trabalha com
// "YYYY-MM-DD" locais: um proxy que vence às 23h de São Paulo vence naquele dia, não no seguinte (UTC).

const formatters = new Map();
function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return formatters.get(timeZone);
}

/** Partes de data/hora locais de um instante. */
export function localParts(date, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

/** Data local "YYYY-MM-DD" de um instante (Date ou string ISO). */
export function localDate(value, timeZone) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Data inválida: ${value}`);
  const p = localParts(d, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const DAY = 86_400_000;
const toUtcMidnight = (ymd) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Data inválida: ${ymd}`);
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
};

/** Dias de calendário de `from` até `to` (positivo se `to` é depois). */
export function daysBetween(from, to) {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / DAY);
}

export function addDays(ymd, n) {
  return new Date(toUtcMidnight(ymd) + n * DAY).toISOString().slice(0, 10);
}

/** "2026-11-30" -> "30/11/2026" */
export function formatBr(ymd) {
  return `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
}

/** Offset (ms) do fuso num instante: local - UTC. */
function offsetMs(date, timeZone) {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Próximo instante em que o relógio local marca hh:mm (estritamente depois de `now`). */
export function nextRunAt(now, hour, minute, timeZone) {
  let day = localDate(now, timeZone);
  for (let i = 0; i < 3; i++) {
    const guess = new Date(toUtcMidnight(day) + (hour * 60 + minute) * 60_000);
    // Corrige pelo offset do fuso (duas passadas cobrem mudança de horário de verão).
    let candidate = new Date(guess.getTime() - offsetMs(guess, timeZone));
    candidate = new Date(guess.getTime() - offsetMs(candidate, timeZone));
    if (candidate.getTime() > now.getTime()) return candidate;
    day = addDays(day, 1);
  }
  throw new Error('não foi possível calcular a próxima execução');
}

/** "1790" -> "R$ 17,90" */
export function formatBrl(cents) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${reais},${String(abs % 100).padStart(2, '0')}`;
}
