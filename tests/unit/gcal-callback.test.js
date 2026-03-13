import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { htmlError, onRequestGet } from "../../functions/api/gcal/callback.js";

describe("htmlError", () => {
  it("returns 400 HTML response with message", async () => {
    const res = htmlError("Something went wrong");
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Something went wrong");
    expect(text).toContain("html");
  });
});

describe("gcal/callback onRequestGet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 400 HTML when no code param", async () => {
    const env = {
      SCHEDULE_KV: { get: vi.fn() },
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
    };
    const request = { url: "https://example.com/api/gcal/callback?state=abc" };
    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("認証コードが見つかりません");
  });

  it("returns 400 HTML when no saved state in KV", async () => {
    const env = {
      SCHEDULE_KV: { get: vi.fn().mockResolvedValue(null) },
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
    };
    const request = { url: "https://example.com/api/gcal/callback?code=mycode&state=abc" };
    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("不正なリクエストです");
  });

  it("returns 400 HTML when state mismatch", async () => {
    const env = {
      SCHEDULE_KV: { get: vi.fn().mockResolvedValue("correct-state") },
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
    };
    const request = { url: "https://example.com/api/gcal/callback?code=mycode&state=wrong-state" };
    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("不正なリクエストです");
  });

  it("returns 400 HTML when token fetch fails (non-ok)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      text: vi.fn().mockResolvedValue("error body"),
    }));

    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: {
        get: vi.fn().mockResolvedValue("match-state"),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const request = { url: "https://example.com/api/gcal/callback?code=mycode&state=match-state" };
    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("トークン取得に失敗しました");
  });

  it("saves token and redirects to / on success", async () => {
    const tokenData = {
      access_token: "at123",
      refresh_token: "rt456",
      expires_in: 3600,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(tokenData),
    }));

    const putMock = vi.fn().mockResolvedValue(undefined);
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: {
        get: vi.fn().mockResolvedValue("match-state"),
        delete: vi.fn().mockResolvedValue(undefined),
        put: putMock,
      },
    };
    const request = { url: "https://example.com/api/gcal/callback?code=mycode&state=match-state" };
    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/");
    expect(putMock).toHaveBeenCalledWith(
      "gcal_token",
      expect.stringContaining("at123")
    );
  });

  it("returns 400 HTML when token fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network failure")));

    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ web: { client_id: "cid", client_secret: "csec" } }),
      SCHEDULE_KV: {
        get: vi.fn().mockResolvedValue("match-state"),
        delete: vi.fn().mockResolvedValue(undefined),
      },
    };
    const request = { url: "https://example.com/api/gcal/callback?code=mycode&state=match-state" };
    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("認証に失敗しました");
    expect(text).toContain("Network failure");
  });

  it("uses installed creds for token exchange", async () => {
    const tokenData = {
      access_token: "at_installed",
      refresh_token: "rt_installed",
      expires_in: 3600,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(tokenData),
    }));

    const putMock = vi.fn().mockResolvedValue(undefined);
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({ installed: { client_id: "icid", client_secret: "icsec" } }),
      SCHEDULE_KV: {
        get: vi.fn().mockResolvedValue("s1"),
        delete: vi.fn().mockResolvedValue(undefined),
        put: putMock,
      },
    };
    const request = { url: "https://example.com/api/gcal/callback?code=mycode&state=s1" };
    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(302);
  });
});
