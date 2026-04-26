import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toAccountKeyFromAddress } from "../accounts/addressing/accountKey.js";
import type { TransactionStatusChange } from "../controllers/index.js";
import { TRANSACTION_STATUS_CHANGED } from "../controllers/transaction/topics.js";
import { NamespaceTransactions } from "../transactions/namespace/NamespaceTransactions.js";
import type {
  NamespaceTransaction,
  NamespaceTransactionExecution,
  NamespaceTransactionProposal,
  NamespaceTransactionTracking,
} from "../transactions/namespace/types.js";
import {
  createChainMetadata,
  flushAsync,
  setupBackground,
  TEST_MNEMONIC,
  TEST_RECEIPT_MAX_DELAY,
  TEST_RECEIPT_POLL_INTERVAL,
} from "./__fixtures__/backgroundTestSetup.js";

const makeRequestContext = (origin: string) => ({
  transport: "provider" as const,
  portId: "test-port",
  sessionId: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
  origin,
});

const buildEip155Submitted = (params: {
  txHash: `0x${string}`;
  from: string;
  chainId?: `0x${string}`;
  prepared?: Record<string, unknown>;
}) => ({
  hash: params.txHash,
  chainId: params.chainId ?? "0x1",
  from: params.from,
  ...(typeof params.prepared?.nonce === "string" ? { nonce: params.prepared.nonce as `0x${string}` } : {}),
});

const createNamespaceTransactionMock = (params: {
  prepareTransaction: NamespaceTransactionProposal["prepare"];
  signTransaction: NamespaceTransactionExecution["sign"];
  broadcastTransaction: NamespaceTransactionExecution["broadcast"];
  tracking?: NamespaceTransactionTracking;
}): NamespaceTransaction => ({
  proposal: {
    prepare: params.prepareTransaction,
  },
  execution: {
    sign: params.signTransaction,
    broadcast: params.broadcastTransaction,
  },
  ...(params.tracking ? { tracking: params.tracking } : {}),
});

const createOwnedAddress = async (context: Awaited<ReturnType<typeof setupBackground>>, chainRef: string) => {
  await context.runtime.services.session.createVault({ password: "test" });
  await context.runtime.services.session.unlock.unlock({ password: "test" });
  const { keyringId } = await context.runtime.services.keyring.confirmNewMnemonic({ mnemonic: TEST_MNEMONIC });
  const account = await context.runtime.services.keyring.deriveAccount(keyringId);
  await context.runtime.controllers.accounts.setActiveAccount({
    namespace: "eip155",
    chainRef,
    accountKey: toAccountKeyFromAddress({
      chainRef,
      address: account.address,
      accountCodecs: context.runtime.services.accountCodecs,
    }),
  });
  return account.address;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createBackgroundRuntime (transactions integration)", () => {
  it("processes an auto-approved transaction through receipt confirmation", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const confirmedReceipt = { status: "0x1", blockNumber: "0x10" };

    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
      status: "ready",
      prepared: {},
    }));
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => ({
      raw: "0x1111",
    }));
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => ({
      submitted: buildEip155Submitted({
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        from: ctx.from ?? "0x0000000000000000000000000000000000000000",
        prepared: prepared as Record<string, unknown>,
      }),
      locator: {
        format: "eip155.tx_hash",
        value: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    }));
    const fetchReceipt = vi.fn<NamespaceTransactionTracking["fetchReceipt"]>(async () => ({
      status: "success",
      receipt: confirmedReceipt,
    }));

    const adapter = createNamespaceTransactionMock({
      prepareTransaction,
      signTransaction,
      broadcastTransaction,
      tracking: { fetchReceipt },
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(chain.namespace, adapter);

    let clock = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      clock += 1;
      return clock;
    });

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const fromAddress = await createOwnedAddress(context, chain.chainRef);
    const unsubscribeAutoApproval = context.enableAutoApproval();
    const statusEvents: TransactionStatusChange[] = [];
    const unsubscribeStatus = context.runtime.bus.subscribe(TRANSACTION_STATUS_CHANGED, (payload) => {
      statusEvents.push(payload);
    });
    try {
      const handoff = await context.runtime.controllers.transactions.beginTransactionApproval(
        {
          namespace: chain.namespace,
          chainRef: chain.chainRef,
          payload: {
            from: fromAddress,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            data: "0x",
          },
        },
        makeRequestContext("https://dapp.example"),
      );
      const approvedMeta = await handoff.waitForApprovalDecision();
      expect(["approved", "signed", "broadcast"]).toContain(approvedMeta.status);
      const submission = await context.runtime.controllers.transactions.waitForTransactionSubmission(
        handoff.transactionId,
      );

      await vi.waitFor(() => expect(prepareTransaction).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));
      expect(fetchReceipt).toHaveBeenCalledTimes(0);

      const broadcastMeta = context.runtime.controllers.transactions.getMeta(handoff.transactionId);
      expect(broadcastMeta?.status).toBe("broadcast");
      expect(submission.locator).toEqual(broadcastMeta?.locator);

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);

      await vi.waitFor(() => expect(fetchReceipt).toHaveBeenCalledTimes(1));

      const timeline = statusEvents
        .filter((event) => event.id === handoff.transactionId)
        .map(({ previousStatus, nextStatus }) => [previousStatus, nextStatus]);

      expect(timeline).toEqual([
        ["pending", "approved"],
        ["approved", "signed"],
        ["signed", "broadcast"],
        ["broadcast", "confirmed"],
      ]);

      const confirmedMeta = context.runtime.controllers.transactions.getMeta(handoff.transactionId);
      expect(confirmedMeta?.status).toBe("confirmed");
      expect(confirmedMeta?.receipt).toMatchObject(confirmedReceipt);

      const stored = await context.transactionsPort.get(handoff.transactionId);
      expect(stored?.status).toBe("confirmed");
    } finally {
      nowSpy.mockRestore();
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

    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
      status: "ready",
      prepared: {},
    }));
    let signedCount = 0;
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => {
      signedCount += 1;
      return {
        raw: "0x1111",
      };
    });
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => ({
      locator: {
        format: "eip155.tx_hash",
        value: `0x${(signedCount + 100).toString(16).padStart(64, "0")}` as `0x${string}`,
      },
      submitted: buildEip155Submitted({
        txHash: `0x${(signedCount + 100).toString(16).padStart(64, "0")}` as `0x${string}`,
        from: ctx.from ?? "0x0000000000000000000000000000000000000000",
        prepared: prepared as Record<string, unknown>,
      }),
    }));
    const fetchReceipt = vi.fn<NamespaceTransactionTracking["fetchReceipt"]>(async () => null);

    const adapter = createNamespaceTransactionMock({
      prepareTransaction,
      signTransaction,
      broadcastTransaction,
      tracking: { fetchReceipt },
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(chain.namespace, adapter);

    let clock = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      clock += 1;
      return clock;
    });

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const fromAddress = await createOwnedAddress(context, chain.chainRef);

    const unsubscribeAutoApproval = context.enableAutoApproval();
    const statusEvents: TransactionStatusChange[] = [];
    const unsubscribeStatus = context.runtime.bus.subscribe(TRANSACTION_STATUS_CHANGED, (payload) => {
      statusEvents.push(payload);
    });

    try {
      const fromAddresses = [fromAddress, fromAddress, fromAddress];
      const toAddresses = [
        "0xdddddddddddddddddddddddddddddddddddddddd",
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "0xffffffffffffffffffffffffffffffffffffffff",
      ];

      const submissionIds = await Promise.all(
        fromAddresses.map(async (from, index) => {
          const handoff = await context.runtime.controllers.transactions.beginTransactionApproval(
            {
              namespace: chain.namespace,
              chainRef: chain.chainRef,
              payload: {
                from,
                to: toAddresses[index],
                value: "0x0",
                data: "0x",
              },
            },
            makeRequestContext("https://dapp.example"),
          );
          await handoff.waitForApprovalDecision();
          return handoff.transactionId;
        }),
      );

      await vi.waitFor(() => expect(prepareTransaction).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(3));
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(3));

      for (const id of submissionIds) {
        const meta = context.runtime.controllers.transactions.getMeta(id);
        expect(meta?.status).toBe("broadcast");
      }

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
      nowSpy.mockRestore();
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
    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
      status: "ready",
      prepared: {},
    }));
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => ({
      raw: "0x1111",
    }));
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => ({
      submitted: buildEip155Submitted({
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        from: ctx.from ?? "0x0000000000000000000000000000000000000000",
        prepared: prepared as Record<string, unknown>,
      }),
      locator: {
        format: "eip155.tx_hash",
        value: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    }));
    const fetchReceipt = vi.fn<NamespaceTransactionTracking["fetchReceipt"]>(async () => null);
    const detectReplacement = vi.fn<NonNullable<NamespaceTransactionTracking["detectReplacement"]>>(async () => ({
      status: "replaced",
    }));

    const adapter = createNamespaceTransactionMock({
      prepareTransaction,
      signTransaction,
      broadcastTransaction,
      tracking: {
        fetchReceipt,
        detectReplacement,
      },
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const fromAddress = await createOwnedAddress(context, chain.chainRef);

    const unsubscribeAutoApproval = context.enableAutoApproval();
    try {
      const handoff = await context.runtime.controllers.transactions.beginTransactionApproval(
        {
          namespace: chain.namespace,
          chainRef: chain.chainRef,
          payload: {
            from: fromAddress,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            data: "0x",
          },
        },
        makeRequestContext("https://dapp.example"),
      );
      await handoff.waitForApprovalDecision();

      await vi.waitFor(() => expect(prepareTransaction).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);
      expect(detectReplacement).toHaveBeenCalledTimes(1);

      const replacedMeta = context.runtime.controllers.transactions.getMeta(handoff.transactionId);
      expect(replacedMeta?.status).toBe("replaced");
      expect(replacedMeta?.locator).toEqual({
        format: "eip155.tx_hash",
        value: "0x1111111111111111111111111111111111111111111111111111111111111111",
      });

      const stored = await context.transactionsPort.get(handoff.transactionId);
      expect(stored?.status).toBe("replaced");
      expect(stored?.locator).toEqual({
        format: "eip155.tx_hash",
        value: "0x1111111111111111111111111111111111111111111111111111111111111111",
      });
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });

  it("links a replaced broadcast transaction to the confirmed local replacement", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const hashes = [
      "0x1111111111111111111111111111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222222222222222222222222222",
    ] as const;

    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
      status: "ready",
      prepared: {
        chainId: "0x1",
        nonce: "0x7",
      },
    }));
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => ({
      raw: "0x1111",
    }));
    let broadcastIndex = 0;
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => {
      const txHash = hashes[broadcastIndex] ?? hashes[hashes.length - 1];
      broadcastIndex += 1;
      return {
        submitted: buildEip155Submitted({
          txHash,
          from: ctx.from ?? "0x0000000000000000000000000000000000000000",
          prepared: prepared as Record<string, unknown>,
        }),
        locator: {
          format: "eip155.tx_hash",
          value: txHash,
        },
      };
    });
    const fetchReceipt = vi.fn<NamespaceTransactionTracking["fetchReceipt"]>(async (trackingContext) => {
      const submitted = trackingContext.submitted as { hash?: unknown };
      if (submitted.hash === hashes[1]) {
        return { status: "success", receipt: { status: "0x1", transactionHash: hashes[1] } };
      }
      return null;
    });
    const detectReplacement = vi.fn<NonNullable<NamespaceTransactionTracking["detectReplacement"]>>(async () => null);

    const adapter: NamespaceTransaction = {
      proposal: {
        prepare: prepareTransaction,
      },
      execution: {
        sign: signTransaction,
        broadcast: broadcastTransaction,
      },
      tracking: {
        fetchReceipt,
        detectReplacement,
        deriveReplacementKey: (trackingContext) => {
          const submitted = trackingContext.submitted as { from?: unknown; nonce?: unknown };
          if (typeof submitted.from !== "string" || typeof submitted.nonce !== "string") return null;
          return {
            scope: "eip155.nonce",
            value: `${trackingContext.chainRef}:${submitted.from.toLowerCase()}:${submitted.nonce.toLowerCase()}`,
          };
        },
      },
    };
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const fromAddress = await createOwnedAddress(context, chain.chainRef);

    const unsubscribeAutoApproval = context.enableAutoApproval();
    try {
      const first = await context.runtime.controllers.transactions.beginTransactionApproval(
        {
          namespace: chain.namespace,
          chainRef: chain.chainRef,
          payload: {
            from: fromAddress,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            data: "0x",
          },
        },
        makeRequestContext("https://dapp.example"),
      );
      await first.waitForApprovalDecision();
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));

      const second = await context.runtime.controllers.transactions.beginTransactionApproval(
        {
          namespace: chain.namespace,
          chainRef: chain.chainRef,
          payload: {
            from: fromAddress,
            to: "0xcccccccccccccccccccccccccccccccccccccccc",
            value: "0x0",
            data: "0x",
            nonce: "0x7",
          },
        },
        makeRequestContext("https://dapp.example"),
      );
      await second.waitForApprovalDecision();
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(2));

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      await vi.waitFor(() => {
        const replacement = context.runtime.controllers.transactions.getMeta(second.transactionId);
        expect(replacement?.status).toBe("confirmed");
      });

      const replaced = context.runtime.controllers.transactions.getMeta(first.transactionId);
      expect(replaced).toMatchObject({
        status: "replaced",
        replacedId: second.transactionId,
      });

      const stored = await context.transactionsPort.get(first.transactionId);
      expect(stored).toMatchObject({
        status: "replaced",
        replacedId: second.transactionId,
      });
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });

  it("does not misclassify transient receipt polling errors as terminal failure", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });
    const confirmedReceipt = { status: "0x1", blockNumber: "0x10" };

    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
      status: "ready",
      prepared: {},
    }));
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => ({
      raw: "0x1111",
    }));
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => ({
      submitted: buildEip155Submitted({
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        from: ctx.from ?? "0x0000000000000000000000000000000000000000",
        prepared: prepared as Record<string, unknown>,
      }),
      locator: {
        format: "eip155.tx_hash",
        value: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    }));
    const fetchReceipt = vi
      .fn<NamespaceTransactionTracking["fetchReceipt"]>()
      .mockRejectedValueOnce(new Error("RPC temporary failure"))
      .mockResolvedValueOnce({ status: "success", receipt: confirmedReceipt });

    const adapter = createNamespaceTransactionMock({
      prepareTransaction,
      signTransaction,
      broadcastTransaction,
      tracking: { fetchReceipt },
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const fromAddress = await createOwnedAddress(context, chain.chainRef);
    const unsubscribeAutoApproval = context.enableAutoApproval();

    try {
      const handoff = await context.runtime.controllers.transactions.beginTransactionApproval(
        {
          namespace: chain.namespace,
          chainRef: chain.chainRef,
          payload: {
            from: fromAddress,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            data: "0x",
          },
        },
        makeRequestContext("https://dapp.example"),
      );
      await handoff.waitForApprovalDecision();

      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);
      const afterError = context.runtime.controllers.transactions.getMeta(handoff.transactionId);
      expect(afterError?.status).toBe("broadcast");

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL * 2);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(2);

      await vi.waitFor(() => {
        const confirmed = context.runtime.controllers.transactions.getMeta(handoff.transactionId);
        expect(confirmed?.status).toBe("confirmed");
      });
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });

  it("rejects new transaction approvals before broadcast when receipt tracking is unsupported by the adapter", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
      status: "ready",
      prepared: {},
    }));
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => ({
      raw: "0x1111",
    }));
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => ({
      submitted: buildEip155Submitted({
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        from: ctx.from ?? "0x0000000000000000000000000000000000000000",
        prepared: prepared as Record<string, unknown>,
      }),
      locator: {
        format: "eip155.tx_hash",
        value: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    }));

    // No `tracking` capability.
    const adapter = createNamespaceTransactionMock({
      prepareTransaction,
      signTransaction,
      broadcastTransaction,
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });

    try {
      await expect(
        context.runtime.controllers.transactions.beginTransactionApproval(
          {
            namespace: chain.namespace,
            chainRef: chain.chainRef,
            payload: {
              from: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              value: "0x0",
              data: "0x",
            },
          },
          makeRequestContext("https://dapp.example"),
        ),
      ).rejects.toMatchObject({
        reason: "ChainNotSupported",
      });

      expect(prepareTransaction).toHaveBeenCalledTimes(0);
      expect(signTransaction).toHaveBeenCalledTimes(0);
      expect(broadcastTransaction).toHaveBeenCalledTimes(0);
      await expect(context.transactionsPort.list()).resolves.toEqual([]);
    } finally {
      context.destroy();
    }
  });

  it("marks a broadcast transaction as failed when receipt polling exceeds max attempts", async () => {
    const chain = createChainMetadata({
      chainRef: "eip155:1",
      chainId: "0x1",
      displayName: "Ethereum Mainnet",
    });

    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
      status: "ready",
      prepared: {},
    }));
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => ({
      raw: "0x1111",
    }));
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => ({
      submitted: buildEip155Submitted({
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        from: ctx.from ?? "0x0000000000000000000000000000000000000000",
        prepared: prepared as Record<string, unknown>,
      }),
      locator: {
        format: "eip155.tx_hash",
        value: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    }));
    const fetchReceipt = vi.fn<NamespaceTransactionTracking["fetchReceipt"]>(async () => null);

    const adapter = createNamespaceTransactionMock({
      prepareTransaction,
      signTransaction,
      broadcastTransaction,
      tracking: { fetchReceipt },
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const fromAddress = await createOwnedAddress(context, chain.chainRef);
    const unsubscribeAutoApproval = context.enableAutoApproval();

    try {
      const handoff = await context.runtime.controllers.transactions.beginTransactionApproval(
        {
          namespace: chain.namespace,
          chainRef: chain.chainRef,
          payload: {
            from: fromAddress,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            data: "0x",
          },
        },
        makeRequestContext("https://dapp.example"),
      );
      await handoff.waitForApprovalDecision();

      await flushAsync();

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const delay = Math.min(TEST_RECEIPT_POLL_INTERVAL * 2 ** attempt, TEST_RECEIPT_MAX_DELAY);
        await vi.advanceTimersByTimeAsync(delay);
        await flushAsync();
      }

      expect(fetchReceipt).toHaveBeenCalledTimes(20);

      const failedMeta = context.runtime.controllers.transactions.getMeta(handoff.transactionId);
      expect(failedMeta?.status).toBe("failed");

      const stored = await context.transactionsPort.get(handoff.transactionId);
      expect(stored?.status).toBe("failed");
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

    const prepareTransaction = vi.fn<NamespaceTransactionProposal["prepare"]>(async () => ({
      status: "ready",
      prepared: {},
    }));
    const signTransaction = vi.fn<NamespaceTransactionExecution["sign"]>(async () => ({
      raw: "0x1111",
    }));
    const broadcastTransaction = vi.fn<NamespaceTransactionExecution["broadcast"]>(async (ctx, _signed, prepared) => ({
      submitted: buildEip155Submitted({
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        from: ctx.from ?? "0x0000000000000000000000000000000000000000",
        prepared: prepared as Record<string, unknown>,
      }),
      locator: {
        format: "eip155.tx_hash",
        value: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    }));
    const fetchReceipt = vi.fn<NamespaceTransactionTracking["fetchReceipt"]>(async () => ({
      status: "failed",
      receipt: failedReceipt,
    }));

    const adapter = createNamespaceTransactionMock({
      prepareTransaction,
      signTransaction,
      broadcastTransaction,
      tracking: { fetchReceipt },
    });
    const namespaceTransactions = new NamespaceTransactions();
    namespaceTransactions.register(chain.namespace, adapter);

    const context = await setupBackground({
      chainSeed: [chain],
      transactions: { namespaces: namespaceTransactions },
      persistDebounceMs: 0,
    });
    const fromAddress = await createOwnedAddress(context, chain.chainRef);
    const unsubscribeAutoApproval = context.enableAutoApproval();

    try {
      const handoff = await context.runtime.controllers.transactions.beginTransactionApproval(
        {
          namespace: chain.namespace,
          chainRef: chain.chainRef,
          payload: {
            from: fromAddress,
            to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            value: "0x0",
            data: "0x",
          },
        },
        makeRequestContext("https://dapp.example"),
      );
      await handoff.waitForApprovalDecision();

      await vi.waitFor(() => expect(prepareTransaction).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(broadcastTransaction).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(TEST_RECEIPT_POLL_INTERVAL);
      await flushAsync();

      expect(fetchReceipt).toHaveBeenCalledTimes(1);

      const failedMeta = context.runtime.controllers.transactions.getMeta(handoff.transactionId);
      expect(failedMeta?.status).toBe("failed");
      expect(failedMeta?.receipt).toMatchObject(failedReceipt);

      const stored = await context.transactionsPort.get(handoff.transactionId);
      expect(stored?.status).toBe("failed");
      expect(stored?.receipt).toMatchObject(failedReceipt);
    } finally {
      unsubscribeAutoApproval();
      context.destroy();
    }
  });
});
