import { Address } from "ox";
import { ChainInvalidAddressError } from "../../chains/errors.js";
import { EIP155_NAMESPACE } from "./constants.js";

export const isValid = (value: string): boolean =>
  Address.validate(value.startsWith("0x") ? value : `0x${value}`, { strict: false });

export const parse = (value: string): Address.Address => {
  const input = value.trim();
  const address = (input.startsWith("0x") ? input : `0x${input}`).toLowerCase();
  if (!Address.validate(address, { strict: false })) {
    throw new ChainInvalidAddressError({ namespace: EIP155_NAMESPACE, field: "input" });
  }
  return address;
};
