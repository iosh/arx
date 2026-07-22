import {
  isPendingTransactionRecord,
  type TransactionCursor,
  type TransactionQuery,
  type TransactionRecord,
  type TransactionsReader,
  transactionRecordToTransaction,
} from "@arx/core/persistence";
import type { Collection } from "dexie";
import type { DexiePersistenceContext } from "../database.js";
import type { TransactionRow } from "../rows.js";

const GLOBAL_HISTORY_INDEX = "[createdAt+transactionId]";
const CHAIN_HISTORY_INDEX = "[chainRef+createdAt+transactionId]";
const ACCOUNT_HISTORY_INDEX = "[accountId+createdAt+transactionId]";
const EARLIEST_TIMESTAMP = Number.MIN_SAFE_INTEGER;
const LATEST_TIMESTAMP = Number.MAX_SAFE_INTEGER;
const FIRST_TRANSACTION_ID = "";
const LAST_TRANSACTION_ID = "\uffff";

const historyCollection = (
  context: DexiePersistenceContext,
  query: TransactionQuery,
): Collection<TransactionRow, string> => {
  const cursor = query.cursor;

  if (query.chainRef !== undefined) {
    const lower = [query.chainRef, EARLIEST_TIMESTAMP, FIRST_TRANSACTION_ID];
    const upper = cursor
      ? [query.chainRef, cursor.createdAt, cursor.transactionId]
      : [query.chainRef, LATEST_TIMESTAMP, LAST_TRANSACTION_ID];
    return context.db.transactions.where(CHAIN_HISTORY_INDEX).between(lower, upper, true, !cursor).reverse();
  }

  if (query.accountId !== undefined) {
    const lower = [query.accountId, EARLIEST_TIMESTAMP, FIRST_TRANSACTION_ID];
    const upper = cursor
      ? [query.accountId, cursor.createdAt, cursor.transactionId]
      : [query.accountId, LATEST_TIMESTAMP, LAST_TRANSACTION_ID];
    return context.db.transactions.where(ACCOUNT_HISTORY_INDEX).between(lower, upper, true, !cursor).reverse();
  }

  if (cursor) {
    return context.db.transactions
      .where(GLOBAL_HISTORY_INDEX)
      .below([cursor.createdAt, cursor.transactionId])
      .reverse();
  }

  return context.db.transactions.orderBy(GLOBAL_HISTORY_INDEX).reverse();
};

const toCursor = (record: TransactionRecord): TransactionCursor => ({
  createdAt: record.createdAt,
  transactionId: record.transactionId,
});

export const createTransactionsReader = (context: DexiePersistenceContext): TransactionsReader => ({
  get(transactionId) {
    return context.read(async () => {
      await context.ready;
      const record = await context.db.transactions.get(transactionId);
      return record ? transactionRecordToTransaction(record) : null;
    });
  },

  list(query) {
    return context.read(async () => {
      await context.ready;
      if (query.limit <= 0) return { transactions: [] };

      let collection = historyCollection(context, query);

      if (query.chainRef !== undefined && query.accountId !== undefined) {
        collection = collection.filter((record) => record.accountId === query.accountId);
      }
      if (query.statuses !== undefined) {
        const statuses = new Set(query.statuses);
        collection = collection.filter((record) => statuses.has(record.state.status));
      }

      const candidates = await collection.limit(query.limit + 1).toArray();
      const records = candidates.slice(0, query.limit);

      if (candidates.length <= query.limit) {
        return { transactions: records.map(transactionRecordToTransaction) };
      }

      return {
        transactions: records.map(transactionRecordToTransaction),
        nextCursor: toCursor(records.at(-1) as TransactionRecord),
      };
    });
  },

  listPending() {
    return context.read(async () => {
      await context.ready;
      const records = await context.db.transactions.where("state.status").equals("pending").toArray();
      return records.filter(isPendingTransactionRecord);
    });
  },
});
