import type { PermissionRecord } from "../../../storage/records.js";

export interface PermissionsPort {
  /**
   * Returns all permission records.
   * Used by the store-backed PermissionController to rebuild its in-memory view.
   */
  listAll(): Promise<PermissionRecord[]>;

  get(params: { origin: string; namespace: string }): Promise<PermissionRecord | null>;

  listByOrigin(origin: string): Promise<PermissionRecord[]>;

  upsert(record: PermissionRecord): Promise<void>;
  remove(params: { origin: string; namespace: string }): Promise<void>;

  clearOrigin(origin: string): Promise<void>;
}
