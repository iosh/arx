import { describe, expect, it } from "vitest";
import type { VaultCiphertext } from "./types.js";
import { createVaultService, VAULT_VERSION } from "./vaultService.js";

const PASSWORD = "correct horse battery staple";
const toArray = (bytes: Uint8Array) => Array.from(bytes);

describe("vaultService", () => {
  it("initializes a vault and exposes ciphertext metadata", async () => {
    const vault = createVaultService();

    const ciphertext = await vault.initialize({ password: PASSWORD });

    expect(ciphertext.version).toBe(VAULT_VERSION);
    expect(ciphertext.algorithm).toBe("pbkdf2-sha256");
    expect(ciphertext.iterations).toBe(600_000);
    expect(typeof ciphertext.createdAt).toBe("number");
    expect(vault.isUnlocked()).toBe(true);
    expect(vault.getStatus()).toEqual({ isUnlocked: true, hasCiphertext: true });

    const exported = vault.exportKey();
    expect(exported).toBeInstanceOf(Uint8Array);
    expect(exported.length).toBe(32);

    exported.fill(42);
    const second = vault.exportKey();
    expect(toArray(second)).not.toEqual(toArray(exported));

    vault.lock();
    expect(vault.getStatus()).toEqual({ isUnlocked: false, hasCiphertext: true });

    expect(() => vault.exportKey()).toThrowError(/Vault is locked/);
  });

  it("reject unlock attempts with an incorrect password", async () => {
    const vault = createVaultService();
    const ciphertext = await vault.initialize({ password: PASSWORD });

    vault.lock();
    await expect(vault.unlock({ password: "wrong", ciphertext })).rejects.toMatchObject({
      code: "ARX_VAULT_INVALID_PASSWORD",
    });
  });

  it("seals custom secrets and allows importing ciphertext", async () => {
    const customSecret = Uint8Array.from({ length: 32 }, (_, index) => index);
    const vault = createVaultService();
    const initialCiphertext = await vault.initialize({ password: PASSWORD });

    const sealedCiphertext = await vault.seal({
      password: PASSWORD,
      secret: customSecret,
    });
    expect(sealedCiphertext.cipher).not.toBe(initialCiphertext.cipher);

    const exportedSecret = vault.exportKey();
    expect(toArray(exportedSecret)).toEqual(toArray(customSecret));

    const importedCiphertext = vault.getCiphertext();
    expect(importedCiphertext).not.toBeNull();

    const secondVault = createVaultService();
    secondVault.importCiphertext(importedCiphertext as VaultCiphertext);
    expect(secondVault.getStatus()).toEqual({ isUnlocked: false, hasCiphertext: true });

    const recovered = await secondVault.unlock({ password: PASSWORD });
    expect(toArray(recovered)).toEqual(toArray(customSecret));
  });

  it("throws when ciphertest metadata is tampered", async () => {
    const vault = createVaultService();
    const ciphertext = await vault.initialize({ password: PASSWORD });

    const tampered = {
      ...ciphertext,
      algorithm: "pbkdf2-sha512",
    } as unknown as VaultCiphertext;

    vault.lock();
    await expect(vault.unlock({ password: PASSWORD, ciphertext: tampered })).rejects.toMatchObject({
      code: "ARX_VAULT_INVALID_CIPHERTEXT",
    });
  });

  it("allows exporting key after unlock", async () => {
    const vault = createVaultService();
    const ciphertext = await vault.initialize({ password: PASSWORD });

    vault.lock();
    const recovered = await vault.unlock({ password: PASSWORD, ciphertext });

    expect(vault.isUnlocked()).toBe(true);
    const exported = vault.exportKey();
    expect(toArray(exported)).toEqual(toArray(recovered));
  });

  it("respects custom config", async () => {
    const vault = createVaultService({ iterations: 100_000 });
    const ciphertext = await vault.initialize({ password: PASSWORD });

    expect(ciphertext.iterations).toBe(100_000);
  });

  it("rejects empty passwords", async () => {
    const vault = createVaultService();

    await expect(vault.initialize({ password: "   " })).rejects.toThrowError(/password/i);
  });

  it("seal allows changing password", async () => {
    const vault = createVaultService();
    const ciphertext = await vault.initialize({ password: "old-password" });

    const customSecret = Uint8Array.from([1, 2, 3, 4, 5]);
    const sealed = await vault.seal({
      password: "new-password", // 新密码
      secret: customSecret,
    });

    vault.lock();

    const recovered = await vault.unlock({ password: "new-password", ciphertext: sealed });

    expect(toArray(recovered)).toEqual(toArray(customSecret));

    await expect(vault.unlock({ password: "old-password", ciphertext: sealed })).rejects.toMatchObject({
      code: "ARX_VAULT_INVALID_PASSWORD",
    });
  });

  it("allows unlocking after importCiphertext", async () => {
    const vault1 = createVaultService();
    const ciphertext = await vault1.initialize({ password: PASSWORD });
    const secret = vault1.exportKey();

    const vault2 = createVaultService();
    vault2.importCiphertext(ciphertext);

    expect(vault2.getStatus()).toEqual({ isUnlocked: false, hasCiphertext: true });

    const recovered = await vault2.unlock({ password: PASSWORD });
    expect(toArray(recovered)).toEqual(toArray(secret));
  });
});
