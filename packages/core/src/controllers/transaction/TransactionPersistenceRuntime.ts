import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord, TransactionReplacementIdentity } from "../../storage/records.js";
import { TransactionSubmittedSchema } from "../../storage/schemas.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { TransactionSubmitted } from "../../transactions/types.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import type { TransactionReviewSessionStore } from "./TransactionReviewSessionStore.js";
import type { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import type { TransactionProposalMeta, TransactionRecordView } from "./types.js";
import { createTransactionPersistenceError } from "./utils.js";

type TransactionPersistenceRuntimeDeps = {
  proposalStore: Pick<TransactionProposalStore, "clearProposalAfterRecordPersisted" | "delete">;
  reviewStore: Pick<TransactionReviewSessionStore, "delete">;
  recordView: TransactionRecordViewStore;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  namespaces: Pick<NamespaceTransactions, "get">;
  service: TransactionsService;
  submission: Pick<TransactionSubmissionStore, "recordPersisted" | "recordPersistenceFailure">;
  startTracking(record: TransactionRecordView, options?: { resume?: boolean }): void;
};

const parseDurableSubmitted = (params: {
  submitted: TransactionSubmitted;
  namespaceTransaction: ReturnType<NamespaceTransactions["get"]>;
}): TransactionRecord["submitted"] => {
  const parsedSubmitted = params.namespaceTransaction?.record?.parseSubmitted(structuredClone(params.submitted));
  return TransactionSubmittedSchema.parse(parsedSubmitted ?? params.submitted);
};

const toStoredReplacementIdentity = (
  replacementKey: import("../../transactions/namespace/types.js").TransactionReplacementKey | null,
): TransactionReplacementIdentity => {
  if (!replacementKey) return null;
  return {
    scope: replacementKey.scope,
    value: replacementKey.value,
  };
};

export class TransactionPersistenceRuntime {
  #proposalStore: Pick<TransactionProposalStore, "clearProposalAfterRecordPersisted" | "delete">;
  #reviewStore: Pick<TransactionReviewSessionStore, "delete">;
  #recordView: TransactionRecordViewStore;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #namespaces: Pick<NamespaceTransactions, "get">;
  #service: TransactionsService;
  #submission: Pick<TransactionSubmissionStore, "recordPersisted" | "recordPersistenceFailure">;
  #startTracking: (record: TransactionRecordView, options?: { resume?: boolean }) => void;

  constructor(deps: TransactionPersistenceRuntimeDeps) {
    this.#proposalStore = deps.proposalStore;
    this.#reviewStore = deps.reviewStore;
    this.#recordView = deps.recordView;
    this.#accountCodecs = deps.accountCodecs;
    this.#namespaces = deps.namespaces;
    this.#service = deps.service;
    this.#submission = deps.submission;
    this.#startTracking = deps.startTracking;
  }

  async persistBroadcastRecord(meta: TransactionProposalMeta, submitted: TransactionSubmitted): Promise<void> {
    const namespaceTransaction = this.#namespaces.get(meta.namespace);
    const durableSubmitted = parseDurableSubmitted({
      submitted,
      namespaceTransaction,
    });

    try {
      if (!meta.from) {
        throw new Error(`Transaction ${meta.id} is missing a from address.`);
      }

      const replacementIdentity = this.#deriveReplacementIdentity({
        namespace: meta.namespace,
        chainRef: meta.chainRef,
        origin: meta.origin,
        from: meta.from,
        id: meta.id,
        submitted: durableSubmitted,
      });

      const durable = await this.#service.createBroadcastRecord({
        id: meta.id,
        createdAt: meta.createdAt,
        chainRef: meta.chainRef,
        origin: meta.origin,
        fromAccountKey: this.#accountCodecs.toAccountKeyFromAddress({
          chainRef: meta.chainRef,
          address: meta.from,
        }),
        submitted: structuredClone(durableSubmitted),
        replacementIdentity,
      });

      this.#proposalStore.clearProposalAfterRecordPersisted(meta.id);
      this.#reviewStore.delete(meta.id);
      const committed = this.#recordView.commitRecordView(durable);
      this.#submission.recordPersisted(meta.id);
      this.#startTracking(committed.next);
    } catch (error) {
      const persistenceFailure = error instanceof Error ? error : new Error("Transaction persistence failed");
      this.#submission.recordPersistenceFailure(meta.id, {
        transactionId: meta.id,
        error: createTransactionPersistenceError({
          cause: persistenceFailure,
          transactionId: meta.id,
          submitted,
        }),
        submitted: structuredClone(submitted),
      });
      this.#proposalStore.delete(meta.id);
      this.#reviewStore.delete(meta.id);
    }
  }

  async commitRecoveredBroadcastRecord(record: TransactionRecord): Promise<void> {
    const committed = this.#recordView.commitRecordView(record);
    this.#startTracking(committed.next, { resume: true });
  }

  #deriveReplacementIdentity(input: {
    namespace: string;
    chainRef: string;
    origin: string;
    from: string;
    id: string;
    submitted: TransactionRecord["submitted"];
  }): TransactionReplacementIdentity {
    const namespaceTransaction = this.#namespaces.get(input.namespace);
    if (!namespaceTransaction?.tracking?.deriveReplacementKey) return null;

    const replacementKey = namespaceTransaction.tracking.deriveReplacementKey({
      recordId: input.id,
      namespace: input.namespace,
      chainRef: input.chainRef,
      origin: input.origin,
      from: input.from,
      submitted: structuredClone(input.submitted),
    });
    return toStoredReplacementIdentity(replacementKey);
  }
}
