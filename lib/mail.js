'use strict';
/* BATCAVE OS // real IMAP/SMTP mail bridge (QQ Mail / NetEase 163 & 126) */
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');

const PROVIDERS = {
  qq: {
    id: 'qq', name: 'QQ邮箱', domains: ['qq.com', 'foxmail.com', 'vip.qq.com'],
    imap: { host: 'imap.qq.com', port: 993 }, smtp: { host: 'smtp.qq.com', port: 465 },
    hint: 'QQ邮箱网页版 → 设置 → 账号 → 开启 IMAP/SMTP 服务 → 生成授权码。登录密码填授权码，不是 QQ 密码。'
  },
  '163': {
    id: '163', name: '网易163邮箱', domains: ['163.com'],
    imap: { host: 'imap.163.com', port: 993 }, smtp: { host: 'smtp.163.com', port: 465 },
    hint: '163邮箱网页版 → 设置 → POP3/SMTP/IMAP → 开启 IMAP/SMTP → 新增客户端授权密码。登录密码填授权码。',
    neteaseId: true
  },
  '126': {
    id: '126', name: '网易126邮箱', domains: ['126.com'],
    imap: { host: 'imap.126.com', port: 993 }, smtp: { host: 'smtp.126.com', port: 465 },
    hint: '126邮箱网页版 → 设置 → POP3/SMTP/IMAP → 开启 IMAP/SMTP → 新增客户端授权密码。登录密码填授权码。',
    neteaseId: true
  },
  yeah: {
    id: 'yeah', name: '网易yeah邮箱', domains: ['yeah.net'],
    imap: { host: 'imap.yeah.net', port: 993 }, smtp: { host: 'smtp.yeah.net', port: 465 },
    hint: 'yeah邮箱网页版 → 设置 → 开启 IMAP/SMTP → 获取客户端授权密码。登录密码填授权码。',
    neteaseId: true
  }
};

const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastUsed > SESSION_TTL) sessions.delete(id);
}
setInterval(cleanup, 5 * 60 * 1000).unref();

function providers() {
  return Object.values(PROVIDERS).map(p => ({
    id: p.id, name: p.name, domains: p.domains,
    imap: p.imap.host + ':' + p.imap.port,
    smtp: p.smtp.host + ':' + p.smtp.port,
    hint: p.hint
  }));
}

function detectProvider(email) {
  const domain = String(email || '').split('@')[1] || '';
  return Object.values(PROVIDERS).find(p => p.domains.includes(domain.toLowerCase())) || null;
}

function q(s) {
  return '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

class Imap {
  constructor(host, port, timeoutMs = 25000) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.buf = Buffer.alloc(0);
    this.sock = null;
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { try { this.sock && this.sock.destroy(); } catch {} reject(err); }
        else resolve();
      };
      const timer = setTimeout(() => done(new Error('IMAP 连接超时（' + this.host + '）')), this.timeoutMs);
      try {
        this.sock = tls.connect({ host: this.host, port: this.port, servername: this.host, rejectUnauthorized: true }, () => {
          this.connected = true;
          this.readLine().then(greeting => {
            if (!/^\* (OK|PREAUTH)/i.test(greeting)) return done(new Error('IMAP 服务器拒绝连接：' + greeting.slice(0, 160)));
            done();
          }).catch(done);
        });
        this.sock.on('error', e => done(new Error('IMAP 网络错误：' + e.message)));
        this.sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); });
        this.sock.on('close', () => { this.connected = false; });
        this.sock.setTimeout(this.timeoutMs, () => this.sock.destroy(new Error('IMAP 读写超时')));
      } catch (e) { done(e); }
    });
  }

  _wait(n) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (this.buf.length >= n) return resolve();
        if (!this.connected && this.sock && this.sock.destroyed) return reject(new Error('IMAP 连接已关闭'));
        if (Date.now() - started > this.timeoutMs) return reject(new Error('IMAP 响应超时'));
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  async readLine() {
    for (;;) {
      const i = this.buf.indexOf('\r\n');
      if (i >= 0) {
        const line = this.buf.slice(0, i).toString('utf8');
        this.buf = this.buf.slice(i + 2);
        return line;
      }
      await this._wait(this.buf.length + 1);
    }
  }

  async command(tag, text) {
    if (!this.connected) throw new Error('IMAP 未连接');
    this.buf = Buffer.alloc(0);
    this.sock.write(tag + ' ' + text + '\r\n');
    let out = '';
    const literals = [];
    const started = Date.now();
    for (;;) {
      if (Date.now() - started > this.timeoutMs) throw new Error('IMAP 命令超时：' + tag);
      const i = this.buf.indexOf('\r\n');
      if (i < 0) { await this._wait(this.buf.length + 1); continue; }
      const line = this.buf.slice(0, i).toString('utf8');
      const lm = line.match(/\{(\d+)\}$/);
      if (lm) {
        const n = Number(lm[1]);
        const need = i + 2 + n;
        if (this.buf.length < need) { await this._wait(need); continue; }
        const lit = this.buf.slice(i + 2, need);
        literals.push(lit);
        out += line + '\r\n' + lit.toString('utf8');
        this.buf = this.buf.slice(need);
        continue;
      }
      this.buf = this.buf.slice(i + 2);
      out += line + '\r\n';
      if (line.startsWith(tag + ' ')) {
        if (!new RegExp('^' + tag + ' (OK|PREAUTH)\\b', 'i').test(line)) {
          throw new Error('IMAP ' + tag + ' 失败：' + line.slice(0, 240));
        }
        return { text: out, literals };
      }
    }
  }

  async login(user, pass, provider) {
    await this.command('A1', 'LOGIN ' + q(user) + ' ' + q(pass));
    if (provider && provider.neteaseId) {
      try { await this.command('A2', 'ID ("name" "BATCAVE" "version" "1.0" "vendor" "BATCAVE")'); } catch { }
    }
  }

  async folders() {
    const r = await this.command('A3', 'LIST "" "*"');
    const out = [];
    for (const line of r.text.split(/\r?\n/)) {
      const m = line.match(/^\* LIST \(([^)]*)\) "([^"]*)" (.+)$/);
      if (!m) continue;
      let name = m[3].trim();
      if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      if (!name) continue;
      out.push({ name, display: decodeImapUtf7(name), flags: m[1] });
    }
    out.sort((a, b) => (a.name.toUpperCase() === 'INBOX' ? -1 : b.name.toUpperCase() === 'INBOX' ? 1 : a.display.localeCompare(b.display, 'zh')));
    return out;
  }

  async select(folder) {
    const r = await this.command('A4', 'SELECT ' + q(folder || 'INBOX'));
    const m = r.text.match(/^\* (\d+) EXISTS/m);
    return m ? Number(m[1]) : 0;
  }

  async list(folder, limit) {
    limit = Math.max(1, Math.min(100, Number(limit) || 30));
    await this.select(folder);
    const r = await this.command('A5', 'UID SEARCH ALL');
    const m = r.text.match(/^\* SEARCH([\d ]*)/m);
    const uids = m ? m[1].trim().split(/\s+/).filter(Boolean).map(Number) : [];
    if (!uids.length) return [];
    const take = uids.slice(-limit);
    const f = await this.command('A6', 'UID FETCH ' + take.join(',') + ' (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])');
    const blocks = f.text.split(/^\* \d+ FETCH \(/m).slice(1);
    const items = [];
    blocks.forEach((block, i) => {
      const uid = (block.match(/\bUID (\d+)/) || [])[1];
      if (!uid) return;
      const flags = (block.match(/FLAGS \(([^)]*)\)/) || [])[1] || '';
      const internal = (block.match(/INTERNALDATE "([^"]*)"/) || [])[1] || '';
      const size = Number((block.match(/RFC822\.SIZE (\d+)/) || [])[1] || 0);
      let hdr = '';
      const lit = f.literals[i];
      if (lit) hdr = lit.toString('utf8');
      else {
        const hm = block.match(/BODY\[HEADER\.FIELDS[^\]]*\]\s*\r?\n([\s\S]*?)\r?\n\)/);
        if (hm) hdr = hm[1];
      }
      const h = parseHeaders(Buffer.from(hdr, 'utf8'));
      items.push({
        uid: Number(uid),
        flags,
        seen: /\\Seen/i.test(flags),
        date: parseMailDate(h.date[0] || internal),
        size,
        from: decodeWords(h.from[0] || ''),
        to: decodeWords(h.to[0] || ''),
        subject: decodeWords(h.subject[0] || '') || '(无主题)',
        messageId: (h['message-id'] || [''])[0]
      });
    });
    items.sort((a, b) => b.uid - a.uid);
    return items;
  }

  async read(folder, uid) {
    await this.select(folder);
    const r = await this.command('A7', 'UID FETCH ' + Number(uid) + ' (UID BODY.PEEK[])');
    if (!r.literals.length) throw new Error('该邮件没有可读取的内容');
    const raw = r.literals.reduce((a, b) => (b.length > a.length ? b : a), Buffer.alloc(0));
    return parseMime(raw);
  }

  close() {
    try { this.sock && this.sock.end(); } catch {}
    try { this.sock && this.sock.destroy(); } catch {}
  }
}

function decodeImapUtf7(str) {
  return String(str || '').replace(/&([A-Za-z0-9+,]*)-/g, (m, b64) => {
    if (!b64) return '&';
    try {
      const buf = Buffer.from(b64.replace(/,/g, '/'), 'base64');
      return new TextDecoder('utf-16be').decode(buf);
    } catch { return m; }
  });
}

function parseHeaders(buf) {
  const text = buf.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  const h = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (!h[k]) h[k] = [];
    h[k].push(v);
  }
  return h;
}

function decodeWords(s) {
  if (!s) return '';
  return String(s).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, charset, enc, data) => {
    try {
      let buf;
      if (enc.toUpperCase() === 'B') buf = Buffer.from(data, 'base64');
      else {
        const qp = data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)));
        buf = Buffer.from(qp, 'binary');
      }
      return decodeCharset(buf, charset);
    } catch { return m; }
  });
}

function charsetName(cs) {
  const s = String(cs || 'utf-8').toLowerCase().replace(/^["']|["']$/g, '');
  if (s === 'gb2312' || s === 'gbk') return 'gb18030';
  if (s === 'utf8') return 'utf-8';
  return s;
}

function decodeCharset(buf, cs) {
  const name = charsetName(cs);
  try { return new TextDecoder(name).decode(buf); }
  catch {
    try { return new TextDecoder('utf-8').decode(buf); }
    catch { return buf.toString('latin1'); }
  }
}

function qpDecode(buf) {
  const s = buf.toString('binary');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (c === '=' && (s.slice(i + 1, i + 3) === '\r\n' || s.slice(i + 1, i + 2) === '\n')) {
      if (s.slice(i + 1, i + 3) === '\r\n') i += 2; else i += 1;
    } else out.push(c.charCodeAt(0));
  }
  return Buffer.from(out);
}

function parseMailDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return isNaN(d.getTime()) ? String(s) : d.toISOString();
}

function splitHeadersBody(buf) {
  const i1 = buf.indexOf('\r\n\r\n');
  const i2 = buf.indexOf('\n\n');
  let i = -1, sep = 4;
  if (i1 >= 0 && (i2 < 0 || i1 < i2)) { i = i1; sep = 4; }
  else if (i2 >= 0) { i = i2; sep = 2; }
  if (i < 0) return { header: buf, body: Buffer.alloc(0) };
  return { header: buf.slice(0, i), body: buf.slice(i + sep) };
}

function decodePartBody(body, enc) {
  enc = String(enc || '').toLowerCase();
  if (enc === 'base64') return Buffer.from(body.toString('binary').replace(/\s+/g, ''), 'base64');
  if (enc === 'quoted-printable') return qpDecode(body);
  return body;
}

function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(iframe|object|embed|link|meta|base|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed|link|meta|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '$1="#"');
}

function parseMime(raw, depth = 0) {
  if (depth > 6) return { headers: {}, text: '', html: '', attachments: [] };
  const { header, body } = splitHeadersBody(raw);
  const headers = parseHeaders(header);
  const ct = (headers['content-type'] || ['text/plain'])[0] || 'text/plain';
  const ctm = ct.match(/^([^;\s]+)/);
  const type = (ctm ? ctm[1] : 'text/plain').toLowerCase();
  const params = {};
  for (const m of ct.matchAll(/;\s*([^=;]+)=("([^"]*)"|[^;]+)/g)) {
    params[m[1].trim().toLowerCase()] = (m[3] !== undefined ? m[3] : m[2]).trim();
  }
  const disp = (headers['content-disposition'] || [''])[0] || '';
  const filenameM = disp.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i) || ct.match(/name=("([^"]*)"|[^;]+)/i);
  const filename = filenameM ? decodeWords((filenameM[2] || filenameM[1] || '').replace(/^"|"$/g, '')) : '';
  const isAttachment = /attachment/i.test(disp) || (filename && !/^text\/(plain|html)$/i.test(type));

  if (type.startsWith('multipart/') && params.boundary) {
    const boundary = Buffer.from('--' + params.boundary);
    let pos = body.indexOf(boundary);
    let text = '', html = '', attachments = [];
    let guard = 0;
    while (pos >= 0 && guard++ < 60) {
      let start = pos + boundary.length;
      if (body.slice(start, start + 2).toString() === '--') break;
      if (body.slice(start, start + 2).toString() === '\r\n') start += 2;
      else if (body.slice(start, start + 1).toString() === '\n') start += 1;
      const next = body.indexOf(boundary, start);
      if (next < 0) break;
      let end = next;
      if (body.slice(end - 2, end).toString() === '\r\n') end -= 2;
      else if (body.slice(end - 1, end).toString() === '\n') end -= 1;
      const part = parseMime(body.slice(start, end), depth + 1);
      if (part.text && !text) text = part.text;
      if (part.html && !html) html = part.html;
      attachments = attachments.concat(part.attachments || []);
      pos = next;
    }
    return { headers, text, html, attachments };
  }

  const decoded = decodePartBody(body, (headers['content-transfer-encoding'] || [''])[0]);
  if (isAttachment) {
    return { headers, text: '', html: '', attachments: [{ filename: filename || '附件', type, size: decoded.length }] };
  }
  if (type === 'text/html') {
    return { headers, text: '', html: sanitizeHtml(decodeCharset(decoded, params.charset)), attachments: [] };
  }
  if (type === 'text/plain') {
    return { headers, text: decodeCharset(decoded, params.charset), html: '', attachments: [] };
  }
  return { headers, text: '', html: '', attachments: [] };
}

class Smtp {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.buf = '';
    this.sock = null;
    this.connected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => done(new Error('SMTP 连接超时（' + this.host + '）')), 25000);
      const done = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) { try { this.sock && this.sock.destroy(); } catch {} reject(err); }
        else resolve();
      };
      try {
        this.sock = tls.connect({ host: this.host, port: this.port, servername: this.host, rejectUnauthorized: true }, () => {
          this.connected = true;
          this.reply().then(r => {
            if (r.code !== 220) return done(new Error('SMTP 服务器拒绝连接：' + r.text));
            done();
          }).catch(done);
        });
        this.sock.on('error', e => done(new Error('SMTP 网络错误：' + e.message)));
        this.sock.on('data', d => { this.buf += d.toString('utf8'); });
        this.sock.on('close', () => { this.connected = false; });
        this.sock.setTimeout(25000, () => this.sock.destroy(new Error('SMTP 读写超时')));
      } catch (e) { done(e); }
    });
  }

  _waitLine() {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (this.buf.includes('\r\n')) return resolve();
        if (!this.connected && this.sock && this.sock.destroyed) return reject(new Error('SMTP 连接已关闭'));
        if (Date.now() - started > 25000) return reject(new Error('SMTP 响应超时'));
        setTimeout(tick, 25);
      };
      tick();
    });
  }

  async reply() {
    for (;;) {
      await this._waitLine();
      const i = this.buf.indexOf('\r\n');
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const code = Number(line.slice(0, 3));
      const cont = line[3] === '-';
      let text = line + '\n';
      while (cont) {
        await this._waitLine();
        const j = this.buf.indexOf('\r\n');
        const l2 = this.buf.slice(0, j);
        this.buf = this.buf.slice(j + 2);
        text += l2 + '\n';
        if (/^\d{3} /.test(l2)) break;
      }
      return { code, text };
    }
  }

  async cmd(line, expect) {
    this.sock.write(line + '\r\n');
    const r = await this.reply();
    if (expect && !expect.includes(r.code)) throw new Error('SMTP 失败（' + r.code + '）：' + r.text.slice(0, 240));
    return r;
  }

  async send({ from, to, subject, text, html }) {
    await this.connect();
    await this.cmd('EHLO batcave.local', [250]);
    const a1 = await this.cmd('AUTH LOGIN', [334]);
    await this.cmd(Buffer.from(from).toString('base64'), [334]);
    await this.cmd(Buffer.from(this.pass || '').toString('base64'), [235, 503]);
    await this.cmd('MAIL FROM:<' + from + '>', [250]);
    for (const addr of to) await this.cmd('RCPT TO:<' + addr + '>', [250, 251]);
    await this.cmd('DATA', [354]);
    const msg = buildMessage({ from, to, subject, text, html });
    const stuffed = msg.replace(/^\./gm, '..');
    this.sock.write(stuffed + '\r\n.\r\n');
    const r = await this.reply();
    if (r.code !== 250) throw new Error('SMTP 发送失败（' + r.code + '）：' + r.text.slice(0, 240));
    try { await this.cmd('QUIT', [221]); } catch {}
    return r;
  }

  close() { try { this.sock && this.sock.end(); } catch {} try { this.sock && this.sock.destroy(); } catch {} }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildMessage({ from, to, subject, text, html }) {
  const boundary = 'bc_' + crypto.randomBytes(12).toString('hex');
  const htmlPart = html || '<div style="white-space:pre-wrap;font-family:sans-serif">' + escapeHtml(text) + '</div>';
  const date = new Date().toUTCString().replace(/GMT$/, '+0000');
  const msgId = '<' + crypto.randomBytes(12).toString('hex') + '@' + from.split('@')[1] + '>';
  const encSubject = '=?UTF-8?B?' + Buffer.from(String(subject || ''), 'utf8').toString('base64') + '?=';
  const lines = [
    'From: ' + from,
    'To: ' + to.join(', '),
    'Subject: ' + encSubject,
    'Date: ' + date,
    'Message-ID: ' + msgId,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"'
  ];
  const body = [
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(String(text || ''), 'utf8').toString('base64'),
    '--' + boundary,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(htmlPart, 'utf8').toString('base64'),
    '--' + boundary + '--',
    ''
  ];
  return lines.join('\r\n') + '\r\n\r\n' + body.join('\r\n');
}

function normalizeEmail(s) {
  const v = String(s || '').trim();
  if (v.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)) throw new Error('邮箱地址无效：' + v.slice(0, 80));
  return v;
}

async function login({ email, password, provider: providerId }) {
  email = normalizeEmail(email);
  password = String(password || '');
  if (!password) throw new Error('请输入邮箱授权码/密码');
  if (password.length > 256) throw new Error('授权码过长');
  const provider = (providerId && PROVIDERS[providerId]) || detectProvider(email);
  if (!provider) throw new Error('暂不支持该邮箱域；当前支持 QQ、163、126、yeah.net');
  const imap = new Imap(provider.imap.host, provider.imap.port);
  try {
    await imap.connect();
    await imap.login(email, password, provider);
    const folders = await imap.folders();
    const exists = await imap.select('INBOX');
    const id = crypto.randomBytes(24).toString('hex');
    sessions.set(id, { id, email, password, provider, createdAt: Date.now(), lastUsed: Date.now() });
    return {
      ok: true, session: id, email, provider: { id: provider.id, name: provider.name, hint: provider.hint },
      folders, inboxCount: exists
    };
  } catch (e) {
    const msg = String(e.message || '');
    if (/AUTHENTICATIONFAILED|LOGIN Login error|password error|authentication failed|invalid credentials/i.test(msg)) {
      throw new Error(provider.name + ' 登录被拒绝：请先在网页版开启 IMAP/SMTP，并填写客户端授权码（不是网页登录密码）。服务商返回：' + msg.slice(0, 220));
    }
    throw e;
  } finally { imap.close(); }
}

function getSession(id) {
  cleanup();
  const s = sessions.get(String(id || ''));
  if (!s) throw new Error('登录会话已过期，请重新登录');
  s.lastUsed = Date.now();
  return s;
}

async function list({ session, folder, limit }) {
  const s = getSession(session);
  const imap = new Imap(s.provider.imap.host, s.provider.imap.port);
  try {
    await imap.connect();
    await imap.login(s.email, s.password, s.provider);
    const items = await imap.list(String(folder || 'INBOX'), limit);
    return { ok: true, folder: folder || 'INBOX', messages: items };
  } finally { imap.close(); }
}

async function read({ session, folder, uid }) {
  const s = getSession(session);
  const imap = new Imap(s.provider.imap.host, s.provider.imap.port);
  try {
    await imap.connect();
    await imap.login(s.email, s.password, s.provider);
    const m = await imap.read(String(folder || 'INBOX'), Number(uid));
    const h = m.headers;
    return {
      ok: true,
      message: {
        uid: Number(uid),
        subject: decodeWords((h.subject || [''])[0]) || '(无主题)',
        from: decodeWords((h.from || [''])[0]),
        to: decodeWords((h.to || [''])[0]),
        cc: decodeWords((h.cc || [''])[0]),
        date: parseMailDate((h.date || [''])[0]),
        text: m.text || '',
        html: m.html || '',
        attachments: m.attachments || []
      }
    };
  } finally { imap.close(); }
}

async function send({ session, to, subject, text, html }) {
  const s = getSession(session);
  const recipients = String(to || '').split(/[,;，；\n]+/).map(x => x.trim()).filter(Boolean);
  if (!recipients.length) throw new Error('请填写收件人');
  if (recipients.length > 10) throw new Error('单次最多 10 个收件人');
  const addrs = recipients.map(normalizeEmail);
  subject = String(subject || '').slice(0, 300);
  text = String(text || '').slice(0, 200000);
  html = String(html || '').slice(0, 300000);
  if (!text && !html) throw new Error('邮件正文为空');
  const smtp = new Smtp(s.provider.smtp.host, s.provider.smtp.port);
  smtp.pass = s.password;
  try {
    await smtp.send({ from: s.email, to: addrs, subject, text, html });
    return { ok: true, message: '邮件已通过 ' + s.provider.smtp.host + ' 发送' };
  } finally { smtp.close(); }
}

function logout({ session }) {
  sessions.delete(String(session || ''));
  return { ok: true };
}

module.exports = { providers, login, list, read, send, logout, detectProvider, parseMime, decodeWords };