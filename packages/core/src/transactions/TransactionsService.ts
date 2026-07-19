import type { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import { isArxBaseError } from "../errors.js";
import type { ChainRef } from "../networks/chainRef.js";
import { WALLET_UI_ORIGIN } from "../runtime/internalOrigins.js";
import type {
  CreateTransactionInput,
  CreateTransactionReplacementInput,
  JsonObject,
  ListTransactionHistoryQuery,
  TransactionRecord,
  TransactionReplacementType,
  TransactionResourceKey,
  TransactionSource,
  TransactionStatus,
  TransactionTerminalReason,
} from "./aggregate/index.js";
import {
  buildTransactionTerminalReason,
  isTransactionStatusTerminal,
  TransactionAggregateInvariantError,
  TransactionAggregateNotFoundError,
} from "./aggregate/index.js";
import { cloneJsonValue } from "./aggregate/json.js";
import type { TransactionAggregateStore } from "./aggregate/TransactionAggregateStore.js";
import { TransactionReplacementUnavailableError } from "./errors.js";
import type { NamespaceTransactions } from "./namespace/NamespaceTransactions.js";
import type {
  NamespaceTransactionProposal,
  TransactionFinalizeSubmitResult,
  TransactionPrepareResult,
  TransactionProposalBlocker,
  TransactionProposalError,
} from "./namespace/types.js";
import type { TransactionReviewDetails } from "./review.js";
import type { TransactionSubmissionExecutor } from "./submission/TransactionSubmissionExecutor.js";
import type { TransactionChangePublisher, TransactionsChangedHandler } from "./TransactionChangePublisher.js";
import type { TransactionResourceLock } from "./TransactionResourceLock.js";

export type { TransactionsChangedHandler } from "./TransactionChangePublisher.js";

export type TransactionAccount = {
  accountId: AccountId;
  address: string;
};

export type TransactionSubmittedSummary = JsonObject;

export type TransactionReceiptSummary = JsonObject;

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

export type TransactionReplacementIntent = CreateTransactionReplacementInput;

export type PrepareTransactionInput = CreateTransactionInput;

type TransactionProposalBase = {
  proposalId: string;
  namespace: string;
  chainRef: ChainRef;
  source: TransactionSource;
  origin: string;
  account: TransactionAccount;
  request: {
    payload: JsonObject;
  };
  replacement: TransactionReplacementIntent | null;
  review: TransactionReviewDetails | null;
  createdAt: number;
};

export type TransactionReadyProposal = TransactionProposalBase & {
  status: "ready";
  prepared: JsonObject;
};

export type TransactionBlockedProposal = TransactionProposalBase & {
  status: "blocked";
  blocker: TransactionProposalBlocker;
};

export type TransactionFailedProposal = TransactionProposalBase & {
  status: "failed";
  error: TransactionProposalError;
};

export type TransactionProposal = TransactionReadyProposal | TransactionBlockedProposal | TransactionFailedProposal;

export type SubmitTransactionInput = {
  proposal: TransactionReadyProposal;
};

export type SubmitTransactionResult =
  | {
      status: "submitted";
      transaction: Transaction;
      submitted: TransactionSubmittedSummary;
    }
  | {
      status: "terminal";
      transaction: Transaction;
      reason: TransactionTerminalReason;
    };

export type PrepareReplacementTransactionInput = {
  transactionId: string;
  type: TransactionReplacementType;
};

export type ListTransactionsQuery = ListTransactionHistoryQuery;

export type WalletTransactionAccess = Pick<
  TransactionsService,
  "prepareTransaction" | "submitTransaction" | "prepareReplacementTransaction" | "getTransaction" | "listTransactions"
>;

export type TransactionsEvents = {
  onTransactionsChanged(handler: TransactionsChangedHandler): () => void;
};

type ActiveApprovedTransaction = {
  transactionId: string;
  status: "submitting" | "submitted";
  approvedPayload: JsonObject;
  conflictKey: TransactionRecord["conflictKey"];
};

type TransactionsServiceDeps = {
  aggregateStore: Pick<
    TransactionAggregateStore,
    "createApprovedTransaction" | "failTransaction" | "loadTransactionAggregate" | "listTransactionHistory"
  >;
  namespaces: Pick<NamespaceTransactions, "require">;
  submission: Pick<TransactionSubmissionExecutor, "submitApprovedTransaction">;
  accounts: Pick<Accounts, "getAddress">;
  resourceLock: TransactionResourceLock;
  transactionChanges: TransactionChangePublisher;
};

const buildTransactionAccount = (
  accounts: TransactionsServiceDeps["accounts"],
  record: Pick<TransactionRecord, "accountId" | "chainRef">,
): TransactionAccount => ({
  accountId: record.accountId,
  address: accounts.getAddress(record).canonicalAddress,
});

const cloneNullableSummary = <T extends TransactionSubmittedSummary | TransactionReceiptSummary>(
  value: T | null,
): T | null => (value === null ? null : cloneJsonValue(value));

const buildReplacementSummary = (record: TransactionRecord): TransactionReplacementSummary | null => {
  const replaces = record.replacement === null ? null : { ...record.replacement };
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

const buildTransaction = (record: TransactionRecord, accounts: TransactionsServiceDeps["accounts"]): Transaction => ({
  id: record.id,
  status: record.status,
  namespace: record.namespace,
  chainRef: record.chainRef,
  source: record.source,
  origin: record.origin,
  account: buildTransactionAccount(accounts, record),
  submitted: cloneNullableSummary(record.submitted),
  receipt: cloneNullableSummary(record.receipt),
  replacement: buildReplacementSummary(record),
  terminalReason: structuredClone(record.terminalReason),
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export class TransactionsService {
  #aggregateStore: TransactionsServiceDeps["aggregateStore"];
  #namespaces: TransactionsServiceDeps["namespaces"];
  #submission: TransactionsServiceDeps["submission"];
  #accounts: TransactionsServiceDeps["accounts"];
  #resourceLock: TransactionResourceLock;
  #transactionChanges: TransactionChangePublisher;

  constructor(deps: TransactionsServiceDeps) {
    this.#aggregateStore = deps.aggregateStore;
    this.#namespaces = deps.namespaces;
    this.#submission = deps.submission;
    this.#accounts = deps.accounts;
    this.#resourceLock = deps.resourceLock;
    this.#transactionChanges = deps.transactionChanges;
  }

  async prepareTransaction(input: PrepareTransactionInput): Promise<TransactionProposal> {
    const proposal = this.#requireProposal(input.namespace);
    const request = {
      namespace: input.namespace,
      chainRef: input.chainRef,
      payload: input.request.payload,
    };
    const account = this.#buildAccount({
      accountId: input.accountId,
      chainRef: input.chainRef,
    });
    const base = {
      proposalId: crypto.randomUUID(),
      namespace: input.namespace,
      chainRef: input.chainRef,
      source: input.source,
      origin: input.origin,
      account,
      request: {
        payload: input.request.payload,
      },
      replacement: input.replacement,
      createdAt: Date.now(),
    };

    try {
      const prepareContext = {
        namespace: input.namespace,
        chainRef: input.chainRef,
        origin: input.origin,
        from: account.address,
        request,
      };

      this.#namespaces.require(input.namespace).request.validateRequest(prepareContext);
      const result = await proposal.prepare(prepareContext);
      return this.#buildProposalFromPrepareResult(base, proposal, request, result);
    } catch (error) {
      if (!isArxBaseError(error)) {
        throw error;
      }

      return {
        ...base,
        status: "failed",
        review: null,
        error: {
          code: error.code,
          message: error.message,
          details: error.details === undefined ? {} : structuredClone(error.details),
        },
      };
    }
  }

  async submitTransaction(input: SubmitTransactionInput): Promise<SubmitTransactionResult> {
    const resourceKey = this.#deriveResourceKey(input.proposal);
    return await this.#resourceLock.withKey(resourceKey, async () => {
      const finalized = await this.#finalizeSubmit(input.proposal);
      if (finalized.status !== "approved") {
        const terminal = await this.#createTerminalTransaction(input.proposal, finalized);
        return {
          status: "terminal",
          transaction: this.#buildTransactionRecord(terminal.record),
          reason: terminal.reason,
        };
      }

      const aggregate = await this.#aggregateStore.createApprovedTransaction({
        namespace: input.proposal.namespace,
        chainRef: input.proposal.chainRef,
        origin: input.proposal.origin,
        source: input.proposal.source,
        accountId: input.proposal.account.accountId,
        request: input.proposal.request,
        replacement: input.proposal.replacement,
        approvedRequestPayload: finalized.approvedPayload,
        conflictKey: finalized.conflictKey,
        resourceKey,
      });
      if (aggregate.record.status !== "submitting") {
        throw new TransactionAggregateInvariantError(
          aggregate.record.id,
          `Approved transaction "${aggregate.record.id}" did not enter submission.`,
        );
      }

      try {
        const submitted = await this.#submission.submitApprovedTransaction(aggregate.record.id, { lock: "held" });
        const transaction = this.#buildTransactionRecord(submitted.aggregate.record);
        if (transaction.submitted === null) {
          throw new TransactionAggregateInvariantError(
            transaction.id,
            `Submitted transaction "${transaction.id}" is missing submitted details.`,
          );
        }
        return {
          status: "submitted",
          transaction,
          submitted: transaction.submitted,
        };
      } catch (error) {
        const transaction = await this.getTransaction(aggregate.record.id);
        if (transaction === null || !isTransactionStatusTerminal(transaction.status)) {
          throw error;
        }
        const reason = transaction.terminalReason;
        if (reason === null) {
          throw new TransactionAggregateInvariantError(
            transaction.id,
            `Terminal transaction "${transaction.id}" is missing a terminal reason.`,
          );
        }
        return { status: "terminal", transaction, reason };
      }
    });
  }

  async prepareReplacementTransaction(input: PrepareReplacementTransactionInput): Promise<TransactionProposal> {
    const { transactionId, type } = input;
    const target = await this.#aggregateStore.loadTransactionAggregate(transactionId);
    if (target === null) {
      throw new TransactionAggregateNotFoundError(transactionId);
    }
    if (target.record.status !== "submitted") {
      throw new TransactionReplacementUnavailableError({
        transactionId,
        status: target.record.status,
      });
    }

    const namespaceProposal = this.#requireProposal(target.record.namespace);
    const targetAccount = this.#buildAccount(target.record);
    const replacementRequest = await namespaceProposal.buildReplacementRequest({
      namespace: target.record.namespace,
      chainRef: target.record.chainRef,
      origin: target.record.origin,
      accountId: target.record.accountId,
      from: targetAccount.address,
      type,
      targetTransactionId: target.record.id,
      targetRequest: {
        namespace: target.record.namespace,
        chainRef: target.record.chainRef,
        payload: target.record.request.payload,
      },
      targetApprovedPayload: target.record.approvedRequest.payload,
    });

    return await this.prepareTransaction({
      namespace: target.record.namespace,
      chainRef: target.record.chainRef,
      source: "wallet-ui",
      origin: WALLET_UI_ORIGIN,
      accountId: target.record.accountId,
      request: {
        payload: replacementRequest.payload,
      },
      replacement: {
        transactionId,
        type,
      },
    });
  }

  async getTransaction(transactionId: string): Promise<Transaction | null> {
    const aggregate = await this.#aggregateStore.loadTransactionAggregate(transactionId);
    return aggregate === null ? null : this.#buildTransactionRecord(aggregate.record);
  }

  async listTransactions(query?: ListTransactionsQuery): Promise<Transaction[]> {
    const records = await this.#aggregateStore.listTransactionHistory(query);
    return records.map((record) => this.#buildTransactionRecord(record));
  }

  onTransactionsChanged(handler: TransactionsChangedHandler): () => void {
    return this.#transactionChanges.onTransactionsChanged(handler);
  }

  #buildProposalFromPrepareResult(
    base: Omit<TransactionProposalBase, "review">,
    proposal: NamespaceTransactionProposal,
    request: { namespace: string; chainRef: string; payload: JsonObject },
    result: TransactionPrepareResult,
  ): TransactionProposal {
    if (result.status === "ready") {
      return {
        ...base,
        status: "ready",
        review: this.#buildReviewDetails(base, proposal, request, result.reviewSnapshot),
        prepared: result.prepared,
      };
    }

    if (result.status === "blocked") {
      return {
        ...base,
        status: "blocked",
        review: this.#buildReviewDetails(base, proposal, request, result.reviewSnapshot),
        blocker: result.blocker,
      };
    }

    return {
      ...base,
      status: "failed",
      review: this.#buildReviewDetails(base, proposal, request, result.reviewSnapshot),
      error: result.error,
    };
  }

  #buildReviewDetails(
    proposalBase: Pick<TransactionProposalBase, "proposalId" | "namespace" | "chainRef" | "origin" | "account">,
    proposal: NamespaceTransactionProposal,
    request: { namespace: string; chainRef: string; payload: JsonObject },
    reviewSnapshot: JsonObject | null,
  ) {
    if (reviewSnapshot === null) {
      return null;
    }

    return proposal.buildReview({
      transactionId: proposalBase.proposalId,
      namespace: proposalBase.namespace,
      chainRef: proposalBase.chainRef,
      origin: proposalBase.origin,
      from: proposalBase.account.address,
      request,
      reviewSnapshot,
    });
  }

  #deriveResourceKey(proposal: TransactionReadyProposal): TransactionResourceKey | null {
    const namespaceProposal = this.#requireProposal(proposal.namespace);
    return namespaceProposal.deriveResourceKey({
      transactionId: proposal.proposalId,
      namespace: proposal.namespace,
      chainRef: proposal.chainRef,
      origin: proposal.origin,
      accountId: proposal.account.accountId,
      from: proposal.account.address,
      request: this.#buildNamespaceRequest(proposal),
      preparedPayload: proposal.prepared,
      replacement: proposal.replacement,
    });
  }

  async #finalizeSubmit(proposal: TransactionReadyProposal): Promise<TransactionFinalizeSubmitResult> {
    const namespaceProposal = this.#requireProposal(proposal.namespace);
    return await namespaceProposal.finalizeSubmit({
      transactionId: proposal.proposalId,
      namespace: proposal.namespace,
      chainRef: proposal.chainRef,
      origin: proposal.origin,
      accountId: proposal.account.accountId,
      from: proposal.account.address,
      request: this.#buildNamespaceRequest(proposal),
      preparedPayload: proposal.prepared,
      replacement: proposal.replacement,
      localActiveTransactions: await this.#listActiveApprovedTransactions(proposal),
    });
  }

  async #createTerminalTransaction(
    proposal: TransactionReadyProposal,
    result: Exclude<TransactionFinalizeSubmitResult, { status: "approved" }>,
  ): Promise<{ record: TransactionRecord; reason: TransactionTerminalReason }> {
    const reason =
      result.status === "blocked"
        ? buildTransactionTerminalReason({
            kind: "validation_failed",
            namespace: proposal.namespace,
            code: result.blocker.code,
            message: result.blocker.message,
            details: result.blocker.details,
          })
        : buildTransactionTerminalReason({
            kind: "prepare_failed",
            namespace: proposal.namespace,
            code: result.error.code,
            message: result.error.message,
            details: result.error.details,
          });

    const aggregate = await this.#aggregateStore.createApprovedTransaction({
      namespace: proposal.namespace,
      chainRef: proposal.chainRef,
      origin: proposal.origin,
      source: proposal.source,
      accountId: proposal.account.accountId,
      request: proposal.request,
      replacement: proposal.replacement,
      approvedRequestPayload: proposal.prepared,
      conflictKey: null,
      resourceKey: this.#deriveResourceKey(proposal),
    });

    const failed = await this.#aggregateStore.failTransaction({
      transactionId: aggregate.record.id,
      reason,
    });

    return { record: failed.record, reason };
  }

  #buildNamespaceRequest(proposal: Pick<TransactionReadyProposal, "namespace" | "chainRef" | "request">) {
    return {
      namespace: proposal.namespace,
      chainRef: proposal.chainRef,
      payload: proposal.request.payload,
    };
  }

  async #listActiveApprovedTransactions(
    proposal: TransactionReadyProposal,
  ): Promise<readonly ActiveApprovedTransaction[]> {
    const [submittingRecords, submittedRecords] = await Promise.all([
      this.#aggregateStore.listTransactionHistory({
        namespace: proposal.namespace,
        chainRef: proposal.chainRef,
        accountId: proposal.account.accountId,
        status: "submitting",
      }),
      this.#aggregateStore.listTransactionHistory({
        namespace: proposal.namespace,
        chainRef: proposal.chainRef,
        accountId: proposal.account.accountId,
        status: "submitted",
      }),
    ]);

    const activeTransactions: ActiveApprovedTransaction[] = [];
    const addRecords = (records: TransactionRecord[], status: ActiveApprovedTransaction["status"]) => {
      for (const record of records) {
        activeTransactions.push({
          transactionId: record.id,
          status,
          approvedPayload: record.approvedRequest.payload,
          conflictKey: record.conflictKey,
        });
      }
    };

    addRecords(submittingRecords, "submitting");
    addRecords(submittedRecords, "submitted");

    return activeTransactions;
  }

  #requireProposal(namespace: string): NamespaceTransactionProposal {
    return this.#namespaces.require(namespace).proposal;
  }

  #buildAccount(record: Pick<TransactionRecord, "accountId" | "chainRef">): TransactionAccount {
    return buildTransactionAccount(this.#accounts, record);
  }

  #buildTransactionRecord(record: TransactionRecord): Transaction {
    return buildTransaction(record, this.#accounts);
  }
}
