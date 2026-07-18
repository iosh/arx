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
  it("loads only the vault record and auto-lock setting, using the configured default when absent", async () => {
    const readers = {
      encryptedVault: { get: vi.fn(async () => encryptedVault) },
      settings: { get: vi.fn(async () => null) },
    } satisfies Pick<CorePersistenceReaders, "encryptedVault" | "settings">;

    await expect(loadVaultBootstrap({ readers, defaultAutoLockDurationMs: 900_000 })).resolves.toEqual({
      encryptedVault,
      autoLockDurationMs: 900_000,
    });
    expect(readers.encryptedVault.get).toHaveBeenCalledOnce();
    expect(readers.settings.get).toHaveBeenCalledWith("autoLock");
  });
});
