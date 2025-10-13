import { parseCaip2 } from "../caip.js";
import type { ChainDescriptor } from "../types.js";
import { createEip155AddressModule } from "./address.js";

export const eip155Descriptor: ChainDescriptor = {
  namespace: "eip155",
  supportsChain(chainRef) {
    const { namespace } = parseCaip2(chainRef);
    return namespace === "eip155";
  },
  address: createEip155AddressModule(),
};
