import type { EncryptedVaultReader } from "@arx/core/persistence";
import type { DexiePersistenceContext } from "../database.js";
import { encryptedVaultFromRow } from "../mappers/singletons.js";
import { ENCRYPTED_VAULT_ROW_KEY } from "../rows.js";

export const createEncryptedVaultReader = (context: DexiePersistenceContext): EncryptedVaultReader => ({
  get() {
    return context.read(async () => {
      await context.ready;
      const row = await context.db.encryptedVault.get(ENCRYPTED_VAULT_ROW_KEY);
      return row ? encryptedVaultFromRow(row) : null;
    });
  },
});
