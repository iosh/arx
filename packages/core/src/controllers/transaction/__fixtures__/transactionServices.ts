import { vi } from "vitest";
import { toAccountKeyFromAddress } from "../../../accounts/addressing/accountKey.js";
import { createAccountCodecRegistry, eip155Codec } from "../../../accounts/addressing/codec.js";
import type { AccountController } from "../../../controllers/account/types.js";
import { Messenger } from "../../../messenger/Messenger.js";
import type { TransactionsService } from "../../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../../storage/records.js";
import { buildEip155ApprovalReview } from "../../../transactions/namespace/eip155/approvalReview.js";
import type { NamespaceTransactions } from "../../../transactions/namespace/NamespaceTransactions.js";
import type { NamespaceTransaction } from "../../../transactions/namespace/types.js";
import { TransactionProposalStore } from "../TransactionProposalStore.js";
import type { TransactionRecordViewStore } from "../TransactionRecordViewStore.js";
import { TransactionReviewSessionStore } from "../TransactionReviewSessionStore.js";
import { TRANSACTION_TOPICS } from "../topics.js";
import type { TransactionProposalMeta, TransactionRecordView } from "../types.js";

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

export const DEFAULT_SUBMITTED = {
  hash: "0xdeadbeef",
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
    validateRequest: (...args: never[]) => unknown;
    prepare: (...args: never[]) => unknown;
    buildReview: (...args: never[]) => unknown;
    applyDraftEdit: (...args: never[]) => unknown;
    sign: (...args: never[]) => unknown;
    broadcast: (...args: never[]) => unknown;
    parseSubmitted: (...args: never[]) => unknown;
    tracking: unknown;
  }>,
): NamespaceTransaction => ({
  request: {
    ...(overrides?.deriveForChain ? { deriveForChain: overrides.deriveForChain as never } : {}),
    ...(overrides?.validateRequest ? { validateRequest: overrides.validateRequest as never } : {}),
  },
  proposal: {
    prepare: (overrides?.prepare as never) ?? vi.fn(async () => ({ status: "ready", prepared: {} })),
    buildReview: (overrides?.buildReview as never) ?? buildEip155ApprovalReview,
    ...(overrides?.applyDraftEdit ? { applyDraftEdit: overrides.applyDraftEdit as never } : {}),
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
  },
  ...(overrides?.tracking !== undefined
    ? { tracking: overrides.tracking as never }
    : { tracking: createReceiptTrackingStub() }),
});

export const createProposalStores = () => {
  const proposalStore = new TransactionProposalStore({
    messenger: new Messenger().scope({ publish: TRANSACTION_TOPICS }),
    accountCodecs,
  });
  const reviewStore = new TransactionReviewSessionStore();

  return {
    proposalStore,
    reviewStore,
  };
};

export const createProposalStore = () => createProposalStores().proposalStore;
export const createReviewStore = () => createProposalStores().reviewStore;

const makeProposalReadyForApproval = (
  proposalStore: TransactionProposalStore,
  reviewStore: TransactionReviewSessionStore,
  transactionId: string,
  input?: {
    updatedAt?: number;
    executionPrepared?: NonNullable<TransactionProposalMeta["prepared"]>;
    reviewPreparedSnapshot?: TransactionProposalMeta["prepared"];
  },
) => {
  const updatedAt = input?.updatedAt ?? 1;
  const current = proposalStore.peek(transactionId);
  if (!current) {
    throw new Error(`Proposal ${transactionId} not found`);
  }

  const session = reviewStore.getOrStartPrepare({
    id: transactionId,
    draftRevision: current.draftRevision,
    updatedAt,
  });

  const executionPrepared = input?.executionPrepared ?? {};
  const settled = reviewStore.settlePrepareReady({
    id: transactionId,
    expectedDraftRevision: current.draftRevision,
    sessionToken: session.sessionToken,
    updatedAt,
    reviewPreparedSnapshot: input?.reviewPreparedSnapshot ?? executionPrepared,
  });
  if (!settled) {
    throw new Error(`Proposal ${transactionId} could not settle ready review`);
  }
  proposalStore.updatePreparedForDraft({
    id: transactionId,
    expectedDraftRevision: current.draftRevision,
    updatedAt,
    prepared: executionPrepared,
  });
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
  proposalStore: TransactionProposalStore,
  reviewStore: TransactionReviewSessionStore,
  input?: Partial<TransactionProposalMeta> & {
    status?: "pending" | "approved" | "failed" | undefined;
    draftRevision?: number;
    fromAccountKey?: string;
  },
): TransactionProposalMeta => {
  const chainRef = input?.chainRef ?? DEFAULT_CHAIN_REF;
  const from = input?.from ?? DEFAULT_FROM;
  const requestedPhase = input?.status ?? "pending";
  const created = proposalStore.createPendingProposal({
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
    error: input?.error ?? undefined,
    userRejected: input?.userRejected ?? undefined,
    draftRevision: input?.draftRevision ?? undefined,
    createdAt: input?.createdAt ?? 1,
    updatedAt: input?.updatedAt ?? 1,
  });

  if (requestedPhase === "pending") return created;

  const id = created.id;
  const updatedAt = input?.updatedAt ?? 1;
  if (requestedPhase === "approved") {
    makeProposalReadyForApproval(proposalStore, reviewStore, id, {
      updatedAt,
      executionPrepared: input?.prepared ?? {},
      reviewPreparedSnapshot: input?.prepared ?? {},
    });
    const approved = proposalStore.approvePendingProposal({ id, updatedAt });
    if (!approved) {
      throw new Error(`Proposal ${id} could not be approved`);
    }
    return proposalStore.get(id) ?? created;
  }
  if (requestedPhase === "failed") {
    return (
      proposalStore.failProposal({
        id,
        updatedAt,
        patch: {
          error: input?.error ?? undefined,
          userRejected: input?.userRejected ?? undefined,
        },
      }) ?? created
    );
  }
  return created;
};

export const toRecord = (
  meta: TransactionProposalMeta,
  patch?: Partial<Pick<TransactionRecord, "receipt" | "replacedId" | "replacementIdentity">>,
): TransactionRecord => ({
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
  ...(patch?.receipt !== undefined ? { receipt: patch.receipt } : {}),
  ...(patch?.replacedId !== undefined ? { replacedId: patch.replacedId } : {}),
  ...(patch?.replacementIdentity !== undefined ? { replacementIdentity: patch.replacementIdentity } : {}),
  createdAt: meta.createdAt,
  updatedAt: meta.updatedAt,
});

export const createTransactionsServiceStub = (
  overrides?: Partial<{
    get: TransactionsService["get"];
    list: TransactionsService["list"];
    findByReplacementIdentity: TransactionsService["findByReplacementIdentity"];
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
    findByReplacementIdentity:
      overrides?.findByReplacementIdentity ??
      vi.fn(async (identity) => {
        const records = await list({ replacementIdentity: identity });
        return records.filter(
          (record) => JSON.stringify(record.replacementIdentity ?? null) === JSON.stringify(identity),
        );
      }),
    createBroadcastRecord:
      overrides?.createBroadcastRecord ??
      vi.fn(async (input) => ({
        id: input.id ?? crypto.randomUUID(),
        chainRef: input.chainRef,
        origin: input.origin,
        fromAccountKey: input.fromAccountKey,
        status: "broadcast",
        submitted: input.submitted,
        ...(input.receipt !== undefined ? { receipt: input.receipt } : {}),
        ...(input.replacedId !== undefined ? { replacedId: input.replacedId } : {}),
        ...(input.replacementIdentity !== undefined ? { replacementIdentity: input.replacementIdentity } : {}),
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
        namespace: record.chainRef.split(":", 1)[0] ?? "",
        chainRef: record.chainRef,
        origin: record.origin,
        from,
        status: record.status,
        submitted: record.submitted,
        receipt: record.receipt ?? null,
        replacedId: record.replacedId ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      } satisfies TransactionRecordView,
    }));

  return {
    getView: params?.getView ?? vi.fn(() => undefined),
    getOrLoadView: params?.getOrLoadView ?? vi.fn(async () => null),
    commitRecordView,
    requestSync: params?.requestSync ?? vi.fn(),
  } as TransactionRecordViewStore;
};

export const createPrepareStub = (overrides?: {
  queuePrepare?: (id: string) => void;
  prepareTransactionForExecution?: (id: string) => Promise<TransactionProposalMeta | null>;
}) => ({
  queuePrepare: overrides?.queuePrepare ?? vi.fn(),
  prepareTransactionForExecution: overrides?.prepareTransactionForExecution ?? vi.fn(async () => null),
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
  proposalStore: TransactionProposalStore,
  reviewStore: TransactionReviewSessionStore,
  transactionId: string,
  input?: {
    updatedAt?: number;
    executionPrepared?: NonNullable<TransactionProposalMeta["prepared"]>;
    reviewPreparedSnapshot?: TransactionProposalMeta["prepared"];
  },
) => {
  makeProposalReadyForApproval(proposalStore, reviewStore, transactionId, input);
};
