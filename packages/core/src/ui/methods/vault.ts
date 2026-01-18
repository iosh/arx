import { z } from "zod";
import { UnlockStateSchema } from "./session.js";
import { defineMethod } from "./types.js";

const VaultCiphertextSchema = z.strictObject({
  version: z.number().int().nonnegative(),
  algorithm: z.literal("pbkdf2-sha256"),
  salt: z.string().min(1),
  iterations: z.number().int().positive(),
  iv: z.string().min(1),
  cipher: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});

const VaultInitResultSchema = z.strictObject({
  ciphertext: VaultCiphertextSchema,
});

export const vaultMethods = {
  "ui.vault.init": defineMethod(z.strictObject({ password: z.string().min(1) }), VaultInitResultSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),

  "ui.vault.initAndUnlock": defineMethod(z.strictObject({ password: z.string().min(1) }), UnlockStateSchema, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
    holdBroadcast: true,
  }),
} as const;
