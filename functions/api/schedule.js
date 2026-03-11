export async function onRequestGet({ env }) {
  const data = await env.SCHEDULE_KV.get("schedule_data");
  const body = data ?? JSON.stringify({ events: [], categories: {} });
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function onRequestPut({ env, request }) {
  const body = await request.text();
  try {
    JSON.parse(body); // validate
    await env.SCHEDULE_KV.put("schedule_data", body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
