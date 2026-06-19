import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

export const sessionMethods = {
  "ui.session.unlock": defineMethod("command", WalletApiSchemas.session.unlock, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
    holdBroadcast: true,
  }),

  "ui.session.lock": defineMethod("command", WalletApiSchemas.session.lock, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),

  "ui.session.resetAutoLockTimer": defineMethod("command", WalletApiSchemas.session.resetAutoLockTimer, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),

  "ui.session.setAutoLockDuration": defineMethod("command", WalletApiSchemas.session.setAutoLockDuration, {
    broadcastSnapshot: true,
    persistVaultMeta: true,
  }),
} as const;
