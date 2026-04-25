import { describe, expect, it } from "vitest";
import { NamespaceTransactions } from "./NamespaceTransactions.js";
import type { NamespaceTransaction } from "./types.js";

const dummy = (): NamespaceTransaction => ({
  prepareTransaction: async () => ({ prepared: {}, warnings: [], issues: [] }),
  signTransaction: async (_ctx, _prepared) => ({ raw: "0x" }),
  broadcastTransaction: async () => ({
    submitted: { hash: "0xhash" },
    locator: { format: "test.tx_hash", value: "0xhash" },
  }),
});

describe("NamespaceTransactions", () => {
  it("registers and retrieves adapters by namespace", () => {
    const namespaceTransactions = new NamespaceTransactions();
    const adapter = dummy();
    namespaceTransactions.register("eip155", adapter);
    expect(namespaceTransactions.get("eip155")).toBe(adapter);
    expect(namespaceTransactions.listNamespaces()).toEqual(["eip155"]);
  });

  it("throws on duplicate register by default", () => {
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register("eip155", dummy());
    expect(() => namespaceTransactions.register("eip155", dummy())).toThrowError(/already registered/);
  });

  it("allows replacement when explicitly requested", () => {
    const namespaceTransactions = new NamespaceTransactions();
    const first = dummy();
    const second = dummy();
    namespaceTransactions.register("eip155", first);
    namespaceTransactions.register("eip155", second, { replace: true });
    expect(namespaceTransactions.get("eip155")).toBe(second);
  });
});
