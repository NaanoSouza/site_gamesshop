// Tela do Nano: reconhecimento de voz (Chrome/Edge), fala, música, agenda e lembretes.
'use strict';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } },
};

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Nano': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'checked') n.checked = Boolean(v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

// ---------------- estado da tela ----------------
const orb = $('#orb');
const setStatus = (t) => { $('#status').textContent = t; };
const setOrb = (mode) => { orb.classList.remove('listening', 'thinking', 'speaking'); if (mode) orb.classList.add(mode); };
function say(who, text, cls = '') {
  if (!text) return;
  const chat = $('#chat');
  chat.append(el('div', { class: `msg ${who} ${cls}` }, text));
  while (chat.children.length > 40) chat.firstChild.remove();
  chat.scrollTop = chat.scrollHeight;
}

// ---------------- voz do Nano (síntese) ----------------
let voice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => /^pt(-|_)BR/i.test(v.lang));
  const preferred = store.get('nano_voice', null);
  voice = voices.find((v) => v.name === preferred) || voices.find((v) => /google|francisca|natural|online/i.test(v.name)) || voices[0] || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
let speaking = false;
function speak(text) {
  return new Promise((resolve) => {
    if (!text || !('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    if (voice) u.voice = voice;
    u.rate = 1.05;
    speaking = true;
    pauseListening();
    duck(true);
    setOrb('speaking');
    const done = () => {
      speaking = false;
      duck(false);
      setOrb(listening ? 'listening' : null);
      resumeListening();
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
  });
}

// ---------------- música ----------------
const audio = $('#audio');
let queue = [];
let qi = 0;
let baseVolume = store.get('nano_volume', 0.8);
audio.volume = baseVolume;
function duck(on) { audio.volume = on ? Math.min(baseVolume, 0.15) : baseVolume; }
function playAt(i) {
  if (!queue.length) return;
  qi = (i + queue.length) % queue.length;
  audio.src = `/api/musica/${encodeURIComponent(queue[qi].id)}`;
  audio.play().catch(() => setHint('Clique em qualquer lugar da tela para liberar o som e peça de novo.'));
  $('#track').textContent = queue[qi].title;
  $('#player').classList.remove('hidden');
  $('#pp').textContent = '❚❚';
}
audio.addEventListener('ended', () => playAt(qi + 1));
audio.addEventListener('pause', () => { $('#pp').textContent = '▶'; });
audio.addEventListener('play', () => { $('#pp').textContent = '❚❚'; });
function stopMusic() { audio.pause(); audio.removeAttribute('src'); audio.load(); queue = []; $('#player').classList.add('hidden'); }

// ---------------- executar resposta ----------------
let followUntil = 0;
async function runAction(acao) {
  if (!acao) return;
  switch (acao.tipo) {
    case 'tocar': queue = acao.fila; playAt(0); break;
    case 'pausar': audio.pause(); break;
    case 'continuar': if (audio.src) audio.play(); break;
    case 'proxima': if (queue.length) playAt(qi + 1); break;
    case 'volume':
      baseVolume = Math.max(0.05, Math.min(1, baseVolume + acao.delta));
      store.set('nano_volume', baseVolume);
      audio.volume = baseVolume;
      break;
    case 'agenda': loadAgenda(); break;
    case 'dormir': followUntil = 0; break;
    default: break;
  }
}

let busy = false;
async function send(text, { escuta = false } = {}) {
  if (!text.trim() || busy) return;
  // Logo depois de o Nano falar, aceita resposta sem "Nano" (ex.: "sim", "pode falar").
  const semNano = escuta && Date.now() < followUntil;
  busy = true;
  setOrb('thinking');
  try {
    const r = await api('POST', '/api/comando', { texto: text, escuta: escuta && !semNano, seguimento: semNano });
    if (!r.ouviu) return;
    say('me', text);
    say('nano', r.fala);
    await runAction(r.acao);
    if (r.fala) await speak(r.fala);
    followUntil = r.acao?.tipo === 'dormir' ? 0 : Date.now() + 8000;
  } catch (e) {
    say('nano', e.message, 'err');
  } finally {
    busy = false;
    setOrb(listening ? 'listening' : null);
  }
}

// ---------------- reconhecimento de voz ----------------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let listening = false; // escuta contínua ligada
let paused = false;
let oneShot = false;

function setHint(t) { $('#hint').textContent = t; }

function buildRecognizer() {
  const r = new SR();
  r.lang = 'pt-BR';
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      const text = res[0].transcript;
      if (res.isFinal) {
        const wasOneShot = oneShot;
        if (oneShot) { oneShot = false; r.stop(); }
        send(text, { escuta: listening && !wasOneShot });
      } else {
        interim += text;
      }
    }
    if (interim) setStatus(`… ${interim}`);
  };
  r.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      listening = false;
      $('#always').checked = false;
      store.set('nano_always', false);
      setHint('O navegador bloqueou o microfone. Clique no cadeado ao lado do endereço e permita o microfone.');
    } else if (ev.error === 'network') {
      setHint('O reconhecimento de voz precisa de internet (Chrome/Edge usam o serviço do navegador).');
    }
  };
  r.onend = () => {
    if (listening && !paused) {
      try { r.start(); } catch { /* já iniciado */ }
    } else if (!listening) {
      setOrb(null);
      setStatus(idleStatus());
    }
  };
  return r;
}

const idleStatus = () => (listening ? 'Ouvindo… diga "Nano, …"' : 'Clique na bolinha e fale, ou ligue a escuta contínua.');

function startRec() {
  if (!SR) return;
  rec ??= buildRecognizer();
  try { rec.start(); } catch { /* já iniciado */ }
}
function pauseListening() { paused = true; try { rec?.abort(); } catch { /* ok */ } }
function resumeListening() {
  paused = false;
  if (listening) startRec();
  setStatus(idleStatus());
}

function setListening(on) {
  listening = on;
  store.set('nano_always', on);
  $('#always').checked = on;
  if (on) { startRec(); setOrb('listening'); } else { try { rec?.stop(); } catch { /* ok */ } setOrb(null); }
  setStatus(idleStatus());
}

orb.addEventListener('click', () => {
  if (!SR) return setHint('Este navegador não reconhece voz. Use o Google Chrome ou o Microsoft Edge (ou digite abaixo).');
  if (speaking) { speechSynthesis.cancel(); return; }
  oneShot = true;
  setOrb('listening');
  setStatus('Pode falar…');
  if (listening) return; // já está ouvindo; a próxima frase vale sem "Nano"
  startRec();
});
$('#always').addEventListener('change', (e) => setListening(e.target.checked));
$('#ask').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('#text').value;
  $('#text').value = '';
  send(t);
});
$('#pp').addEventListener('click', () => (audio.paused ? audio.play() : audio.pause()));
$('#next').addEventListener('click', () => playAt(qi + 1));
$('#stop').addEventListener('click', stopMusic);

// ---------------- agenda ----------------
const fmtDia = (ymd, hoje) => {
  if (ymd === hoje) return 'hoje';
  const d = new Date(`${ymd}T12:00:00`);
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
};
let agendaCache = null;
async function loadAgenda() {
  try {
    const a = await api('GET', '/api/agenda');
    agendaCache = a;
    $('#today').textContent = new Date(`${a.hoje}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    const tasks = $('#tasks');
    tasks.replaceChildren(
      ...(a.tarefas.length ? a.tarefas : [null]).map((t) =>
        t
          ? el('li', { class: t.feitaHoje ? 'done' : '' },
              el('input', { type: 'checkbox', checked: t.feitaHoje, 'aria-label': `Concluir ${t.texto}`, onchange: (e) => api('POST', e.target.checked ? '/api/agenda/tarefa/concluir' : '/api/agenda/tarefa/desmarcar', { id: t.id }).then(loadAgenda) }),
              el('span', { class: 'txt' }, t.texto),
              t.diaria ? el('span', { class: 'tag' }, 'todo dia') : null,
              el('button', { type: 'button', class: 'link', 'aria-label': 'Remover', onclick: () => api('POST', '/api/agenda/tarefa/remover', { id: t.id }).then(loadAgenda) }, '✕'))
          : el('li', { class: 'empty' }, 'Nenhuma tarefa. Diga "Nano, anota …"'),
      ),
    );
    const events = $('#events');
    events.replaceChildren(
      ...(a.proximos.length ? a.proximos : [null]).map((c) =>
        c
          ? el('li', {},
              el('span', { class: 'when' }, `${fmtDia(c.dia, a.hoje)}${c.hora ? ` ${c.hora}` : ''}`),
              el('span', { class: 'txt' }, c.titulo),
              c.repeticao !== 'nenhuma' ? el('span', { class: 'tag' }, '↻') : null,
              el('button', { type: 'button', class: 'link', 'aria-label': 'Remover', onclick: () => confirm(`Remover "${c.titulo}"${c.repeticao !== 'nenhuma' ? ' (todas as repetições)' : ''}?`) && api('POST', '/api/agenda/compromisso/remover', { id: c.id }).then(loadAgenda) }, '✕'))
          : el('li', { class: 'empty' }, 'Nada marcado. Diga "Nano, marca reunião amanhã às 10"'),
      ),
    );
    if (!$('#ev-date').value) $('#ev-date').value = a.hoje;
  } catch (e) {
    setHint(`Agenda: ${e.message}`);
  }
}
$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/agenda/tarefa', { texto: $('#task-text').value, diaria: $('#task-daily').checked });
    $('#task-text').value = '';
    $('#task-daily').checked = false;
    loadAgenda();
  } catch (err) { setHint(err.message); }
});
$('#event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/agenda/compromisso', { titulo: $('#ev-title').value, data: $('#ev-date').value, hora: $('#ev-time').value || null, repeticao: $('#ev-rep').value });
    $('#ev-title').value = '';
    $('#ev-time').value = '';
    loadAgenda();
  } catch (err) { setHint(err.message); }
});

// ---------------- lembretes ----------------
function checkReminders() {
  const a = agendaCache;
  if (!a) return;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const sent = store.get('nano_avisos', {});
  for (const c of a.proximos) {
    if (c.dia !== today || !c.hora) continue;
    const at = new Date(`${today}T${c.hora}:00`);
    const diffMin = (at - now) / 60000;
    const keyBefore = `${c.id}|${today}|antes`;
    const keyNow = `${c.id}|${today}|agora`;
    if (c.avisarMin > 0 && diffMin <= c.avisarMin && diffMin > 1 && !sent[keyBefore]) {
      sent[keyBefore] = 1;
      notify(`Daqui a ${Math.round(diffMin)} minutos: ${c.titulo}.`);
    } else if (diffMin <= 1 && diffMin > -10 && !sent[keyNow]) {
      sent[keyNow] = 1;
      sent[keyBefore] = 1;
      notify(`Está na hora: ${c.titulo}.`);
    }
  }
  for (const k of Object.keys(sent)) if (!k.includes(today)) delete sent[k];
  store.set('nano_avisos', sent);
}
function notify(text) {
  say('nano', text);
  speak(text);
  if ('Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Nano', { body: text, icon: '/icon.svg' }); } catch { /* ok */ }
  }
}

// ---------------- início ----------------
(async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try {
    const s = await api('GET', '/api/status');
    const extras = [s.musicas ? `${s.musicas} músicas na pasta` : 'músicas pelo YouTube', s.claude ? 'conversa livre ligada' : null, s.regua ? 'cobranças ligadas' : null].filter(Boolean);
    setHint(extras.join(' · '));
    document.title = s.nome ? `Nano · ${s.nome}` : 'Nano';
  } catch (e) {
    setHint(e.message);
  }
  if (!SR) setHint('Use o Google Chrome ou o Microsoft Edge para falar com o Nano. Aqui dá para digitar.');
  loadAgenda();
  setInterval(loadAgenda, 5 * 60_000);
  setInterval(checkReminders, 30_000);
  setTimeout(checkReminders, 3000);
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission().catch(() => {}), { once: true });
  }
  if (SR && store.get('nano_always', false)) setListening(true);
  setStatus(idleStatus());
})();
