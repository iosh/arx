import type { NamespaceDefinition } from "../definition.js";
import { eip155AccountAddressCodec } from "./accountAddressCodec.js";
import { eip155ChainAddressing } from "./chainAddressing.js";
import { EIP155_CHAIN_DEFINITION_SEEDS } from "./chains.js";
import { eip155KeyringAdapter } from "./keyring.js";

export const eip155Namespace = {
  namespace: "eip155",
  accountAddressCodec: eip155AccountAddressCodec,
  chainAddressing: eip155ChainAddressing,
  keyring: eip155KeyringAdapter,
  builtinChains: EIP155_CHAIN_DEFINITION_SEEDS,
} as const satisfies NamespaceDefinition<"eip155">;
