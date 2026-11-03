import { describe, expect, it } from "vitest";
import { ChainInvalidAddressError } from "../../chains/errors.js";
import * as EvmAddress from "./address.js";

const ADDRESS = "0xfcad0b19bb29d4674531d6f115237e16afce377c";

describe("EVM address input", () => {
  it("parses the supported input forms to the same address", () => {
    for (const value of [
      ADDRESS,
      "0xFCAD0B19BB29D4674531D6F115237E16AFCE377C",
      "FCad0b19bB29D4674531d6F115237e16afCe377c",
      `  ${ADDRESS}  `,
    ]) {
      expect(EvmAddress.parse(value)).toBe(ADDRESS);
    }
  });

  it("rejects malformed address input", () => {
    for (const value of ["", "  ", "0x123", `${ADDRESS}ff`, `${ADDRESS.slice(0, -1)}g`, `0X${ADDRESS.slice(2)}`]) {
      expect(() => EvmAddress.parse(value)).toThrow(ChainInvalidAddressError);
    }
  });
});
