import { WalletApiSchemas } from "../../../wallet/schemas.js";
import { defineMethod } from "./types.js";

export const balancesMethods = {
  "ui.balances.getNative": defineMethod("query", WalletApiSchemas.balances.getNative),
} as const;
