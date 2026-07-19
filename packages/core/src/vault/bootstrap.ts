import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { EncryptedVaultRecord } from "./persistence.js";

export type VaultBootstrap = Readonly<{
  encryptedVault: EncryptedVaultRecord | null;
}>;

export const loadVaultBootstrap = async (
  readers: Pick<CorePersistenceReaders, "encryptedVault">,
): Promise<VaultBootstrap> => ({
  encryptedVault: await readers.encryptedVault.get(),
});
