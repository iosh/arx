import { setupOperations } from "./actions/setup/operations.js";
import type { WalletOperations } from "./operation.js";

export const walletOperations = {
  setup: setupOperations,
} as const satisfies WalletOperations;
