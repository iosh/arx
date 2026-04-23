import { describe, expect, it } from "vitest";
import type { TransactionRecord } from "./records.js";
import { NetworkSelectionRecordSchema, TransactionRecordSchema } from "./records.js";

const createTransactionRecord = (overrides: Partial<TransactionRecord> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  chainRef: "eip155:1",
  origin: "https://dapp.example",
  fromAccountKey: "eip155:aa",
  status: "broadcast" as const,
  submitted: {
    hash: "0x1111",
    chainId: "0x1",
    from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    nonce: "0x7",
  },
  locator: { format: "eip155.tx_hash" as const, value: "0x1111" },
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
          fromAccountKey: "eip155:aa",
        }),
      ),
    ).toThrow(/namespace/i);
  });

  it("requires durable submitted and locator payloads", () => {
    expect(() =>
      TransactionRecordSchema.parse(
        createTransactionRecord({
          id: "22222222-2222-4222-8222-222222222222",
          submitted: undefined,
        }),
      ),
    ).toThrow(/submitted/i);

    expect(() =>
      TransactionRecordSchema.parse(
        createTransactionRecord({
          id: "33333333-3333-4333-8333-333333333333",
          locator: null as never,
        }),
      ),
    ).toThrow(/locator/i);
  });
});
