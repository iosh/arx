import type { NamespaceChainAddressing } from "../../chains/types.js";
import { createEip155AddressFormat } from "./address.js";
import { EIP155_NAMESPACE } from "./constants.js";

export const eip155ChainAddressing: NamespaceChainAddressing = {
  namespace: EIP155_NAMESPACE,
  address: createEip155AddressFormat(),
};
