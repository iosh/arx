import { base64 } from "@scure/base";
import { assert, describe, expect, it } from "vitest";
import { createUnlockedVault, replaceVaultPlaintext, unlockVaultRecord } from "./crypto.js";
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
    assert(draft);
    try {
      expect(new TextDecoder().decode(draft.plaintext)).toBe("ARX vault test");
      expect(draft.unlocked.record).toEqual(fixedRecord);
    } finally {
      draft.plaintext.fill(0);
      draft.unlocked.encryptionKey.fill(0);
    }
  });

  it("roundtrips opaque bytes and re-encrypts with the same salt and a new IV", async () => {
    const firstPlaintext = encoder.encode("first opaque plaintext");
    const secondPlaintext = encoder.encode("second opaque plaintext");
    const first = await createUnlockedVault({ password: "password", plaintext: firstPlaintext });
    const firstUnlocked = await unlockVaultRecord(first.record, "password");
    assert(firstUnlocked);
    try {
      expect(firstUnlocked.plaintext).toEqual(firstPlaintext);
      expect(base64.decode(first.record.salt)).toHaveLength(16);
      expect(base64.decode(first.record.iv)).toHaveLength(12);
      const second = replaceVaultPlaintext(first, secondPlaintext);
      const secondUnlocked = await unlockVaultRecord(second.record, "password");
      assert(secondUnlocked);
      try {
        expect(second.record.salt).toBe(first.record.salt);
        expect(second.record.iv).not.toBe(first.record.iv);
        expect(secondUnlocked.plaintext).toEqual(secondPlaintext);
      } finally {
        secondUnlocked.plaintext.fill(0);
        secondUnlocked.unlocked.encryptionKey.fill(0);
      }
    } finally {
      first.encryptionKey.fill(0);
      firstUnlocked.plaintext.fill(0);
      firstUnlocked.unlocked.encryptionKey.fill(0);
      firstPlaintext.fill(0);
      secondPlaintext.fill(0);
    }
  });

  it("rejects a new password below the shared code-point minimum", async () => {
    await expect(
      createUnlockedVault({
        password: "🔐".repeat(VAULT_PASSWORD_MIN_LENGTH - 1),
        plaintext: encoder.encode("keyring secrets"),
      }),
    ).rejects.toThrow("below the required minimum");
  });

  it("returns null when the password or ciphertext fails authentication", async () => {
    await expect(unlockVaultRecord(fixedRecord, "wrong password")).resolves.toBeNull();
    const ciphertext = base64.decode(fixedRecord.ciphertext);
    ciphertext[0] = (ciphertext[0] as number) ^ 1;
    await expect(
      unlockVaultRecord(
        {
          ...fixedRecord,
          ciphertext: base64.encode(ciphertext),
        },
        "correct horse battery staple",
      ),
    ).resolves.toBeNull();
  });
});
