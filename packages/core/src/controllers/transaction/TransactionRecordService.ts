import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ListTransactionsCursor, TransactionsService } from "../../services/store/transactions/types.js";
import type { TransactionRecord } from "../../storage/records.js";
import { TransactionSubmittedSchema } from "../../storage/schemas.js";
import type { NamespaceTransactions } from "../../transactions/namespace/NamespaceTransactions.js";
import type { TransactionError, TransactionSubmitted } from "../../transactions/types.js";
import { isTransactionRecordTerminal } from "./status.js";
import type { TransactionProposalStore } from "./TransactionProposalStore.js";
import type { TransactionReceiptTracking } from "./TransactionReceiptTracking.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import type { TransactionSubmissionStore } from "./TransactionSubmissionStore.js";
import type { TransactionProposalMeta, TransactionRecordStatus, TransactionRecordView } from "./types.js";
import { coerceTransactionError, createTransactionPersistenceError, isUserRejectedError } from "./utils.js";

type TransactionRecordServiceDeps = {
  proposalStore: Pick<TransactionProposalStore, "clearProposalAfterRecordPersisted" | "delete">;
  recordView: TransactionRecordViewStore;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  namespaces: Pick<NamespaceTransactions, "get">;
  service: TransactionsService;
  submission: Pick<TransactionSubmissionStore, "recordPersistenceFailure">;
  tracking: TransactionReceiptTracking;
};

const parseDurableSubmitted = (params: {
  submitted: TransactionSubmitted;
  namespaceTransaction: ReturnType<NamespaceTransactions["get"]>;
}): TransactionRecord["submitted"] => {
  const normalizedSubmitted = params.namespaceTransaction?.record?.parseSubmitted(structuredClone(params.submitted));
  return TransactionSubmittedSchema.parse(normalizedSubmitted ?? params.submitted);
};

export class TransactionRecordService {
  #proposalStore: Pick<TransactionProposalStore, "clearProposalAfterRecordPersisted" | "delete">;
  #recordView: TransactionRecordViewStore;
  #accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  #namespaces: Pick<NamespaceTransactions, "get">;
  #service: TransactionsService;
  #submission: Pick<TransactionSubmissionStore, "recordPersistenceFailure">;
  #tracking: TransactionReceiptTracking;

  constructor(deps: TransactionRecordServiceDeps) {
    this.#proposalStore = deps.proposalStore;
    this.#recordView = deps.recordView;
    this.#accountCodecs = deps.accountCodecs;
    this.#namespaces = deps.namespaces;
    this.#service = deps.service;
    this.#submission = deps.submission;
    this.#tracking = deps.tracking;
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

      const durable = await this.#service.createSubmitted({
        id: meta.id,
        createdAt: meta.createdAt,
        chainRef: meta.chainRef,
        origin: meta.origin,
        fromAccountKey: this.#accountCodecs.toAccountKeyFromAddress({
          chainRef: meta.chainRef,
          address: meta.from,
        }),
        status: "broadcast",
        submitted: structuredClone(durableSubmitted),
      });

      this.#proposalStore.clearProposalAfterRecordPersisted(meta.id);
      const { previous, next } = this.#recordView.commitRecordView(durable);
      this.#tracking.handleTransition(previous, next);
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
    }
  }

  async failRecord(id: string, reason?: Error | TransactionError): Promise<void> {
    const latestRecord = await this.#service.get(id);
    if (!latestRecord) {
      return;
    }

    const latest = this.#recordView.commitRecordView(latestRecord).next;
    const error = coerceTransactionError(reason) ?? null;
    const userRejected = isUserRejectedError(reason, error ?? undefined);
    if (latest.status === "broadcast" && userRejected) {
      return;
    }
    if (isTransactionRecordTerminal(latest)) {
      return;
    }

    const updated = await this.#service.transition({
      id,
      fromStatus: latest.status,
      toStatus: "failed",
    });
    if (!updated) {
      return;
    }

    const { previous, next } = this.#recordView.commitRecordView(updated);
    this.#tracking.stop(id);
    this.#tracking.handleTransition(previous, next);
  }

  async resumeBroadcastRecords(): Promise<void> {
    this.#recordView.requestSync();
    for (const record of await this.#listAllByStatus("broadcast")) {
      const view = this.#recordView.commitRecordView(record).next;
      this.#tracking.resumeBroadcast(view);
    }
  }

  async listRecordsByStatus(status: TransactionRecordStatus): Promise<TransactionRecordView[]> {
    const out: TransactionRecordView[] = [];
    for (const record of await this.#listAllByStatus(status)) {
      out.push(this.#recordView.commitRecordView(record).next);
    }
    return out;
  }

  async #listAllByStatus(status: TransactionRecordStatus) {
    const out = [];
    let cursor: ListTransactionsCursor | undefined;

    while (true) {
      const page = await this.#service.list({
        status,
        limit: 200,
        ...(cursor !== undefined ? { before: cursor } : {}),
      });
      if (page.length === 0) {
        break;
      }
      out.push(...page);
      const tail = page.at(-1);
      cursor = tail ? { createdAt: tail.createdAt, id: tail.id } : undefined;
      if (cursor === undefined) {
        break;
      }
    }

    return out;
  }
}
