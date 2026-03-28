import { describe, expect, it } from "vitest";
import type { TransactionRecord } from "./records.js";
import { NetworkPreferencesRecordSchema, TransactionRecordSchema } from "./records.js";

const createTransactionRecord = (
  overrides: Partial<TransactionRecord> & {
    request?: Partial<TransactionRecord["request"]>;
  } = {},
) => {
  const { request: requestOverrides, ...restOverrides } = overrides;
  const request = {
    namespace: "eip155",
    chainRef: "eip155:1",
    payload: { chainId: "0x1" },
    ...requestOverrides,
  };

  return {
    id: "11111111-1111-4111-8111-111111111111",
    namespace: "eip155",
    chainRef: "eip155:1",
    origin: "https://dapp.example",
    fromAccountKey: "eip155:aa",
    status: "pending",
    prepared: null,
    hash: null,
    userRejected: false,
    warnings: [],
    issues: [],
    createdAt: 0,
    updatedAt: 0,
    ...restOverrides,
    request,
  };
};

describe("NetworkPreferencesRecordSchema", () => {
  it("requires selectedNamespace", () => {
    expect(() =>
      NetworkPreferencesRecordSchema.parse({
        id: "network-preferences",
        activeChainByNamespace: {
          solana: "solana:101",
          eip155: "eip155:1",
        },
        rpc: {},
        updatedAt: 0,
      }),
    ).toThrow();
  });

  it("accepts records whose selected namespace resolves through activeChainByNamespace", () => {
    const parsed = NetworkPreferencesRecordSchema.parse({
      id: "network-preferences",
      selectedNamespace: "solana",
      activeChainByNamespace: {
        solana: "solana:101",
        eip155: "eip155:1",
      },
      rpc: {},
      updatedAt: 0,
    });

    expect(parsed.selectedNamespace).toBe("solana");
  });

  it("rejects records that provide neither selected owner field", () => {
    expect(() =>
      NetworkPreferencesRecordSchema.parse({
        id: "network-preferences",
        activeChainByNamespace: {},
        rpc: {},
        updatedAt: 0,
      }),
    ).toThrow();
  });

  it("rejects records whose selected namespace is missing from activeChainByNamespace", () => {
    expect(() =>
      NetworkPreferencesRecordSchema.parse({
        id: "network-preferences",
        selectedNamespace: "solana",
        activeChainByNamespace: {
          eip155: "eip155:1",
        },
        rpc: {},
        updatedAt: 0,
      }),
    ).toThrow(/must include the selected namespace/);
  });

  it("rejects activeChainByNamespace entries whose chainRef namespace drifts", () => {
    expect(() =>
      NetworkPreferencesRecordSchema.parse({
        id: "network-preferences",
        selectedNamespace: "solana",
        activeChainByNamespace: {
          solana: "eip155:1",
        },
        rpc: {},
        updatedAt: 0,
      }),
    ).toThrow(/must point to the same namespace/);
  });
});

describe("TransactionRecordSchema", () => {
  it("rejects records whose chain, account, and request namespaces drift", () => {
    expect(() =>
      TransactionRecordSchema.parse(
        createTransactionRecord({
          namespace: "eip155",
          chainRef: "cosmos:cosmoshub-4",
          fromAccountKey: "cosmos:aa",
          request: {
            namespace: "eip155",
            chainRef: "eip155:1",
          },
        }),
      ),
    ).toThrow(/namespace/i);
  });

  it("requires persisted request chainRef and terminal state guards", () => {
    expect(() =>
      TransactionRecordSchema.parse(
        createTransactionRecord({
          id: "22222222-2222-4222-8222-222222222222",
          request: {
            chainRef: undefined,
          },
        }),
      ),
    ).toThrow();

    expect(() =>
      TransactionRecordSchema.parse(
        createTransactionRecord({
          id: "33333333-3333-4333-8333-333333333333",
          status: "broadcast",
          prepared: {},
          hash: null,
          userRejected: true,
        }),
      ),
    ).toThrow(/hash|userRejected/i);
  });
});
