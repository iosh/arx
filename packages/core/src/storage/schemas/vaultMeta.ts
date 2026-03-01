import { z } from "zod";
import { epochMillisecondsSchema } from "../validators.js";
import { createSnapshotSchema } from "./snapshot.js";

const vaultEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  kdf: z.strictObject({
    name: z.literal("pbkdf2"),
    hash: z.literal("sha256"),
    salt: z.string().min(1),
    iterations: z.number().int().positive(),
  }),
  cipher: z.strictObject({
    name: z.literal("aes-gcm"),
    iv: z.string().min(1),
    data: z.string().min(1),
  }),
});

export const VAULT_META_SNAPSHOT_VERSION = 1;

const vaultMetaPayloadSchema = z.strictObject({
  envelope: vaultEnvelopeSchema.nullable(),
  autoLockDurationMs: z.number().int().positive(),
  initializedAt: epochMillisecondsSchema,
});

export const VaultMetaSnapshotSchema = createSnapshotSchema({
  version: VAULT_META_SNAPSHOT_VERSION,
  payload: vaultMetaPayloadSchema,
});

export type VaultMetaSnapshot = z.infer<typeof VaultMetaSnapshotSchema>;
