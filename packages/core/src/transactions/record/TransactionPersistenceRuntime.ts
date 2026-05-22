import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { TransactionsService } from "../../services/store/transactions/types.js";
import type {
  TransactionReplacementKey as DurableTransactionReplacementKey,
  TransactionRecord,
} from "../../storage/records.js";
import { TransactionSubmittedSchema } from "../../storage/schemas.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { TransactionReplacementKey as NamespaceTransactionReplacementKey } from "../namespace/types.js";
import type { TransactionProposalMeta } from "../proposal/types.js";
import type { TransactionError, TransactionSubmitted } from "../types.js";
import { createTransactionPersistenceError } from "../utils.js";
import type { TransactionRecordView } from "./index.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";

type ProposalPersistenceBridge = {
  clearProposalAfterRecordPersisted(id: string): { status: "cleared" | "not_found" | "not_approved" };
  delete(id: string): void;
};

type SubmissionPersistenceBridge = {
  recordPersisted(id: string): void;
  recordPersistenceFailure(
    id: string,
    failure: {
      transactionId: string;
      error: TransactionError;
      submitted: TransactionSubmitted;
    },
  ): void;
};

type TransactionPersistenceRuntimeDeps = {
  proposalRuntime: ProposalPersistenceBridge;
  recordView: TransactionRecordViewStore;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  namespaces: Pick<NamespaceTransactions, "get">;
  service: TransactionsService;
  submission: SubmissionPersistenceBridge;
  startTracking(record: TransactionRecordView, options?: { resume?: boolean }): void;
};

const parseDurableSubmitted = (params: {
  submitted: TransactionSubmitted;
  namespaceTransaction: ReturnType<NamespaceTransactions["get"]>;
}): TransactionRecord["submitted"] => {
  const parsedSubmitted = params.namespaceTransaction?.record?.parseSubmitted(structuredClone(params.submitted));
  return TransactionSubmittedSchema.parse(parsedSubmitted ?? params.submitted);
};

const toDurableReplacementKey = (
  replacementKey: NamespaceTransactionReplacementKey | null,
): DurableTransactionReplacementKey => {
  if (!replacementKey) return null;
  return {
    scope: replacementKey.scope,
    value: replacementKey.value,
  };
};

export class TransactionPersistenceRuntime {
  #proposalRuntime: ProposalPersistenceBridge;
  #recordView: TransactionRecordViewStore;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #namespaces: Pick<NamespaceTransactions, "get">;
  #service: TransactionsService;
  #submission: SubmissionPersistenceBridge;
  #startTracking: (record: TransactionRecordView, options?: { resume?: boolean }) => void;

  constructor(deps: TransactionPersistenceRuntimeDeps) {
    this.#proposalRuntime = deps.proposalRuntime;
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

      const replacementKey = this.#deriveReplacementKey({
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
        accountKey: this.#accountCodecs.toAccountKeyFromAddress({
          chainRef: meta.chainRef,
          address: meta.from,
        }),
        submitted: structuredClone(durableSubmitted),
        replacementKey,
      });

      const cleared = this.#proposalRuntime.clearProposalAfterRecordPersisted(meta.id);
      if (cleared.status !== "cleared") {
        throw new Error(
          `Failed to clear approved proposal ${meta.id} after durable record persistence: ${cleared.status}`,
        );
      }
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
      this.#proposalRuntime.delete(meta.id);
    }
  }

  async commitRecoveredBroadcastRecord(record: TransactionRecord): Promise<void> {
    const committed = this.#recordView.commitRecordView(record);
    this.#startTracking(committed.next, { resume: true });
  }

  #deriveReplacementKey(input: {
    namespace: string;
    chainRef: string;
    origin: string;
    from: string;
    id: string;
    submitted: TransactionRecord["submitted"];
  }): DurableTransactionReplacementKey {
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
    return toDurableReplacementKey(replacementKey);
  }
}
