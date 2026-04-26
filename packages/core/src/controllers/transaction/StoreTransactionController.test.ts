import { describe, expect, it, vi } from "vitest";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import { Messenger } from "../../messenger/Messenger.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { NamespaceTransaction } from "../../transactions/namespace/types.js";
import { StoreTransactionController } from "./StoreTransactionController.js";
import { TRANSACTION_TOPICS } from "./topics.js";

const accountCodecs = createAccountCodecRegistry([eip155Codec]);
const chainRef = "eip155:10";
const from = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const requestContext = {
  transport: "provider" as const,
  origin: "https://dapp.example",
  portId: "port-1",
  sessionId: "session-1",
  requestId: "request-1",
};

const createTransactionsService = (): TransactionsService => ({
  subscribeChanged: vi.fn(() => () => {}),
  get: vi.fn(async () => null),
  list: vi.fn(async () => []),
  createSubmitted: vi.fn(async () => {
    throw new Error("createSubmitted should not be called");
  }),
  transition: vi.fn(async () => null),
  patchIfStatus: vi.fn(async () => null),
  remove: vi.fn(async () => {}),
});

const createController = (namespaceTransaction: NamespaceTransaction) => {
  const namespaces = new NamespaceTransactions([["eip155", namespaceTransaction]]);
  const accountKey = accountCodecs.toAccountKeyFromAddress({ chainRef, address: from });

  return new StoreTransactionController({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs,
    networkSelection: {
      getSelectedChainRef: () => chainRef,
    },
    supportedChains: {
      getChain: () => null,
    },
    accounts: {
      getActiveAccountForNamespace: () => ({
        accountKey,
        namespace: "eip155",
        chainRef,
        canonicalAddress: from,
        displayAddress: from,
      }),
      listOwnedForNamespace: () => [
        {
          accountKey,
          namespace: "eip155",
          chainRef,
          canonicalAddress: from,
          displayAddress: from,
        },
      ],
    },
    approvals: {
      create: vi.fn((request) => ({
        approvalId: request.approvalId,
        settled: Promise.resolve(undefined as never),
      })),
      onFinished: vi.fn(() => () => {}),
    },
    namespaces,
    service: createTransactionsService(),
    now: () => 1,
  });
};

describe("StoreTransactionController", () => {
  it("projects blocked prepared snapshots for review without making the transaction executable", async () => {
    const prepare = vi.fn(async () => ({
      status: "blocked" as const,
      blocker: {
        reason: "transaction.prepare.insufficient_funds",
        message: "Insufficient funds for transaction.",
      },
      prepared: {
        gas: "0x5208",
        gasPrice: "0x3b9aca00",
      },
    }));
    const buildReview = vi.fn(({ reviewPreparedSnapshot }) => ({
      namespace: "eip155" as const,
      summary: {
        from,
        to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        value: "0x1",
      },
      execution: {
        gas: reviewPreparedSnapshot?.gas,
        gasPrice: reviewPreparedSnapshot?.gasPrice,
      },
    }));
    const controller = createController({
      proposal: {
        prepare,
        buildReview,
      },
      tracking: {
        fetchReceipt: vi.fn(async () => null),
      },
    });

    const handoff = await controller.beginTransactionApproval(
      {
        namespace: "eip155",
        chainRef,
        payload: {
          from,
          to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          value: "0x1",
        },
      },
      requestContext,
    );

    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(controller.getReviewSession(handoff.transactionId)?.status).toBe("blocked"));

    expect(controller.getMeta(handoff.transactionId)?.prepared).toBeNull();
    expect(await controller.approveTransaction(handoff.transactionId)).toMatchObject({
      status: "failed",
      reason: "prepare_blocked",
      message: "Insufficient funds for transaction.",
    });
    expect(controller.getApprovalReview({ transactionId: handoff.transactionId })).toMatchObject({
      prepare: {
        state: "blocked",
        blocker: {
          reason: "transaction.prepare.insufficient_funds",
        },
      },
      namespaceReview: {
        execution: {
          gas: "0x5208",
          gasPrice: "0x3b9aca00",
        },
      },
    });
    expect(buildReview).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewPreparedSnapshot: {
          gas: "0x5208",
          gasPrice: "0x3b9aca00",
        },
      }),
    );
  });
});
