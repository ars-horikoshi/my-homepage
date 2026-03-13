import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { onRequestGet } from "../../functions/api/gcal/auth.js";

describe("gcal/auth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 503 JSON when no GCAL_CLIENT_SECRET", async () => {
    const env = { GCAL_CLIENT_SECRET: null };
    const request = { url: "https://example.com/api/gcal/auth" };
    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("redirects to Google OAuth URL with web creds", async () => {
    const state = "test-uuid-1234";
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValue(state),
    });

    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({
        web: { client_id: "my-client-id", client_secret: "my-secret" },
      }),
      SCHEDULE_KV: {
        put: vi.fn().mockResolvedValue(undefined),
      },
    };
    const request = { url: "https://example.com/api/gcal/auth" };

    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("accounts.google.com");
    expect(location).toContain("client_id=my-client-id");
    expect(location).toContain(`state=${state}`);
    expect(location).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fgcal%2Fcallback");

    vi.unstubAllGlobals();
  });

  it("redirects to Google OAuth URL with installed creds", async () => {
    const state = "installed-uuid-5678";
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValue(state),
    });

    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({
        installed: { client_id: "installed-cid", client_secret: "installed-secret" },
      }),
      SCHEDULE_KV: {
        put: vi.fn().mockResolvedValue(undefined),
      },
    };
    const request = { url: "https://example.com/api/gcal/auth" };

    const res = await onRequestGet({ env, request });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("client_id=installed-cid");

    vi.unstubAllGlobals();
  });

  it("saves state to KV with TTL 600", async () => {
    const state = "state-abc";
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValue(state),
    });

    const putMock = vi.fn().mockResolvedValue(undefined);
    const env = {
      GCAL_CLIENT_SECRET: JSON.stringify({
        web: { client_id: "cid", client_secret: "csec" },
      }),
      SCHEDULE_KV: { put: putMock },
    };
    const request = { url: "https://example.com/api/gcal/auth" };

    await onRequestGet({ env, request });
    expect(putMock).toHaveBeenCalledWith("oauth_state", state, { expirationTtl: 600 });

    vi.unstubAllGlobals();
  });
});
