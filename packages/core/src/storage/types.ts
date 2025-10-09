import type { StorageNamespace, StorageSnapshotMap, VaultMetaSnapshot } from "./schemas.js";
export type SnapshotEnvelope<TPayload, TVersion extends number = number> = {
  version: TVersion;
  updatedAt: number;
  payload: TPayload;
};

export interface StoragePort {
  loadSnapshot<TNamespace extends StorageNamespace>(
    namespace: TNamespace,
  ): Promise<StorageSnapshotMap[TNamespace] | null>;
  saveSnapshot<TNamespace extends StorageNamespace>(
    namespace: TNamespace,
    envelope: StorageSnapshotMap[TNamespace],
  ): Promise<void>;
  clearSnapshot(namespace: StorageNamespace): Promise<void>;

  loadVaultMeta(): Promise<VaultMetaSnapshot | null>;
  saveVaultMeta(envelope: VaultMetaSnapshot): Promise<void>;
  clearVaultMeta(): Promise<void>;
}
