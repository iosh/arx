import type { PermissionRecord } from "../../../storage/records.js";

export interface PermissionsPort {
  /**
   * Returns all permission records.
   * Used by the permissions owner to hydrate its in-memory authorization ledger.
   */
  listAll(): Promise<PermissionRecord[]>;

  get(params: { origin: string; namespace: string }): Promise<PermissionRecord | null>;

  listByOrigin(origin: string): Promise<PermissionRecord[]>;

  upsert(record: PermissionRecord): Promise<void>;
  remove(params: { origin: string; namespace: string }): Promise<void>;

  clearOrigin(origin: string): Promise<void>;
}
