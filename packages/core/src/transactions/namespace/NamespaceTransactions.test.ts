import { describe, expect, it } from "vitest";
import { NamespaceTransactions } from "./NamespaceTransactions.js";
import type { NamespaceTransaction } from "./types.js";

const dummy = (): NamespaceTransaction => ({
  request: {
    deriveForChain: (request, chainRef) => ({ ...request, chainRef }),
    validateRequest: () => {},
  },
  proposal: {
    prepare: async () => ({ status: "ready", prepared: {}, reviewSnapshot: {} }),
    buildReview: () => null,
    buildReplacementRequest: async (context) => context.targetRequest,
    deriveResourceKey: () => null,
    finalizeSubmit: async (context) => ({
      status: "approved",
      approvedPayload: context.preparedPayload,
      conflictKey: null,
    }),
  },
  submission: {
    createBroadcastArtifact: async () => ({ kind: "test.raw", payload: { raw: "0x" } }),
    broadcast: async () => ({
      broadcastIdentity: { hash: "0xhash" },
      submitted: { hash: "0xhash" },
    }),
  },
  tracking: {
    inspectSubmittedTransaction: async () => ({ trackingStatus: "pending", evidence: null }),
    getInitialInspectionDelay: () => 1_000,
    getPendingInspectionDelay: () => 1_000,
    getRetryInspectionDelay: () => 1_000,
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
