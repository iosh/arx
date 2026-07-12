import type { AccountAddressCodecs } from "../../accounts/accountAddressCodec.js";
import { isArxBaseError } from "../../errors.js";
import {
  buildTransactionTerminalReason,
  isTransactionStatusTerminal,
  type TransactionAggregate,
  TransactionAggregateNotFoundError,
  type TransactionAggregateStore,
  type TransactionConflictKey,
  type TransactionRecord,
} from "../aggregate/index.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { SubmittedTransactionInspection, TransactionFailure } from "../namespace/types.js";
import type { TransactionResourceLock } from "../TransactionResourceLock.js";
import { buildSubmittedTransactionTrackingContext } from "./contexts.js";
import { SubmittedTransactionTrackingInvariantError } from "./errors.js";

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
  accountAddressCodecs: AccountAddressCodecs;
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
      failure: TransactionFailure;
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
  #accountAddressCodecs: AccountAddressCodecs;
  #resourceLock: TransactionResourceLock;

  constructor(deps: SubmittedTransactionTrackerDeps) {
    this.#transactions = deps.transactions;
    this.#namespaces = deps.namespaces;
    this.#accountAddressCodecs = deps.accountAddressCodecs;
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

    const namespaceTracking = this.#namespaces.require(aggregate.record.namespace).tracking;
    const context = buildSubmittedTransactionTrackingContext(aggregate, this.#accountAddressCodecs);

    let inspection: SubmittedTransactionInspection;
    try {
      inspection = await namespaceTracking.inspectSubmittedTransaction(context);
    } catch (error) {
      const details = isArxBaseError(error) && error.details ? structuredClone(error.details) : {};
      const failure = {
        code: isArxBaseError(error) ? error.code : `${aggregate.record.namespace}.tracking`,
        message: error instanceof Error ? error.message : "tracking failed",
        details,
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
              receipt: inspection.receipt,
            }),
        );
        await this.#tryReplaceConflictingSubmittedTransactions(next);
        return { status: "advanced", inspection, aggregate: next };
      }
      case "failed": {
        const next = await this.#withTrackingResourceLock(
          aggregate,
          async () =>
            await this.#transactions.recordTransactionFailedOnChain({
              transactionId,
              receipt: inspection.receipt,
              reason: buildTransactionTerminalReason({
                kind: "on_chain_failed",
                namespace: aggregate.record.namespace,
                code: inspection.error.code,
                message: inspection.error.message,
                details: inspection.error.details,
              }),
            }),
        );
        await this.#tryReplaceConflictingSubmittedTransactions(next);
        return { status: "advanced", inspection, aggregate: next };
      }
      case "dropped": {
        const localReplacement = await this.#findLocalReplacementRecord(aggregate);
        if (localReplacement?.status === "submitted") {
          return {
            status: "pending",
            inspection: {
              trackingStatus: "pending",
              evidence: {
                reason: "local_replacement_pending",
                replacementTransactionId: localReplacement.id,
              },
            },
            aggregate,
          };
        }

        if (localReplacement) {
          const next = await this.#withTrackingResourceLock(
            aggregate,
            async () =>
              await this.#transactions.recordTransactionReplaced({
                transactionId,
                replacedByTransactionId: localReplacement.id,
                reason: buildTransactionTerminalReason({
                  kind: "tracking_failed",
                  namespace: aggregate.record.namespace,
                  code: "replaced",
                  message: "Transaction was replaced by another local transaction.",
                  details: {
                    replacedByTransactionId: localReplacement.id,
                    conflictKey: structuredClone(aggregate.record.conflictKey),
                  },
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
                details: inspection.evidence ?? {},
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
                details: inspection.evidence ?? {},
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

  async #withTrackingResourceLock<T>(aggregate: TransactionAggregate, run: () => Promise<T>) {
    return await this.#resourceLock.withKey(aggregate.record.resourceKey, run);
  }

  async #tryReplaceConflictingSubmittedTransactions(winner: TransactionAggregate): Promise<void> {
    try {
      await this.#replaceConflictingSubmittedTransactions(winner);
    } catch {
      // Best effort: winner status is already durable.
    }
  }

  async #replaceConflictingSubmittedTransactions(winner: TransactionAggregate): Promise<void> {
    const conflictKey = winner.record.conflictKey;
    if (!conflictKey) {
      return;
    }

    const candidates = await this.#transactions.findTransactionRecordsByConflictKey(conflictKey);
    const losers = candidates.filter(
      (candidate) =>
        candidate.id !== winner.record.id &&
        candidate.conflictKey?.kind === conflictKey.kind &&
        candidate.conflictKey.value === conflictKey.value &&
        candidate.status === "submitted",
    );

    for (const loser of losers) {
      await this.#transactions.recordTransactionReplaced({
        transactionId: loser.id,
        replacedByTransactionId: winner.record.id,
        reason: buildTransactionTerminalReason({
          kind: "tracking_failed",
          namespace: loser.namespace,
          code: "replaced",
          message: "Transaction was replaced by another local transaction.",
          details: {
            replacedByTransactionId: winner.record.id,
            conflictKey: structuredClone(conflictKey),
          },
        }),
      });
    }
  }

  async #findLocalReplacementRecord(aggregate: TransactionAggregate): Promise<TransactionRecord | null> {
    const conflictKey = aggregate.record.conflictKey;
    if (!conflictKey) {
      return null;
    }

    const candidates = await this.#transactions.findTransactionRecordsByConflictKey(conflictKey);
    return this.#selectLocalReplacementRecord({
      currentTransactionId: aggregate.record.id,
      conflictKey,
      candidates,
    });
  }

  #selectLocalReplacementRecord(params: {
    currentTransactionId: string;
    conflictKey: TransactionConflictKey;
    candidates: TransactionRecord[];
  }): TransactionRecord | null {
    const localReplacements = params.candidates.filter(
      (candidate) =>
        candidate.id !== params.currentTransactionId &&
        candidate.conflictKey?.kind === params.conflictKey.kind &&
        candidate.conflictKey.value === params.conflictKey.value &&
        candidate.replacement !== null,
    );

    const chainConsumed = localReplacements.find(
      (candidate) =>
        candidate.status === "confirmed" ||
        (candidate.status === "failed" && candidate.terminalReason?.kind === "on_chain_failed"),
    );
    if (chainConsumed) {
      return chainConsumed;
    }

    return localReplacements.find((candidate) => candidate.status === "submitted") ?? null;
  }
}
