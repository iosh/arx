import type { VaultMetaSnapshot } from "@arx/core/storage";

export type VaultMetaEntity = {
  id: "vault-meta";
  version: number;
  updatedAt: number;
  payload: VaultMetaSnapshot;
};
