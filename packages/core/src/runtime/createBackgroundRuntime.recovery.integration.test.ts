import { describe, expect, it, vi } from "vitest";
import type { TransactionAggregate } from "../transactions/aggregate/index.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import type { NamespaceTransaction, NamespaceTransactionTracking } from "../transactions/namespace/types.js";
import {
  createChainMetadata,
  flushAsync,
  MemoryTransactionAggregatesPort,
  setupBackground,
} from "./__fixtures__/backgroundTestSetup.js";

describe("createBackgroundRuntime (recovery integration)", () => {
  it("refreshes submitted transaction monitoring during initialization", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const inspectSubmittedTransaction = vi.fn<NonNullable<NamespaceTransactionTracking["inspectSubmittedTransaction"]>>(
      async () => ({
        trackingStatus: "confirmed",
        receipt: { status: "0x1", blockNumber: "0x10" },
      }),
    );
    const createBroadcastArtifact = vi.fn(async () => ({ kind: "test.raw", payload: { raw: "0x" } }));
    const broadcastTransaction = vi.fn(async () => ({
      broadcastIdentity: { hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      submitted: {
        hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        chainId: "0x1",
        from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        nonce: "0x7",
      },
    }));

    const adapter: NamespaceTransaction = {
      submission: {
        createBroadcastArtifact,
        broadcast: broadcastTransaction,
      },
      tracking: {
        inspectSubmittedTransaction,
        getInitialInspectionDelay: () => 0,
        getPendingInspectionDelay: () => 1_000,
        getRetryInspectionDelay: () => 1_000,
      },
    };

    const txId = "11111111-1111-4111-8111-111111111111";
    const seed: TransactionAggregate = {
      record: {
        id: txId,
        namespace: chain.namespace,
        chainRef: chain.chainRef,
        origin: "https://dapp.example",
        source: "provider",
        requestId: "request-1",
        accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "submitted",
        request: {
          kind: "eip155.transaction",
          payload: {
            from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
          },
        },
        approvedRequest: {
          approvalId: "approval-1",
          payload: {
            nonce: "0x7",
          },
          approvedAt: 1_000,
        },
        activeSubmissionId: null,
        submitted: {
          hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          chainId: "0x1",
          from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          nonce: "0x7",
        },
        receipt: null,
        conflictKey: null,
        replacesTransactionId: null,
        replacementType: null,
        replacedByTransactionId: null,
        terminalReason: null,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      submissions: [
        {
          id: "submission-1",
          transactionId: txId,
          status: "accepted",
          terminalReason: null,
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
    };
    const transactionAggregatesPort = new MemoryTransactionAggregatesPort();
    await transactionAggregatesPort.insertTransactionAggregate(seed);

    const context = await setupBackground({
      chainSeed: [chain],
      transactionAggregatesPort,
      transactions: { namespaces: new NamespaceTransactions([[chain.namespace, adapter]]) },
      persistDebounceMs: 0,
    });

    try {
      await flushAsync();

      expect(createBroadcastArtifact).toHaveBeenCalledTimes(0);
      expect(broadcastTransaction).toHaveBeenCalledTimes(0);
      expect(context.runtime.transactionMonitor.getNextWakeAt()).not.toBeNull();
      expect(inspectSubmittedTransaction).toHaveBeenCalledTimes(0);

      await context.runtime.transactionMonitor.runDue();
      expect(inspectSubmittedTransaction).toHaveBeenCalledTimes(1);

      await expect(context.runtime.transactions.getTransaction(txId)).resolves.toMatchObject({
        status: "confirmed",
        receipt: {
          status: "0x1",
        },
      });
    } finally {
      context.destroy();
    }
  });
});
