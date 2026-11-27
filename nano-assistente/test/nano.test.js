import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { extractCommand, parseIntent, parseWhen, normalize } from '../src/intents.js';
import { createAgenda } from '../src/agenda.js';
import { createMusicLibrary } from '../src/music.js';
import { resolveFolder, isSafeUrl, createSystem } from '../src/system.js';
import { createBrain } from '../src/brain.js';
import { createApp } from '../src/app.js';
import { createLlm } from '../src/llm.js';
import { createReguaClient } from '../src/regua.js';
import { loadConfig } from '../src/config.js';

const T = '2026-11-27'; // sexta-feira
const quiet = { info() {}, warn() {}, error() {} };
const tmp = () => mkdtempSync(join(tmpdir(), 'nano-'));

describe('palavra de ativação', () => {
  test('acha "Nano" no começo, no fim e com vírgula', () => {
    assert.equal(extractCommand('Bom dia, Nano!'), 'bom dia');
    assert.equal(extractCommand('Nano, abre a pasta Downloads'), 'abre a pasta downloads');
    assert.equal(extractCommand('ei nano que horas são'), 'que horas sao');
    assert.equal(extractCommand('Nano'), '');
  });
  test('sem "Nano" não é com ele', () => {
    assert.equal(extractCommand('bom dia pessoal'), null);
    assert.equal(extractCommand('nanoparticulas'), null);
  });
});

describe('intenções', () => {
  const i = (s) => parseIntent(s, T);
  test('saudação, hora, ajuda, minhas coisas', () => {
    assert.deepEqual(i('bom dia'), { intent: 'saudacao', args: { tipo: 'bom dia' } });
    assert.equal(i('boa noite tudo bem').intent, 'saudacao');
    assert.equal(i('que horas são').intent, 'hora');
    assert.equal(i('o que você sabe fazer').intent, 'ajuda');
    for (const s of ['fala as minhas coisas', 'o que eu tenho hoje', 'minha agenda', 'como está meu dia', 'me fala o que tenho pra hoje']) assert.equal(i(s).intent, 'minhas_coisas', s);
    assert.equal(i('como estão as cobranças').intent, 'cobrancas');
  });
  test('pastas', () => {
    assert.deepEqual(i('abre a pasta Downloads').args, { nome: 'downloads' });
    assert.deepEqual(i('abre minha pasta de trabalho').args, { nome: 'trabalho' });
    assert.equal(i('abre os documentos').intent, 'abrir_pasta');
  });
  test('música', () => {
    assert.deepEqual(i('coloca uma música').args, { consulta: '', onde: null });
    assert.deepEqual(parseIntent('toca Legião Urbana', T, 'toca Legião Urbana').args, { consulta: 'Legião Urbana', onde: null });
    assert.deepEqual(i('bota um samba no youtube').args, { consulta: 'samba', onde: 'youtube' });
    assert.equal(i('para a música').intent, 'parar_musica');
    assert.equal(i('próxima').intent, 'proxima_musica');
    assert.equal(i('aumenta o volume').intent, 'volume');
  });
  test('sites e pesquisa', () => {
    assert.deepEqual(i('abre o youtube'), { intent: 'abrir_site', args: { nome: 'youtube' } });
    assert.equal(i('pesquisa preço do dólar').intent, 'pesquisar');
  });
  test('tarefas e compromissos com acento preservado', () => {
    assert.deepEqual(parseIntent('anota comprar café', T, 'Nano, anota comprar café'), { intent: 'nova_tarefa', args: { texto: 'comprar café' } });
    assert.deepEqual(parseIntent('me lembra de ligar pro joao amanha as 10', T, 'me lembra de ligar pro João amanhã às 10').args, { titulo: 'ligar pro João', data: '2026-11-28', hora: '10:00' });
    assert.deepEqual(i('marca reunião com cliente segunda às 14:30').args, { titulo: 'reunião com cliente', data: '2026-11-30', hora: '14:30' });
    assert.equal(i('terminei comprar café').intent, 'concluir_tarefa');
  });
  test('desconhecido vai para a conversa livre', () => {
    assert.equal(i('qual a capital da frança').intent, 'desconhecido');
  });
});

describe('datas e horas faladas', () => {
  const w = (s) => parseWhen(normalize(s), T);
  test('amanhã, depois de amanhã, dia N, dia da semana', () => {
    assert.equal(w('amanhã').data, '2026-11-28');
    assert.equal(w('depois de amanhã').data, '2026-11-29');
    assert.equal(w('dia 5').data, '2026-12-05'); // dia 5 já passou em novembro → dezembro
    assert.equal(w('dia 30').data, '2026-11-30');
    assert.equal(w('na sexta').data, '2026-12-04'); // hoje é sexta → a próxima
    assert.equal(w('segunda-feira').data, '2026-11-30');
  });
  test('horas: 14:30, 10h, 3 da tarde, 8 e meia da noite, meio dia', () => {
    assert.equal(w('às 14:30').hora, '14:30');
    assert.equal(w('10h').hora, '10:00');
    assert.equal(w('às 3 da tarde').hora, '15:00');
    assert.equal(w('às 8 e meia da noite').hora, '20:30');
    assert.equal(w('meio dia').hora, '12:00');
    assert.equal(w('comprar 2 pães').hora, null); // número solto não é hora
  });
});

describe('agenda', () => {
  test('tarefas, tarefa diária volta desmarcada, compromissos com repetição', () => {
    const a = createAgenda(tmp());
    a.addTarefa({ texto: 'Comprar café' });
    const d = a.addTarefa({ texto: 'Conferir cobranças', diaria: true });
    assert.equal(a.pendentes(T).length, 2);
    assert.ok(a.concluirTarefa({ texto: 'comprar cafe', today: T }));
    a.concluirTarefa({ id: d.id, today: T });
    assert.equal(a.pendentes(T).length, 0);
    assert.equal(a.pendentes('2026-11-28').length, 1); // a diária volta no dia seguinte
    a.addCompromisso({ titulo: 'Academia', data: '2026-11-23', hora: '07:00', repeticao: 'dias_uteis' });
    a.addCompromisso({ titulo: 'Reunião', data: T, hora: '10:00' });
    assert.deepEqual(a.compromissosDoDia(T).map((c) => c.titulo), ['Academia', 'Reunião']);
    assert.equal(a.compromissosDoDia('2026-11-28').length, 0); // sábado
    assert.throws(() => a.addCompromisso({ titulo: 'x', data: '27/11', hora: null }), /Data/);
  });
  test('persiste em arquivo', () => {
    const dir = tmp();
    createAgenda(dir).addTarefa({ texto: 'Persistir' });
    assert.equal(createAgenda(dir).pendentes(T)[0].texto, 'Persistir');
  });
});

describe('pastas, links e músicas', () => {
  const home = tmp();
  mkdirSync(join(home, 'Downloads'));
  mkdirSync(join(home, 'OneDrive', 'Documents'), { recursive: true });
  const trabalho = join(home, 'Trabalho');
  mkdirSync(trabalho);
  const cfg = { home, pastas: { trabalho, sumida: join(home, 'nao-existe') } };

  test('resolve pastas conhecidas (inclusive OneDrive) e apelidos', () => {
    assert.equal(resolveFolder('downloads', cfg), join(home, 'Downloads'));
    assert.equal(resolveFolder('documentos', cfg), join(home, 'OneDrive', 'Documents'));
    assert.equal(resolveFolder('trabalho', cfg), trabalho);
    assert.equal(resolveFolder('sumida', cfg), null);
    assert.equal(resolveFolder('../../etc', cfg), null);
  });

  test('só abre http(s) e spotify, sem shell', async () => {
    assert.equal(isSafeUrl('https://youtube.com'), true);
    assert.equal(isSafeUrl('spotify:search:samba'), true);
    assert.equal(isSafeUrl('file:///etc/passwd'), false);
    assert.equal(isSafeUrl('javascript:alert(1)'), false);
    const calls = [];
    const sys = createSystem({ platform: 'win32', logger: quiet, spawnImpl: (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { on() {}, unref() {} }; } });
    await sys.openUrl('https://youtube.com');
    await sys.openFolder(trabalho);
    await assert.rejects(sys.openUrl('file:///c:/windows'), /não permitido/);
    assert.deepEqual(calls.map((c) => [c.cmd, c.args[0], c.opts.shell]), [['explorer.exe', 'https://youtube.com', false], ['explorer.exe', trabalho, false]]);
  });

  test('biblioteca de músicas por nome', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'Rock'));
    writeFileSync(join(dir, 'Rock', 'Legião Urbana - Tempo Perdido.mp3'), 'x');
    writeFileSync(join(dir, 'Samba - Zeca.m4a'), 'x');
    writeFileSync(join(dir, 'notas.txt'), 'x');
    const lib = createMusicLibrary(dir);
    assert.equal(lib.count(), 2);
    assert.equal(lib.pick('legiao')[0].title, 'Legião Urbana - Tempo Perdido');
    assert.equal(lib.pick('rock').length, 1); // nome da pasta também conta
    assert.equal(lib.pick('').length, 2);
    assert.equal(lib.pick('forró').length, 0);
  });
});

function makeBrain({ musicDir = '', llm = null, regua = null } = {}) {
  const home = tmp();
  mkdirSync(join(home, 'Downloads'));
  const config = { ...loadConfig({}), home, nome: 'Nano', pastas: {}, musicaDir: musicDir };
  const agenda = createAgenda(tmp());
  const opened = [];
  const system = { openFolder: async (p) => opened.push(p), openUrl: async (u) => opened.push(u) };
  const brain = createBrain({ config, agenda, music: createMusicLibrary(musicDir), system, regua: regua || { enabled: false }, llm, logger: quiet });
  return { brain, agenda, opened, home };
}
const morning = new Date(2026, 10, 27, 8, 30); // 08:30 local

describe('cérebro do Nano', () => {
  test('bom dia → bom dia de volta, e oferece as coisas do dia', async () => {
    const { brain, agenda } = makeBrain();
    agenda.addTarefa({ texto: 'Pagar boleto' });
    const r = await brain.handle('Bom dia, Nano!', { requireWake: true, now: morning });
    assert.match(r.fala, /^Bom dia, Nano!/);
    assert.match(r.fala, /Quer que eu fale suas coisas/);
    const yes = await brain.handle('sim', { seguimento: true, now: morning });
    assert.equal(yes.intent, 'minhas_coisas');
    assert.match(yes.fala, /Pagar boleto/);
  });

  test('em escuta contínua ignora conversa sem "Nano"', async () => {
    const { brain } = makeBrain();
    assert.deepEqual(await brain.handle('bom dia pessoal', { requireWake: true, now: morning }), { ouviu: false });
    assert.deepEqual(await brain.handle('qualquer conversa', { seguimento: true, now: morning }), { ouviu: false });
  });

  test('minhas coisas: data, compromissos e tarefas', async () => {
    const { brain, agenda } = makeBrain();
    agenda.addCompromisso({ titulo: 'Reunião com cliente', data: '2026-11-27', hora: '14:30' });
    agenda.addTarefa({ texto: 'Ligar pro contador' });
    const r = await brain.handle('nano fala minhas coisas', { now: morning });
    assert.match(r.fala, /sexta-feira, 27 de novembro/);
    assert.match(r.fala, /Reunião com cliente às 14 e meia/);
    assert.match(r.fala, /Ligar pro contador/);
  });

  test('abre pasta e site', async () => {
    const { brain, opened, home } = makeBrain();
    assert.match((await brain.handle('nano abre a pasta downloads', { now: morning })).fala, /Abrindo downloads/);
    assert.equal(opened[0], join(home, 'Downloads'));
    await brain.handle('nano abre o youtube', { now: morning });
    assert.equal(opened[1], 'https://www.youtube.com');
    assert.match((await brain.handle('nano abre a pasta inexistente', { now: morning })).fala, /Não achei/);
  });

  test('música: local quando tem, senão YouTube', async () => {
    const dir = tmp();
    writeFileSync(join(dir, 'Tempo Perdido.mp3'), 'x');
    const local = makeBrain({ musicDir: dir });
    const r = await local.brain.handle('nano toca tempo perdido', { now: morning });
    assert.equal(r.acao.tipo, 'tocar');
    const online = makeBrain();
    const r2 = await online.brain.handle('nano toca Legião Urbana', { now: morning });
    assert.equal(online.opened[0], 'https://www.youtube.com/results?search_query=Legi%C3%A3o%20Urbana');
    assert.match(r2.fala, /YouTube/);
  });

  test('anota tarefa e marca compromisso pela voz', async () => {
    const { brain, agenda } = makeBrain();
    await brain.handle('Nano, anota comprar café', { now: morning });
    const r = await brain.handle('Nano, marca dentista amanhã às 3 da tarde', { now: morning });
    assert.match(r.fala, /dentista, amanhã às 15 horas/);
    assert.equal(agenda.pendentes('2026-11-27')[0].texto, 'comprar café');
    assert.equal(agenda.compromissosDoDia('2026-11-28')[0].hora, '15:00');
  });

  test('pergunta livre: Claude quando configurado, senão orienta', async () => {
    const sem = makeBrain();
    assert.match((await sem.brain.handle('nano qual a capital da França', { now: morning })).fala, /Não entendi/);
    const llm = { ask: async (q, ctx) => `Resposta para ${q} (${ctx.includes('sexta-feira') ? 'com contexto' : 'sem'})` };
    const com = makeBrain({ llm });
    assert.equal((await com.brain.handle('nano qual a capital da França', { now: morning })).fala, 'Resposta para qual a capital da franca (com contexto)');
  });

  test('cobranças via régua', async () => {
    const regua = { enabled: true, resumo: async () => 'Hoje a régua avisou 3 clientes.' };
    const { brain } = makeBrain({ regua });
    assert.equal((await brain.handle('nano como estão as cobranças', { now: morning })).fala, 'Hoje a régua avisou 3 clientes.');
  });
});

describe('integrações', () => {
  test('cliente da régua monta o resumo falado', async () => {
    const today = new Date().toISOString();
    const fetchImpl = async (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer tok');
      const body = url.endsWith('/overview')
        ? { enabled: true, whatsappMode: 'simulado', cycles: { em_cobranca: 4, renovado: 2, recarregado: 1 } }
        : { sends: [{ client_id: 'c1', channel: 'whatsapp', status: 'simulado', created_at: today }, { client_id: 'c2', channel: 'whatsapp', status: 'falhou', created_at: today }] };
      return { ok: true, json: async () => body };
    };
    const r = createReguaClient({ url: 'https://regua.x', token: 'tok' }, { fetchImpl });
    const text = await r.resumo();
    assert.match(text, /avisou 2 clientes/);
    assert.match(text, /1 envio falhou/);
    assert.match(text, /2 já renovaram/);
    assert.match(text, /simulado/);
  });

  test('Claude: pede fallback, esforço baixo e guarda o histórico sem alterar', async () => {
    const requests = [];
    const client = {
      beta: { messages: { create: async (req) => { requests.push(structuredClone(req)); return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'Paris.' }] }; } } },
    };
    const llm = createLlm({ claude: { enabled: true, model: 'claude-opus-5-5' } }, { clientFactory: () => client, logger: quiet });
    assert.equal(await llm.ask('capital da França?', 'ctx'), 'Paris.');
    await llm.ask('e da Itália?', 'ctx');
    assert.equal(requests[0].model, 'claude-opus-5-5');
    assert.equal(requests[0].fallbacks, 'default');
    assert.deepEqual(requests[0].betas, ['server-side-fallback-2026-07-01']);
    assert.equal(requests[0].output_config.effort, 'low');
    assert.equal(requests[1].messages.length, 3);
    assert.equal(requests[1].messages[1].content[0].type, 'thinking'); // bloco de raciocínio devolvido sem mudança
  });

  test('Claude recusou: responde educadamente', async () => {
    const client = { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } };
    const llm = createLlm({ claude: { enabled: true, model: 'claude-opus-5-5' } }, { clientFactory: () => client, logger: quiet });
    assert.match(await llm.ask('x', 'ctx'), /não posso ajudar/);
  });
});

describe('servidor local', () => {
  test('recusa outro Host, POST sem X-Nano e Origin de outro site', async () => {
    const { brain, agenda } = makeBrain();
    const config = { ...loadConfig({}), port: 0 };
    const server = createServer();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    config.port = port;
    const app = createApp({ config, agenda, music: createMusicLibrary(''), brain, logger: quiet });
    server.on('request', app.handler);
    const base = `http://127.0.0.1:${port}`;
    const post = (headers) => fetch(`${base}/api/comando`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ texto: 'nano que horas são' }) });
    assert.equal((await post({})).status, 403);
    assert.equal((await post({ 'X-Nano': '1', Origin: 'https://site-malicioso.com' })).status, 403);
    const ok = await post({ 'X-Nano': '1', Origin: base });
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).fala, /^São /);
    const page = await fetch(`${base}/`);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    server.close();
  });
});
