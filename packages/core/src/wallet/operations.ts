import { setupOperations } from "./actions/setup/operations.js";
import type { WalletOperationDescriptorTree } from "./operation.js";

export const walletOperations = {
  setup: setupOperations,
} as const satisfies WalletOperationDescriptorTree;
