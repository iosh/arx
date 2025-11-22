import { describe, expect, it } from "vitest";
import { TransactionAdapterRegistry } from "./registry.js";
import type { TransactionAdapter } from "./types.js";

const dummy = (): TransactionAdapter => ({
  buildDraft: async () => ({ prepared: {}, summary: {}, warnings: [], issues: [] }),
  signTransaction: async () => ({ raw: "0x", hash: "0xhash" }),
  broadcastTransaction: async () => ({ hash: "0xhash" }),
});

describe("TransactionAdapterRegistry", () => {
  it("registers and retrieves adapters by namespace", () => {
    const registry = new TransactionAdapterRegistry();
    const adapter = dummy();
    registry.register("eip155", adapter);
    expect(registry.get("eip155")).toBe(adapter);
    expect(registry.listNamespaces()).toEqual(["eip155"]);
  });

  it("throws on duplicate register by default", () => {
    const registry = new TransactionAdapterRegistry();
    registry.register("eip155", dummy());
    expect(() => registry.register("eip155", dummy())).toThrowError(/already registered/);
  });

  it("allows replacement when explicitly requested", () => {
    const registry = new TransactionAdapterRegistry();
    const first = dummy();
    const second = dummy();
    registry.register("eip155", first);
    registry.register("eip155", second, { replace: true });
    expect(registry.get("eip155")).toBe(second);
  });
});
