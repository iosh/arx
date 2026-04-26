import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionRecord } from "../storage/records.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import type { NamespaceTransaction, NamespaceTransactionTracking } from "../transactions/namespace/types.js";
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

describe("createBackgroundRuntime (recovery integration)", () => {
  it("resumes receipt tracking for broadcast transactions during initialization", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const fetchReceipt = vi.fn<NamespaceTransactionTracking["fetchReceipt"]>(async () => ({
      status: "success",
      receipt: { status: "0x1", blockNumber: "0x10" },
    }));

    const adapter: NamespaceTransaction = {
      proposal: {
        prepare: vi.fn(async () => ({ status: "ready", prepared: {} })),
      },
      execution: {
        sign: vi.fn(async (_ctx, _prepared) => ({ raw: "0x" })),
        broadcast: vi.fn(async () => ({
          submitted: {
            hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            chainId: "0x1",
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            nonce: "0x7",
          },
          locator: {
            format: "eip155.tx_hash",
            value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        })),
      },
      tracking: { fetchReceipt },
    };

    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(chain.namespace, adapter);

    const txId = "11111111-1111-4111-8111-111111111111";
    const seed: TransactionRecord = {
      id: txId,
      chainRef: chain.chainRef,
      origin: "https://dapp.example",
      fromAccountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "broadcast",
      submitted: {
        hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
      locator: {
        format: "eip155.tx_hash",
        value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      createdAt: 1_000,
      updatedAt: 1_000,
    };

    const context = await setupBackground({
      chainSeed: [chain],
      transactionsSeed: [seed],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });

    try {
      await flushAsync();

      // Tracker polls after the initial delay.
      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);

      const meta = context.runtime.controllers.transactions.getMeta(txId);
      expect(meta?.status).toBe("confirmed");
      expect(meta?.receipt).toMatchObject({ status: "0x1" });
    } finally {
      context.destroy();
    }
  });
});
