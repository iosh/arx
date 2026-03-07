import type { ChainAddressCodec } from "../types.js";
import { createEip155AddressModule } from "./address.js";

export const eip155AddressCodec: ChainAddressCodec = {
  namespace: "eip155",
  address: createEip155AddressModule(),
};
