import type { ApprovalRecord } from "../../db/records.js";

export interface ApprovalsPort {
  get(id: ApprovalRecord["id"]): Promise<ApprovalRecord | null>;
  listPending(): Promise<ApprovalRecord[]>;

  upsert(record: ApprovalRecord): Promise<void>;
}
