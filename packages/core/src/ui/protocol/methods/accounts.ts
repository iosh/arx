import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

export const accountsMethods = {
  "ui.accounts.switchActive": defineMethod("command", WalletApiSchemas.accounts.switchActive, {
    broadcastSnapshot: true,
  }),
} as const;
