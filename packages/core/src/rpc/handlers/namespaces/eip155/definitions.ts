import type { MethodDefinition } from "../../types.js";
import { ethAccountsDefinition } from "./eth_accounts.js";
import { ethChainIdDefinition } from "./eth_chainId.js";
import { ethRequestAccountsDefinition } from "./eth_requestAccounts.js";
import { ethSendTransactionDefinition } from "./eth_sendTransaction.js";
import { ethSignTypedDataV4Definition } from "./eth_signTypedData_v4.js";
import { personalSignDefinition } from "./personal_sign.js";
import { walletAddEthereumChainDefinition } from "./wallet_addEthereumChain.js";
import { walletGetPermissionsDefinition } from "./wallet_getPermissions.js";
import { walletRequestPermissionsDefinition } from "./wallet_requestPermissions.js";
import { walletSwitchEthereumChainDefinition } from "./wallet_switchEthereumChain.js";

export const EIP155_DEFINITIONS = {
  eth_chainId: ethChainIdDefinition,
  eth_accounts: ethAccountsDefinition,
  eth_requestAccounts: ethRequestAccountsDefinition,
  wallet_switchEthereumChain: walletSwitchEthereumChainDefinition,
  personal_sign: personalSignDefinition,
  eth_signTypedData_v4: ethSignTypedDataV4Definition,
  eth_sendTransaction: ethSendTransactionDefinition,
  wallet_addEthereumChain: walletAddEthereumChainDefinition,
  wallet_getPermissions: walletGetPermissionsDefinition,
  wallet_requestPermissions: walletRequestPermissionsDefinition,
} as const satisfies Record<string, MethodDefinition>;

export type Eip155Method = keyof typeof EIP155_DEFINITIONS;

export const buildEip155Definitions = () => EIP155_DEFINITIONS;
