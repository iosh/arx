import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { EncryptedVaultRecord } from "./persistence.js";

export type VaultBootstrap = Readonly<{
  encryptedVault: EncryptedVaultRecord | null;
  autoLockDurationMs: number;
}>;

export const loadVaultBootstrap = async (params: {
  readers: Pick<CorePersistenceReaders, "encryptedVault" | "settings">;
  defaultAutoLockDurationMs: number;
}): Promise<VaultBootstrap> => {
  const [encryptedVault, autoLock] = await Promise.all([
    params.readers.encryptedVault.get(),
    params.readers.settings.get("autoLock"),
  ]);
  return {
    encryptedVault,
    autoLockDurationMs: autoLock?.value.durationMs ?? params.defaultAutoLockDurationMs,
  };
};
