import { type ApprovalRecord, ApprovalRecordSchema } from "@arx/core/db";
import type { ApprovalsPort } from "@arx/core/services";
import type { Dexie, PromiseExtended, Table } from "dexie";
import type { ArxStorageDatabase } from "../db.js";
export class DexieApprovalsPort implements ApprovalsPort {
  private readonly ready: PromiseExtended<Dexie>;
  private readonly table: Table<ApprovalRecord, string>;

  constructor(private readonly db: ArxStorageDatabase) {
    this.ready = this.db.open();
    this.table = this.db.approvals;
  }

  async get(id: ApprovalRecord["id"]): Promise<ApprovalRecord | null> {
    await this.ready;
    const row = await this.table.get(id);
    return await this.parseRow(row);
  }

  async listPending(): Promise<ApprovalRecord[]> {
    await this.ready;
    const rows = await this.table.where("status").equals("pending").toArray();
    const out: ApprovalRecord[] = [];
    for (const row of rows) {
      const parsed = await this.parseRow(row);
      if (parsed && parsed.status === "pending") {
        out.push(parsed);
      }
    }
    return out;
  }

  async upsert(record: ApprovalRecord): Promise<void> {
    await this.ready;
    // Storage-level validation: drop invalid writes early.
    const checked = ApprovalRecordSchema.parse(record);
    await this.table.put(checked);
  }

  private async parseRow(row: ApprovalRecord | undefined): Promise<ApprovalRecord | null> {
    if (!row) return null;

    const parsed = ApprovalRecordSchema.safeParse(row);
    if (!parsed.success) {
      console.warn("[storage-dexie] invalid approval record, dropping", parsed.error);
      await this.table.delete(row.id);
      return null;
    }
    return parsed.data;
  }
}
