import type { PermissionRecord } from "../../db/records.js";

export type PermissionsChangedEvent = {
  origin: string | null;
};

export type PermissionsChangedHandler = (event: PermissionsChangedEvent) => void;

export type GetPermissionByOriginParams = {
  origin: string;
  namespace: string;
};

export type PermissionsService = {
  on(event: "changed", handler: PermissionsChangedHandler): void;
  off(event: "changed", handler: PermissionsChangedHandler): void;

  get(id: PermissionRecord["id"]): Promise<PermissionRecord | null>;
  getByOrigin(params: GetPermissionByOriginParams): Promise<PermissionRecord | null>;

  listAll(): Promise<PermissionRecord[]>;

  listByOrigin(origin: string): Promise<PermissionRecord[]>;
  /**
   * Store-facing upsert:
   * - `updatedAt` is managed by the service (callers should not supply it).
   * - `id` is optional; the service reuses the existing id for (origin, namespace).
   */
  upsert(record: PermissionRecordInput): Promise<PermissionRecord>;
  remove(id: PermissionRecord["id"]): Promise<void>;

  clearOrigin(origin: string): Promise<void>;
};

export type PermissionRecordInput = Omit<PermissionRecord, "id" | "updatedAt"> & {
  id?: PermissionRecord["id"];
};
