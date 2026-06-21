import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

export const sessionMethods = {
  "ui.session.getStatus": defineMethod("query", WalletApiSchemas.session.getStatus),

  "ui.session.unlock": defineMethod("command", WalletApiSchemas.session.unlock),

  "ui.session.lock": defineMethod("command", WalletApiSchemas.session.lock),

  "ui.session.resetAutoLockTimer": defineMethod("command", WalletApiSchemas.session.resetAutoLockTimer),

  "ui.session.setAutoLockDuration": defineMethod("command", WalletApiSchemas.session.setAutoLockDuration),
} as const;
