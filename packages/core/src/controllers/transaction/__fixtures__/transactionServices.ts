import { vi } from "vitest";
import { toAccountKeyFromAddress } from "../../../accounts/addressing/accountKey.js";
import { createAccountCodecRegistry, eip155Codec } from "../../../accounts/addressing/codec.js";
import type { AccountController } from "../../../controllers/account/types.js";
import { Messenger } from "../../../messenger/Messenger.js";
import type { TransactionsService } from "../../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../../storage/records.js";
import type { NamespaceTransactions } from "../../../transactions/namespace/NamespaceTransactions.js";
import type { NamespaceTransaction } from "../../../transactions/namespace/types.js";
import { RuntimeTransactionStore } from "../RuntimeTransactionStore.js";
import type { TransactionReviewSessions } from "../review/session.js";
import type { StoreTransactionView } from "../StoreTransactionView.js";
import { TRANSACTION_TOPICS } from "../topics.js";
import type { TransactionMeta } from "../types.js";

export const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
export const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";
export const DEFAULT_CHAIN_REF = "eip155:10";
export const DEFAULT_FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const DEFAULT_TO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const REQUEST_CONTEXT = {
  transport: "provider" as const,
  origin: "https://dapp.example",
  portId: "port-1",
  sessionId: "session-1",
  requestId: "request-1",
};

export const DEFAULT_LOCATOR = { format: "eip155.tx_hash" as const, value: "0xdeadbeef" };
export const DEFAULT_SUBMITTED = {
  hash: DEFAULT_LOCATOR.value,
  chainId: "0xa",
  from: DEFAULT_FROM,
  nonce: "0x7",
};

export const accountCodecs = createAccountCodecRegistry([eip155Codec]);

export const createReceiptTrackingStub = () => ({
  fetchReceipt: vi.fn(async () => null),
});

export const createNamespaceTransactionStub = (
  overrides?: Partial<{
    deriveForChain: (...args: never[]) => unknown;
    validate: (...args: never[]) => unknown;
    prepare: (...args: never[]) => unknown;
    buildReview: (...args: never[]) => unknown;
    applyDraftEdit: (...args: never[]) => unknown;
    sign: (...args: never[]) => unknown;
    broadcast: (...args: never[]) => unknown;
    tracking: unknown;
  }>,
): NamespaceTransaction => ({
  request: {
    ...(overrides?.deriveForChain ? { deriveForChain: overrides.deriveForChain as never } : {}),
    ...(overrides?.validate ? { validate: overrides.validate as never } : {}),
  },
  proposal: {
    prepare: (overrides?.prepare as never) ?? vi.fn(async () => ({ status: "ready", prepared: {} })),
    ...(overrides?.buildReview ? { buildReview: overrides.buildReview as never } : {}),
    ...(overrides?.applyDraftEdit ? { applyDraftEdit: overrides.applyDraftEdit as never } : {}),
  },
  execution: {
    sign: (overrides?.sign as never) ?? vi.fn(async () => ({ raw: "0x" })),
    broadcast:
      (overrides?.broadcast as never) ??
      vi.fn(async () => ({
        submitted: DEFAULT_SUBMITTED,
        locator: DEFAULT_LOCATOR,
      })),
  },
  ...(overrides?.tracking !== undefined
    ? { tracking: overrides.tracking as never }
    : { tracking: createReceiptTrackingStub() }),
});

export const createRuntime = () =>
  new RuntimeTransactionStore({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs,
  });

export const createDefaultAccountKey = (params?: { chainRef?: string; from?: string }) =>
  toAccountKeyFromAddress({
    chainRef: params?.chainRef ?? DEFAULT_CHAIN_REF,
    address: params?.from ?? DEFAULT_FROM,
    accountCodecs,
  });

export const createAccountControllerStub = (params?: {
  chainRef?: string;
  from?: string;
}): Pick<AccountController, "listOwnedForNamespace"> => {
  const chainRef = params?.chainRef ?? DEFAULT_CHAIN_REF;
  const from = params?.from ?? DEFAULT_FROM;
  const accountKey = createDefaultAccountKey({ chainRef, from });

  return {
    listOwnedForNamespace: () => [
      {
        accountKey,
        namespace: "eip155",
        canonicalAddress: from,
        displayAddress: from,
      },
    ],
  };
};

export const createRuntimeTransaction = (
  runtime: RuntimeTransactionStore,
  input?: Partial<TransactionMeta> & {
    draftRevision?: number;
    fromAccountKey?: string;
  },
): TransactionMeta => {
  const chainRef = input?.chainRef ?? DEFAULT_CHAIN_REF;
  const from = input?.from ?? DEFAULT_FROM;
  return runtime.create({
    id: input?.id ?? REQUEST_ID,
    namespace: input?.namespace ?? "eip155",
    chainRef,
    origin: input?.origin ?? REQUEST_CONTEXT.origin,
    fromAccountKey: input?.fromAccountKey ?? createDefaultAccountKey({ chainRef, from }),
    request: input?.request ?? {
      namespace: "eip155",
      chainRef,
      payload: {
        from,
        to: DEFAULT_TO,
        value: "0x0",
        data: "0x",
      },
    },
    prepared: input?.prepared ?? undefined,
    submitted: input?.submitted ?? undefined,
    locator: input?.locator ?? undefined,
    receipt: input?.receipt ?? undefined,
    replacedId: input?.replacedId ?? undefined,
    error: input?.error ?? undefined,
    userRejected: input?.userRejected ?? undefined,
    draftRevision: input?.draftRevision ?? undefined,
    status: input?.status ?? "pending",
    createdAt: input?.createdAt ?? 1,
    updatedAt: input?.updatedAt ?? 1,
  });
};

export const toRecord = (meta: TransactionMeta): TransactionRecord => ({
  id: meta.id,
  chainRef: meta.chainRef,
  origin: meta.origin,
  fromAccountKey: toAccountKeyFromAddress({
    chainRef: meta.chainRef,
    address: meta.from ?? (meta.request?.payload as { from?: string } | undefined)?.from ?? "",
    accountCodecs,
  }),
  status:
    meta.status === "broadcast" || meta.status === "confirmed" || meta.status === "failed" || meta.status === "replaced"
      ? meta.status
      : "failed",
  submitted: meta.submitted ?? DEFAULT_SUBMITTED,
  locator: meta.locator ?? DEFAULT_LOCATOR,
  ...(meta.receipt !== null ? { receipt: meta.receipt } : {}),
  ...(meta.replacedId !== null ? { replacedId: meta.replacedId } : {}),
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
});

export const createTransactionsServiceStub = (
  overrides?: Partial<{
    get: TransactionsService["get"];
    list: TransactionsService["list"];
    createSubmitted: TransactionsService["createSubmitted"];
    transition: TransactionsService["transition"];
    subscribeChanged: TransactionsService["subscribeChanged"];
    patchIfStatus: TransactionsService["patchIfStatus"];
    remove: TransactionsService["remove"];
  }>,
): TransactionsService => ({
  get: overrides?.get ?? vi.fn(async () => null),
  list: overrides?.list ?? vi.fn(async () => []),
  createSubmitted:
    overrides?.createSubmitted ??
    vi.fn(async (input) => ({
      id: input.id ?? crypto.randomUUID(),
      chainRef: input.chainRef,
      origin: input.origin,
      fromAccountKey: input.fromAccountKey,
      status: input.status,
      submitted: input.submitted,
      locator: input.locator,
      ...(input.receipt !== undefined ? { receipt: input.receipt } : {}),
      ...(input.replacedId !== undefined ? { replacedId: input.replacedId } : {}),
      createdAt: input.createdAt ?? 1,
      updatedAt: input.createdAt ?? 1,
    })),
  transition: overrides?.transition ?? vi.fn(async () => null),
  subscribeChanged: overrides?.subscribeChanged ?? vi.fn(() => () => {}),
  patchIfStatus: overrides?.patchIfStatus ?? vi.fn(async () => null),
  remove: overrides?.remove ?? vi.fn(async () => {}),
});

export const createViewStub = (params?: {
  from?: string;
  getMeta?: StoreTransactionView["getMeta"];
  getOrLoad?: StoreTransactionView["getOrLoad"];
  commitRecord?: StoreTransactionView["commitRecord"];
  requestSync?: StoreTransactionView["requestSync"];
}): StoreTransactionView => {
  const from = params?.from ?? DEFAULT_FROM;
  const commitRecord =
    params?.commitRecord ??
    vi.fn((record: TransactionRecord) => ({
      next: {
        id: record.id,
        namespace: record.chainRef.split(":", 1)[0] ?? "",
        chainRef: record.chainRef,
        origin: record.origin,
        from,
        request: null,
        prepared: null,
        status: record.status,
        submitted: record.submitted,
        locator: record.locator,
        receipt: record.receipt ?? null,
        replacedId: record.replacedId ?? null,
        error: null,
        userRejected: false,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      } satisfies TransactionMeta,
    }));

  return {
    getMeta: params?.getMeta ?? vi.fn(() => undefined),
    getOrLoad: params?.getOrLoad ?? vi.fn(async () => null),
    commitRecord,
    requestSync: params?.requestSync ?? vi.fn(),
  } as StoreTransactionView;
};

export const createPrepareStub = (overrides?: {
  queuePrepare?: (id: string) => void;
  prepareTransactionForExecution?: (id: string) => Promise<TransactionMeta | null>;
}) => ({
  queuePrepare: overrides?.queuePrepare ?? vi.fn(),
  prepareTransactionForExecution: overrides?.prepareTransactionForExecution ?? vi.fn(async () => null),
});

export const createNamespacesStub = (get?: NamespaceTransactions["get"]): Pick<NamespaceTransactions, "get"> => ({
  get:
    get ??
    vi.fn(() =>
      createNamespaceTransactionStub({
        validate: () => undefined,
      }),
    ),
});

export const markReviewReady = (reviewSessions: TransactionReviewSessions, transactionId: string, updatedAt = 1) => {
  const session = reviewSessions.begin(transactionId, updatedAt);
  reviewSessions.markReady(transactionId, session.sessionToken, updatedAt, {});
};
