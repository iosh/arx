import * as Base64 from "ox/Base64";
import { describe, expect, it } from "vitest";
import { changeVaultPassword, createUnlockedVault, replaceVaultPlaintext, unlockVaultRecord } from "./crypto.js";
import { VaultIncorrectPasswordError, VaultPasswordTooShortError, VaultRecordDecodeError } from "./errors.js";
import { VAULT_PASSWORD_MIN_LENGTH } from "./passwordPolicy.js";
import type { EncryptedVaultRecord } from "./persistence.js";

const encoder = new TextEncoder();

const fixedRecord: EncryptedVaultRecord = {
  salt: "AAECAwQFBgcICQoLDA0ODw==",
  iv: "EBESExQVFhcYGRob",
  ciphertext: "agb8IJOfOxl6Ke013P2ano3y/ozpwgpnfigGCN4M",
};

describe("vault crypto", () => {
  it("decrypts the fixed scrypt and AES-256-GCM vector", async () => {
    const draft = await unlockVaultRecord(fixedRecord, "correct horse battery staple");

    expect(new TextDecoder().decode(draft.plaintext)).toBe("ARX vault test");
    expect(draft.unlocked.record).toEqual(fixedRecord);
    expect(draft.unlocked.encryptionKey).toHaveLength(32);
  });

  it("roundtrips opaque bytes and re-encrypts with the same salt and a new IV", async () => {
    const firstPlaintext = encoder.encode("first opaque plaintext");
    const first = await createUnlockedVault({ password: "password", plaintext: firstPlaintext });
    const firstUnlocked = await unlockVaultRecord(first.record, "password");

    expect(firstUnlocked.plaintext).toEqual(firstPlaintext);
    expect(Base64.toBytes(first.record.salt)).toHaveLength(16);
    expect(Base64.toBytes(first.record.iv)).toHaveLength(12);

    const secondPlaintext = encoder.encode("second opaque plaintext");
    const second = await replaceVaultPlaintext(first, secondPlaintext);
    const secondUnlocked = await unlockVaultRecord(second.record, "password");

    expect(second.record.salt).toBe(first.record.salt);
    expect(second.record.iv).not.toBe(first.record.iv);
    expect(secondUnlocked.plaintext).toEqual(secondPlaintext);
  });

  it("uses a new salt when changing the password", async () => {
    const plaintext = encoder.encode("keyring secrets");
    const current = await createUnlockedVault({ password: "current-password", plaintext });
    const changed = await changeVaultPassword({
      unlocked: current,
      currentPassword: "current-password",
      newPassword: "next-password",
    });

    expect(changed.record.salt).not.toBe(current.record.salt);
    await expect(unlockVaultRecord(changed.record, "current-password")).rejects.toBeInstanceOf(
      VaultIncorrectPasswordError,
    );
    await expect(unlockVaultRecord(changed.record, "next-password")).resolves.toMatchObject({ plaintext });
  });

  it("rejects a new password below the shared minimum", async () => {
    await expect(
      createUnlockedVault({
        password: "short",
        plaintext: encoder.encode("keyring secrets"),
      }),
    ).rejects.toMatchObject({
      code: VaultPasswordTooShortError.code,
      details: { minimumLength: VAULT_PASSWORD_MIN_LENGTH, actualLength: 5 },
    });
  });

  it("counts Unicode code points when checking new password length", async () => {
    await expect(
      createUnlockedVault({
        password: "🔐".repeat(VAULT_PASSWORD_MIN_LENGTH - 1),
        plaintext: encoder.encode("keyring secrets"),
      }),
    ).rejects.toMatchObject({
      code: VaultPasswordTooShortError.code,
      details: { minimumLength: VAULT_PASSWORD_MIN_LENGTH, actualLength: VAULT_PASSWORD_MIN_LENGTH - 1 },
    });
  });

  it("rejects a replacement password below the shared minimum", async () => {
    const current = await createUnlockedVault({
      password: "current-password",
      plaintext: encoder.encode("keyring secrets"),
    });

    await expect(
      changeVaultPassword({
        unlocked: current,
        currentPassword: "current-password",
        newPassword: "short",
      }),
    ).rejects.toMatchObject({
      code: VaultPasswordTooShortError.code,
      details: { minimumLength: VAULT_PASSWORD_MIN_LENGTH, actualLength: 5 },
    });
  });

  it("maps a wrong password or corrupted ciphertext to authentication failure", async () => {
    await expect(unlockVaultRecord(fixedRecord, "wrong password")).rejects.toBeInstanceOf(VaultIncorrectPasswordError);

    const ciphertext = Base64.toBytes(fixedRecord.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    await expect(
      unlockVaultRecord({ ...fixedRecord, ciphertext: Base64.fromBytes(ciphertext) }, "correct horse battery staple"),
    ).rejects.toBeInstanceOf(VaultIncorrectPasswordError);
  });

  it("maps an undecodable persisted record to the Vault boundary error", async () => {
    const undecodable = { ...fixedRecord, salt: null } as unknown as EncryptedVaultRecord;

    await expect(unlockVaultRecord(undecodable, "password")).rejects.toMatchObject({
      code: VaultRecordDecodeError.code,
    });
  });
});
