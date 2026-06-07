import { z } from "zod";
import { AccountKeySchema } from "../../../storage/records.js";
import { defineMethod } from "./types.js";

const passwordSchema = z
  .string()
  .min(1)
  .refine((v) => v.trim().length > 0, { message: "Password cannot be empty." });

export const keyringsMethods = {
  "ui.keyrings.confirmNewMnemonic": defineMethod(
    "command",
    z.strictObject({
      words: z.array(z.string().min(1)).min(12).max(24),
      alias: z.string().min(1).optional(),
      skipBackup: z.boolean().optional(),
      namespace: z.string().min(1).optional(),
    }),
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.importMnemonic": defineMethod(
    "command",
    z.strictObject({
      words: z.array(z.string().min(1)).min(12).max(24),
      alias: z.string().min(1).optional(),
      namespace: z.string().min(1).optional(),
    }),
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.importPrivateKey": defineMethod(
    "command",
    z.strictObject({
      privateKey: z.string().min(1),
      alias: z.string().min(1).optional(),
      namespace: z.string().min(1).optional(),
    }),
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.deriveAccount": defineMethod("command", z.strictObject({ keyringId: z.uuid() }), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.list": defineMethod("query", z.undefined()),

  "ui.keyrings.getAccountsByKeyring": defineMethod(
    "query",
    z.strictObject({ keyringId: z.uuid(), includeHidden: z.boolean().optional() }),
  ),

  "ui.keyrings.renameKeyring": defineMethod(
    "command",
    z.strictObject({ keyringId: z.uuid(), alias: z.string().min(1) }),
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.renameAccount": defineMethod(
    "command",
    z.strictObject({ accountKey: AccountKeySchema, alias: z.string().min(1) }),
    { broadcastSnapshot: true },
  ),

  "ui.keyrings.markBackedUp": defineMethod("command", z.strictObject({ keyringId: z.uuid() }), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.hideHdAccount": defineMethod("command", z.strictObject({ accountKey: AccountKeySchema }), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.unhideHdAccount": defineMethod("command", z.strictObject({ accountKey: AccountKeySchema }), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.removePrivateKeyKeyring": defineMethod("command", z.strictObject({ keyringId: z.uuid() }), {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.exportMnemonic": defineMethod(
    "command",
    z.strictObject({ keyringId: z.uuid(), password: passwordSchema }),
  ),

  "ui.keyrings.exportPrivateKey": defineMethod(
    "command",
    z.strictObject({ accountKey: AccountKeySchema, password: passwordSchema }),
  ),
} as const;
