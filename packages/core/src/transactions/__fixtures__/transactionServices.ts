import { vi } from "vitest";
import { toAccountKeyFromAddress } from "../../accounts/addressing/accountKey.js";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import type { AccountController } from "../../controllers/account/types.js";
import { Messenger } from "../../messenger/Messenger.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionStatus as StorageTransactionStatus, TransactionRecord } from "../../storage/records.js";
import { buildEip155ApprovalReview } from "../namespace/eip155/approvalReview.js";
import type { Eip155UnsignedTransaction } from "../namespace/eip155/unsignedTransaction.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { NamespaceTransaction } from "../namespace/types.js";
import type { TransactionProposalTerminationReason } from "../proposal/index.js";
import { TransactionProposalRuntime } from "../proposal/TransactionProposalRuntime.js";
import type { TransactionProposalMeta } from "../proposal/types.js";
import type { TransactionRecordView } from "../record/index.js";
import type { TransactionRecordViewStore } from "../record/TransactionRecordViewStore.js";
import { TRANSACTION_TOPICS } from "../topics.js";
import type { TransactionReviewSnapshot } from "../types.js";

export const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
export const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";
export const DEFAULT_CHAIN_REF = "eip155:10";
export const DEFAULT_FROM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const DEFAULT_TO = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const APPROVAL_REQUESTER = {
  origin: "https://dapp.example",
  initiator: "dapp" as const,
  requestId: "request-1",
};

export const DEFAULT_SUBMITTED = {
  hash: "0xdeadbeef",
  chainId: "0xa",
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  value: "0x0",
  data: "0x",
  gas: "0x5208",
  nonce: "0x7",
};

export const DEFAULT_UNSIGNED_TRANSACTION: Eip155UnsignedTransaction = {
  type: "legacy",
  chainId: "0xa",
  from: DEFAULT_FROM,
  to: DEFAULT_TO,
  value: "0x0",
  data: "0x",
  gas: "0x5208",
  nonce: "0x7",
  gasPrice: "0x3b9aca00",
};

export const accountCodecs = createAccountCodecRegistry([eip155Codec]);

export const createReceiptTrackingStub = () => ({
  fetchReceipt: vi.fn(async () => null),
});

export const createNamespaceTransactionStub = (
  overrides?: Partial<{
    deriveForChain: (...args: never[]) => unknown;
    validateRequest: (...args: never[]) => unknown;
    prepare: (...args: never[]) => unknown;
    buildReview: (...args: never[]) => unknown;
    applyDraftEdit: (...args: never[]) => unknown;
    deriveConflictKey: (...args: never[]) => unknown;
    sign: (...args: never[]) => unknown;
    broadcast: (...args: never[]) => unknown;
    parseSubmitted: (...args: never[]) => unknown;
    parseReceipt: (...args: never[]) => unknown;
    tracking: unknown;
  }>,
): NamespaceTransaction => ({
  request: {
    ...(overrides?.deriveForChain ? { deriveForChain: overrides.deriveForChain as never } : {}),
    ...(overrides?.validateRequest ? { validateRequest: overrides.validateRequest as never } : {}),
  },
  proposal: {
    prepare:
      (overrides?.prepare as never) ??
      vi.fn(async () => ({ status: "ready", prepared: structuredClone(DEFAULT_UNSIGNED_TRANSACTION) })),
    buildReview: (overrides?.buildReview as never) ?? buildEip155ApprovalReview,
    ...(overrides?.applyDraftEdit ? { applyDraftEdit: overrides.applyDraftEdit as never } : {}),
    ...(overrides?.deriveConflictKey ? { deriveConflictKey: overrides.deriveConflictKey as never } : {}),
  },
  execution: {
    sign: (overrides?.sign as never) ?? vi.fn(async () => ({ raw: "0x" })),
    broadcast:
      (overrides?.broadcast as never) ??
      vi.fn(async () => ({
        submitted: DEFAULT_SUBMITTED,
      })),
  },
  record: {
    parseSubmitted: (overrides?.parseSubmitted as never) ?? vi.fn((submitted) => submitted),
    parseReceipt: (overrides?.parseReceipt as never) ?? vi.fn((receipt) => receipt),
  },
  ...(overrides?.tracking !== undefined
    ? { tracking: overrides.tracking as never }
    : { tracking: createReceiptTrackingStub() }),
});

export const createProposalRuntime = () =>
  new TransactionProposalRuntime({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs,
  });

const makeProposalReadyForApproval = (
  proposalRuntime: TransactionProposalRuntime,
  transactionId: string,
  input?: {
    updatedAt?: number;
    executionPrepared?: NonNullable<TransactionProposalMeta["prepared"]>;
    reviewSnapshot?: TransactionReviewSnapshot;
  },
) => {
  const updatedAt = input?.updatedAt ?? 1;
  const current = proposalRuntime.peek(transactionId);
  if (!current) {
    throw new Error(`Proposal ${transactionId} not found`);
  }

  const session = proposalRuntime.getOrStartPrepare({
    id: transactionId,
    requestRevision: current.prepare.requestRevision,
    updatedAt,
  });
  if (session.status !== "opened") {
    throw new Error(`Proposal ${transactionId} could not start prepare session`);
  }

  const executionPrepared = input?.executionPrepared ?? structuredClone(DEFAULT_UNSIGNED_TRANSACTION);
  const settled = proposalRuntime.settlePrepareReady({
    id: transactionId,
    expectedRequestRevision: current.prepare.requestRevision,
    sessionToken: session.review.sessionToken,
    updatedAt,
    executionPrepared,
    reviewSnapshot: input?.reviewSnapshot ?? executionPrepared,
  });
  if (settled.status !== "settled") {
    throw new Error(`Proposal ${transactionId} could not settle ready review`);
  }
};

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

export const createTransactionProposal = (
  proposalRuntime: TransactionProposalRuntime,
  input?: Partial<TransactionProposalMeta> & {
    status?: "active" | "approved" | "terminated" | undefined;
    requestRevision?: number;
    fromAccountKey?: string;
    terminationReason?: TransactionProposalTerminationReason;
    error?: { name: string; message: string; code?: number; data?: unknown } | null;
  },
): TransactionProposalMeta => {
  const chainRef = input?.chainRef ?? DEFAULT_CHAIN_REF;
  const from = input?.from ?? DEFAULT_FROM;
  const requestedStatus = input?.status ?? "active";
  const created = proposalRuntime.createPendingProposal({
    id: input?.id ?? REQUEST_ID,
    namespace: input?.namespace ?? "eip155",
    chainRef,
    origin: input?.origin ?? APPROVAL_REQUESTER.origin,
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
    requestRevision: input?.requestRevision ?? undefined,
    createdAt: input?.createdAt ?? 1,
    updatedAt: input?.updatedAt ?? 1,
  });

  if (requestedStatus === "active") return created;

  const id = created.id;
  const updatedAt = input?.updatedAt ?? 1;
  if (requestedStatus === "approved") {
    makeProposalReadyForApproval(proposalRuntime, id, {
      updatedAt,
      executionPrepared: input?.prepared ?? structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
      reviewSnapshot: input?.prepared ?? structuredClone(DEFAULT_UNSIGNED_TRANSACTION),
    });
    const approved = proposalRuntime.approvePendingProposal({ id, updatedAt });
    if (approved.status !== "approved") {
      throw new Error(`Proposal ${id} could not be approved`);
    }
    return proposalRuntime.get(id) ?? created;
  }
  if (requestedStatus === "terminated") {
    const failed = proposalRuntime.failProposal({
      id,
      updatedAt,
      error: input?.error ?? null,
      terminationReason: input?.terminationReason ?? "execution_failed",
    });
    if (failed.status !== "failed") {
      throw new Error(`Proposal ${id} could not be failed`);
    }
    return failed.proposal;
  }
  return created;
};

export const toRecord = (
  meta: Pick<TransactionProposalMeta, "id" | "namespace" | "chainRef" | "origin" | "from" | "createdAt" | "updatedAt">,
  status: StorageTransactionStatus = "broadcast",
  patch?: Partial<Pick<TransactionRecord, "receipt" | "replacedByRecordId" | "replacementKey">>,
): TransactionRecord => ({
  id: meta.id,
  namespace: meta.namespace,
  chainRef: meta.chainRef,
  origin: meta.origin,
  accountKey: toAccountKeyFromAddress({
    chainRef: meta.chainRef,
    address: meta.from,
    accountCodecs,
  }),
  status,
  submitted: DEFAULT_SUBMITTED,
  receipt: patch?.receipt ?? null,
  replacementKey: patch?.replacementKey ?? null,
  replacedByRecordId: patch?.replacedByRecordId ?? null,
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
});

export const createTransactionsServiceStub = (
  overrides?: Partial<{
    get: TransactionsService["get"];
    list: TransactionsService["list"];
    findByReplacementKey: TransactionsService["findByReplacementKey"];
    createBroadcastRecord: TransactionsService["createBroadcastRecord"];
    updateRecordStatus: TransactionsService["updateRecordStatus"];
    subscribeChanged: TransactionsService["subscribeChanged"];
    linkRecord: TransactionsService["linkRecord"];
    remove: TransactionsService["remove"];
  }>,
): TransactionsService => {
  const list = overrides?.list ?? vi.fn(async () => []);

  return {
    get: overrides?.get ?? vi.fn(async () => null),
    list,
    findByReplacementKey:
      overrides?.findByReplacementKey ??
      vi.fn(async (key) => {
        const records = await list({ replacementKey: key });
        return records.filter((record) => JSON.stringify(record.replacementKey) === JSON.stringify(key));
      }),
    createBroadcastRecord:
      overrides?.createBroadcastRecord ??
      vi.fn(async (input) => ({
        id: input.id ?? crypto.randomUUID(),
        namespace: input.chainRef.split(":", 1)[0] ?? "",
        chainRef: input.chainRef,
        origin: input.origin,
        accountKey: input.accountKey,
        status: "broadcast" as const,
        submitted: input.submitted,
        receipt: input.receipt ?? null,
        replacementKey: input.replacementKey ?? null,
        replacedByRecordId: input.replacedByRecordId ?? null,
        createdAt: input.createdAt ?? 1,
        updatedAt: input.createdAt ?? 1,
      })),
    updateRecordStatus: overrides?.updateRecordStatus ?? vi.fn(async () => null),
    subscribeChanged: overrides?.subscribeChanged ?? vi.fn(() => () => {}),
    linkRecord: overrides?.linkRecord ?? vi.fn(async () => null),
    remove: overrides?.remove ?? vi.fn(async () => {}),
  };
};

export const createRecordViewStub = (params?: {
  from?: string;
  getView?: TransactionRecordViewStore["getView"];
  getOrLoadView?: TransactionRecordViewStore["getOrLoadView"];
  getOrLoadRecordView?: TransactionRecordViewStore["getOrLoadRecordView"];
  commitRecordView?: TransactionRecordViewStore["commitRecordView"];
  requestSync?: TransactionRecordViewStore["requestSync"];
}): TransactionRecordViewStore => {
  const from = params?.from ?? DEFAULT_FROM;
  const commitRecordView =
    params?.commitRecordView ??
    vi.fn((record: TransactionRecord) => ({
      next: {
        kind: "record",
        id: record.id,
        namespace: record.namespace,
        chainRef: record.chainRef,
        origin: record.origin,
        accountAddress: from,
        accountKey: record.accountKey,
        status: record.status,
        submitted: record.submitted,
        receipt: record.receipt,
        replacementKey: record.replacementKey,
        replacedByRecordId: record.replacedByRecordId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      } satisfies TransactionRecordView,
    }));

  return {
    getView: params?.getView ?? vi.fn(() => undefined),
    getOrLoadView: params?.getOrLoadView ?? vi.fn(async () => null),
    getOrLoadRecordView: params?.getOrLoadRecordView ?? vi.fn(async () => null),
    commitRecordView,
    requestSync: params?.requestSync ?? vi.fn(),
  } as TransactionRecordViewStore;
};

export const createPrepareStub = (overrides?: {
  queue?: (id: string) => void;
  rerun?: (id: string) => void;
  discard?: (id: string) => void;
  prepareCurrentDraft?: (id: string) => Promise<void>;
}) => ({
  queue: overrides?.queue ?? vi.fn(),
  rerun: overrides?.rerun ?? vi.fn(),
  discard: overrides?.discard ?? vi.fn(),
  prepareCurrentDraft: overrides?.prepareCurrentDraft ?? vi.fn(async () => {}),
});

export const createNamespacesStub = (get?: NamespaceTransactions["get"]): Pick<NamespaceTransactions, "get"> => ({
  get:
    get ??
    vi.fn(() =>
      createNamespaceTransactionStub({
        validateRequest: () => undefined,
      }),
    ),
});

export const markReviewReady = (
  proposalRuntime: TransactionProposalRuntime,
  transactionId: string,
  input?: {
    updatedAt?: number;
    executionPrepared?: NonNullable<TransactionProposalMeta["prepared"]>;
    reviewSnapshot?: TransactionReviewSnapshot;
  },
) => {
  makeProposalReadyForApproval(proposalRuntime, transactionId, input);
};
