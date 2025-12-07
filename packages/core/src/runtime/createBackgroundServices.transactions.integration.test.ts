import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionStatusChange } from "../controllers/index.js";
import { TransactionAdapterRegistry } from "../transactions/adapters/registry.js";
import type { TransactionAdapter } from "../transactions/adapters/types.js";
import {
  createChainMetadata,
  flushAsync,
  isTransactionsSnapshot,
  setupBackground,
  TEST_RECEIPT_MAX_DELAY,
  TEST_RECEIPT_POLL_INTERVAL,
} from "./__fixtures__/backgroundTestSetup.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackgroundServices (transactions integration)", () => {
  it("processes an auto-approved transaction through receipt confirmation", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const confirmedReceipt = { status: "0x1", blockNumber: "0x10" };

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
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => ({
      status: "success",
      receipt: confirmedReceipt,
    }));

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction, fetchReceipt };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });
    const unsubscribeAutoApproval = context.enableAutoApproval();
    const statusEvents: TransactionStatusChange[] = [];
    const unsubscribeStatus = context.services.messenger.subscribe("transaction:statusChanged", (payload) => {
      statusEvents.push(payload);
    });
    try {
      const submission = await context.services.controllers.transactions.submitTransaction("https://dapp.example", {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      });

      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);
      expect(fetchReceipt).not.toHaveBeenCalled();

      const broadcastMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(broadcastMeta?.status).toBe("broadcast");

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);

      const timeline = statusEvents
        .filter((event) => event.id === submission.id)
        .map(({ previousStatus, nextStatus }) => [previousStatus, nextStatus]);

      expect(timeline).toEqual([
        ["pending", "approved"],
        ["approved", "signed"],
        ["signed", "broadcast"],
        ["broadcast", "confirmed"],
      ]);

      const confirmedMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(confirmedMeta?.status).toBe("confirmed");
      expect(confirmedMeta?.receipt).toMatchObject(confirmedReceipt);

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const latest = snapshots.at(-1)?.envelope.payload.history.find((item) => item.id === submission.id);
      expect(latest?.status).toBe("confirmed");
    } finally {
      unsubscribeAutoApproval();
      unsubscribeStatus();
      context.destroy();
    }
  });

  it("handles multiple concurrent transactions independently", async () => {
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
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => null);

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction, fetchReceipt };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });

    const unsubscribeAutoApproval = context.enableAutoApproval();
    const statusEvents: TransactionStatusChange[] = [];
    const unsubscribeStatus = context.services.messenger.subscribe("transaction:statusChanged", (payload) => {
      statusEvents.push(payload);
    });

    try {
      const fromAddresses = [
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "0xcccccccccccccccccccccccccccccccccccccccc",
      ];
      const toAddresses = [
        "0xdddddddddddddddddddddddddddddddddddddddd",
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "0xffffffffffffffffffffffffffffffffffffffff",
      ];

      const submissions = await Promise.all(
        fromAddresses.map((from, index) =>
          context.services.controllers.transactions.submitTransaction("https://dapp.example", {
            namespace: chain.namespace,
            caip2: chain.chainRef,
            payload: {
              from,
              to: toAddresses[index],
              value: "0x0",
              data: "0x",
            },
          }),
        ),
      );

      await flushAsync();

      await vi.waitFor(() => expect(buildDraft).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(3));

      const state = context.services.controllers.transactions.getState();
      expect(state.pending).toHaveLength(0);
      expect(state.history).toHaveLength(3);

      const submissionIds = submissions.map((submission) => submission.id);
      expect(new Set(state.history.map((meta) => meta.id))).toEqual(new Set(submissionIds));
      expect(state.history.every((meta) => meta.status === "broadcast")).toBe(true);

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const storedHistory = snapshots.at(-1)?.envelope.payload.history ?? [];
      expect(storedHistory.map((meta) => meta.id)).toEqual(expect.arrayContaining(submissionIds));
      expect(storedHistory.every((meta) => meta.status === "broadcast")).toBe(true);

      submissionIds.forEach((id) => {
        const timeline = statusEvents
          .filter((event) => event.id === id)
          .map(({ previousStatus, nextStatus }) => [previousStatus, nextStatus]);

        expect(timeline).toEqual([
          ["pending", "approved"],
          ["approved", "signed"],
          ["signed", "broadcast"],
        ]);
      });
    } finally {
      unsubscribeAutoApproval();
      unsubscribeStatus();
      context.destroy();
    }
  });

  it("marks a broadcast transaction as replaced when detectReplacement resolves", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const replacementHash = "0x2222222222222222222222222222222222222222222222222222222222222222";

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
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => null);
    const detectReplacement = vi.fn<NonNullable<TransactionAdapter["detectReplacement"]>>(async () => ({
      status: "replaced",
      hash: replacementHash,
    }));

    const adapter: TransactionAdapter = {
      buildDraft,
      signTransaction,
      broadcastTransaction,
      fetchReceipt,
      detectReplacement,
    };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });

    const unsubscribeAutoApproval = context.enableAutoApproval();
    try {
      const submission = await context.services.controllers.transactions.submitTransaction("https://dapp.example", {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      });

      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);
      expect(detectReplacement).toHaveBeenCalledTimes(1);

      const replacedMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(replacedMeta?.status).toBe("replaced");
      expect(replacedMeta?.hash).toBe(replacementHash);
      expect(replacedMeta?.error?.name).toBe("TransactionReplacedError");

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const latest = snapshots.at(-1)?.envelope.payload.history.find((item) => item.id === submission.id);
      expect(latest?.status).toBe("replaced");
      expect(latest?.hash).toBe(replacementHash);
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });

  it("marks a broadcast transaction as failed when receipt polling exceeds max attempts", async () => {
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
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => null);

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction, fetchReceipt };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });
    const unsubscribeAutoApproval = context.enableAutoApproval();

    try {
      const submission = await context.services.controllers.transactions.submitTransaction("https://dapp.example", {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      });

      await flushAsync();

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const delay = Math.min(TEST_RECEIPT_POLL_INTERVAL * 2 ** attempt, TEST_RECEIPT_MAX_DELAY);
        await vi.advanceTimersByTimeAsync(delay);
        await flushAsync();
      }

      expect(fetchReceipt).toHaveBeenCalledTimes(20);

      const failedMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(failedMeta?.status).toBe("failed");
      expect(failedMeta?.error?.name).toBe("TransactionReceiptTimeoutError");

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const latest = snapshots.at(-1)?.envelope.payload.history.find((item) => item.id === submission.id);
      expect(latest?.status).toBe("failed");
      expect(latest?.error?.name).toBe("TransactionReceiptTimeoutError");
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });

  it("marks a broadcast transaction as failed when receipt resolution reports failure", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const failedReceipt = { status: "0x0", blockNumber: "0x20" };

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
    const fetchReceipt = vi.fn<NonNullable<TransactionAdapter["fetchReceipt"]>>(async () => ({
      status: "failed",
      receipt: failedReceipt,
    }));

    const adapter: TransactionAdapter = { buildDraft, signTransaction, broadcastTransaction, fetchReceipt };
    const registry = new TransactionAdapterRegistry();
    registry.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { registry },
      persistDebounceMs: 0,
    });
    const unsubscribeAutoApproval = context.enableAutoApproval();

    try {
      const submission = await context.services.controllers.transactions.submitTransaction("https://dapp.example", {
        namespace: chain.namespace,
        caip2: chain.chainRef,
        payload: {
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x0",
          data: "0x",
        },
      });

      await flushAsync();

      expect(buildDraft).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
      expect(broadcastTransaction).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);

      const failedMeta = context.services.controllers.transactions.getMeta(submission.id);
      expect(failedMeta?.status).toBe("failed");
      expect(failedMeta?.error?.name).toBe("TransactionExecutionFailed");
      expect(failedMeta?.receipt).toMatchObject(failedReceipt);

      const snapshots = context.storagePort.savedSnapshots.filter(isTransactionsSnapshot);
      const latest = snapshots.at(-1)?.envelope.payload.history.find((item) => item.id === submission.id);
      expect(latest?.status).toBe("failed");
      expect(latest?.error?.name).toBe("TransactionExecutionFailed");
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });
});
