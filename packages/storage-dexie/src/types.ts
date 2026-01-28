import type { StorageNamespace } from "@arx/core/storage";

export type VaultMetaEntity = {
  id: "vault-meta";
  version: number;
  updatedAt: number;
  payload: unknown;
};

export type SnapshotEntity = {
  namespace: StorageNamespace;
  envelope: unknown;
};
