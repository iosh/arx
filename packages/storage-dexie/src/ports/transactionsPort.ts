import type { ChainRef } from "@arx/core/chains";
import type { TransactionsPort } from "@arx/core/services";
import { type TransactionRecord, TransactionRecordSchema } from "@arx/core/storage";
import { Dexie } from "dexie";
import type { ArxStorageDatabase } from "../db.js";

export class DexieTransactionsPort implements TransactionsPort {
  private readonly ready: ReturnType<ArxStorageDatabase["open"]>;
  private readonly table: ArxStorageDatabase["transactions"];

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.transactions;
  }

  async get(id: TransactionRecord["id"]): Promise<TransactionRecord | null> {
    await this.ready;
    const row = await this.table.get(id);
    return await this.parseRow({ row, deleteKey: id });
  }

  async list(query?: {
    chainRef?: ChainRef;
    status?: TransactionRecord["status"];
    limit?: number;
    beforeCreatedAt?: number;
  }): Promise<TransactionRecord[]> {
    await this.ready;
    const limit = query?.limit ?? 100;
    const batchSize = Math.max(50, Math.min(200, limit * 2));

    const chainRef = query?.chainRef;
    const status = query?.status;
    const beforeCreatedAt = query?.beforeCreatedAt;

    const base = (() => {
      if (chainRef !== undefined) {
        const upper = beforeCreatedAt !== undefined ? [chainRef, beforeCreatedAt] : [chainRef, Dexie.maxKey];
        const includeUpper = beforeCreatedAt === undefined;
        return (this.table as unknown as Dexie.Table<TransactionRecord, string>)
          .where("[chainRef+createdAt]")
          .between([chainRef, Dexie.minKey], upper, true, includeUpper)
          .reverse();
      }

      if (status !== undefined) {
        const upper = beforeCreatedAt !== undefined ? [status, beforeCreatedAt] : [status, Dexie.maxKey];
        const includeUpper = beforeCreatedAt === undefined;
        return (this.table as unknown as Dexie.Table<TransactionRecord, string>)
          .where("[status+createdAt]")
          .between([status, Dexie.minKey], upper, true, includeUpper)
          .reverse();
      }

      if (beforeCreatedAt !== undefined) {
        return this.table.where("createdAt").below(beforeCreatedAt).reverse();
      }

      return this.table.orderBy("createdAt").reverse();
    })();

    const out: TransactionRecord[] = [];
    let offset = 0;

    while (out.length < limit) {
      const rows = await base.offset(offset).limit(batchSize).toArray();
      if (rows.length === 0) break;
      offset += rows.length;

      for (const row of rows) {
        const parsed = await this.parseRow({ row, deleteKey: row.id });
        if (!parsed) continue;

        if (chainRef !== undefined && parsed.chainRef !== chainRef) continue;
        if (status !== undefined && parsed.status !== status) continue;

        out.push(parsed);
        if (out.length >= limit) break;
      }
    }

    return out;
  }

  async findByChainRefAndHash(params: { chainRef: ChainRef; hash: string }): Promise<TransactionRecord | null> {
    await this.ready;

    const rows = await this.table.where("hash").equals(params.hash).toArray();
    for (const row of rows) {
      if (row.chainRef !== params.chainRef) continue;

      const parsed = await this.parseRow({ row, deleteKey: row.id });
      if (parsed && parsed.chainRef === params.chainRef && parsed.hash === params.hash) {
        return parsed;
      }
    }

    return null;
  }

  async upsert(record: TransactionRecord): Promise<void> {
    await this.ready;
    const checked = TransactionRecordSchema.parse(record);
    await this.table.put(checked);
  }

  async updateIfStatus(params: {
    id: TransactionRecord["id"];
    expectedStatus: TransactionRecord["status"];
    next: TransactionRecord;
  }): Promise<boolean> {
    await this.ready;

    return await this.db.transaction("rw", this.table, async () => {
      const row = await this.table.get(params.id);
      const current = await this.parseRow({ row, deleteKey: params.id });
      if (!current) return false;

      if (current.status !== params.expectedStatus) {
        return false;
      }

      const checked = TransactionRecordSchema.parse(params.next);
      await this.table.put(checked);
      return true;
    });
  }

  async remove(id: TransactionRecord["id"]): Promise<void> {
    await this.ready;
    await this.table.delete(id);
  }

  private async parseRow(params: {
    row: TransactionRecord | undefined;
    deleteKey: TransactionRecord["id"];
  }): Promise<TransactionRecord | null> {
    const { row, deleteKey } = params;
    if (!row) return null;

    const parsed = TransactionRecordSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid transaction record, dropping", parsed.error);
      await this.table.delete(deleteKey);
      return null;
    }

    return parsed.data;
  }
}
