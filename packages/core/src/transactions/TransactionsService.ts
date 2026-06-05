import type { AccountKey } from "../accounts/addressing/accountKey.js";
import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { ChainRef } from "../chains/ids.js";
import type {
  CreateTransactionInput,
  JsonValue,
  ListTransactionHistoryQuery,
  TransactionRecord,
  TransactionReplacementType,
  TransactionSource,
  TransactionStatus,
  TransactionTerminalReason,
} from "./aggregate/index.js";
import { cloneJsonValue } from "./aggregate/json.js";
import type { TransactionAggregateStore } from "./aggregate/TransactionAggregateStore.js";
import type {
  ApprovalStaleTransactionApprovalSessionResult,
  BlockedTransactionApprovalSessionResult,
  FailedTransactionApprovalSessionResult,
  TransactionApprovalPrepareState,
  TransactionApprovalSession,
  TransactionApprovalSessionService,
} from "./approval/index.js";
import { TransactionApprovalSessionInvariantError } from "./approval/index.js";
import type { TransactionProposalBlocker, TransactionProposalError } from "./namespace/types.js";
import type { TransactionReviewDetails } from "./review.js";
import type { NamespaceTransactionDraftEdit } from "./types.js";

export class TransactionApprovalNotFoundError extends Error {
  readonly approvalId: string;

  constructor(approvalId: string) {
    super(`Transaction approval "${approvalId}" was not found.`);
    this.name = "TransactionApprovalNotFoundError";
    this.approvalId = approvalId;
  }
}

export type TransactionAccount = {
  accountKey: AccountKey;
  address: string;
};

export type TransactionSubmittedSummary = JsonValue;

export type TransactionReceiptSummary = JsonValue;

export type TransactionReplacementSummary = {
  replaces: {
    transactionId: string;
    type: TransactionReplacementType;
  } | null;
  replacedBy: {
    transactionId: string;
  } | null;
};

/** Public lifecycle/history view returned by `TransactionsService`. */
export type Transaction = {
  id: string;
  status: TransactionStatus;
  namespace: string;
  chainRef: ChainRef;
  source: TransactionSource;
  origin: string;
  account: TransactionAccount;
  requestKind: string;
  submitted: TransactionSubmittedSummary | null;
  receipt: TransactionReceiptSummary | null;
  replacement: TransactionReplacementSummary | null;
  terminalReason: TransactionTerminalReason | null;
  createdAt: number;
  updatedAt: number;
};

type TransactionApprovalPrepareBase = {
  id: string;
  draftRevision: number;
  updatedAt: number;
};

export type TransactionApprovalPreparing = TransactionApprovalPrepareBase & {
  status: "preparing";
};

export type TransactionApprovalReady = TransactionApprovalPrepareBase & {
  status: "ready";
  preparedAt: number;
  expiresAt: number | null;
};

export type TransactionApprovalBlocked = TransactionApprovalPrepareBase & {
  status: "blocked";
  blocker: TransactionProposalBlocker;
  expiresAt: number | null;
};

export type TransactionApprovalFailed = TransactionApprovalPrepareBase & {
  status: "failed";
  error: TransactionProposalError;
};

export type TransactionApprovalPrepare =
  | TransactionApprovalPreparing
  | TransactionApprovalReady
  | TransactionApprovalBlocked
  | TransactionApprovalFailed;

/** Public view of one active send-transaction approval. */
export type TransactionApproval = {
  approvalId: string;
  transactionId: string;
  namespace: string;
  chainRef: ChainRef;
  origin: string;
  account: TransactionAccount;
  review: TransactionReviewDetails | null;
  prepare: TransactionApprovalPrepare;
  updatedAt: number;
};

export type RequestTransactionApprovalInput = CreateTransactionInput & {
  approvalId: string;
};

export type RequestTransactionApprovalResult = {
  transaction: Transaction;
  approval: TransactionApproval;
};

export type UpdateApprovalDraftInput = {
  approvalId: string;
  edit: NamespaceTransactionDraftEdit;
  mode?: string;
};

export type RerunApprovalPrepareInput = {
  approvalId: string;
};

export type ApproveTransactionInput = {
  approvalId: string;
  expectedPrepareId: string;
};

export type ApprovedTransactionResult = {
  status: "approved";
  transaction: Transaction;
};

export type ApprovalStaleTransactionResult = Omit<ApprovalStaleTransactionApprovalSessionResult, "session"> & {
  approval: TransactionApproval | null;
};

export type BlockedTransactionApprovalResult = Omit<BlockedTransactionApprovalSessionResult, "session"> & {
  approval: TransactionApproval;
};

export type FailedTransactionApprovalResult = Omit<FailedTransactionApprovalSessionResult, "session"> & {
  approval: TransactionApproval;
};

export type ApproveTransactionResult =
  | ApprovedTransactionResult
  | ApprovalStaleTransactionResult
  | BlockedTransactionApprovalResult
  | FailedTransactionApprovalResult;

export type RejectTransactionApprovalInput = {
  approvalId: string;
  reason?: TransactionTerminalReason | null;
};

export type CancelPendingTransactionInput = {
  transactionId: string;
  reason?: TransactionTerminalReason | null;
};

export type CreateReplacementTransactionApprovalInput = Omit<RequestTransactionApprovalInput, "replacement"> & {
  transactionId: string;
};

export type ListTransactionsQuery = ListTransactionHistoryQuery;

export type TransactionsChangedHandler = (transactionIds: string[]) => void;

export type TransactionApprovalsChangedHandler = (approvalIds: string[]) => void;

export type TransactionsEvents = {
  onTransactionsChanged(handler: TransactionsChangedHandler): () => void;
  onTransactionApprovalsChanged(handler: TransactionApprovalsChangedHandler): () => void;
};

type TransactionsServiceDeps = {
  aggregateStore: Pick<
    TransactionAggregateStore,
    "createTransaction" | "loadTransactionAggregate" | "listTransactionHistory" | "cancelTransaction"
  >;
  approvalSessions: Pick<
    TransactionApprovalSessionService,
    | "openSession"
    | "prepareSession"
    | "applyDraftEdit"
    | "approveTransaction"
    | "rejectTransaction"
    | "getSessionByApprovalId"
    | "discardSessionByTransactionId"
  >;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
};

const buildTransactionAccount = (
  accountCodecs: TransactionsServiceDeps["accountCodecs"],
  record: Pick<TransactionRecord, "accountKey">,
): TransactionAccount => ({
  accountKey: record.accountKey,
  address: accountCodecs.toCanonicalAddressFromAccountKey({
    accountKey: record.accountKey,
  }),
});

const buildTransactionApprovalAccount = (session: TransactionApprovalSession): TransactionAccount => ({
  accountKey: session.accountKey,
  address: session.from,
});

const cloneNullableSummary = <T extends TransactionSubmittedSummary | TransactionReceiptSummary>(
  value: T | null,
): T | null => (value === null ? null : cloneJsonValue(value));

const requireReplacementType = (record: TransactionRecord) => {
  if (record.replacementType !== null) {
    return record.replacementType;
  }

  throw new Error(`Transaction "${record.id}" replaces another transaction but has no replacement type.`);
};

const buildReplacementSummary = (record: TransactionRecord): TransactionReplacementSummary | null => {
  const replaces =
    record.replacesTransactionId === null
      ? null
      : {
          transactionId: record.replacesTransactionId,
          type: requireReplacementType(record),
        };
  const replacedBy =
    record.replacedByTransactionId === null
      ? null
      : {
          transactionId: record.replacedByTransactionId,
        };

  if (replaces === null && replacedBy === null) {
    return null;
  }

  return {
    replaces,
    replacedBy,
  };
};

const buildTransaction = (
  record: TransactionRecord,
  accountCodecs: TransactionsServiceDeps["accountCodecs"],
): Transaction => ({
  id: record.id,
  status: record.status,
  namespace: record.namespace,
  chainRef: record.chainRef,
  source: record.source,
  origin: record.origin,
  account: buildTransactionAccount(accountCodecs, record),
  requestKind: record.request.kind,
  submitted: cloneNullableSummary(record.submitted),
  receipt: cloneNullableSummary(record.receipt),
  replacement: buildReplacementSummary(record),
  terminalReason: structuredClone(record.terminalReason),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const buildPrepare = (prepare: TransactionApprovalPrepareState): TransactionApprovalPrepare => {
  const base = {
    id: prepare.prepareId,
    draftRevision: prepare.draftRevision,
    updatedAt: prepare.updatedAt,
  };

  if (prepare.status === "preparing") {
    return {
      ...base,
      status: "preparing",
    };
  }

  if (prepare.status === "ready") {
    return {
      ...base,
      status: "ready",
      preparedAt: prepare.preparedAt,
      expiresAt: prepare.expiresAt,
    };
  }

  if (prepare.status === "blocked") {
    return {
      ...base,
      status: "blocked",
      blocker: structuredClone(prepare.blocker),
      expiresAt: prepare.expiresAt,
    };
  }

  return {
    ...base,
    status: "failed",
    error: structuredClone(prepare.error),
  };
};

const buildTransactionApproval = (session: TransactionApprovalSession): TransactionApproval => ({
  approvalId: session.approvalId,
  transactionId: session.transactionId,
  namespace: session.namespace,
  chainRef: session.chainRef,
  origin: session.origin,
  account: buildTransactionApprovalAccount(session),
  review: structuredClone(session.review),
  prepare: buildPrepare(session.prepare),
  updatedAt: Math.max(session.draft.updatedAt, session.prepare.updatedAt),
});

export class TransactionsService {
  #aggregateStore: TransactionsServiceDeps["aggregateStore"];
  #approvalSessions: TransactionsServiceDeps["approvalSessions"];
  #accountCodecs: TransactionsServiceDeps["accountCodecs"];
  #transactionChangedHandlers = new Set<TransactionsChangedHandler>();
  #approvalChangedHandlers = new Set<TransactionApprovalsChangedHandler>();

  constructor(deps: TransactionsServiceDeps) {
    this.#aggregateStore = deps.aggregateStore;
    this.#approvalSessions = deps.approvalSessions;
    this.#accountCodecs = deps.accountCodecs;
  }

  async requestTransactionApproval(input: RequestTransactionApprovalInput): Promise<RequestTransactionApprovalResult> {
    const { approvalId, ...createInput } = input;
    this.#assertApprovalIdIsAvailable(approvalId);
    const aggregate = await this.#aggregateStore.createTransaction(createInput);
    const session = await this.#approvalSessions.openSession({
      transactionId: aggregate.record.id,
      approvalId,
    });

    const transaction = this.#buildTransactionRecord(aggregate.record);
    const approval = buildTransactionApproval(session);
    this.#notifyTransactionsChanged([transaction.id]);
    this.#notifyTransactionApprovalsChanged([approval.approvalId]);

    return {
      transaction,
      approval,
    };
  }

  async createSpeedUpReplacement(
    input: CreateReplacementTransactionApprovalInput,
  ): Promise<RequestTransactionApprovalResult> {
    return await this.#requestReplacementApproval(input, "speed_up");
  }

  async createCancelReplacement(
    input: CreateReplacementTransactionApprovalInput,
  ): Promise<RequestTransactionApprovalResult> {
    return await this.#requestReplacementApproval(input, "cancel");
  }

  async updateApprovalDraft(input: UpdateApprovalDraftInput): Promise<TransactionApproval> {
    const session = this.#requireOpenSessionByApprovalId(input.approvalId);
    const edited = await this.#approvalSessions.applyDraftEdit({
      transactionId: session.transactionId,
      approvalId: input.approvalId,
      edit: input.edit,
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
    });
    const approval = buildTransactionApproval(edited);
    this.#notifyTransactionApprovalsChanged([approval.approvalId]);
    return approval;
  }

  async rerunApprovalPrepare(input: RerunApprovalPrepareInput): Promise<TransactionApproval> {
    const session = this.#requireOpenSessionByApprovalId(input.approvalId);
    const prepared = await this.#approvalSessions.prepareSession({
      transactionId: session.transactionId,
      approvalId: input.approvalId,
    });
    const approval = buildTransactionApproval(prepared);
    this.#notifyTransactionApprovalsChanged([approval.approvalId]);
    return approval;
  }

  async approveTransaction(input: ApproveTransactionInput): Promise<ApproveTransactionResult> {
    const session = this.#requireOpenSessionByApprovalId(input.approvalId);
    const result = await this.#approvalSessions.approveTransaction({
      transactionId: session.transactionId,
      approvalId: input.approvalId,
      expectedPrepareId: input.expectedPrepareId,
    });

    this.#notifyTransactionApprovalsChanged([input.approvalId]);

    if (result.status === "approved") {
      const transaction = this.#buildTransactionRecord(result.aggregate.record);
      this.#notifyTransactionsChanged([transaction.id]);
      return {
        status: "approved",
        transaction,
      };
    }

    if (result.status === "approval_stale") {
      return {
        status: "approval_stale",
        approval: result.session === null ? null : buildTransactionApproval(result.session),
        stale: result.stale,
      };
    }

    if (result.status === "blocked") {
      return {
        status: "blocked",
        approval: buildTransactionApproval(result.session),
        blocker: result.blocker,
      };
    }

    return {
      status: "failed",
      approval: buildTransactionApproval(result.session),
      error: result.error,
    };
  }

  async rejectTransactionApproval(input: RejectTransactionApprovalInput): Promise<Transaction> {
    const session = this.#requireOpenSessionByApprovalId(input.approvalId);
    const aggregate = await this.#approvalSessions.rejectTransaction({
      transactionId: session.transactionId,
      approvalId: input.approvalId,
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
    });

    const transaction = this.#buildTransactionRecord(aggregate.record);
    this.#notifyTransactionsChanged([transaction.id]);
    this.#notifyTransactionApprovalsChanged([input.approvalId]);
    return transaction;
  }

  async cancelPendingTransaction(input: CancelPendingTransactionInput): Promise<Transaction> {
    const aggregate = await this.#aggregateStore.cancelTransaction({
      transactionId: input.transactionId,
      reason: input.reason ?? null,
    });
    const discarded = this.#approvalSessions.discardSessionByTransactionId(input.transactionId);
    const transaction = this.#buildTransactionRecord(aggregate.record);

    this.#notifyTransactionsChanged([transaction.id]);
    if (discarded) {
      this.#notifyTransactionApprovalsChanged([discarded.approvalId]);
    }

    return transaction;
  }

  async getTransaction(transactionId: string): Promise<Transaction | null> {
    const aggregate = await this.#aggregateStore.loadTransactionAggregate(transactionId);
    return aggregate === null ? null : this.#buildTransactionRecord(aggregate.record);
  }

  async listTransactions(query?: ListTransactionsQuery): Promise<Transaction[]> {
    const records = await this.#aggregateStore.listTransactionHistory(query);
    return records.map((record) => this.#buildTransactionRecord(record));
  }

  getTransactionApproval(approvalId: string): TransactionApproval | null {
    const session = this.#approvalSessions.getSessionByApprovalId(approvalId);
    return session === null ? null : buildTransactionApproval(session);
  }

  onTransactionsChanged(handler: TransactionsChangedHandler): () => void {
    this.#transactionChangedHandlers.add(handler);
    return () => {
      this.#transactionChangedHandlers.delete(handler);
    };
  }

  onTransactionApprovalsChanged(handler: TransactionApprovalsChangedHandler): () => void {
    this.#approvalChangedHandlers.add(handler);
    return () => {
      this.#approvalChangedHandlers.delete(handler);
    };
  }

  async #requestReplacementApproval(
    input: CreateReplacementTransactionApprovalInput,
    type: NonNullable<RequestTransactionApprovalInput["replacement"]>["type"],
  ): Promise<RequestTransactionApprovalResult> {
    const { transactionId, ...requestInput } = input;
    return await this.requestTransactionApproval({
      ...requestInput,
      replacement: {
        transactionId,
        type,
      },
    });
  }

  #requireOpenSessionByApprovalId(approvalId: string): TransactionApprovalSession {
    const session = this.#approvalSessions.getSessionByApprovalId(approvalId);
    if (session === null) {
      throw new TransactionApprovalNotFoundError(approvalId);
    }
    return session;
  }

  #assertApprovalIdIsAvailable(approvalId: string): void {
    const session = this.#approvalSessions.getSessionByApprovalId(approvalId);
    if (session !== null) {
      throw new TransactionApprovalSessionInvariantError(
        session.transactionId,
        `Approval "${approvalId}" already owns transaction "${session.transactionId}".`,
      );
    }
  }

  #buildTransactionRecord(record: TransactionRecord): Transaction {
    return buildTransaction(record, this.#accountCodecs);
  }

  #notifyTransactionsChanged(transactionIds: string[]): void {
    for (const handler of this.#transactionChangedHandlers) {
      handler(transactionIds);
    }
  }

  #notifyTransactionApprovalsChanged(approvalIds: string[]): void {
    for (const handler of this.#approvalChangedHandlers) {
      handler(approvalIds);
    }
  }
}
