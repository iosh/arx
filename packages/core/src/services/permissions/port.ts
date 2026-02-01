import type { ChainRef } from "../../chains/ids.js";
import type { PermissionRecord } from "../../db/records.js";

export interface PermissionsPort {
  get(id: PermissionRecord["id"]): Promise<PermissionRecord | null>;

  /**
   * Returns all permission records.
   * Used by the store-backed PermissionController to rebuild its in-memory view.
   */
  listAll(): Promise<PermissionRecord[]>;

  getByOrigin(params: { origin: string; namespace: string; chainRef: ChainRef }): Promise<PermissionRecord | null>;

  listByOrigin(origin: string): Promise<PermissionRecord[]>;

  upsert(record: PermissionRecord): Promise<void>;
  remove(id: PermissionRecord["id"]): Promise<void>;

  clearOrigin(origin: string): Promise<void>;
}
