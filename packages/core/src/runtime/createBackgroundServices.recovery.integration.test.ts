import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionStatusChange } from "../controllers/index.js";
import type { TransactionsSnapshot } from "../storage/index.js";
import { StorageNamespaces, TRANSACTIONS_SNAPSHOT_VERSION } from "../storage/index.js";
import { TransactionAdapterRegistry } from "../transactions/adapters/registry.js";
import type { TransactionAdapter } from "../transactions/adapters/types.js";
import { createChainMetadata, flushAsync, setupBackground } from "./__test-utils__/backgroundTestSetup.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackgroundServices (recovery integration)", () => {
  it("replays approved transactions from storage during initialization", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const buildDraft = vi.fn<TransactionAdapter["buildDraft"]>(async () => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));

    const adapter: TransactionAdapter = {
      buildDraft,
      signTransaction,
      broadcastTransaction,
    };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const transactionsSnapshot: TransactionsSnapshot = {
      version: TRANSACTIONS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        pending: [],
        history: [
          {
            id: "tx-storage-1",
            namespace: chain.namespace,
            caip2: chain.chainRef,
            origin: "https://dapp.example",
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            request: {
              namespace: chain.namespace,
              caip2: chain.chainRef,
              payload: {
                from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                value: "0x0",
                data: "0x",
              },
            },
            status: "approved",
            hash: null,
            receipt: null,
            error: null,
            userRejected: false,
            warnings: [],
            issues: [],
            createdAt: 1_000,
            updatedAt: 1_000,
          },
        ],
      },
    };

    const context = await setupBackground({
      chainSeed: [chain],
      storageSeed: {
        [StorageNamespaces.Transactions]: transactionsSnapshot,
      },
      transactions: {
        registry,
        autoApprove: false,
      },
      now: () => 2_000,
    });

    try {
      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      const resumedMeta = context.services.controllers.transactions.getMeta("tx-storage-1");
      expect(resumedMeta?.status).toBe("broadcast");
      expect(resumedMeta?.hash).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");
    } finally {
      context.destroy();
    }
  });

  it("resumes approved transactions from storage and emits status events", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const buildDraft = vi.fn<TransactionAdapter["buildDraft"]>(async () => ({
      prepared: { raw: "0x" },
      summary: { kind: "transfer" },
      warnings: [],
      issues: [],
    }));
    const signTransaction = vi.fn<TransactionAdapter["signTransaction"]>(async () => ({
      raw: "0x1111",
      hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));
    const broadcastTransaction = vi.fn<TransactionAdapter["broadcastTransaction"]>(async (_ctx, signed) => ({
      hash: signed.hash ?? "0x1111111111111111111111111111111111111111111111111111111111111111",
    }));

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry, autoApprove: false },
      persistDebounceMs: 0,
    });

    const approvedMeta: TransactionsSnapshot["payload"]["pending"][number] = {
      id: "tx-resume-1",
      namespace: chain.namespace,
      caip2: chain.chainRef,
      origin: "https://dapp.example",
      from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      request: {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      },
      status: "approved",
      hash: null,
      receipt: null,
      error: null,
      userRejected: false,
      warnings: [],
      issues: [],
      createdAt: 1_000,
      updatedAt: 1_000,
    };

    context.services.controllers.transactions.replaceState({
      pending: [],
      history: [approvedMeta],
    });

    const statusEvents: TransactionStatusChange[] = [];
    const queuedEvents: string[] = [];

    const unsubscribeStatus = context.services.messenger.subscribe("transaction:statusChanged", (payload) => {
      if (payload.id === "tx-resume-1") {
        statusEvents.push(payload);
      }
    });
    const unsubscribeQueued = context.services.messenger.subscribe("transaction:queued", (meta) => {
      queuedEvents.push(meta.id);
    });

    try {
      await context.services.controllers.transactions.resumePending();
      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      const resumedMeta = context.services.controllers.transactions.getMeta("tx-resume-1");
      expect(resumedMeta?.status).toBe("broadcast");
      expect(resumedMeta?.hash).toBe("0x1111111111111111111111111111111111111111111111111111111111111111");

      expect(queuedEvents).toHaveLength(0);
      expect(statusEvents.map(({ previousStatus, nextStatus }) => [previousStatus, nextStatus])).toEqual([
        ["approved", "signed"],
        ["signed", "broadcast"],
      ]);
    } finally {
      unsubscribeStatus();
      unsubscribeQueued();
      context.destroy();
    }
  });

  it("clears invalid transaction snapshots during hydration", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const corruptedSnapshot = {
      version: TRANSACTIONS_SNAPSHOT_VERSION,
      updatedAt: 1_000,
      payload: {
        pending: [
          {
            id: "broken",
            namespace: chain.namespace,
            caip2: chain.chainRef,
            origin: "https://dapp.example",
          },
        ],
        history: [],
      },
    } as unknown as TransactionsSnapshot;

    const logger = vi.fn();

    const context = await setupBackground({
      chainSeed: [chain],
      storageSeed: { [StorageNamespaces.Transactions]: corruptedSnapshot },
      storageLogger: logger,
    });

    try {
      expect(context.services.controllers.transactions.getState()).toEqual({ pending: [], history: [] });
      expect(context.storagePort.clearedSnapshots).toContain(StorageNamespaces.Transactions);
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining("storage: failed to hydrate"),
        expect.objectContaining({
          name: "TypeError",
          message: expect.stringContaining("namespace"),
        }),
      );
    } finally {
      context.destroy();
    }
  });
});
