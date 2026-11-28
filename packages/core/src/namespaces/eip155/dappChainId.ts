import { isSupportedEip155ChainId, MAX_EIP155_CHAIN_ID } from "./chainId.js";
import { hexQuantity } from "./hexQuantity.js";

export const chainIdParam = hexQuantity
  .transform((value) => BigInt(value))
  .refine(isSupportedEip155ChainId, `Expected a positive chain ID no greater than ${MAX_EIP155_CHAIN_ID}.`);
