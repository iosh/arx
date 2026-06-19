import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import { isArxBaseError } from "../../error.js";
import {
  buildTransactionTerminalReason,
  isTransactionStatusTerminal,
  type JsonValue,
  type TransactionAggregate,
  TransactionAggregateNotFoundError,
  type TransactionAggregateStore,
  type TransactionConflictKey,
  type TransactionRecord,
} from "../aggregate/index.js";
import { deriveApprovalResourceKeyFromAggregate } from "../approvalResourceKeys.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { SubmittedTransactionInspection } from "../namespace/types.js";
import type { TransactionResourceLock } from "../TransactionResourceLock.js";
import { buildSubmittedTransactionTrackingContext } from "./contexts.js";
import { SubmittedTransactionTrackingInvariantError, SubmittedTransactionTrackingUnsupportedError } from "./errors.js";

type SubmittedTransactionTrackerDeps = {
  transactions: Pick<
    TransactionAggregateStore,
    | "loadTransactionAggregate"
    | "recordTransactionConfirmed"
    | "recordTransactionFailedOnChain"
    | "recordTransactionDropped"
    | "recordTransactionExpired"
    | "recordTransactionReplaced"
    | "findTransactionRecordsByConflictKey"
  >;
  namespaces: Pick<NamespaceTransactions, "require">;
  accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  resourceLock: TransactionResourceLock;
};

export type SubmittedTransactionTrackerResult =
  | {
      status: "pending";
      inspection: SubmittedTransactionInspection;
      aggregate: TransactionAggregate;
    }
  | {
      status: "advanced";
      inspection: SubmittedTransactionInspection;
      aggregate: TransactionAggregate;
    }
  | {
      status: "stale";
      aggregate: TransactionAggregate;
    }
  | {
      status: "retry_later";
      failure: {
        reason: string;
        message: string;
        data: JsonValue | null;
      };
      aggregate: TransactionAggregate;
    };

export class SubmittedTransactionTracker {
  #transactions: Pick<
    TransactionAggregateStore,
    | "loadTransactionAggregate"
    | "recordTransactionConfirmed"
    | "recordTransactionFailedOnChain"
    | "recordTransactionDropped"
    | "recordTransactionExpired"
    | "recordTransactionReplaced"
    | "findTransactionRecordsByConflictKey"
  >;
  #namespaces: Pick<NamespaceTransactions, "require">;
  #accountCodecs: Pick<AccountCodecRegistry, "toCanonicalAddressFromAccountKey">;
  #resourceLock: TransactionResourceLock;

  constructor(deps: SubmittedTransactionTrackerDeps) {
    this.#transactions = deps.transactions;
    this.#namespaces = deps.namespaces;
    this.#accountCodecs = deps.accountCodecs;
    this.#resourceLock = deps.resourceLock;
  }

  /**
   * Flow:
   * submitted -> inspectSubmittedTransaction()
   *           -> pending    => keep submitted
   *           -> confirmed  => confirmed
   *           -> failed     => failed
   *           -> dropped    => dropped
   *           -> expired    => expired
   */
  async inspectSubmittedTransaction(transactionId: string): Promise<SubmittedTransactionTrackerResult> {
    const aggregate = await this.#loadSubmittedAggregate(transactionId);
    if (aggregate.record.status !== "submitted") {
      return {
        status: "stale",
        aggregate,
      };
    }

    const namespaceTracking = this.#requireNamespaceTracking(aggregate.record.namespace);
    const context = buildSubmittedTransactionTrackingContext(aggregate, this.#accountCodecs);

    let inspection: SubmittedTransactionInspection;
    try {
      inspection = await namespaceTracking.inspectSubmittedTransaction(context);
    } catch (error) {
      const details =
        isArxBaseError(error) && error.details && typeof error.details === "object"
          ? (structuredClone(error.details) as JsonValue)
          : null;
      const failure = {
        reason: isArxBaseError(error) ? error.code : `${aggregate.record.namespace}.tracking`,
        message: error instanceof Error ? error.message : "tracking failed",
        data: details,
      };

      return {
        status: "retry_later",
        failure,
        aggregate,
      };
    }

    switch (inspection.trackingStatus) {
      case "pending":
        return {
          status: "pending",
          inspection,
          aggregate,
        };
      case "confirmed": {
        const next = await this.#withTrackingResourceLock(
          aggregate,
          async () =>
            await this.#transactions.recordTransactionConfirmed({
              transactionId,
              receipt: inspection.receipt as never,
            }),
        );
        await this.#tryReplaceOtherSubmittedTransactions(next);
        return { status: "advanced", inspection, aggregate: next };
      }
      case "failed": {
        const next = await this.#withTrackingResourceLock(
          aggregate,
          async () =>
            await this.#transactions.recordTransactionFailedOnChain({
              transactionId,
              receipt: inspection.receipt as never,
              reason: buildTransactionTerminalReason({
                kind: "on_chain_failed",
                namespace: aggregate.record.namespace,
                code: inspection.error.reason,
                message: inspection.error.message,
                details: inspection.error.data as never,
              }),
            }),
        );
        return { status: "advanced", inspection, aggregate: next };
      }
      case "dropped": {
        const replacement = await this.#findConfirmedReplacementRecord(aggregate);
        if (replacement) {
          const next = await this.#withTrackingResourceLock(
            aggregate,
            async () =>
              await this.#transactions.recordTransactionReplaced({
                transactionId,
                replacedByTransactionId: replacement.id,
                reason: buildTransactionTerminalReason({
                  kind: "tracking_failed",
                  namespace: aggregate.record.namespace,
                  code: "replaced",
                  message: "Transaction was replaced by another local transaction.",
                  details: {
                    replacedByTransactionId: replacement.id,
                    conflictKey: structuredClone(aggregate.record.conflictKey),
                  } as JsonValue,
                }),
              }),
          );
          return { status: "advanced", inspection, aggregate: next };
        }

        const next = await this.#withTrackingResourceLock(
          aggregate,
          async () =>
            await this.#transactions.recordTransactionDropped({
              transactionId,
              reason: buildTransactionTerminalReason({
                kind: "tracking_failed",
                namespace: aggregate.record.namespace,
                code: "dropped",
                message: "Transaction is no longer expected to confirm.",
                details: inspection.evidence as never,
              }),
            }),
        );
        return { status: "advanced", inspection, aggregate: next };
      }
      case "expired": {
        const next = await this.#withTrackingResourceLock(
          aggregate,
          async () =>
            await this.#transactions.recordTransactionExpired({
              transactionId,
              reason: buildTransactionTerminalReason({
                kind: "tracking_failed",
                namespace: aggregate.record.namespace,
                code: "expired",
                message: "Transaction submission expired on chain.",
                details: inspection.evidence as never,
              }),
            }),
        );
        return { status: "advanced", inspection, aggregate: next };
      }
    }
  }

  async #loadSubmittedAggregate(transactionId: string) {
    const aggregate = await this.#transactions.loadTransactionAggregate(transactionId);
    if (!aggregate) {
      throw new TransactionAggregateNotFoundError(transactionId);
    }
    if (aggregate.record.status !== "submitted") {
      if (isTransactionStatusTerminal(aggregate.record.status)) {
        return aggregate;
      }

      throw new SubmittedTransactionTrackingInvariantError(
        transactionId,
        `Transaction "${transactionId}" is not submitted.`,
      );
    }
    return aggregate;
  }

  #requireNamespaceTracking(namespace: string) {
    const tracking = this.#namespaces.require(namespace).tracking;
    if (tracking) {
      return tracking;
    }

    throw new SubmittedTransactionTrackingUnsupportedError({
      namespace,
      operation: "tracking",
    });
  }

  async #withTrackingResourceLock<T>(aggregate: TransactionAggregate, run: () => Promise<T>) {
    return await this.#resourceLock.withKey(deriveApprovalResourceKeyFromAggregate(aggregate), run);
  }

  async #tryReplaceOtherSubmittedTransactions(confirmed: TransactionAggregate): Promise<void> {
    try {
      await this.#replaceOtherSubmittedTransactions(confirmed);
    } catch {
      // Best effort: winner confirmation is already durable.
    }
  }

  async #replaceOtherSubmittedTransactions(confirmed: TransactionAggregate): Promise<void> {
    const conflictKey = confirmed.record.conflictKey;
    if (!conflictKey) {
      return;
    }

    const candidates = await this.#transactions.findTransactionRecordsByConflictKey(conflictKey);
    const losers = candidates.filter(
      (candidate) =>
        candidate.id !== confirmed.record.id &&
        candidate.conflictKey?.kind === conflictKey.kind &&
        candidate.conflictKey.value === conflictKey.value &&
        candidate.status === "submitted",
    );

    for (const loser of losers) {
      await this.#transactions.recordTransactionReplaced({
        transactionId: loser.id,
        replacedByTransactionId: confirmed.record.id,
        reason: buildTransactionTerminalReason({
          kind: "tracking_failed",
          namespace: loser.namespace,
          code: "replaced",
          message: "Transaction was replaced by another local transaction.",
          details: {
            replacedByTransactionId: confirmed.record.id,
            conflictKey: structuredClone(conflictKey),
          } as JsonValue,
        }),
      });
    }
  }

  async #findConfirmedReplacementRecord(aggregate: TransactionAggregate): Promise<TransactionRecord | null> {
    const conflictKey = aggregate.record.conflictKey;
    if (!conflictKey) {
      return null;
    }

    const candidates = await this.#transactions.findTransactionRecordsByConflictKey(conflictKey);
    return this.#selectConfirmedReplacementRecord({
      currentTransactionId: aggregate.record.id,
      conflictKey,
      candidates,
    });
  }

  #selectConfirmedReplacementRecord(params: {
    currentTransactionId: string;
    conflictKey: TransactionConflictKey;
    candidates: TransactionRecord[];
  }): TransactionRecord | null {
    const activeCandidates = params.candidates.filter(
      (candidate) =>
        candidate.id !== params.currentTransactionId &&
        candidate.conflictKey?.kind === params.conflictKey.kind &&
        candidate.conflictKey.value === params.conflictKey.value,
    );

    const confirmed = activeCandidates.find((candidate) => candidate.status === "confirmed");
    if (confirmed) {
      return confirmed;
    }

    return null;
  }
}
