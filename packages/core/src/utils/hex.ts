import type { Hex as OxHexValue } from "ox/Hex";
import * as OxHex from "ox/Hex";

export type Hex = OxHexValue;

const HEX_NUMBER_PATTERN = /^0x[0-9a-f]+$/;

const asHexNumber = (value: string): Hex => {
  const hex = value.toLowerCase();
  if (!HEX_NUMBER_PATTERN.test(hex)) {
    throw new Error("Hex number must be a non-empty 0x-prefixed hexadecimal string");
  }

  return hex as Hex;
};

export const toBigInt = (value: string): bigint => {
  return OxHex.toBigInt(asHexNumber(value));
};

export const fromNumber = (value: bigint | number): Hex => {
  return OxHex.fromNumber(value);
};
