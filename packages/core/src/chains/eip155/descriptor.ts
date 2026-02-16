import type { ChainDescriptor } from "../types.js";
import { createEip155AddressModule } from "./address.js";

export const eip155Descriptor: ChainDescriptor = {
  namespace: "eip155",
  address: createEip155AddressModule(),
};
