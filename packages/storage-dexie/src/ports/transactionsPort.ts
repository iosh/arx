import type { ChainRef } from "@arx/core/chains";
import type { TransactionsPort } from "@arx/core/services";
import { type TransactionRecord, TransactionRecordSchema } from "@arx/core/storage";
import type { DexieCtx } from "../internal/ctx.js";
import { parseOrDrop } from "../internal/parseOrDrop.js";

export class DexieTransactionsPort implements TransactionsPort {
  constructor(private readonly ctx: DexieCtx) {}

  private get table() {
    return this.ctx.db.transactions;
  }

  async get(id: TransactionRecord["id"]): Promise<TransactionRecord | null> {
    await this.ctx.ready;
    const row = await this.table.get(id);
    return await this.parseRow(row, id);
  }

  async list(query?: {
    chainRef?: ChainRef;
    status?: TransactionRecord["status"];
    limit?: number;
    before?: {
      createdAt: number;
      id: TransactionRecord["id"];
    };
  }): Promise<TransactionRecord[]> {
    await this.ctx.ready;

    const limit = query?.limit ?? 100;
    const batchSize = Math.max(50, Math.min(200, limit * 2));

    const chainRef = query?.chainRef;
    const status = query?.status;
    const before = query?.before;
    const minCreatedAt = Number.MIN_SAFE_INTEGER;
    const maxCreatedAt = Number.MAX_SAFE_INTEGER;
    const minId = "";
    const maxId = "\uffff";

    const base = (() => {
      if (chainRef !== undefined) {
        const upper = before !== undefined ? [chainRef, before.createdAt, before.id] : [chainRef, maxCreatedAt, maxId];
        const includeUpper = before === undefined;
        return this.table
          .where("[chainRef+createdAt+id]")
          .between([chainRef, minCreatedAt, minId], upper, true, includeUpper)
          .reverse();
      }

      if (status !== undefined) {
        const upper = before !== undefined ? [status, before.createdAt, before.id] : [status, maxCreatedAt, maxId];
        const includeUpper = before === undefined;
        return this.table
          .where("[status+createdAt+id]")
          .between([status, minCreatedAt, minId], upper, true, includeUpper)
          .reverse();
      }

      if (before !== undefined) {
        return this.table.where("[createdAt+id]").below([before.createdAt, before.id]).reverse();
      }

      return this.table.orderBy("[createdAt+id]").reverse();
    })();

    const out: TransactionRecord[] = [];
    let offset = 0;

    while (out.length < limit) {
      const rows = await base.offset(offset).limit(batchSize).toArray();
      if (rows.length === 0) break;
      offset += rows.length;

      for (const row of rows) {
        const id = typeof (row as { id?: unknown }).id === "string" ? row.id : undefined;
        const parsed = await this.parseRow(row, id);
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
    await this.ctx.ready;

    // Requires db.ts to include [chainRef+hash]
    const row = await this.table.where("[chainRef+hash]").equals([params.chainRef, params.hash]).first();
    const id = row && typeof (row as { id?: unknown }).id === "string" ? row.id : undefined;
    const parsed = await this.parseRow(row, id);

    if (!parsed) return null;
    if (parsed.chainRef !== params.chainRef || parsed.hash !== params.hash) return null;
    return parsed;
  }

  async create(record: TransactionRecord): Promise<void> {
    await this.ctx.ready;
    await this.table.add(TransactionRecordSchema.parse(record));
  }

  async updateIfStatus(params: {
    id: TransactionRecord["id"];
    expectedStatus: TransactionRecord["status"];
    next: TransactionRecord;
  }): Promise<boolean> {
    await this.ctx.ready;

    return await this.ctx.db.transaction("rw", this.table, async () => {
      const row = await this.table.get(params.id);
      const current = await this.parseRow(row, params.id);
      if (!current) return false;

      if (current.status !== params.expectedStatus) return false;

      await this.table.put(TransactionRecordSchema.parse(params.next));
      return true;
    });
  }

  async remove(id: TransactionRecord["id"]): Promise<void> {
    await this.ctx.ready;
    await this.table.delete(id);
  }

  private async parseRow(row: unknown, deleteKey?: TransactionRecord["id"]): Promise<TransactionRecord | null> {
    if (!row) return null;

    if (!deleteKey) {
      const parsed = TransactionRecordSchema.safeParse(row);
      if (!parsed.success) {
        this.ctx.log.warn("[storage-dexie] invalid transaction record detected, cannot drop", parsed.error);
        return null;
      }
      return parsed.data;
    }

    return await parseOrDrop({
      schema: TransactionRecordSchema,
      row,
      what: "transaction record",
      drop: () => this.table.delete(deleteKey),
      log: this.ctx.log,
    });
  }
}
