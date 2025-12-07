import * as Hex from "ox/Hex";
import { parseCaip2 } from "../../../../chains/caip.js";

// Derive numeric chainId from CAIP-2 chainRef
export const deriveExpectedChainId = (chainRef: string): Hex.Hex | null => {
  try {
    const { reference } = parseCaip2(chainRef);
    if (/^\d+$/.test(reference)) {
      return Hex.fromNumber(BigInt(reference));
    }
  } catch {
    // ignore parse errors
  }
  return null;
};
