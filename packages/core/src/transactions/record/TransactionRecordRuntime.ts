import type { AccountCodecRegistry } from "../../accounts/addressing/codec.js";
import type { ListTransactionsCursor, TransactionsService } from "../../services/store/transactions/types.js";
import type { NamespaceTransactions } from "../namespace/NamespaceTransactions.js";
import type { TransactionProposalMeta } from "../proposal/types.js";
import type { ReceiptTracker } from "../tracker/ReceiptTracker.js";
import type { TransactionError, TransactionSubmitted } from "../types.js";
import type { TransactionRecordStatus, TransactionRecordView } from "./index.js";
import { TransactionPersistenceRuntime } from "./TransactionPersistenceRuntime.js";
import type { TransactionRecordViewStore } from "./TransactionRecordViewStore.js";
import { TransactionTrackingRuntime } from "./TransactionTrackingRuntime.js";

type ProposalRecordBridge = {
  clearProposalAfterRecordPersisted(id: string): { status: "cleared" | "not_found" | "not_approved" };
  delete(id: string): void;
};

type SubmissionOutcomeBridge = {
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

type TransactionRecordRuntimeDeps = {
  proposalRuntime: ProposalRecordBridge;
  recordView: TransactionRecordViewStore;
  accountCodecs: Pick<AccountCodecRegistry, "toAccountKeyFromAddress">;
  namespaces: Pick<NamespaceTransactions, "get">;
  service: TransactionsService;
  submission: SubmissionOutcomeBridge;
  tracker?: ReceiptTracker;
};

export class TransactionRecordRuntime {
  #service: TransactionsService;
  #recordView: TransactionRecordViewStore;
  #persistence: TransactionPersistenceRuntime;
  #tracking: TransactionTrackingRuntime;

  constructor(deps: TransactionRecordRuntimeDeps) {
    this.#service = deps.service;
    this.#recordView = deps.recordView;
    this.#tracking = new TransactionTrackingRuntime({
      recordView: deps.recordView,
      namespaces: deps.namespaces,
      service: deps.service,
      ...(deps.tracker ? { tracker: deps.tracker } : {}),
    });
    this.#persistence = new TransactionPersistenceRuntime({
      proposalRuntime: deps.proposalRuntime,
      recordView: deps.recordView,
      accountCodecs: deps.accountCodecs,
      namespaces: deps.namespaces,
      service: deps.service,
      submission: deps.submission,
      startTracking: (record, options) => this.#tracking.startTracking(record, options),
    });
  }

  async persistBroadcastRecord(meta: TransactionProposalMeta, submitted: TransactionSubmitted): Promise<void> {
    await this.#persistence.persistBroadcastRecord(meta, submitted);
  }

  async failRecord(id: string, reason?: Error | TransactionError): Promise<void> {
    await this.#tracking.failRecord(id, reason);
  }

  async resumeBroadcastRecords(): Promise<void> {
    this.#recordView.requestSync();
    for (const record of await this.#listAllByStatus("broadcast")) {
      await this.#persistence.commitRecoveredBroadcastRecord(record);
    }
  }

  stopTracking(id: string): void {
    this.#tracking.stopTracking(id);
  }

  isTracking(id: string): boolean {
    return this.#tracking.isTracking(id);
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
