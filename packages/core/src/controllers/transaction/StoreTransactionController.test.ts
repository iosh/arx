import { describe, expect, it, vi } from "vitest";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import { Messenger } from "../../messenger/Messenger.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { NamespaceTransaction } from "../../transactions/namespace/types.js";
import { DEFAULT_LOCATOR, DEFAULT_SUBMITTED } from "./__fixtures__/transactionServices.js";
import { StoreTransactionController } from "./StoreTransactionController.js";
import { TRANSACTION_STATUS_CHANGED, TRANSACTION_TOPICS } from "./topics.js";
import type { TransactionMeta } from "./types.js";

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

const createBroadcastRecord = (id: string): TransactionRecord => ({
  id,
  chainRef,
  origin: requestContext.origin,
  fromAccountKey: accountCodecs.toAccountKeyFromAddress({ chainRef, address: from }),
  status: "broadcast",
  submitted: DEFAULT_SUBMITTED,
  locator: DEFAULT_LOCATOR,
  createdAt: 1,
  updatedAt: 1,
});

const createBroadcastMeta = (id: string): TransactionMeta => ({
  id,
  namespace: "eip155",
  chainRef,
  origin: requestContext.origin,
  from,
  request: null,
  prepared: null,
  status: "broadcast",
  submitted: DEFAULT_SUBMITTED,
  locator: DEFAULT_LOCATOR,
  receipt: null,
  replacedId: null,
  error: null,
  userRejected: false,
  createdAt: 1,
  updatedAt: 1,
});

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

describe("StoreTransactionController", () => {
  it("does not miss submission while loading the initial transaction state", async () => {
    const messenger = new Messenger();
    const service = createTransactionsService();
    const controller = createController(
      {
        proposal: {
          prepare: vi.fn(async () => ({ status: "ready" as const, prepared: {} })),
        },
        tracking: {
          fetchReceipt: vi.fn(async () => null),
        },
      },
      { service, messenger },
    );
    const record = createBroadcastRecord("tx-1");
    vi.mocked(service.get).mockImplementationOnce(async () => {
      messenger.publish(TRANSACTION_STATUS_CHANGED, {
        id: record.id,
        previousStatus: "signed",
        nextStatus: "broadcast",
        meta: createBroadcastMeta(record.id),
      });
      return record;
    });

    const pending = controller.waitForTransactionSubmission(record.id);
    await expect(pending).resolves.toMatchObject({
      locator: DEFAULT_LOCATOR,
      meta: {
        id: record.id,
        status: "broadcast",
      },
    });
  });
});
