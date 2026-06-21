import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

export const networksMethods = {
  "ui.networks.getSelectedChain": defineMethod("query", WalletApiSchemas.chains.getSelectedChain),

  "ui.networks.list": defineMethod("query", WalletApiSchemas.chains.list),

  "ui.networks.switchActive": defineMethod("command", WalletApiSchemas.chains.selectWalletChain),
} as const;
