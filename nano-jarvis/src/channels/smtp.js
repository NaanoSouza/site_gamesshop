// Cliente SMTP mínimo, sem dependências (node:net / node:tls). Suporta TLS direto (porta 465)
// e STARTTLS (porta 587), com AUTH PLAIN. Sem TLS só é permitido para localhost (testes).
import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

const TIMEOUT_MS = 20_000;

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
/** Cabeçalho com acentos: =?UTF-8?B?...?= */
export const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
const cleanHeader = (s) => String(s).replace(/[\r\n]+/g, ' ').trim();

export function buildMessage({ from, to, subject, text, date = new Date() }) {
  const domain = String(from).split('@').pop().replace(/[>\s]/g, '') || 'localhost';
  return [
    `From: ${cleanHeader(from)}`,
    `To: ${cleanHeader(to)}`,
    `Subject: ${encodeHeader(cleanHeader(subject))}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)),
  ].join('\r\n');
}

/** Lê respostas SMTP (multilinha "250-...", final "250 ..."). */
function reader(socket) {
  let buf = '';
  const waiters = [];
  let failure = null;
  const flush = () => {
    while (waiters.length) {
      const lines = buf.split('\r\n');
      let end = -1;
      for (let i = 0; i < lines.length - 1; i++) if (/^\d{3} /.test(lines[i])) { end = i; break; }
      if (end === -1) break;
      const chunk = lines.slice(0, end + 1);
      buf = lines.slice(end + 1).join('\r\n');
      waiters.shift().resolve({ code: Number(chunk[end].slice(0, 3)), text: chunk.join('\n') });
    }
  };
  const onData = (d) => { buf += d.toString('utf8'); flush(); };
  const onErr = (e) => { failure = e; while (waiters.length) waiters.shift().reject(e); };
  socket.on('data', onData);
  socket.on('error', onErr);
  socket.on('close', () => onErr(new Error('conexão SMTP fechada')));
  return {
    next: () => new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      waiters.push({ resolve, reject });
      flush();
    }),
    detach: () => { socket.off('data', onData); socket.off('error', onErr); socket.removeAllListeners('close'); },
  };
}

export async function sendMail(opts, message) {
  const { host, port, secure, user, pass, from, to, allowInsecure } = opts;
  const local = /^(127\.0\.0\.1|localhost|::1)$/.test(host);
  let socket = await new Promise((resolve, reject) => {
    const s = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    s.once(secure ? 'secureConnect' : 'connect', () => resolve(s));
    s.once('error', reject);
  });
  socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('SMTP não respondeu a tempo (timeout)')));
  let r = reader(socket);
  const cmd = async (line, expect) => {
    if (line !== null) socket.write(`${line}\r\n`);
    const res = await r.next();
    if (!expect.includes(res.code)) {
      const shown = line && line.startsWith('AUTH') ? 'AUTH ***' : line;
      throw new Error(`SMTP recusou ${shown ?? 'conexão'}: ${res.text.slice(0, 200)}`);
    }
    return res;
  };
  try {
    await cmd(null, [220]);
    let ehlo = await cmd('EHLO nano-jarvis', [250]);
    if (!secure) {
      if (/STARTTLS/i.test(ehlo.text)) {
        await cmd('STARTTLS', [220]);
        r.detach();
        socket = await new Promise((resolve, reject) => {
          const s = tls.connect({ socket, servername: host }, () => resolve(s));
          s.once('error', reject);
        });
        socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('SMTP não respondeu a tempo (timeout)')));
        r = reader(socket);
        ehlo = await cmd('EHLO nano-jarvis', [250]);
      } else if (!(local && allowInsecure)) {
        throw new Error('servidor SMTP sem TLS: recusado para não enviar a senha em texto aberto');
      }
    }
    if (user) await cmd(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`, [235]);
    await cmd(`MAIL FROM:<${String(from).replace(/^.*<|>.*$/g, '')}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    const body = message.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const res = await cmd(`${body}\r\n.`, [250]);
    socket.write('QUIT\r\n');
    return res.text;
  } finally {
    socket.end();
  }
}
