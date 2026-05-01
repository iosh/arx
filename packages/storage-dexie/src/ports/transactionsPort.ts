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
    const chainRef = query?.chainRef;
    const status = query?.status;
    const before = query?.before;
    const candidateRows = await (() => {
      if (chainRef !== undefined) {
        return this.table.where("chainRef").equals(chainRef).toArray();
      }
      if (status !== undefined) {
        return this.table.where("status").equals(status).toArray();
      }
      return this.table.toArray();
    })();

    const records: TransactionRecord[] = [];
    for (const row of candidateRows) {
      const id = typeof (row as { id?: unknown }).id === "string" ? row.id : undefined;
      const parsed = await this.parseRow(row, id);
      if (!parsed) continue;

      if (chainRef !== undefined && parsed.chainRef !== chainRef) continue;
      if (status !== undefined && parsed.status !== status) continue;
      if (
        before !== undefined &&
        !(
          parsed.createdAt < before.createdAt ||
          (parsed.createdAt === before.createdAt && parsed.id.localeCompare(before.id) < 0)
        )
      ) {
        continue;
      }

      records.push(parsed);
    }

    records.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
    return records.slice(0, limit);
  }

  async findByChainRefAndLocator(params: {
    chainRef: ChainRef;
    locator: TransactionRecord["locator"];
  }): Promise<TransactionRecord | null> {
    await this.ctx.ready;

    const row = await this.table
      .where("[chainRef+locator.format+locator.value]")
      .equals([params.chainRef, params.locator.format, params.locator.value])
      .first();
    const id = row && typeof (row as { id?: unknown }).id === "string" ? row.id : undefined;
    const parsed = await this.parseRow(row, id);

    if (!parsed) return null;
    if (parsed.chainRef !== params.chainRef) return null;
    if (parsed.locator.format !== params.locator.format || parsed.locator.value !== params.locator.value) {
      return null;
    }
    return parsed;
  }

  async create(record: TransactionRecord): Promise<void> {
    await this.ctx.ready;
    const checked = TransactionRecordSchema.parse(record);
    await this.table.add(checked);
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

      const checked = TransactionRecordSchema.parse(params.next);
      await this.table.put(checked);
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
