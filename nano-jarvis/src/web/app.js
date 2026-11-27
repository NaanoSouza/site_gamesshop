// Painel "Cobranças". Todo texto vindo do servidor entra por textContent (nunca innerHTML) — sem XSS.
'use strict';

const $ = (sel) => document.querySelector(sel);
const TOKEN_KEY = 'nj_admin_token';
let meta = { stages: [], skipReasonLabels: {} };

function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
function setToken(t) {
  try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* sem storage */ }
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${getToken()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { setToken(''); showLogin('Token inválido.'); throw new Error('Token inválido'); }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

// ---------- utilidades de formatação ----------
const brl = (c) => (c == null ? '-' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dateBr = (ymd) => (ymd ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '-');
const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');
const CYCLE_LABEL = { em_cobranca: 'Em cobrança', renovado: 'Renovado', recarregado: 'Recarregou', encerrado: 'Encerrado' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function table(target, headers, rows, emptyText) {
  const t = $(target);
  t.replaceChildren();
  t.append(el('thead', {}, el('tr', {}, headers.map((h) => el('th', {}, h)))));
  const body = el('tbody');
  if (!rows.length) body.append(el('tr', {}, el('td', { class: 'empty', colspan: headers.length }, emptyText)));
  for (const r of rows) body.append(el('tr', {}, r));
  t.append(body);
}

function flash(text, isError) {
  const f = $('#flash');
  f.textContent = text;
  f.classList.remove('hidden');
  f.style.color = isError ? 'var(--bad)' : '';
  clearTimeout(flash.t);
  flash.t = setTimeout(() => f.classList.add('hidden'), 7000);
}

function busy(btn, on) { if (btn) btn.disabled = on; }

// ---------- login ----------
function showLogin(msg) {
  $('#app').classList.add('hidden');
  $('#logout').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#login-error').textContent = msg || '';
}

async function enter() {
  try {
    await loadOverview();
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#logout').classList.remove('hidden');
    await Promise.all([loadSends(), loadCycles(), loadDnc(), loadTemplates()]);
  } catch (e) {
    showLogin(e.message);
  }
}

// ---------- visão geral ----------
async function loadOverview() {
  const o = await api('GET', '/api/cobrancas/overview');
  meta = o;
  $('#toggle').checked = o.enabled;
  $('#toggle-label').textContent = o.enabled ? 'Régua LIGADA' : 'Régua DESLIGADA';
  const ch = o.enabledChange;
  $('#toggle-hint').textContent =
    (o.schedule ? `Roda todo dia às ${o.schedule.time} (${o.schedule.timezone}). Próxima: ${dateTime(o.schedule.next)}.` : 'Agendador desligado.') +
    (ch ? ` Última alteração: ${dateTime(ch.at)}.` : '');

  const badges = $('#badges');
  badges.replaceChildren(
    el('span', { class: `badge ${o.whatsappMode === 'real' ? 'ok' : 'warn'}` }, o.whatsappMode === 'real' ? 'WhatsApp REAL' : 'WhatsApp SIMULADO'),
    el('span', { class: `badge ${o.dataSource === 'demo' ? 'warn' : ''}` }, `Fonte: ${o.dataSource === 'demo' ? 'dados de demonstração' : o.dataSource}`),
    el('span', { class: 'badge' }, `Preço ref.: ${brl(o.priceCents)}/proxy`),
  );

  const cost = o.costsThisMonth.reduce((s, c) => s + (c.cost_cents || 0), 0);
  const msgs = o.costsThisMonth.reduce((s, c) => s + (c.total || 0), 0);
  const k = (v, l) => el('div', { class: 'kpi' }, el('div', { class: 'v' }, v), el('div', { class: 'l' }, l));
  $('#kpis').replaceChildren(
    k(o.cycles.em_cobranca || 0, 'Em cobrança'),
    k(o.cycles.renovado || 0, 'Renovaram'),
    k(o.cycles.recarregado || 0, 'Recarregaram'),
    k(o.cycles.encerrado || 0, 'Encerrados sem renovar'),
    k(o.doNotChargeCount, 'Na lista "não cobrar"'),
    k(msgs, 'Mensagens no mês'),
    k(brl(cost), 'Custo real no mês'),
    k(brl(o.projectedWhatsappCostCents), 'Custo se o WhatsApp simulado fosse real'),
  );

  const stageSel = $('#f-stage');
  if (stageSel.options.length <= 1) for (const s of o.stages) stageSel.append(el('option', { value: s }, s));

  table(
    '#runs-table',
    ['Início', 'Dia', 'Origem', 'Resultado', 'Envios', 'Falhas', 'Não enviados'],
    o.lastRuns.map((r) => [
      el('td', {}, dateTime(r.started_at)),
      el('td', {}, dateBr(r.run_date)),
      el('td', {}, r.trigger),
      el('td', { class: `st ${r.error ? 'st-falhou' : ''}` }, r.error ? `erro: ${r.error}` : r.summary?.status === 'regua_desligada' ? 'régua desligada' : r.summary?.status || '-'),
      el('td', { class: 'num' }, r.summary?.sent ?? 0),
      el('td', { class: 'num' }, r.summary?.failed ?? 0),
      el('td', {}, Object.entries(r.summary?.skipped || {}).map(([k2, v]) => `${o.skipReasonLabels[k2] || k2}: ${v}`).join(' · ') || '-'),
    ]),
    'Nenhuma execução ainda.',
  );
}

// ---------- histórico ----------
async function loadSends() {
  const p = new URLSearchParams({ limit: '200' });
  if ($('#f-stage').value) p.set('stage', $('#f-stage').value);
  if ($('#f-status').value) p.set('status', $('#f-status').value);
  if ($('#f-client').value.trim()) p.set('clientId', $('#f-client').value.trim());
  const { sends } = await api('GET', `/api/cobrancas/sends?${p}`);
  table(
    '#sends-table',
    ['Quando', 'Cliente', 'Vencimento', 'Etapa', 'Canal', 'Status', 'Tent.', 'Mensagem', ''],
    sends.map((s) => [
      el('td', {}, dateTime(s.created_at)),
      el('td', {}, s.client_id),
      el('td', {}, dateBr(s.due_date)),
      el('td', {}, s.stage),
      el('td', {}, s.channel + (s.simulated ? ' (sim.)' : '')),
      el('td', { class: `st st-${s.status}`, title: s.error || '' }, s.status + (s.error ? ' ⚠' : '')),
      el('td', { class: 'num' }, s.attempts),
      el('td', { class: 'msg' }, s.message),
      el('td', {}, ['falhou', 'incerto'].includes(s.status) ? el('button', { type: 'button', class: 'secondary', onclick: (ev) => resend(s, ev.currentTarget) }, 'Reenviar') : ''),
    ]),
    'Nenhum envio registrado.',
  );
}

async function resend(s, btn) {
  const warn = s.status === 'incerto'
    ? 'Este envio ficou INCERTO: pode ser que o cliente já tenha recebido. Reenviar mesmo assim?'
    : `Reenviar a etapa ${s.stage} (${s.channel}) para o cliente ${s.client_id}?`;
  if (!confirm(warn)) return;
  busy(btn, true);
  try {
    const r = await api('POST', '/api/cobrancas/resend', { id: s.id });
    flash(`Reenviado: ${r.status}.`);
    await loadSends();
  } catch (e) {
    flash(e.message, true);
    busy(btn, false);
  }
}

// ---------- vencimentos (ciclos) ----------
async function loadCycles() {
  const st = $('#c-status').value;
  const { cycles } = await api('GET', `/api/cobrancas/cycles${st ? `?status=${encodeURIComponent(st)}` : ''}`);
  table(
    '#cycles-table',
    ['Cliente', 'Vencimento', 'Proxies', 'Portas', 'Necessário', 'Saldo', 'Última etapa', 'Situação', 'Atualizado'],
    cycles.map((c) => [
      el('td', {}, `${c.client_name || ''} (${c.client_id})`),
      el('td', {}, dateBr(c.due_date)),
      el('td', { class: 'num' }, c.quantity),
      el('td', {}, c.ports.join(', ')),
      el('td', { class: 'num' }, brl(c.required_cents)),
      el('td', { class: 'num' }, brl(c.balance_cents)),
      el('td', {}, c.last_stage || '-'),
      el('td', { class: `st st-${c.status}` }, CYCLE_LABEL[c.status] || c.status),
      el('td', {}, dateTime(c.updated_at)),
    ]),
    'Nenhum vencimento cobrado ainda.',
  );
}

// ---------- não cobrar ----------
async function loadDnc() {
  const { list, log } = await api('GET', '/api/cobrancas/nao-cobrar');
  table(
    '#dnc-table',
    ['Cliente', 'Motivo', 'Origem', 'Desde', ''],
    list.map((d) => [
      el('td', {}, `${d.client_name || ''} (${d.client_id})`),
      el('td', {}, d.reason),
      el('td', {}, d.origin === 'opt_out' ? 'Cliente pediu (opt-out)' : 'Admin'),
      el('td', {}, dateTime(d.created_at)),
      el('td', {}, el('button', { type: 'button', class: 'secondary', onclick: (ev) => backToCharge(d, ev.currentTarget) }, 'Voltar a cobrar')),
    ]),
    'Ninguém na lista.',
  );
  table(
    '#dnc-log',
    ['Quando', 'Cliente', 'Ação', 'Motivo', 'Por'],
    log.map((l) => [
      el('td', {}, dateTime(l.at)),
      el('td', {}, l.client_id),
      el('td', {}, l.action === 'nao_cobrar' ? 'Não cobrar' : 'Voltar a cobrar'),
      el('td', {}, l.reason || '-'),
      el('td', {}, l.actor || '-'),
    ]),
    'Sem alterações.',
  );
}

async function backToCharge(d, btn) {
  if (d.origin === 'opt_out' && !confirm('Este cliente pediu para sair dos lembretes (LGPD). Voltar a cobrar mesmo assim?')) return;
  if (d.origin !== 'opt_out' && !confirm(`Voltar a cobrar ${d.client_name || d.client_id}?`)) return;
  busy(btn, true);
  try {
    await api('DELETE', `/api/cobrancas/nao-cobrar?clientId=${encodeURIComponent(d.client_id)}`);
    flash(`${d.client_name || d.client_id} voltou a ser cobrado.`);
    await Promise.all([loadDnc(), loadOverview()]);
  } catch (e) {
    flash(e.message, true);
    busy(btn, false);
  }
}

let searchTimer;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = $('#dnc-search').value.trim();
    const sel = $('#dnc-client');
    if (q.length < 2) return;
    try {
      const { clients } = await api('GET', `/api/clientes?q=${encodeURIComponent(q)}`);
      sel.replaceChildren(el('option', { value: '' }, clients.length ? 'Selecione o cliente' : 'Nenhum cliente encontrado'));
      for (const c of clients) {
        const tags = [c.isAdmin && 'admin', c.isTest && 'teste', c.doNotCharge && 'já na lista'].filter(Boolean).join(', ');
        sel.append(el('option', { value: c.id, disabled: c.doNotCharge }, `${c.name} — ${c.email || 's/ e-mail'} (${c.id})${tags ? ` [${tags}]` : ''}`));
      }
    } catch (e) {
      flash(e.message, true);
    }
  }, 300);
}

async function onDncSubmit(ev) {
  ev.preventDefault();
  const clientId = $('#dnc-client').value;
  const reason = $('#dnc-reason').value.trim();
  if (!clientId || !reason) return flash('Escolha o cliente e informe o motivo.', true);
  const btn = ev.submitter;
  busy(btn, true);
  try {
    await api('POST', '/api/cobrancas/nao-cobrar', { clientId, reason });
    flash('Cliente marcado como "não cobrar".');
    $('#dnc-reason').value = '';
    $('#dnc-search').value = '';
    $('#dnc-client').replaceChildren(el('option', { value: '' }, 'Selecione o cliente'));
    await Promise.all([loadDnc(), loadOverview()]);
  } catch (e) {
    flash(e.message, true);
  } finally {
    busy(btn, false);
  }
}

// ---------- textos ----------
async function loadTemplates() {
  const t = await api('GET', '/api/cobrancas/templates');
  $('#tpl-vars').textContent = t.variables.map((v) => `{{${v}}}`).join(' ');
  const form = $('#tpl-form');
  form.replaceChildren(
    ...t.stages.map((s) => el('div', { class: 'tpl-row' }, el('label', {}, `Etapa ${s}`, el('textarea', { name: s, maxlength: 1024 }, t.templates[s])))),
  );
}

async function saveTemplates(ev) {
  const templates = {};
  for (const ta of $('#tpl-form').querySelectorAll('textarea')) templates[ta.name] = ta.value;
  const btn = ev.currentTarget;
  busy(btn, true);
  try {
    await api('PUT', '/api/cobrancas/templates', { templates });
    flash('Textos salvos.');
  } catch (e) {
    flash(e.message, true);
  } finally {
    busy(btn, false);
  }
}

async function resetTemplates(ev) {
  if (!confirm('Restaurar todos os textos para o padrão?')) return;
  const btn = ev.currentTarget;
  busy(btn, true);
  try {
    await api('POST', '/api/cobrancas/templates/reset', {});
    await loadTemplates();
    flash('Textos restaurados.');
  } catch (e) {
    flash(e.message, true);
  } finally {
    busy(btn, false);
  }
}

// ---------- ações ----------
async function onToggle(ev) {
  const box = ev.currentTarget;
  const enabled = box.checked;
  if (!confirm(enabled ? 'Ligar a régua? Ela passa a enviar lembretes todos os dias.' : 'Desligar a régua? Nenhum lembrete será enviado até ligar de novo.')) {
    box.checked = !enabled;
    return;
  }
  try {
    await api('POST', '/api/cobrancas/toggle', { enabled });
    flash(enabled ? 'Régua ligada.' : 'Régua desligada.');
    await loadOverview();
  } catch (e) {
    box.checked = !enabled;
    flash(e.message, true);
  }
}

async function onPreview(ev) {
  const btn = ev.currentTarget;
  busy(btn, true);
  try {
    const date = $('#preview-date').value || undefined;
    const s = await api('POST', '/api/cobrancas/preview', { date });
    $('#preview-title').textContent = `Prévia de ${dateBr(s.runDate)} — nada foi enviado`;
    table(
      '#preview-table',
      ['Cliente', 'Vencimento', 'Dias', 'Proxies', 'Necessário', 'Saldo', 'Decisão', 'Mensagem'],
      s.decisions.map((d) => [
        el('td', {}, `${d.clientName || ''} (${d.clientId})`),
        el('td', {}, dateBr(d.dueDate)),
        el('td', { class: 'num' }, d.daysUntilDue),
        el('td', { class: 'num' }, d.quantity),
        el('td', { class: 'num' }, brl(d.requiredCents)),
        el('td', { class: 'num' }, brl(d.balanceCents)),
        el('td', { class: `st ${d.action === 'send' ? 'st-enviado' : ''}` }, d.action === 'send' ? `Envia ${d.stage}` : meta.skipReasonLabels[d.reason] || d.reason),
        el('td', { class: 'msg' }, d.channels.map((c) => (c.text ? `[${c.channel}] ${c.text}` : `[${c.channel}] ${c.result}`)).join('\n')),
      ]),
      'Nenhum proxy vencendo na janela de 7 dias.',
    );
    document.querySelector('[data-panel="preview"]').classList.remove('hidden');
  } catch (e) {
    flash(e.message, true);
  } finally {
    busy(btn, false);
  }
}

async function onRun(ev) {
  if (!confirm('Rodar a régua agora? Envia as etapas de hoje que ainda não saíram (nada é repetido).')) return;
  const btn = ev.currentTarget;
  busy(btn, true);
  try {
    const s = await api('POST', '/api/cobrancas/run', {});
    flash(s.status === 'regua_desligada' ? 'A régua está desligada: nada foi enviado.' : `Execução concluída: ${s.sent} envio(s), ${s.failed} falha(s).`);
    await Promise.all([loadOverview(), loadSends(), loadCycles()]);
  } catch (e) {
    flash(e.message, true);
  } finally {
    busy(btn, false);
  }
}

function switchTab(name) {
  for (const b of document.querySelectorAll('.subtabs button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const p of document.querySelectorAll('[data-panel]')) {
    if (p.dataset.panel === 'preview') continue;
    p.classList.toggle('hidden', p.dataset.panel !== name);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#login-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    setToken($('#token').value.trim());
    $('#token').value = '';
    enter();
  });
  $('#logout').addEventListener('click', () => { setToken(''); showLogin(''); });
  $('#toggle').addEventListener('change', onToggle);
  $('#btn-preview').addEventListener('click', onPreview);
  $('#btn-run').addEventListener('click', onRun);
  $('#close-preview').addEventListener('click', () => document.querySelector('[data-panel="preview"]').classList.add('hidden'));
  $('#f-apply').addEventListener('click', () => loadSends().catch((e) => flash(e.message, true)));
  $('#c-status').addEventListener('change', () => loadCycles().catch((e) => flash(e.message, true)));
  $('#dnc-search').addEventListener('input', onSearch);
  $('#dnc-form').addEventListener('submit', onDncSubmit);
  $('#tpl-save').addEventListener('click', saveTemplates);
  $('#tpl-reset').addEventListener('click', resetTemplates);
  for (const b of document.querySelectorAll('.subtabs button')) b.addEventListener('click', () => switchTab(b.dataset.tab));
  if (getToken()) enter(); else showLogin('');
});
