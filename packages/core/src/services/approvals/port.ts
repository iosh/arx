import type { ApprovalRecord } from "../../db/records.js";

export interface ApprovalsPort {
  get(id: ApprovalRecord["id"]): Promise<ApprovalRecord | null>;

  /**
   * Returns pending approvals in a stable order (createdAt asc, then id asc).
   */
  listPending(): Promise<ApprovalRecord[]>;

  upsert(record: ApprovalRecord): Promise<void>;
}
