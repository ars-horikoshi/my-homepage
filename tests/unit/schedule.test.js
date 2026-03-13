import { describe, it, expect, vi } from "vitest";
import { onRequestGet, onRequestPut } from "../../functions/api/schedule.js";

describe("schedule API", () => {
  describe("onRequestGet", () => {
    it("returns KV data when present", async () => {
      const data = JSON.stringify({ events: [{ id: 1 }], categories: {} });
      const env = { SCHEDULE_KV: { get: vi.fn().mockResolvedValue(data) } };
      const res = await onRequestGet({ env });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.events).toHaveLength(1);
    });

    it("returns default empty structure when KV is null", async () => {
      const env = { SCHEDULE_KV: { get: vi.fn().mockResolvedValue(null) } };
      const res = await onRequestGet({ env });
      const body = await res.json();
      expect(body).toEqual({ events: [], categories: {} });
    });
  });

  describe("onRequestPut", () => {
    it("saves valid JSON and returns ok", async () => {
      const env = { SCHEDULE_KV: { put: vi.fn().mockResolvedValue(undefined) } };
      const body = JSON.stringify({ events: [], categories: {} });
      const request = { text: vi.fn().mockResolvedValue(body) };
      const res = await onRequestPut({ env, request });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(env.SCHEDULE_KV.put).toHaveBeenCalledWith("schedule_data", body);
    });

    it("returns 400 for invalid JSON", async () => {
      const env = { SCHEDULE_KV: { put: vi.fn() } };
      const request = { text: vi.fn().mockResolvedValue("not json{{{") };
      const res = await onRequestPut({ env, request });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });
  });
});
