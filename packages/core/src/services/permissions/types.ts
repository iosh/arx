import type { ChainRef } from "../../chains/ids.js";
import type { PermissionRecord } from "../../db/records.js";

export type PermissionsChangedHandler = () => void;

export type GetPermissionByOriginParams = {
  origin: string;
  namespace: string;
  chainRef: ChainRef;
};

export type PermissionsService = {
  on(event: "changed", handler: PermissionsChangedHandler): void;
  off(event: "changed", handler: PermissionsChangedHandler): void;

  get(id: PermissionRecord["id"]): Promise<PermissionRecord | null>;
  getByOrigin(params: GetPermissionByOriginParams): Promise<PermissionRecord | null>;

  listByOrigin(origin: string): Promise<PermissionRecord[]>;
  upsert(record: PermissionRecord): Promise<void>;
  remove(id: PermissionRecord["id"]): Promise<void>;

  clearOrigin(origin: string): Promise<void>;
};
