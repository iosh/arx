import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import type { EncryptedVaultRecord } from "../vault/persistence.js";
import type { HdKeyringRecord, KeySourceRecord } from "./persistence.js";

export type KeyringBootstrap = Readonly<{
  encryptedVault: EncryptedVaultRecord | null;
  keySources: readonly KeySourceRecord[];
  hdKeyrings: readonly HdKeyringRecord[];
}>;

export const loadKeyringBootstrap = async (
  readers: Pick<CorePersistenceReaders, "encryptedVault" | "keySources" | "hdKeyrings">,
): Promise<KeyringBootstrap> => {
  const [encryptedVault, keySources, hdKeyrings] = await Promise.all([
    readers.encryptedVault.get(),
    readers.keySources.listAll(),
    readers.hdKeyrings.listAll(),
  ]);

  return { encryptedVault, keySources, hdKeyrings };
};
