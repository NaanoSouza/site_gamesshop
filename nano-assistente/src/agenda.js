// Agenda pessoal do Nano: tarefas, tarefas diárias (voltam desmarcadas todo dia) e compromissos.
// Guardada num arquivo JSON local (data/agenda.json), gravado de forma atômica.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalize } from './intents.js';

const EMPTY = { tarefas: [], compromissos: [] };
const REPETICOES = ['nenhuma', 'diaria', 'dias_uteis', 'semanal', 'mensal'];

export function createAgenda(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'agenda.json');
  let state = existsSync(file) ? { ...EMPTY, ...JSON.parse(readFileSync(file, 'utf8')) } : structuredClone(EMPTY);
  const save = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, file);
  };
  const clean = (s, max = 200) => String(s || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

  const isDone = (t, today) => (t.diaria ? t.feitaEm === today : Boolean(t.feita));

  /** O compromisso acontece nesta data? (considera repetição) */
  const occursOn = (c, ymd) => {
    if (c.data === ymd) return true;
    if (!c.repeticao || c.repeticao === 'nenhuma' || ymd < c.data) return false;
    const d = new Date(`${ymd}T12:00:00Z`);
    const start = new Date(`${c.data}T12:00:00Z`);
    switch (c.repeticao) {
      case 'diaria': return true;
      case 'dias_uteis': return d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
      case 'semanal': return d.getUTCDay() === start.getUTCDay();
      case 'mensal': return d.getUTCDate() === start.getUTCDate();
      default: return false;
    }
  };

  return {
    file,
    addTarefa({ texto, diaria = false }) {
      const t = { id: randomUUID(), texto: clean(texto), diaria: Boolean(diaria), feita: false, feitaEm: null, criada: new Date().toISOString() };
      if (!t.texto) throw new Error('Tarefa vazia');
      state.tarefas.push(t);
      save();
      return t;
    },
    concluirTarefa({ id, texto, today }) {
      let t = id ? state.tarefas.find((x) => x.id === id) : null;
      if (!t && texto) {
        const q = normalize(texto);
        const pending = state.tarefas.filter((x) => !isDone(x, today));
        t = pending.find((x) => normalize(x.texto) === q) || pending.find((x) => normalize(x.texto).includes(q) || q.includes(normalize(x.texto)));
      }
      if (!t) return null;
      if (t.diaria) t.feitaEm = today;
      else t.feita = true;
      save();
      return t;
    },
    desmarcarTarefa({ id }) {
      const t = state.tarefas.find((x) => x.id === id);
      if (!t) return null;
      t.feita = false;
      t.feitaEm = null;
      save();
      return t;
    },
    removerTarefa(id) {
      const n = state.tarefas.length;
      state.tarefas = state.tarefas.filter((x) => x.id !== id);
      if (state.tarefas.length !== n) save();
      return state.tarefas.length !== n;
    },
    addCompromisso({ titulo, data, hora = null, repeticao = 'nenhuma', avisarMin = 30 }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data))) throw new Error('Data inválida');
      if (hora !== null && hora !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora))) throw new Error('Hora inválida');
      if (!REPETICOES.includes(repeticao)) throw new Error('Repetição inválida');
      const c = { id: randomUUID(), titulo: clean(titulo) || 'Compromisso', data, hora: hora || null, repeticao, avisarMin: Math.max(0, Math.min(1440, Number(avisarMin) || 0)) };
      state.compromissos.push(c);
      save();
      return c;
    },
    removerCompromisso(id) {
      const n = state.compromissos.length;
      state.compromissos = state.compromissos.filter((x) => x.id !== id);
      if (state.compromissos.length !== n) save();
      return state.compromissos.length !== n;
    },
    compromissosDoDia(ymd) {
      return state.compromissos.filter((c) => occursOn(c, ymd)).sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99'));
    },
    tarefas(today) {
      return state.tarefas.map((t) => ({ ...t, feitaHoje: isDone(t, today) }));
    },
    pendentes(today) {
      return state.tarefas.filter((t) => !isDone(t, today));
    },
    all: () => structuredClone(state),
    reload() {
      state = existsSync(file) ? { ...EMPTY, ...JSON.parse(readFileSync(file, 'utf8')) } : structuredClone(EMPTY);
    },
  };
}
