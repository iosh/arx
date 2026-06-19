import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

export const networksMethods = {
  "ui.networks.switchActive": defineMethod("command", WalletApiSchemas.chains.selectWalletChain, {
    broadcastSnapshot: true,
  }),
} as const;
