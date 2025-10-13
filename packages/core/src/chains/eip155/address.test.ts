import { describe, expect, it } from "vitest";
import { createEip155AddressModule } from "./address.js";

const module = createEip155AddressModule();
const chainRef = "eip155:1";

describe("eip155 address module", () => {
  it("normalizes mixed-case input to lowercase canonical", () => {
    const result = module.normalize({
      chainRef,
      value: "0xAaBbCcDdEeFf00112233445566778899AaBbCcDd",
    });
    expect(result.canonical).toBe("0xaabbccddeeff00112233445566778899aabbccdd");
  });

  it("normalizes value without 0x prefix", () => {
    const result = module.normalize({
      chainRef,
      value: "aabbccddeeff00112233445566778899aabbccdd",
    });
    expect(result.canonical).toBe("0xaabbccddeeff00112233445566778899aabbccdd");
  });

  it("throws on invalid input", () => {
    expect(() =>
      module.normalize({
        chainRef,
        value: "0x123",
      }),
    ).toThrow(/Invalid EIP-155 address/);
  });

  it("formats canonical address to EIP-55 checksum", () => {
    const display = module.format({
      chainRef,
      canonical: "0xde709f2102306220921060314715629080e2fb77",
    });
    expect(display).toBe("0xde709f2102306220921060314715629080e2fb77");
  });

  it("validate throws for non-checksum canonical", () => {
    expect(() =>
      module.validate?.({
        chainRef,
        canonical: "0x0000000000000000000000000000000000000000",
      }),
    ).not.toThrow();

    expect(() =>
      module.validate?.({
        chainRef,
        canonical: "0xzz00000000000000000000000000000000000000",
      }),
    ).toThrow(/Invalid canonical EIP-155 address/);
  });
});
