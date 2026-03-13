import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseDateTime,
  convertGcalEvent,
  refreshAccessToken,
  onRequestGet,
} from "../../functions/api/gcal.js";

describe("parseDateTime", () => {
  it("parses a valid dateTime string", () => {
    const result = parseDateTime("2024-03-15T09:30:00+09:00");
    expect(result).toEqual({ date: "2024-03-15", time: "09:30" });
  });

  it("returns empty strings for no match", () => {
    const result = parseDateTime("not-a-date");
    expect(result).toEqual({ date: "", time: "" });
  });

  it("returns empty strings for empty string", () => {
    const result = parseDateTime("");
    expect(result).toEqual({ date: "", time: "" });
  });
});

describe("convertGcalEvent", () => {
  it("converts all-day single-day event", () => {
    const item = {
      id: "abc",
      summary: "Holiday",
      start: { date: "2024-03-20" },
      end: { date: "2024-03-21" },
      description: "Spring equinox",
    };
    const results = convertGcalEvent(item);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "gcal_abc_2024-03-20",
      title: "Holiday",
      date: "2024-03-20",
      startTime: "00:00",
      endTime: "23:59",
      category: "google",
      note: "Spring equinox",
      source: "gcal",
    });
  });

  it("converts all-day multi-day event into multiple entries", () => {
    const item = {
      id: "xyz",
      summary: "Conference",
      start: { date: "2024-04-01" },
      end: { date: "2024-04-04" },
    };
    const results = convertGcalEvent(item);
    expect(results).toHaveLength(3);
    expect(results[0].date).toBe("2024-04-01");
    expect(results[1].date).toBe("2024-04-02");
    expect(results[2].date).toBe("2024-04-03");
    expect(results[0].id).toBe("gcal_xyz_2024-04-01");
  });

  it("converts a timed event", () => {
    const item = {
      id: "tid1",
      summary: "Meeting",
      start: { dateTime: "2024-05-10T10:00:00+09:00" },
      end: { dateTime: "2024-05-10T11:30:00+09:00" },
      description: "Team sync",
    };
    const results = convertGcalEvent(item);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "gcal_tid1",
      title: "Meeting",
      date: "2024-05-10",
      startTime: "10:00",
      endTime: "11:30",
      category: "google",
      note: "Team sync",
      source: "gcal",
    });
  });

  it("uses fallback title when summary is missing", () => {
    const item = {
      id: "noid",
      start: { dateTime: "2024-05-10T10:00:00+09:00" },
      end: { dateTime: "2024-05-10T11:00:00+09:00" },
    };
    const results = convertGcalEvent(item);
    expect(results[0].title).toBe("(タイトルなし)");
    expect(results[0].note).toBe("");
  });

  it("uses empty string for id when missing", () => {
    const item = {
      summary: "No ID event",
      start: { dateTime: "2024-05-10T10:00:00+09:00" },
      end: { dateTime: "2024-05-10T11:00:00+09:00" },
    };
    const results = convertGcalEvent(item);
    expect(results[0].id).toBe("gcal_");
  });

  it("handles null start and end (falls back to empty object, no start.date)", () => {
    // start and end are null, ?? {} gives {}, .date is undefined -> timed path
    // .dateTime is also undefined -> parseDateTime(undefined) throws
    // But we can test with explicit empty objects to cover the ?? branch
    const item = {
      id: "nostart",
      summary: "No times",
      start: null,
      end: null,
    };
    // This will throw because parseDateTime(undefined) -- but covers the ?? branch
    expect(() => convertGcalEvent(item)).toThrow();
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns updated tokens on success with web creds", async () => {
    const tokens = { access_token: "old", refresh_token: "rtoken", expiry_date: 1000 };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({
        web: { client_id: "cid", client_secret: "csec" },
      }),
    };
    const newData = { access_token: "new_token", expires_in: 3600 };
    fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(newData),
    });

    const result = await refreshAccessToken(tokens, env);
    expect(result.access_token).toBe("new_token");
    expect(result.refresh_token).toBe("rtoken");
    expect(result.expiry_date).toBeGreaterThan(Date.now());
  });

  it("returns updated tokens on success with installed creds", async () => {
    const tokens = { access_token: "old", refresh_token: "rtoken", expiry_date: 1000 };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({
        installed: { client_id: "cid2", client_secret: "csec2" },
      }),
    };
    const newData = { access_token: "new_token2", expires_in: 3600 };
    fetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(newData),
    });

    const result = await refreshAccessToken(tokens, env);
    expect(result.access_token).toBe("new_token2");
  });

  it("returns null on non-ok response", async () => {
    const tokens = { access_token: "old", refresh_token: "rtoken" };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({
        web: { client_id: "cid", client_secret: "csec" },
      }),
    };
    fetch.mockResolvedValue({ ok: false });

    const result = await refreshAccessToken(tokens, env);
    expect(result).toBeNull();
  });
});

describe("onRequestGet", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 503 when no GCAL_CLIENT_SECRET", async () => {
    const env = { GCAL_CLIENT_SECRET: null };
    const res = await onRequestGet({ env });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 401 when no token in KV", async () => {
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: { get: vi.fn().mockResolvedValue(null) },
    };
    const res = await onRequestGet({ env });
    expect(res.status).toBe(401);
  });

  it("returns 200 with events when token is valid and not expired", async () => {
    const tokens = { access_token: "tok", expiry_date: Date.now() + 999999 };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: { get: vi.fn().mockResolvedValue(JSON.stringify(tokens)) },
    };
    const calData = {
      items: [
        {
          id: "ev1",
          summary: "Test",
          start: { dateTime: "2024-05-10T10:00:00+09:00" },
          end: { dateTime: "2024-05-10T11:00:00+09:00" },
        },
      ],
    };
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(calData),
    });

    const res = await onRequestGet({ env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(body.events[0].title).toBe("Test");
  });

  it("returns 401 when token is expired and refresh fails", async () => {
    const tokens = { access_token: "tok", refresh_token: "rtoken", expiry_date: Date.now() - 99999 };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: {
        get: vi.fn().mockResolvedValue(JSON.stringify(tokens)),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    // refresh fails
    fetch.mockResolvedValue({ ok: false });

    const res = await onRequestGet({ env });
    expect(res.status).toBe(401);
    expect(env.SCHEDULE_KV.delete).toHaveBeenCalledWith("gcal_token");
  });

  it("refreshes token and fetches calendar when expired and refresh succeeds", async () => {
    const tokens = { access_token: "old_tok", refresh_token: "rtoken", expiry_date: Date.now() - 99999 };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: {
        get: vi.fn().mockResolvedValue(JSON.stringify(tokens)),
        put: vi.fn().mockResolvedValue(undefined),
      },
    };

    const refreshData = { access_token: "new_tok", expires_in: 3600 };
    const calData = { items: [] };
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(refreshData),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(calData),
      });

    const res = await onRequestGet({ env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
    expect(env.SCHEDULE_KV.put).toHaveBeenCalledWith("gcal_token", expect.any(String));
  });

  it("returns 401 when calendar API returns 401 and deletes token", async () => {
    const tokens = { access_token: "tok", expiry_date: Date.now() + 999999 };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: {
        get: vi.fn().mockResolvedValue(JSON.stringify(tokens)),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    fetch.mockResolvedValue({ ok: false, status: 401 });

    const res = await onRequestGet({ env });
    expect(res.status).toBe(401);
    expect(env.SCHEDULE_KV.delete).toHaveBeenCalledWith("gcal_token");
  });

  it("returns error when calendar API returns non-ok non-401 status", async () => {
    const tokens = { access_token: "tok", expiry_date: Date.now() + 999999 };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: { get: vi.fn().mockResolvedValue(JSON.stringify(tokens)) },
    };
    fetch.mockResolvedValue({ ok: false, status: 500 });

    const res = await onRequestGet({ env });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 500 when fetch throws an error", async () => {
    const tokens = { access_token: "tok", expiry_date: Date.now() + 999999 };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: { get: vi.fn().mockResolvedValue(JSON.stringify(tokens)) },
    };
    fetch.mockRejectedValue(new Error("Network error"));

    const res = await onRequestGet({ env });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Network error");
  });

  it("handles calendar response with null items", async () => {
    const tokens = { access_token: "tok", expiry_date: Date.now() + 999999 };
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: { get: vi.fn().mockResolvedValue(JSON.stringify(tokens)) },
    };
    const calData = { items: null };
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(calData),
    });

    const res = await onRequestGet({ env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
  });
});
