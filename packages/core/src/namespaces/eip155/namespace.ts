import type { NamespaceDefinition } from "../definition.js";
import { eip155AccountsAdapter } from "./accounts.js";
import { eip155ChainAddressing } from "./chainAddressing.js";
import { EIP155_CHAIN_DEFINITION_SEEDS } from "./chains.js";
import { eip155KeyringAdapter } from "./keyring.js";

export const eip155Namespace = {
  namespace: "eip155",
  accounts: eip155AccountsAdapter,
  chainAddressing: eip155ChainAddressing,
  keyring: eip155KeyringAdapter,
  builtinChains: EIP155_CHAIN_DEFINITION_SEEDS,
} as const satisfies NamespaceDefinition<"eip155">;
