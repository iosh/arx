import { describe, expect, it, vi } from "vitest";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import { Messenger } from "../../messenger/Messenger.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { NamespaceTransaction } from "../../transactions/namespace/types.js";
import { DEFAULT_LOCATOR, DEFAULT_SUBMITTED } from "./__fixtures__/transactionServices.js";
import { StoreTransactionController } from "./StoreTransactionController.js";
import { TRANSACTION_SUBMITTED, TRANSACTION_TOPICS } from "./topics.js";
import type { TransactionView } from "./types.js";

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

const createTransactionsService = (overrides?: Partial<TransactionsService>): TransactionsService => ({
  subscribeChanged: vi.fn(() => () => {}),
  get: vi.fn(async () => null),
  list: vi.fn(async () => []),
  createSubmitted: vi.fn(async () => {
    throw new Error("createSubmitted should not be called");
  }),
  transition: vi.fn(async () => null),
  patchIfStatus: vi.fn(async () => null),
  remove: vi.fn(async () => {}),
  ...overrides,
});

const createController = (
  namespaceTransaction: NamespaceTransaction,
  options?: {
    service?: TransactionsService;
    messenger?: Messenger;
  },
) => {
  const namespaces = new NamespaceTransactions([["eip155", namespaceTransaction]]);
  const accountKey = accountCodecs.toAccountKeyFromAddress({ chainRef, address: from });
  const messenger = options?.messenger ?? new Messenger();

  return new StoreTransactionController({
    messenger: messenger.scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs,
    networkSelection: {
      getSelectedChainRef: () => chainRef,
    },
    supportedChains: {
      getChain: () => null,
    },
    accounts: {
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
    service: options?.service ?? createTransactionsService(),
    now: () => 1,
  });
};

const setView = (controller: StoreTransactionController, id: string, view: TransactionView) => {
  vi.spyOn(controller, "getView").mockImplementation((candidateId: string) => (candidateId === id ? view : undefined));
};

describe("StoreTransactionController", () => {
  it("resolves submission waits from the broadcast result without durable meta fields", async () => {
    const messenger = new Messenger();
    const controller = createController(
      {
        proposal: {
          prepare: vi.fn(async () => ({ status: "ready" as const, prepared: {} })),
        },
        tracking: {
          fetchReceipt: vi.fn(async () => null),
        },
      },
      { messenger },
    );

    const pending = controller.waitForTransactionSubmission("tx-2");
    messenger.publish(TRANSACTION_SUBMITTED, {
      id: "tx-2",
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });

    await expect(pending).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });
  });

  it("loads submission waits from durable storage when in-memory caches are cold", async () => {
    const accountKey = accountCodecs.toAccountKeyFromAddress({ chainRef, address: from });
    const controller = createController(
      {
        proposal: {
          prepare: vi.fn(async () => ({ status: "ready" as const, prepared: {} })),
        },
        tracking: {
          fetchReceipt: vi.fn(async () => null),
        },
      },
      {
        service: createTransactionsService({
          get: vi.fn(async (id) => {
            if (id !== "durable-tx") {
              return null;
            }
            return {
              id,
              chainRef,
              origin: requestContext.origin,
              fromAccountKey: accountKey,
              status: "broadcast" as const,
              submitted: DEFAULT_SUBMITTED,
              locator: DEFAULT_LOCATOR,
              createdAt: 1,
              updatedAt: 1,
            };
          }),
        }),
      },
    );

    await expect(controller.waitForTransactionSubmission("durable-tx")).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });
  });

  it("rejects missing submission waits instead of hanging forever", async () => {
    const controller = createController({
      proposal: {
        prepare: vi.fn(async () => ({ status: "ready" as const, prepared: {} })),
      },
      tracking: {
        fetchReceipt: vi.fn(async () => null),
      },
    });

    await expect(controller.waitForTransactionSubmission("missing-tx")).rejects.toThrow(
      "Transaction missing-tx not found after approval",
    );
  });

  it("rejects submission waits when the proposal failed before broadcast", async () => {
    const controller = createController({
      proposal: {
        prepare: vi.fn(async () => ({ status: "ready" as const, prepared: {} })),
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
          value: "0x0",
        },
      },
      requestContext,
      { from },
    );

    await controller.rejectTransaction(handoff.transactionId, new Error("User cancelled before submission"));

    await expect(controller.waitForTransactionSubmission(handoff.transactionId)).rejects.toMatchObject({
      message: "User cancelled before submission",
    });
  });

  it("resolves submission waits from the runtime outcome cache after local persistence fails", async () => {
    const messenger = new Messenger();
    const controller = createController(
      {
        proposal: {
          prepare: vi.fn(async () => ({ status: "ready" as const, prepared: {} })),
        },
        tracking: {
          fetchReceipt: vi.fn(async () => null),
        },
      },
      { messenger },
    );

    messenger.publish(TRANSACTION_SUBMITTED, {
      id: "tx-persist-failed",
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });

    await expect(controller.waitForTransactionSubmission("tx-persist-failed")).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });
  });

  it("recovers submission waits from an unpersisted proposal view when runtime caches are gone", async () => {
    const controller = createController({
      proposal: {
        prepare: vi.fn(async () => ({ status: "ready" as const, prepared: {} })),
      },
      tracking: {
        fetchReceipt: vi.fn(async () => null),
      },
    });

    setView(controller, "tx-unpersisted", {
      kind: "proposal",
      id: "tx-unpersisted",
      approvalId: "approval-unpersisted",
      namespace: "eip155",
      chainRef,
      origin: requestContext.origin,
      fromAccountKey: accountCodecs.toAccountKeyFromAddress({ chainRef, address: from }),
      from,
      baseRequest: {
        namespace: "eip155",
        chainRef,
        payload: { from, to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", value: "0x0" },
      },
      currentRequest: {
        namespace: "eip155",
        chainRef,
        payload: { from, to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", value: "0x0" },
      },
      draftRevision: 0,
      prepared: { gas: "0x5208" },
      reviewState: {
        sessionToken: null,
        status: null,
        reviewPreparedSnapshot: null,
        blocker: null,
        error: null,
        updatedAt: 1,
      },
      review: {
        updatedAt: 1,
        namespaceReview: null,
        prepare: { state: "ready" },
      },
      phase: "unpersisted",
      failure: {
        error: {
          name: "TransactionPersistenceError",
          message: "Transaction was broadcast but could not be persisted locally.",
          data: {
            submitted: DEFAULT_SUBMITTED,
            locator: DEFAULT_LOCATOR,
          },
        },
        userRejected: false,
      },
      createdAt: 1,
      updatedAt: 1,
    });

    await expect(controller.waitForTransactionSubmission("tx-unpersisted")).resolves.toEqual({
      submitted: DEFAULT_SUBMITTED,
      locator: DEFAULT_LOCATOR,
    });
  });
});
