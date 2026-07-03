import type { NamespaceChainAddressing } from "../types.js";
import { createEip155AddressFormat } from "./address.js";

export const eip155ChainAddressing: NamespaceChainAddressing = {
  namespace: "eip155",
  address: createEip155AddressFormat(),
};
