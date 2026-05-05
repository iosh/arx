import { describe, expect, it } from "vitest";
import { NamespaceTransactions } from "./NamespaceTransactions.js";
import type { NamespaceTransaction } from "./types.js";

const dummy = (): NamespaceTransaction => ({
  proposal: {
    prepare: async () => ({ status: "ready", prepared: {} }),
  },
  execution: {
    sign: async (_ctx, _prepared) => ({ raw: "0x" }),
    broadcast: async () => ({
      submitted: { hash: "0xhash" },
    }),
  },
});

describe("NamespaceTransactions", () => {
  it("stores and retrieves namespace transactions", () => {
    const adapter = dummy();
    const namespaceTransactions = new NamespaceTransactions([["eip155", adapter]]);
    expect(namespaceTransactions.find("eip155")).toBe(adapter);
    expect(namespaceTransactions.require("eip155")).toBe(adapter);
    expect(namespaceTransactions.list()).toEqual([adapter]);
    expect(namespaceTransactions.listNamespaces()).toEqual(["eip155"]);
  });

  it("throws on duplicate namespace entries", () => {
    expect(
      () =>
        new NamespaceTransactions([
          ["eip155", dummy()],
          ["eip155", dummy()],
        ]),
    ).toThrowError(/Duplicate namespace transaction/);
  });

  it("throws when requiring a missing namespace transaction", () => {
    const namespaceTransactions = new NamespaceTransactions();
    expect(() => namespaceTransactions.require("eip155")).toThrowError(/Missing namespace transaction/);
  });
});
