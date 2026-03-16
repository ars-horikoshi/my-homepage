async function refreshAccessToken(tokens, env) {
  const creds = JSON.parse(env.GCAL_CLIENT_SECRET);
  const { client_id, client_secret } = creds.web ?? creds.installed;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id,
      client_secret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return {
    ...tokens,
    access_token: data.access_token,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
}

export async function onRequestGet({ env }) {
  if (!env.GCAL_CLIENT_SECRET) {
    return jsonError(503, "Google API設定がありません");
  }

  const tokenRaw = await env.SCHEDULE_KV.get("gmail_token");
  if (!tokenRaw) return jsonError(401, "認証が必要です");

  let tokens = JSON.parse(tokenRaw);
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60_000) {
    tokens = await refreshAccessToken(tokens, env);
    if (!tokens) {
      await env.SCHEDULE_KV.delete("gmail_token");
      return jsonError(401, "認証が必要です");
    }
    await env.SCHEDULE_KV.put("gmail_token", JSON.stringify(tokens));
  }

  try {
    const today = new Date();
    // Gmail の after: クエリは YYYY/M/D 形式
    const dateQuery = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:inbox+after:${dateQuery}&maxResults=50`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    if (listRes.status === 401) {
      await env.SCHEDULE_KV.delete("gmail_token");
      return jsonError(401, "認証が必要です");
    }
    if (!listRes.ok) return jsonError(listRes.status, "Gmail APIエラー");

    const listData = await listRes.json();
    const messages = listData.messages ?? [];

    // 各メッセージの詳細を取得（並列）
    const emails = await Promise.all(
      messages.map(({ id }) =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        )
          .then(r => r.json())
          .then(parseGmailMessage)
          .catch(() => null)
      )
    );

    // null 除去・日時昇順ソート
    const validEmails = emails
      .filter(Boolean)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return new Response(JSON.stringify({ emails: validEmails }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return jsonError(500, e.message);
  }
}

function parseGmailMessage(msg) {
  const headers = msg.payload?.headers ?? [];
  const getHeader = name =>
    headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

  return {
    id: msg.id,
    from: getHeader("From"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    body: extractBody(msg.payload),
    unread: (msg.labelIds ?? []).includes("UNREAD"),
  };
}

function extractBody(payload) {
  if (!payload) return "";

  // シンプルなメッセージ（multipart でない）
  if (payload.body?.data) {
    const text = b64Decode(payload.body.data);
    if (payload.mimeType === "text/plain") return text.slice(0, 2000);
    if (payload.mimeType === "text/html") return stripHtml(text).slice(0, 2000);
  }

  // multipart: text/plain を優先
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return b64Decode(part.body.data).slice(0, 2000);
      }
    }
    // text/html にフォールバック
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return stripHtml(b64Decode(part.body.data)).slice(0, 2000);
      }
    }
    // ネストした multipart を再帰探索
    for (const part of payload.parts) {
      if (part.mimeType.startsWith("multipart/")) {
        const text = extractBody(part);
        if (text) return text;
      }
    }
  }

  return "";
}

// Gmail API は base64url エンコードを使用
function b64Decode(data) {
  try {
    const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8").decode(
      Uint8Array.from(bin, c => c.charCodeAt(0))
    );
  } catch {
    return "";
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
