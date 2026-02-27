import { z } from "zod";
import { epochMillisecondsSchema } from "../validators.js";
import { createSnapshotSchema } from "./snapshot.js";

const vaultCiphertextSchema = z.strictObject({
  version: z.number().int().positive(),
  algorithm: z.literal("pbkdf2-sha256"),
  salt: z.string().min(1),
  iterations: z.number().int().positive(),
  iv: z.string().min(1),
  cipher: z.string().min(1),
  createdAt: epochMillisecondsSchema,
});

export const VAULT_META_SNAPSHOT_VERSION = 3;

const vaultMetaPayloadSchema = z.strictObject({
  ciphertext: vaultCiphertextSchema.nullable(),
  autoLockDurationMs: z.number().int().positive(),
  initializedAt: epochMillisecondsSchema,
});

export const VaultMetaSnapshotSchema = createSnapshotSchema({
  version: VAULT_META_SNAPSHOT_VERSION,
  payload: vaultMetaPayloadSchema,
});

export type VaultMetaSnapshot = z.infer<typeof VaultMetaSnapshotSchema>;
