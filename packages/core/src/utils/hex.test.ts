import { describe, expect, it } from "vitest";
import * as Hex from "./hex.js";

describe("hex helpers", () => {
  it("accepts uppercase hex quantities with leading zeros", () => {
    expect(Hex.toBigInt("0X02105")).toBe(8453n);
  });

  it("rejects malformed hex numbers", () => {
    expect(() => Hex.toBigInt("not-hex")).toThrow("0x-prefixed hexadecimal");
    expect(() => Hex.toBigInt("0xGG")).toThrow("0x-prefixed hexadecimal");
    expect(() => Hex.toBigInt(" 0x1 ")).toThrow("0x-prefixed hexadecimal");
  });
});
