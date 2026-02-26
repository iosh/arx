import type { PermissionRecord } from "../../../storage/records.js";
import type { Unsubscribe } from "../_shared/signal.js";

export type PermissionsChangedEvent = {
  origin: string | null;
};

export type PermissionsChangedHandler = (event: PermissionsChangedEvent) => void;

export type PermissionKey = {
  origin: string;
  namespace: string;
};

export type PermissionsService = {
  subscribeChanged(handler: PermissionsChangedHandler): Unsubscribe;

  get(key: PermissionKey): Promise<PermissionRecord | null>;

  listAll(): Promise<PermissionRecord[]>;

  listByOrigin(origin: string): Promise<PermissionRecord[]>;
  /**
   * Store-facing upsert:
   * - `updatedAt` is managed by the service (callers should not supply it).
   */
  upsert(record: PermissionRecordInput): Promise<PermissionRecord>;
  remove(key: PermissionKey): Promise<void>;

  clearOrigin(origin: string): Promise<void>;
};

export type PermissionRecordInput = Omit<PermissionRecord, "updatedAt">;
