function parseDateTime(dateTimeStr) {
  const m = dateTimeStr.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? { date: m[1], time: m[2] } : { date: "", time: "" };
}

function convertGcalEvent(item) {
  const id = item.id ?? "";
  const title = item.summary ?? "(タイトルなし)";
  const start = item.start ?? {};
  const end = item.end ?? {};
  const note = item.description ?? "";

  if (start.date) {
    const results = [];
    const endDate = new Date(end.date + "T00:00:00Z");
    let cur = new Date(start.date + "T00:00:00Z");
    while (cur < endDate) {
      const dateStr = cur.toISOString().split("T")[0];
      results.push({
        id: `gcal_${id}_${dateStr}`,
        title,
        date: dateStr,
        startTime: "00:00",
        endTime: "23:59",
        category: "google",
        note,
        source: "gcal",
      });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return results;
  }

  const s = parseDateTime(start.dateTime);
  const e = parseDateTime(end.dateTime);
  return [{
    id: `gcal_${id}`,
    title,
    date: s.date,
    startTime: s.time,
    endTime: e.time,
    category: "google",
    note,
    source: "gcal",
  }];
}

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
    return json503("Google API設定がありません");
  }

  const tokenRaw = await env.SCHEDULE_KV.get("gcal_token");
  if (!tokenRaw) {
    return json401();
  }

  let tokens = JSON.parse(tokenRaw);
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60_000) {
    tokens = await refreshAccessToken(tokens, env);
    if (!tokens) {
      await env.SCHEDULE_KV.delete("gcal_token");
      return json401();
    }
    await env.SCHEDULE_KV.put("gcal_token", JSON.stringify(tokens));
  }

  try {
    const now = Date.now();
    const timeMin = new Date(now - 90 * 86400_000).toISOString();
    const timeMax = new Date(now + 90 * 86400_000).toISOString();
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "500",
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    if (res.status === 401) {
      await env.SCHEDULE_KV.delete("gcal_token");
      return json401();
    }
    if (!res.ok) {
      return jsonError(res.status, "Google Calendar APIエラー");
    }

    const data = await res.json();
    const events = (data.items ?? []).flatMap(convertGcalEvent);
    return new Response(JSON.stringify({ events }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return jsonError(500, e.message);
  }
}

function json401() {
  return jsonError(401, "認証が必要です");
}

function json503(msg) {
  return jsonError(503, msg);
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
