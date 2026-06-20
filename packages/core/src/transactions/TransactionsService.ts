import type { AccountKey } from "../accounts/addressing/accountKey.js";
import type { AccountCodecRegistry } from "../accounts/addressing/codec.js";
import type { ChainRef } from "../chains/ids.js";
import type {
  CreateTransactionInput,
  CreateTransactionReplacementInput,
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
  cancellation?: TransactionApprovalCancellation;
};

export type RequestTransactionApprovalResult = {
  approval: TransactionApproval;
  decision: Promise<TransactionApprovalDecision>;
};

export type TransactionApprovalCancellation = {
  signal: AbortSignal;
  reason: TransactionTerminalReason;
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

export type ApprovedTransactionApprovalDecision = {
  status: "approved";
  approvalId: string;
  transaction: Transaction;
};

export type RejectedTransactionApprovalDecision = {
  status: "rejected";
  approvalId: string;
  reason: TransactionTerminalReason | null;
};

export type CancelledTransactionApprovalDecision = {
  status: "cancelled";
  approvalId: string;
  reason: TransactionTerminalReason | null;
};

export type TransactionApprovalDecision =
  | ApprovedTransactionApprovalDecision
  | RejectedTransactionApprovalDecision
  | CancelledTransactionApprovalDecision;

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

export type WalletTransactionAccess = Pick<
  TransactionsService,
  | "requestTransactionApproval"
  | "rerunApprovalPrepare"
  | "updateApprovalDraft"
  | "getTransactionApproval"
  | "approveAndSubmitTransaction"
  | "rejectTransactionApproval"
>;

export type TransactionsEvents = {
  onTransactionsChanged(handler: TransactionsChangedHandler): () => void;
  onTransactionApprovalsChanged(handler: TransactionApprovalsChangedHandler): () => void;
};

type TransactionsServiceDeps = {
  aggregateStore: Pick<
    TransactionAggregateStore,
    "createApprovedTransaction" | "loadTransactionAggregate" | "listTransactionHistory"
  >;
  approvalSessions: Pick<
    TransactionApprovalSessionService,
    | "openSession"
    | "prepareSession"
    | "applyDraftEdit"
    | "approveTransaction"
    | "getSessionByApprovalId"
    | "listSessions"
    | "discardSessionByApprovalId"
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

type TransactionApprovalDecisionSettlement = {
  resolve: (decision: TransactionApprovalDecision) => void;
  cleanupCancellation: (() => void) | null;
};

export class TransactionsService {
  #aggregateStore: TransactionsServiceDeps["aggregateStore"];
  #approvalSessions: TransactionsServiceDeps["approvalSessions"];
  #submission: TransactionsServiceDeps["submission"];
  #accountCodecs: TransactionsServiceDeps["accountCodecs"];
  #invalidations: TransactionInvalidations;
  #approvalDecisions = new Map<string, TransactionApprovalDecisionSettlement>();

  constructor(deps: TransactionsServiceDeps) {
    this.#aggregateStore = deps.aggregateStore;
    this.#approvalSessions = deps.approvalSessions;
    this.#submission = deps.submission;
    this.#accountCodecs = deps.accountCodecs;
    this.#invalidations = deps.invalidations;
  }

  async requestTransactionApproval(input: RequestTransactionApprovalInput): Promise<RequestTransactionApprovalResult> {
    const { approvalId, cancellation, ...reviewInput } = input;
    this.#throwIfApprovalCancellationRequested(cancellation);
    this.#assertApprovalIdIsAvailable(approvalId);
    const decision = this.#openApprovalDecision(approvalId);
    let session: TransactionApprovalSession;
    try {
      session = await this.#approvalSessions.openSession({
        approvalId,
        namespace: reviewInput.namespace,
        chainRef: reviewInput.chainRef,
        source: reviewInput.source,
        origin: reviewInput.origin,
        accountKey: reviewInput.accountKey,
        from: this.#accountCodecs.toCanonicalAddressFromAccountKey({
          accountKey: reviewInput.accountKey,
        }),
        requestId: reviewInput.requestId ?? null,
        request: structuredClone(reviewInput.request),
        replacement: reviewInput.replacement ?? null,
      });
    } catch (error) {
      this.#approvalDecisions.delete(approvalId);
      throw error;
    }

    try {
      await this.#bindApprovalCancellation(approvalId, cancellation);
    } catch (error) {
      this.#approvalDecisions.delete(approvalId);
      throw error;
    }

    const approval = buildTransactionApproval(session);
    this.#notifyTransactionApprovalsChanged([approval.approvalId]);

    return {
      approval,
      decision,
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
    const edited = await this.#approvalSessions.applyDraftEdit({
      approvalId: input.approvalId,
      edit: input.edit,
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
    });
    const approval = buildTransactionApproval(edited);
    this.#notifyTransactionApprovalsChanged([approval.approvalId]);
    return approval;
  }

  async rerunApprovalPrepare(input: RerunApprovalPrepareInput): Promise<TransactionApproval> {
    const prepared = await this.#approvalSessions.prepareSession({
      approvalId: input.approvalId,
    });
    const approval = buildTransactionApproval(prepared);
    this.#notifyTransactionApprovalsChanged([approval.approvalId]);
    return approval;
  }

  async approveTransaction(input: ApproveTransactionInput): Promise<ApproveTransactionResult> {
    const result = await this.#approvalSessions.approveTransaction({
      approvalId: input.approvalId,
      expectedPrepareId: input.expectedPrepareId,
    });

    this.#notifyTransactionApprovalsChanged([input.approvalId]);

    if (result.status === "approved") {
      const transaction = this.#buildTransactionRecord(result.aggregate.record);
      this.#settleApprovalDecision(input.approvalId, {
        status: "approved",
        approvalId: input.approvalId,
        transaction,
      });
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

  async rejectTransactionApproval(input: RejectTransactionApprovalInput): Promise<TransactionApproval | null> {
    const discarded = this.#approvalSessions.discardSessionByApprovalId(input.approvalId);
    const approval = discarded ? buildTransactionApproval(discarded) : null;
    this.#notifyTransactionApprovalsChanged([input.approvalId]);
    this.#settleApprovalDecision(input.approvalId, {
      status: "rejected",
      approvalId: input.approvalId,
      reason: input.reason ?? null,
    });
    return approval;
  }

  async cancelTransactionApproval(input: CancelTransactionApprovalInput): Promise<TransactionApproval | null> {
    const discarded = this.#approvalSessions.discardSessionByApprovalId(input.approvalId);
    const approval = discarded ? buildTransactionApproval(discarded) : null;
    this.#notifyTransactionApprovalsChanged([input.approvalId]);
    this.#settleApprovalDecision(input.approvalId, {
      status: "cancelled",
      approvalId: input.approvalId,
      reason: input.reason ?? null,
    });
    return approval;
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

  async listTransactionApprovals(): Promise<TransactionApproval[]> {
    return this.#approvalSessions.listSessions().map((session) => buildTransactionApproval(session));
  }

  onTransactionsChanged(handler: TransactionsChangedHandler): () => void {
    return this.#invalidations.onTransactionsChanged(handler);
  }

  onTransactionApprovalsChanged(handler: TransactionApprovalsChangedHandler): () => void {
    return this.#invalidations.onTransactionApprovalsChanged(handler);
  }

  async #requestReplacementApproval(
    input: CreateReplacementTransactionApprovalInput,
    type: CreateTransactionReplacementInput["type"],
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

  #assertApprovalIdIsAvailable(approvalId: string): void {
    const session = this.#approvalSessions.getSessionByApprovalId(approvalId);
    if (session !== null || this.#approvalDecisions.has(approvalId)) {
      throw new TransactionApprovalSessionInvariantError(
        approvalId,
        `Approval "${approvalId}" already has an active transaction review.`,
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

  #throwIfApprovalCancellationRequested(cancellation: TransactionApprovalCancellation | undefined): void {
    if (cancellation?.signal.aborted) {
      throw cancellation.signal.reason ?? new Error(cancellation.reason.message);
    }
  }

  #notifyTransactionApprovalsChanged(approvalIds: string[]): void {
    this.#invalidations.publishTransactionApprovalsChanged(approvalIds);
  }

  async #bindApprovalCancellation(
    approvalId: string,
    cancellation: TransactionApprovalCancellation | undefined,
  ): Promise<void> {
    if (!cancellation) {
      return;
    }

    const settlement = this.#approvalDecisions.get(approvalId);
    if (!settlement) {
      return;
    }

    const abort = () => {
      void this.cancelTransactionApproval({
        approvalId,
        reason: cancellation.reason,
      });
    };

    cancellation.signal.addEventListener("abort", abort, { once: true });
    settlement.cleanupCancellation = () => {
      cancellation.signal.removeEventListener("abort", abort);
    };

    if (cancellation.signal.aborted) {
      await this.cancelTransactionApproval({
        approvalId,
        reason: cancellation.reason,
      });
      throw cancellation.signal.reason ?? new Error(cancellation.reason.message);
    }
  }

  #openApprovalDecision(approvalId: string): Promise<TransactionApprovalDecision> {
    const existing = this.#approvalDecisions.get(approvalId);
    if (existing) {
      throw new TransactionApprovalSessionInvariantError(
        approvalId,
        `Approval "${approvalId}" already has an active transaction review.`,
      );
    }

    let resolveDecision: (decision: TransactionApprovalDecision) => void = () => {};
    const promise = new Promise<TransactionApprovalDecision>((resolve) => {
      resolveDecision = resolve;
    });

    this.#approvalDecisions.set(approvalId, {
      resolve: resolveDecision,
      cleanupCancellation: null,
    });

    return promise;
  }

  #settleApprovalDecision(approvalId: string, decision: TransactionApprovalDecision): void {
    const settlement = this.#approvalDecisions.get(approvalId);
    if (!settlement) {
      return;
    }

    this.#approvalDecisions.delete(approvalId);
    settlement.cleanupCancellation?.();
    settlement.resolve(structuredClone(decision));
  }
}
