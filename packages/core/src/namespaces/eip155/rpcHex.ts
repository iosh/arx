import { Hex } from "ox";
import { invalidDappParams } from "../../dappConnections/routeDappRequest.js";
import type { ChainRef } from "../../networks/chainRef.js";
import { chainRefFromChainId } from "./chainId.js";
import { Eip155InvalidChainIdError } from "./errors.js";

export const decodeHexNumber = (value: unknown, method: string, field: string): Hex.Hex => {
  if (typeof value !== "string") {
    throw invalidDappParams(method, `${field} must be a canonical 0x-prefixed hex number.`);
  }

  const encoded = value.toLowerCase();
  if (!Hex.validate(encoded, { strict: true }) || encoded === "0x") {
    throw invalidDappParams(method, `${field} must be a canonical 0x-prefixed hex number.`);
  }

  let canonical: Hex.Hex;
  try {
    canonical = Hex.fromNumber(Hex.toBigInt(encoded));
  } catch {
    throw invalidDappParams(method, `${field} must be a canonical 0x-prefixed hex number.`);
  }
  if (canonical !== encoded) {
    throw invalidDappParams(method, `${field} must be a canonical 0x-prefixed hex number.`);
  }

  return canonical;
};

export const decodeHexBytes = (value: unknown, method: string, field: string): Hex.Hex => {
  if (typeof value !== "string") {
    throw invalidDappParams(method, `${field} must be 0x-prefixed hex bytes.`);
  }

  const encoded = value.toLowerCase();
  if (!Hex.validate(encoded, { strict: true }) || (encoded.length - 2) % 2 !== 0) {
    throw invalidDappParams(method, `${field} must be 0x-prefixed hex bytes.`);
  }

  return encoded;
};

export const decodeChainId = (value: unknown, method: string): Readonly<{ chainId: Hex.Hex; chainRef: ChainRef }> => {
  const chainId = decodeHexNumber(value, method, "chainId");

  try {
    return { chainId, chainRef: chainRefFromChainId(Hex.toBigInt(chainId)) };
  } catch (error) {
    if (error instanceof Eip155InvalidChainIdError) {
      throw invalidDappParams(method, "chainId is outside the supported EIP-155 range.");
    }
    throw error;
  }
};
