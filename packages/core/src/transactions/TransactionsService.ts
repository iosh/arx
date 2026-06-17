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
import { isTransactionStatusTerminal } from "./aggregate/index.js";
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
import type { TransactionSubmissionExecutor } from "./submission/TransactionSubmissionExecutor.js";
import type {
  TransactionApprovalsChangedHandler,
  TransactionInvalidations,
  TransactionsChangedHandler,
} from "./TransactionInvalidations.js";
import type { NamespaceTransactionDraftEdit } from "./types.js";

export type {
  TransactionApprovalsChangedHandler,
  TransactionsChangedHandler,
} from "./TransactionInvalidations.js";

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
  source: TransactionSource;
  origin: string;
  account: TransactionAccount;
  review: TransactionReviewDetails | null;
  prepare: TransactionApprovalPrepare;
  createdAt: number;
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

export type SubmittedTransactionResult = {
  status: "submitted";
  transaction: Transaction;
};

export type ApproveAndSubmitTransactionResult =
  | SubmittedTransactionResult
  | ApprovalStaleTransactionResult
  | BlockedTransactionApprovalResult
  | FailedTransactionApprovalResult;

export type RejectTransactionApprovalInput = {
  approvalId: string;
  reason?: TransactionTerminalReason | null;
};

export type CancelTransactionApprovalInput = {
  approvalId: string;
  reason?: TransactionTerminalReason | null;
};

export type CancelPendingTransactionInput = {
  transactionId: string;
  reason?: TransactionTerminalReason | null;
};

export type WaitForTransactionSubmissionOutcomeInput = {
  transactionId: string;
  signal?: AbortSignal;
};

export type TransactionSubmittedOutcome = {
  kind: "submitted";
  transaction: Transaction;
  submitted: TransactionSubmittedSummary;
};

export type TransactionTerminalOutcome = {
  kind: "terminal";
  transaction: Transaction;
};

export type TransactionSubmissionOutcome = TransactionSubmittedOutcome | TransactionTerminalOutcome;

export type CreateReplacementTransactionApprovalInput = Omit<RequestTransactionApprovalInput, "replacement"> & {
  transactionId: string;
};

export type ListTransactionsQuery = ListTransactionHistoryQuery;

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
    | "cancelTransaction"
    | "getSession"
    | "getSessionByApprovalId"
    | "discardSessionByTransactionId"
  >;
  submission: Pick<TransactionSubmissionExecutor, "submitApprovedTransaction">;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  invalidations: TransactionInvalidations;
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
  source: session.source,
  origin: session.origin,
  account: buildTransactionApprovalAccount(session),
  review: structuredClone(session.review),
  prepare: buildPrepare(session.prepare),
  createdAt: session.createdAt,
  updatedAt: Math.max(session.draft.updatedAt, session.prepare.updatedAt),
});

export class TransactionsService {
  #aggregateStore: TransactionsServiceDeps["aggregateStore"];
  #approvalSessions: TransactionsServiceDeps["approvalSessions"];
  #submission: TransactionsServiceDeps["submission"];
  #accountCodecs: TransactionsServiceDeps["accountCodecs"];
  #invalidations: TransactionInvalidations;

  constructor(deps: TransactionsServiceDeps) {
    this.#aggregateStore = deps.aggregateStore;
    this.#approvalSessions = deps.approvalSessions;
    this.#submission = deps.submission;
    this.#accountCodecs = deps.accountCodecs;
    this.#invalidations = deps.invalidations;
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

  async approveAndSubmitTransaction(input: ApproveTransactionInput): Promise<ApproveAndSubmitTransactionResult> {
    const approved = await this.approveTransaction(input);
    if (approved.status !== "approved") {
      return approved;
    }

    const submitted = await this.#submission.submitApprovedTransaction(approved.transaction.id);
    const transaction = this.#buildTransactionRecord(submitted.aggregate.record);
    return {
      status: "submitted",
      transaction,
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
    this.#notifyTransactionApprovalsChanged([input.approvalId]);
    return transaction;
  }

  async cancelTransactionApproval(input: CancelTransactionApprovalInput): Promise<Transaction | null> {
    const session = this.#approvalSessions.getSessionByApprovalId(input.approvalId);
    if (session === null) {
      return null;
    }

    const aggregate = await this.#approvalSessions.cancelTransaction({
      transactionId: session.transactionId,
      approvalId: input.approvalId,
      reason: input.reason ?? null,
    });

    const transaction = this.#buildTransactionRecord(aggregate.record);
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

  async waitForTransactionSubmissionOutcome(
    input: WaitForTransactionSubmissionOutcomeInput,
  ): Promise<TransactionSubmissionOutcome> {
    this.#throwIfAborted(input.signal);
    const current = await this.getTransaction(input.transactionId);
    if (!current) {
      throw new Error(`Transaction "${input.transactionId}" was not found.`);
    }

    const currentResult = this.#buildTransactionSubmissionOutcome(current);
    if (currentResult) {
      return currentResult;
    }

    return await new Promise<TransactionSubmissionOutcome>((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => void) | null = null;
      const cleanup = () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        input.signal?.removeEventListener("abort", abort);
      };
      const settle = (run: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        run();
      };
      const abort = () => {
        settle(() => reject(input.signal?.reason ?? new Error("Transaction wait was aborted.")));
      };

      if (input.signal?.aborted) {
        abort();
        return;
      }

      input.signal?.addEventListener("abort", abort, { once: true });
      const readOutcome = async () => {
        try {
          const transaction = await this.getTransaction(input.transactionId);
          if (!transaction) {
            throw new Error(`Transaction "${input.transactionId}" was not found.`);
          }
          const result = this.#buildTransactionSubmissionOutcome(transaction);
          if (result) {
            settle(() => resolve(result));
          }
        } catch (error) {
          settle(() => reject(error));
        }
      };

      unsubscribe = this.onTransactionsChanged((transactionIds) => {
        if (!transactionIds.includes(input.transactionId)) {
          return;
        }

        void readOutcome();
      });
      void readOutcome();
    });
  }

  getTransactionApproval(approvalId: string): TransactionApproval | null {
    const session = this.#approvalSessions.getSessionByApprovalId(approvalId);
    return session === null ? null : buildTransactionApproval(session);
  }

  getTransactionApprovalByTransactionId(transactionId: string): TransactionApproval | null {
    const session = this.#approvalSessions.getSession(transactionId);
    return session === null ? null : buildTransactionApproval(session);
  }

  async listTransactionApprovals(): Promise<TransactionApproval[]> {
    const records = await this.#aggregateStore.listTransactionHistory({ status: "awaiting_approval" });
    const approvals: TransactionApproval[] = [];

    for (const record of records) {
      const session = this.#approvalSessions.getSession(record.id);
      if (session) {
        approvals.push(buildTransactionApproval(session));
      }
    }

    return approvals;
  }

  onTransactionsChanged(handler: TransactionsChangedHandler): () => void {
    return this.#invalidations.onTransactionsChanged(handler);
  }

  onTransactionApprovalsChanged(handler: TransactionApprovalsChangedHandler): () => void {
    return this.#invalidations.onTransactionApprovalsChanged(handler);
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

  #buildTransactionSubmissionOutcome(transaction: Transaction): TransactionSubmissionOutcome | null {
    if (transaction.submitted !== null) {
      return {
        kind: "submitted",
        transaction,
        submitted: transaction.submitted,
      };
    }
    if (isTransactionStatusTerminal(transaction.status)) {
      return {
        kind: "terminal",
        transaction,
      };
    }
    return null;
  }

  #throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("Transaction wait was aborted.");
    }
  }

  #notifyTransactionApprovalsChanged(approvalIds: string[]): void {
    this.#invalidations.publishTransactionApprovalsChanged(approvalIds);
  }
}
