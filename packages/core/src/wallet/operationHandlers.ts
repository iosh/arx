import { getWalletSetupStatus } from "./actions/setup.js";
import type { WalletApiContext } from "./context.js";
import type { WalletOperationHandlerTree } from "./executor.js";
import type { walletOperations } from "./operations.js";

export const walletOperationHandlers = {
  setup: {
    getStatus: getWalletSetupStatus,
  },
} as const satisfies WalletOperationHandlerTree<WalletApiContext, typeof walletOperations>;
