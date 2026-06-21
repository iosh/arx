import { z } from "zod";
import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

const UiKeyringsListParamsSchema = z.undefined();

export const keyringsMethods = {
  "ui.keyrings.confirmNewMnemonic": defineMethod("command", WalletApiSchemas.keyrings.confirmNewMnemonic, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.importMnemonic": defineMethod("command", WalletApiSchemas.keyrings.importMnemonic, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.importPrivateKey": defineMethod("command", WalletApiSchemas.keyrings.importPrivateKey, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.deriveAccount": defineMethod("command", WalletApiSchemas.keyrings.deriveAccount, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.list": defineMethod("query", UiKeyringsListParamsSchema),

  "ui.keyrings.getAccountsByKeyring": defineMethod("query", WalletApiSchemas.keyrings.getAccountsByKeyring),

  "ui.keyrings.renameKeyring": defineMethod("command", WalletApiSchemas.keyrings.renameKeyring, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.renameAccount": defineMethod("command", WalletApiSchemas.keyrings.renameAccount, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.markBackedUp": defineMethod("command", WalletApiSchemas.keyrings.markBackedUp, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.hideHdAccount": defineMethod("command", WalletApiSchemas.keyrings.hideHdAccount, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.unhideHdAccount": defineMethod("command", WalletApiSchemas.keyrings.unhideHdAccount, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.removePrivateKeyKeyring": defineMethod("command", WalletApiSchemas.keyrings.removePrivateKeyKeyring, {
    broadcastSnapshot: true,
  }),

  "ui.keyrings.exportMnemonic": defineMethod("command", WalletApiSchemas.keyrings.exportMnemonic),

  "ui.keyrings.exportPrivateKey": defineMethod("command", WalletApiSchemas.keyrings.exportPrivateKey),
} as const;
