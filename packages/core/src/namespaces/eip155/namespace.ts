import type { NamespaceDefinition } from "../definition.js";
import { eip155AccountsAdapter } from "./accounts.js";
import { eip155ChainAddressing } from "./chainAddressing.js";
import { EIP155_NAMESPACE } from "./constants.js";
import { eip155KeyringAdapter } from "./keyring.js";

export const eip155Namespace = {
  namespace: EIP155_NAMESPACE,
  accounts: eip155AccountsAdapter,
  chainAddressing: eip155ChainAddressing,
  keyring: eip155KeyringAdapter,
} as const satisfies NamespaceDefinition<typeof EIP155_NAMESPACE>;
