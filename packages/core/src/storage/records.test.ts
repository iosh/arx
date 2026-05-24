import { describe, expect, it } from "vitest";
import type { TransactionRecord } from "./records.js";
import { NetworkSelectionRecordSchema, TransactionRecordSchema } from "./records.js";

const createTransactionRecord = (overrides: Partial<TransactionRecord> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  namespace: "eip155",
  chainRef: "eip155:1",
  origin: "https://dapp.example",
  accountKey: "eip155:aa",
  status: "broadcast" as const,
  submitted: {
    hash: "0x1111",
    chainId: "0x1",
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    nonce: "0x7",
  },
  receipt: null,
  replacementKey: null,
  replacedByRecordId: null,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe("NetworkSelectionRecordSchema", () => {
  it("requires selectedNamespace", () => {
    expect(() =>
      NetworkSelectionRecordSchema.parse({
        id: "network-selection",
        chainRefByNamespace: {
          solana: "solana:101",
          eip155: "eip155:1",
        },
        updatedAt: 0,
      }),
    ).toThrow();
  });

  it("accepts records whose selected namespace resolves through chainRefByNamespace", () => {
    const parsed = NetworkSelectionRecordSchema.parse({
      id: "network-selection",
      selectedNamespace: "solana",
      chainRefByNamespace: {
        solana: "solana:101",
        eip155: "eip155:1",
      },
      updatedAt: 0,
    });

    expect(parsed.selectedNamespace).toBe("solana");
  });

  it("rejects records that provide neither selected owner field", () => {
    expect(() =>
      NetworkSelectionRecordSchema.parse({
        id: "network-selection",
        chainRefByNamespace: {},
        updatedAt: 0,
      }),
    ).toThrow();
  });

  it("rejects records whose selected namespace is missing from chainRefByNamespace", () => {
    expect(() =>
      NetworkSelectionRecordSchema.parse({
        id: "network-selection",
        selectedNamespace: "solana",
        chainRefByNamespace: {
          eip155: "eip155:1",
        },
        updatedAt: 0,
      }),
    ).toThrow(/must include the selected namespace/);
  });

  it("rejects chainRefByNamespace entries whose chainRef namespace drifts", () => {
    expect(() =>
      NetworkSelectionRecordSchema.parse({
        id: "network-selection",
        selectedNamespace: "solana",
        chainRefByNamespace: {
          solana: "eip155:1",
        },
        updatedAt: 0,
      }),
    ).toThrow(/must point to the same namespace/);
  });
});

describe("TransactionRecordSchema", () => {
  it("rejects records whose chain and account namespaces drift", () => {
    expect(() =>
      TransactionRecordSchema.parse(
        createTransactionRecord({
          chainRef: "cosmos:cosmoshub-4",
          namespace: "cosmos",
          accountKey: "eip155:aa",
        }),
      ),
    ).toThrow(/namespace/i);
  });

  it("requires durable submitted payloads", () => {
    expect(() =>
      TransactionRecordSchema.parse(
        createTransactionRecord({
          id: "22222222-2222-4222-8222-222222222222",
          submitted: undefined,
        }),
      ),
    ).toThrow(/submitted/i);
  });

  it("accepts namespace-owned submitted payload shapes", () => {
    const parsed = TransactionRecordSchema.parse(
      createTransactionRecord({
        id: "44444444-4444-4444-8444-444444444444",
        submitted: {
          txHash: "request-1",
          memo: "delegate",
        },
      }),
    );

    expect(parsed.submitted).toEqual({
      txHash: "request-1",
      memo: "delegate",
    });
  });

  it("accepts records with a durable replacement key", () => {
    const parsed = TransactionRecordSchema.parse(
      createTransactionRecord({
        replacementKey: {
          scope: "eip155.nonce",
          value: "eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
        },
      }),
    );

    expect(parsed.replacementKey).toEqual({
      scope: "eip155.nonce",
      value: "eip155:1:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:0x7",
    });
  });
});
