import { parseChainRef } from "../caip.js";
import type { ChainDescriptor } from "../types.js";
import { createEip155AddressModule } from "./address.js";

export const eip155Descriptor: ChainDescriptor = {
  namespace: "eip155",
  supportsChain(chainRef) {
    const { namespace } = parseChainRef(chainRef);
    return namespace === "eip155";
  },
  address: createEip155AddressModule(),
};
