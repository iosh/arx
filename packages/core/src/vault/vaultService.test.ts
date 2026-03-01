import { ArxReasons } from "@arx/errors";
import { describe, expect, it } from "vitest";
import type { VaultEnvelope } from "./types.js";
import { randomBytes } from "./utils.js";
import { createVaultService, VAULT_VERSION } from "./vaultService.js";

const PASSWORD = "correct horse battery staple";
const toArray = (bytes: Uint8Array) => Array.from(bytes);

describe("vaultService", () => {
  it("initializes a vault and exposes envelope metadata", async () => {
    const vault = createVaultService();

    const envelope = await vault.initialize({ password: PASSWORD });

    expect(envelope.version).toBe(VAULT_VERSION);
    expect(envelope.kdf).toEqual({
      name: "pbkdf2",
      hash: "sha256",
      salt: expect.any(String),
      iterations: 600_000,
    });
    expect(envelope.cipher.name).toBe("aes-gcm");
    expect(typeof envelope.cipher.iv).toBe("string");
    expect(typeof envelope.cipher.data).toBe("string");

    expect(vault.isUnlocked()).toBe(true);
    expect(vault.getStatus()).toEqual({ isUnlocked: true, hasEnvelope: true });

    const exported = vault.exportSecret();
    expect(exported).toBeInstanceOf(Uint8Array);
    expect(exported.length).toBe(32);

    exported.fill(42);
    const second = vault.exportSecret();
    expect(toArray(second)).not.toEqual(toArray(exported));

    vault.lock();
    expect(vault.getStatus()).toEqual({ isUnlocked: false, hasEnvelope: true });
    expect(() => vault.exportSecret()).toThrowError(/locked/i);
  });

  it("rejects unlock attempts with an incorrect password", async () => {
    const vault = createVaultService();
    const envelope = await vault.initialize({ password: PASSWORD });

    vault.lock();
    await expect(vault.unlock({ password: "wrong", envelope })).rejects.toMatchObject({
      reason: ArxReasons.VaultInvalidPassword,
    });
  });

  it("supports importing an envelope and unlocking", async () => {
    const customSecret = Uint8Array.from({ length: 32 }, (_, index) => index);
    const vault1 = createVaultService();
    const envelope1 = await vault1.initialize({ password: PASSWORD, secret: customSecret });

    const vault2 = createVaultService();
    vault2.importEnvelope(envelope1);
    expect(vault2.getStatus()).toEqual({ isUnlocked: false, hasEnvelope: true });

    await vault2.unlock({ password: PASSWORD });
    expect(toArray(vault2.exportSecret())).toEqual(toArray(customSecret));
  });

  it("throws when envelope metadata is tampered", async () => {
    const vault = createVaultService();
    const envelope = await vault.initialize({ password: PASSWORD });

    const tampered = {
      ...envelope,
      kdf: { ...envelope.kdf, hash: "sha512" },
    } as unknown as VaultEnvelope;

    vault.lock();
    await expect(vault.unlock({ password: PASSWORD, envelope: tampered })).rejects.toMatchObject({
      reason: ArxReasons.VaultInvalidCiphertext,
    });
  });

  it("allows exporting secret after unlock", async () => {
    const vault = createVaultService();
    const envelope = await vault.initialize({ password: PASSWORD });
    const secret = vault.exportSecret();

    vault.lock();
    await vault.unlock({ password: PASSWORD, envelope });

    expect(vault.isUnlocked()).toBe(true);
    expect(toArray(vault.exportSecret())).toEqual(toArray(secret));
  });

  it("respects custom config", async () => {
    const vault = createVaultService({ iterations: 100_000 });
    const envelope = await vault.initialize({ password: PASSWORD });
    expect(envelope.kdf.iterations).toBe(100_000);
  });

  it("rejects empty passwords", async () => {
    const vault = createVaultService();
    await expect(vault.initialize({ password: "   " })).rejects.toThrowError(/password/i);
  });

  it("commitSecret reseals using the current derived key without a password", async () => {
    const vault = createVaultService();
    const envelope = await vault.initialize({ password: PASSWORD });
    await vault.unlock({ password: PASSWORD, envelope });

    const nextSecret = randomBytes(32);
    const updated = await vault.commitSecret({ secret: nextSecret });
    expect(updated.cipher.data).not.toEqual(envelope.cipher.data);
    expect(toArray(vault.exportSecret())).toEqual(toArray(nextSecret));
  });

  it("throws when commitSecret is called while locked", async () => {
    const vault = createVaultService();
    await expect(vault.commitSecret({ secret: new Uint8Array([1]) })).rejects.toThrowError(/locked/i);
  });

  it("reencrypt changes password and keeps the vault unlocked", async () => {
    const vault = createVaultService();
    await vault.initialize({ password: "old-password" });
    const secret = vault.exportSecret();

    const nextEnvelope = await vault.reencrypt({ newPassword: "new-password" });

    vault.lock();
    await vault.unlock({ password: "new-password", envelope: nextEnvelope });
    expect(toArray(vault.exportSecret())).toEqual(toArray(secret));

    vault.lock();
    await expect(vault.unlock({ password: "old-password", envelope: nextEnvelope })).rejects.toMatchObject({
      reason: ArxReasons.VaultInvalidPassword,
    });
  });
});
