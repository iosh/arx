import { z } from "zod";
import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

const UiKeyringsListParamsSchema = z.undefined();

export const keyringsMethods = {
  "ui.keyrings.confirmNewMnemonic": defineMethod("command", WalletApiSchemas.keyrings.confirmNewMnemonic),

  "ui.keyrings.importMnemonic": defineMethod("command", WalletApiSchemas.keyrings.importMnemonic),

  "ui.keyrings.importPrivateKey": defineMethod("command", WalletApiSchemas.keyrings.importPrivateKey),

  "ui.keyrings.deriveAccount": defineMethod("command", WalletApiSchemas.keyrings.deriveAccount),

  "ui.keyrings.list": defineMethod("query", UiKeyringsListParamsSchema),

  "ui.keyrings.getAccountsByKeyring": defineMethod("query", WalletApiSchemas.keyrings.getAccountsByKeyring),

  "ui.keyrings.getBackupStatus": defineMethod("query", WalletApiSchemas.keyrings.getBackupStatus),

  "ui.keyrings.renameKeyring": defineMethod("command", WalletApiSchemas.keyrings.renameKeyring),

  "ui.keyrings.renameAccount": defineMethod("command", WalletApiSchemas.keyrings.renameAccount),

  "ui.keyrings.markBackedUp": defineMethod("command", WalletApiSchemas.keyrings.markBackedUp),

  "ui.keyrings.hideHdAccount": defineMethod("command", WalletApiSchemas.keyrings.hideHdAccount),

  "ui.keyrings.unhideHdAccount": defineMethod("command", WalletApiSchemas.keyrings.unhideHdAccount),

  "ui.keyrings.removePrivateKeyKeyring": defineMethod("command", WalletApiSchemas.keyrings.removePrivateKeyKeyring),

  "ui.keyrings.exportMnemonic": defineMethod("command", WalletApiSchemas.keyrings.exportMnemonic),

  "ui.keyrings.exportPrivateKey": defineMethod("command", WalletApiSchemas.keyrings.exportPrivateKey),
} as const;
