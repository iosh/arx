import type { VaultMetaSnapshot } from "./schemas.js";

export interface VaultMetaPort {
  loadVaultMeta(): Promise<VaultMetaSnapshot | null>;
  saveVaultMeta(envelope: VaultMetaSnapshot): Promise<void>;
  clearVaultMeta(): Promise<void>;
}
