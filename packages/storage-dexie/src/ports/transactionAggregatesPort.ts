import {
  type ListRecoverableTransactionAggregatesQuery,
  type ListTransactionHistoryQuery,
  type TransactionAggregate,
  TransactionAggregateNotFoundError,
  type TransactionConflictKey,
  type TransactionRecord,
  type TransactionSubmission,
  type TransactionSubmissionArtifact,
  type TransactionsStoragePort,
} from "@arx/core/transactions/storage";
import type { DexieCtx } from "../internal/ctx.js";

const RECOVERABLE_TRANSACTION_STATUSES = ["awaiting_approval", "submitting", "submitted"] as const;

const compareRecordsNewestFirst = (left: TransactionRecord, right: TransactionRecord): number =>
  right.createdAt - left.createdAt || right.id.localeCompare(left.id);

const compareSubmissionsOldestFirst = (left: TransactionSubmission, right: TransactionSubmission): number =>
  left.createdAt - right.createdAt || left.id.localeCompare(right.id);

const compareArtifactsOldestFirst = (
  left: TransactionSubmissionArtifact,
  right: TransactionSubmissionArtifact,
): number => left.createdAt - right.createdAt || left.id.localeCompare(right.id);

export class DexieTransactionAggregatesPort implements TransactionsStoragePort {
  constructor(private readonly ctx: DexieCtx) {}

  private get records() {
    return this.ctx.db.transactionRecords;
  }

  private get submissions() {
    return this.ctx.db.transactionSubmissions;
  }

  private get artifacts() {
    return this.ctx.db.transactionSubmissionArtifacts;
  }

  async loadTransactionAggregate(transactionId: TransactionRecord["id"]): Promise<TransactionAggregate | null> {
    await this.ctx.ready;
    return await this.ctx.db.transaction("r", this.records, this.submissions, this.artifacts, async () => {
      return await this.loadTransactionAggregateInOpenTransaction(transactionId);
    });
  }

  async insertTransactionAggregate(aggregate: TransactionAggregate): Promise<void> {
    await this.ctx.ready;

    await this.ctx.db.transaction("rw", this.records, this.submissions, this.artifacts, async () => {
      await this.records.add(aggregate.record);
      if (aggregate.submissions.length > 0) {
        await this.submissions.bulkAdd(aggregate.submissions);
      }
      if (aggregate.submissionArtifacts.length > 0) {
        await this.artifacts.bulkAdd(aggregate.submissionArtifacts);
      }
    });
  }

  async saveTransactionAggregate(aggregate: TransactionAggregate): Promise<void> {
    await this.ctx.ready;
    const transactionId = aggregate.record.id;

    await this.ctx.db.transaction("rw", this.records, this.submissions, this.artifacts, async () => {
      const existing = await this.records.get(transactionId);
      if (!existing) {
        throw new TransactionAggregateNotFoundError(transactionId);
      }

      await this.records.put(aggregate.record);
      await this.submissions.where("transactionId").equals(transactionId).delete();
      await this.artifacts.where("transactionId").equals(transactionId).delete();
      if (aggregate.submissions.length > 0) {
        await this.submissions.bulkAdd(aggregate.submissions);
      }
      if (aggregate.submissionArtifacts.length > 0) {
        await this.artifacts.bulkAdd(aggregate.submissionArtifacts);
      }
    });
  }

  async listTransactionHistory(query: ListTransactionHistoryQuery = {}): Promise<TransactionRecord[]> {
    await this.ctx.ready;

    const rows = await this.readHistoryCandidateRows(query);
    const records: TransactionRecord[] = [];
    for (const record of rows) {
      if (!this.matchesHistoryQuery(record, query)) continue;
      records.push(record);
    }

    records.sort(compareRecordsNewestFirst);
    return records.slice(0, query.limit ?? 100);
  }

  async findTransactionRecordsByConflictKey(key: TransactionConflictKey): Promise<TransactionRecord[]> {
    await this.ctx.ready;
    const rows = await this.records
      .where("[conflictKey.kind+conflictKey.value]")
      .equals([key.kind, key.value])
      .toArray();
    return rows.sort(compareRecordsNewestFirst);
  }

  async listRecoverableTransactionAggregates(
    query: ListRecoverableTransactionAggregatesQuery = {},
  ): Promise<TransactionAggregate[]> {
    await this.ctx.ready;
    const limit = query.limit ?? 100;

    return await this.ctx.db.transaction("r", this.records, this.submissions, this.artifacts, async () => {
      const rows = await this.records.where("status").anyOf(RECOVERABLE_TRANSACTION_STATUSES).toArray();
      const records = rows.sort(compareRecordsNewestFirst);
      const aggregates: TransactionAggregate[] = [];

      for (const record of records) {
        if (aggregates.length >= limit) break;
        const aggregate = await this.loadTransactionAggregateInOpenTransaction(record.id);
        if (aggregate) aggregates.push(aggregate);
      }

      return aggregates;
    });
  }

  private async readHistoryCandidateRows(query: ListTransactionHistoryQuery): Promise<TransactionRecord[]> {
    if (query.chainRef !== undefined) {
      return await this.records.where("chainRef").equals(query.chainRef).toArray();
    }

    if (query.accountKey !== undefined) {
      return await this.records.where("accountKey").equals(query.accountKey).toArray();
    }

    if (query.status !== undefined) {
      return await this.records.where("status").equals(query.status).toArray();
    }

    if (query.namespace !== undefined) {
      return await this.records.where("namespace").equals(query.namespace).toArray();
    }

    return await this.records.toArray();
  }

  private matchesHistoryQuery(record: TransactionRecord, query: ListTransactionHistoryQuery): boolean {
    if (query.namespace !== undefined && record.namespace !== query.namespace) return false;
    if (query.chainRef !== undefined && record.chainRef !== query.chainRef) return false;
    if (query.accountKey !== undefined && record.accountKey !== query.accountKey) return false;
    if (query.status !== undefined && record.status !== query.status) return false;
    if (
      query.before !== undefined &&
      !(
        record.createdAt < query.before.createdAt ||
        (record.createdAt === query.before.createdAt && record.id.localeCompare(query.before.id) < 0)
      )
    ) {
      return false;
    }
    return true;
  }

  private async loadTransactionAggregateInOpenTransaction(
    transactionId: TransactionRecord["id"],
  ): Promise<TransactionAggregate | null> {
    const recordRow = await this.records.get(transactionId);
    if (recordRow === undefined) return null;

    const submissionRows = await this.submissions.where("transactionId").equals(transactionId).toArray();
    const artifactRows = await this.artifacts.where("transactionId").equals(transactionId).toArray();

    return {
      record: recordRow,
      submissions: submissionRows.sort(compareSubmissionsOldestFirst),
      submissionArtifacts: artifactRows.sort(compareArtifactsOldestFirst),
    };
  }
}
