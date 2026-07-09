import type { Hex as OxHexValue } from "ox/Hex";
import * as OxHex from "ox/Hex";
import { ArxBaseError } from "../error.js";

export type Hex = OxHexValue;

const HEX_NUMBER_PATTERN = /^0x[0-9a-f]+$/;

export class HexInvalidNumberError extends ArxBaseError {
  static readonly code = "hex.invalid_number";

  constructor() {
    super("Hex number must be a non-empty 0x-prefixed hexadecimal string.", {
      code: HexInvalidNumberError.code,
    });
  }
}

const asHexNumber = (value: string): Hex => {
  const hex = value.toLowerCase();
  if (!HEX_NUMBER_PATTERN.test(hex)) {
    throw new HexInvalidNumberError();
  }

  return hex as Hex;
};

export const toBigInt = (value: string): bigint => {
  return OxHex.toBigInt(asHexNumber(value));
};

export const fromNumber = (value: bigint | number): Hex => {
  return OxHex.fromNumber(value);
};
