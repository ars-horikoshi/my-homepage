// IMAP メール取得 API
// 必要な環境変数: MAIL_HOST, MAIL_PASSWORD
// オプション: MAIL_PORT (デフォルト 993), MAIL_USER (デフォルト t-horikoshi@ar-system.co.jp)

export async function onRequestGet(context) {
  const { env } = context;
  const host = env.MAIL_HOST;
  const port = parseInt(env.MAIL_PORT || '993');
  const user = env.MAIL_USER || 't-horikoshi@ar-system.co.jp';
  const pass = env.MAIL_PASSWORD;

  if (!host || !pass) {
    return Response.json(
      { error: 'メールサーバーが未設定です。MAIL_HOST と MAIL_PASSWORD を Cloudflare Secrets に設定してください。' },
      { status: 503 }
    );
  }

  try {
    const emails = await fetchTodayEmails(host, port, user, pass);
    return Response.json({ emails });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

async function fetchTodayEmails(host, port, user, pass) {
  const { connect } = await import('cloudflare:sockets');
  const socket = connect({ hostname: host, port }, { secureTransport: 'on' });
  const writer = socket.writable.getWriter();
  const client = new IMAPClient(socket.readable, writer);

  try {
    await client.readGreeting();
    await client.login(user, pass);
    await client.selectInbox();

    const today = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dateStr = `${today.getDate()}-${months[today.getMonth()]}-${today.getFullYear()}`;
    const msgNums = await client.search(`SINCE ${dateStr}`);

    let emails = [];
    if (msgNums.length > 0) {
      // 最大50件に制限
      const limited = msgNums.slice(-50);
      emails = await client.fetchMessages(limited);
    }

    await client.logout();
    return emails;
  } finally {
    try { await writer.close(); } catch { /* ignore */ }
  }
}

class IMAPClient {
  constructor(readable, writer) {
    this.writer = writer;
    this.reader = readable.getReader();
    this.enc = new TextEncoder();
    this.dec = new TextDecoder();
    this.buf = new Uint8Array(0);
    this.tagN = 0;
  }

  nextTag() { return `T${++this.tagN}`; }

  async fillBuf(need) {
    while (this.buf.length < need) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error('接続が切断されました');
      const tmp = new Uint8Array(this.buf.length + value.length);
      tmp.set(this.buf);
      tmp.set(value, this.buf.length);
      this.buf = tmp;
    }
  }

  async readLine() {
    let idx;
    while ((idx = this.buf.indexOf(10)) === -1) {
      await this.fillBuf(this.buf.length + 64);
    }
    const end = (idx > 0 && this.buf[idx - 1] === 13) ? idx - 1 : idx;
    const line = this.dec.decode(this.buf.slice(0, end));
    this.buf = this.buf.slice(idx + 1);
    return line;
  }

  async readLiteral(n) {
    await this.fillBuf(n);
    const data = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return this.dec.decode(data);
  }

  async send(tag, cmd) {
    await this.writer.write(this.enc.encode(`${tag} ${cmd}\r\n`));
  }

  // タグ付き応答が来るまで読み続ける
  // リテラル {N} があれば N バイト読んで { line, literal } として返す
  async readUntilTag(tag) {
    const items = [];
    while (true) {
      const line = await this.readLine();
      const litMatch = line.match(/\{(\d+)\}$/);
      if (litMatch) {
        const n = parseInt(litMatch[1]);
        const literal = await this.readLiteral(n);
        items.push({ line, literal });
      } else {
        items.push({ line });
      }
      if (line.startsWith(`${tag} OK`) ||
          line.startsWith(`${tag} NO`) ||
          line.startsWith(`${tag} BAD`)) {
        return { ok: line.startsWith(`${tag} OK`), items };
      }
    }
  }

  async readGreeting() {
    await this.readLine();
  }

  async login(user, pass) {
    const tag = this.nextTag();
    await this.send(tag, `LOGIN "${escImap(user)}" "${escImap(pass)}"`);
    const { ok } = await this.readUntilTag(tag);
    if (!ok) throw new Error('IMAPログインに失敗しました（ユーザー名またはパスワードを確認してください）');
  }

  async selectInbox() {
    const tag = this.nextTag();
    await this.send(tag, 'SELECT INBOX');
    const { ok } = await this.readUntilTag(tag);
    if (!ok) throw new Error('INBOXの選択に失敗しました');
  }

  async search(criteria) {
    const tag = this.nextTag();
    await this.send(tag, `SEARCH ${criteria}`);
    const { ok, items } = await this.readUntilTag(tag);
    if (!ok) return [];
    for (const { line } of items) {
      if (line.startsWith('* SEARCH')) {
        return line.slice(8).trim().split(/\s+/).filter(x => /^\d+$/.test(x)).map(Number);
      }
    }
    return [];
  }

  async fetchMessages(msgNums) {
    const tag = this.nextTag();
    await this.send(tag, `FETCH ${msgNums.join(',')} (FLAGS ENVELOPE BODY.PEEK[TEXT]<0.3000>)`);
    const { items } = await this.readUntilTag(tag);
    return parseFetchItems(items);
  }

  async logout() {
    const tag = this.nextTag();
    await this.send(tag, 'LOGOUT');
    try { await this.readUntilTag(tag); } catch { /* ignore */ }
  }
}

function escImap(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseFetchItems(items) {
  const emails = [];
  for (const { line, literal } of items) {
    const m = line.match(/^\* (\d+) FETCH \(/i);
    if (!m) continue;
    const msgNum = parseInt(m[1]);
    const flags = parseFlags(line);
    const envelope = parseEnvelope(line);
    emails.push({
      msgNum,
      from: envelope.from,
      subject: envelope.subject,
      date: envelope.date,
      body: cleanBody(literal || ''),
      unread: !flags.includes('\\Seen'),
    });
  }
  return emails.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function parseFlags(line) {
  const m = line.match(/FLAGS \(([^)]*)\)/);
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
}

function parseEnvelope(line) {
  const m = line.match(/ENVELOPE \(/i);
  if (!m) return { from: '', subject: '', date: '' };
  try {
    // m.index + 10 = "ENVELOPE (" の後の位置
    const pos = { i: m.index + 10 };
    const parsed = parseSexpList(line, pos);
    if (!Array.isArray(parsed)) return { from: '', subject: '', date: '' };

    const dateVal = typeof parsed[0] === 'string' ? parsed[0] : '';
    const rawSubject = typeof parsed[1] === 'string' ? parsed[1] : '';
    const fromAddrs = parsed[2];

    let from = '';
    if (Array.isArray(fromAddrs) && fromAddrs.length > 0) {
      const addr = fromAddrs[0];
      if (Array.isArray(addr)) {
        const name = typeof addr[0] === 'string' ? addr[0] : '';
        const addrUser = typeof addr[2] === 'string' ? addr[2] : '';
        const addrHost = typeof addr[3] === 'string' ? addr[3] : '';
        from = name ? decodeMime(name) : (addrUser && addrHost ? `${addrUser}@${addrHost}` : '');
      }
    }
    return { from, subject: decodeMime(rawSubject), date: dateVal };
  } catch {
    return { from: '', subject: '(解析エラー)', date: '' };
  }
}

// IMAP S式リストパーサー: 開き括弧の直後から始まる
function parseSexpList(s, pos) {
  const items = [];
  skipWs(s, pos);
  while (pos.i < s.length && s[pos.i] !== ')') {
    items.push(parseSexpItem(s, pos));
    skipWs(s, pos);
  }
  if (pos.i < s.length && s[pos.i] === ')') pos.i++;
  return items;
}

function parseSexpItem(s, pos) {
  skipWs(s, pos);
  if (pos.i >= s.length) return null;

  if (s[pos.i] === '(') {
    pos.i++;
    return parseSexpList(s, pos);
  }

  if (s[pos.i] === '"') {
    pos.i++;
    let r = '';
    while (pos.i < s.length && s[pos.i] !== '"') {
      if (s[pos.i] === '\\') pos.i++;
      r += s[pos.i++];
    }
    if (pos.i < s.length) pos.i++; // closing "
    return r;
  }

  if (s.slice(pos.i, pos.i + 3).toUpperCase() === 'NIL') {
    pos.i += 3;
    return null;
  }

  let atom = '';
  while (pos.i < s.length && s[pos.i] !== ' ' && s[pos.i] !== ')' && s[pos.i] !== '(') {
    atom += s[pos.i++];
  }
  return atom || null;
}

function skipWs(s, pos) {
  while (pos.i < s.length && (s[pos.i] === ' ' || s[pos.i] === '\t')) pos.i++;
}

// RFC 2047 encoded word のデコード (=?charset?B/Q?data?=)
function decodeMime(s) {
  if (!s) return '';
  return s.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, data) => {
    try {
      const bytes = enc.toUpperCase() === 'B' ? b64Bytes(data) : qpBytes(data);
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return _;
    }
  });
}

function b64Bytes(s) {
  const bin = atob(s.replace(/\s/g, ''));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function qpBytes(s) {
  const out = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === '_') { out.push(0x20); i++; }
    else if (s[i] === '=' && i + 2 < s.length) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 3; }
    else { out.push(s.charCodeAt(i++)); }
  }
  return new Uint8Array(out);
}

function cleanBody(body) {
  if (!body) return '';

  // MIME マルチパートから text/plain を抽出
  const plainMatch = body.match(
    /Content-Type:\s*text\/plain[^\r\n]*(?:\r?\n[^\r\n]*)*\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\s*$)/i
  );
  if (plainMatch) {
    let text = plainMatch[1];
    // Quoted-Printable デコード
    text = text.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return text.trim().slice(0, 2000);
  }

  // HTML タグを除去
  let text = body.replace(/<[^>]*>/g, ' ');
  // MIME ヘッダー行を除去
  text = text.replace(/^--[^\n]+\n?/gm, '').replace(/^Content-[^\n]+\n?/gm, '');
  // HTML エンティティ
  text = text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
  text = text.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.slice(0, 2000);
}
