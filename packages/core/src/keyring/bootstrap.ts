import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { EncryptedVaultRecord } from "../vault/persistence.js";
import type { KeySource } from "./types.js";

export type KeyringBootstrap = Readonly<{
  encryptedVault: EncryptedVaultRecord | null;
  keySources: readonly KeySource[];
}>;

export const loadKeyringBootstrap = async (
  readers: Pick<CorePersistenceReaders, "encryptedVault" | "keySources">,
): Promise<KeyringBootstrap> => {
  const [encryptedVault, keySources] = await Promise.all([readers.encryptedVault.get(), readers.keySources.listAll()]);

  return { encryptedVault, keySources };
};
