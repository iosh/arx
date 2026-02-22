import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionRecord } from "../storage/records.js";
import { TransactionAdapterRegistry } from "../transactions/adapters/registry.js";
import type { TransactionAdapter } from "../transactions/adapters/types.js";
import {
  createChainMetadata,
  flushAsync,
  setupBackground,
  TEST_RECEIPT_POLL_INTERVAL,
} from "./__fixtures__/backgroundTestSetup.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackgroundServices (recovery integration)", () => {
  it("resumes receipt tracking for broadcast transactions during initialization", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => ({
      status: "success",
      receipt: { status: "0x1", blockNumber: "0x10" },
    }));

    const adapter: TransactionAdapter = {
      prepareTransaction: vi.fn(async () => ({ prepared: {}, warnings: [], issues: [] })),
      signTransaction: vi.fn(async (_ctx, _prepared) => ({ raw: "0x", hash: null })),
      broadcastTransaction: vi.fn(async () => ({
        hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      })),
      fetchReceipt,
    };

    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const txId = "11111111-1111-4111-8111-111111111111";
    const seed: TransactionRecord = {
      id: txId,
      namespace: "eip155",
      chainRef: chain.chainRef,
      origin: "https://dapp.example",
      fromAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "broadcast",
      request: {
        namespace: "eip155",
        chainRef: chain.chainRef,
        payload: {
          chainId: "0x1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      prepared: null,
      hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      receipt: undefined,
      error: undefined,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1_000,
      updatedAt: 1_000,
    };

    const context = await setupBackground({
      chainSeed: [chain],
      transactionsSeed: [seed],
      transactions: { registry },
      persistDebounceMs: 0,
    });

    try {
      await flushAsync();

      // Tracker polls after the initial delay.
      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);

      const meta = context.services.controllers.transactions.getMeta(txId);
      expect(meta?.status).toBe("confirmed");
      expect(meta?.receipt).toMatchObject({ status: "0x1" });
    } finally {
      context.destroy();
    }
  });

  it("does not sign approved transactions during initialization", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const prepareTransaction = vi.fn<TransactionAdapter["prepareTransaction"]>(async () => ({
      prepared: {},
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async (_ctx, _prepared) => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));

    const adapter: TransactionAdapter = { prepareTransaction, signTransaction, broadcastTransaction };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const txId = "22222222-2222-4222-8222-222222222222";
    const seed: TransactionRecord = {
      id: txId,
      namespace: "eip155",
      chainRef: chain.chainRef,
      origin: "https://dapp.example",
      fromAccountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "approved",
      request: {
        namespace: "eip155",
        chainRef: chain.chainRef,
        payload: {
          chainId: "0x1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      hash: null,
      receipt: undefined,
      error: undefined,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1_000,
      updatedAt: 1_000,
    };

    const context = await setupBackground({
      chainSeed: [chain],
      transactionsSeed: [seed],
      transactions: { registry },
      persistDebounceMs: 0,
    });

    try {
      await flushAsync();

      expect(prepareTransaction).toHaveBeenCalledTimes(0);
      expect(signTransaction).toHaveBeenCalledTimes(0);
      expect(broadcastTransaction).toHaveBeenCalledTimes(0);

      const before = context.services.controllers.transactions.getMeta(txId);
      expect(before?.status).toBe("approved");

      await context.services.controllers.transactions.resumePending({ includeSigning: true });
      await flushAsync();

      await vi.waitFor(() => expect(prepareTransaction).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));

      const after = context.services.controllers.transactions.getMeta(txId);
      expect(after?.status).toBe("broadcast");
    } finally {
      context.destroy();
    }
  });
});
