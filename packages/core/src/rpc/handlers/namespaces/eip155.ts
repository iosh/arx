import { PermissionScopes } from "../../../controllers/index.js";
import type { MethodDefinition, MethodHandler } from "../types.js";

export const EIP155_NAMESPACE = "eip155";

const handleEthChainId: MethodHandler = ({ controllers }) => {
  return controllers.network.getState().active.chainId;
};

const handleEthAccounts: MethodHandler = ({ controllers }) => {
  return controllers.accounts.getAccounts();
};

export const buildEip155Definitions = (): Record<string, MethodDefinition> => ({
  eth_chainId: {
    scope: PermissionScopes.Basic,
    handler: handleEthChainId,
  },
  eth_accounts: {
    scope: PermissionScopes.Accounts,
    handler: handleEthAccounts,
  },
});
