import { describe, expect, it } from "vitest";
import * as Hex from "./hex.js";

describe("hex helpers", () => {
  it("converts between hex numbers and bigint values", () => {
    expect(Hex.toBigInt("0X02105")).toBe(8453n);
    expect(Hex.fromNumber(8453n)).toBe("0x2105");
    expect(Hex.fromNumber(1)).toBe("0x1");
  });

  it("canonicalizes hex numbers by reading and writing the numeric value", () => {
    expect(Hex.fromNumber(Hex.toBigInt("0x1"))).toBe("0x1");
    expect(Hex.fromNumber(Hex.toBigInt("0X02105"))).toBe("0x2105");
  });

  it("rejects malformed hex numbers", () => {
    expect(() => Hex.toBigInt("not-hex")).toThrow("0x-prefixed hexadecimal");
    expect(() => Hex.toBigInt("0xGG")).toThrow("0x-prefixed hexadecimal");
    expect(() => Hex.toBigInt(" 0x1 ")).toThrow("0x-prefixed hexadecimal");
    expect(() => Hex.fromNumber(-1n)).toThrow();
  });
});
