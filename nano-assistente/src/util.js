// Datas no fuso do computador (o Nano roda na máquina do dono).
export const pad = (n) => String(n).padStart(2, '0');
export const localYmd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localHm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const addDaysYmd = (ymd, n) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "sexta-feira, 27 de novembro" */
export function falaData(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]}, ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

/** "14:30" → "14 e 30"; "09:00" → "9 horas" */
export function falaHora(hm) {
  const [h, m] = hm.split(':').map(Number);
  if (m === 0) return `${h} ${h === 1 ? 'hora' : 'horas'}`;
  if (m === 30) return `${h} e meia`;
  return `${h} e ${m}`;
}

export function periodo(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'bom dia';
  if (h >= 12 && h < 18) return 'boa tarde';
  return 'boa noite';
}

export const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
