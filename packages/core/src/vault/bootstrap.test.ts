import { describe, expect, it, vi } from "vitest";
import type { CorePersistenceReaders } from "../persistence/corePersistence.js";
import { loadVaultBootstrap } from "./bootstrap.js";
import type { EncryptedVaultRecord } from "./persistence.js";

const encryptedVault: EncryptedVaultRecord = {
  salt: "AAECAwQFBgcICQoLDA0ODw==",
  iv: "EBESExQVFhcYGRob",
  ciphertext: "zp/Hc7X9pGfcMMMdmr+Fmv+RHSNqR5YnwEDSEQ==",
};

describe("loadVaultBootstrap", () => {
  it("loads the encrypted vault record", async () => {
    const readers = {
      encryptedVault: { get: vi.fn(async () => encryptedVault) },
    } satisfies Pick<CorePersistenceReaders, "encryptedVault">;

    await expect(loadVaultBootstrap(readers)).resolves.toEqual({ encryptedVault });
    expect(readers.encryptedVault.get).toHaveBeenCalledOnce();
  });
});
