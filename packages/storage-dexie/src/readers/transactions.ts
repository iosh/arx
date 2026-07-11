import type {
  TransactionHistoryCursor,
  TransactionHistoryQuery,
  TransactionRecord,
  TransactionsReader,
} from "@arx/core/persistence";
import { type Collection, Dexie } from "dexie";
import type { DexiePersistenceContext } from "../database.js";
import type { TransactionRow } from "../rows.js";

const GLOBAL_HISTORY_INDEX = "[createAt+transactionId]";
const CHAIN_HISTORY_INDEX = "[chainRef+createAt+transactionId]";
const ACCOUNT_HISTORY_INDEX = "[accountId+createAt+transactionId]";
const CONFLICT_INDEX = "[chainRef+conflictKey.kind+conflictKey.value]";

const historyCollection = (
  context: DexiePersistenceContext,
  query: TransactionHistoryQuery,
): Collection<TransactionRow, string> => {
  const cursor = query.cursor;

  if (query.chainRef !== undefined) {
    const lower = [query.chainRef, Dexie.minKey, Dexie.minKey];
    const upper = cursor
      ? [query.chainRef, cursor.createAt, cursor.transactionId]
      : [query.chainRef, Dexie.maxKey, Dexie.maxKey];
    return context.db.transactions.where(CHAIN_HISTORY_INDEX).between(lower, upper, true, !cursor).reverse();
  }

  if (query.accountId !== undefined) {
    const lower = [query.accountId, Dexie.minKey, Dexie.minKey];
    const upper = cursor
      ? [query.accountId, cursor.createAt, cursor.transactionId]
      : [query.accountId, Dexie.maxKey, Dexie.maxKey];
    return context.db.transactions.where(ACCOUNT_HISTORY_INDEX).between(lower, upper, true, !cursor).reverse();
  }

  if (cursor) {
    return context.db.transactions.where(GLOBAL_HISTORY_INDEX).below([cursor.createAt, cursor.transactionId]).reverse();
  }

  return context.db.transactions.orderBy(GLOBAL_HISTORY_INDEX).reverse();
};

const toCursor = (record: TransactionRecord): TransactionHistoryCursor => ({
  createAt: record.createAt,
  transactionId: record.transactionId,
});

export const createTransactionsReader = (context: DexiePersistenceContext): TransactionsReader => ({
  async get(transactionId) {
    await context.ready;
    return (await context.db.transactions.get(transactionId)) ?? null;
  },

  async listHistory(query) {
    await context.ready;
    let collection = historyCollection(context, query);

    if (query.chainRef !== undefined && query.accountId !== undefined) {
      collection = collection.filter((record) => record.accountId === query.accountId);
    }
    if (query.statuses !== undefined) {
      const statuses = new Set(query.statuses);
      collection = collection.filter((record) => statuses.has(record.status));
    }

    const candidates = await collection.limit(query.limit + 1).toArray();
    const transactions = candidates.slice(0, query.limit);

    if (candidates.length <= query.limit) {
      return { transactions };
    }

    return {
      transactions,
      nextCursor: toCursor(transactions.at(-1) as TransactionRecord),
    };
  },

  async listByConflictKey(query) {
    await context.ready;
    return await context.db.transactions
      .where(CONFLICT_INDEX)
      .equals([query.chainRef, query.conflictKey.kind, query.conflictKey.value])
      .toArray();
  },

  async listByStatuses(statuses) {
    await context.ready;
    if (statuses.length === 0) return [];
    return await context.db.transactions
      .where("status")
      .anyOf([...statuses])
      .toArray();
  },

  async existsByChainRefAndStatuses(query) {
    await context.ready;
    if (query.statuses.length === 0) return false;
    const record = await context.db.transactions
      .where("status")
      .anyOf([...query.statuses])
      .filter((candidate) => candidate.chainRef === query.chainRef)
      .first();
    return record !== undefined;
  },

  async listIds() {
    await context.ready;
    return await context.db.transactions.toCollection().primaryKeys();
  },
});
