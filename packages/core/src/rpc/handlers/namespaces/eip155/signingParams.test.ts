import { describe, expect, it } from "vitest";
import { parseEip155PersonalSignParams, parseEip155TypedDataParams } from "./signingParams.js";

describe("parseEip155PersonalSignParams", () => {
  it("extracts the address and message regardless of parameter order", () => {
    expect(parseEip155PersonalSignParams(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "hello"])).toEqual({
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      message: "hello",
    });

    expect(parseEip155PersonalSignParams(["hello", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])).toEqual({
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      message: "hello",
    });
  });
});

describe("parseEip155TypedDataParams", () => {
  it("keeps string typed data payloads unchanged", () => {
    expect(parseEip155TypedDataParams(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", '{"types":{}}'])).toEqual({
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      typedData: '{"types":{}}',
    });
  });

  it("serializes object typed data payloads", () => {
    expect(
      parseEip155TypedDataParams(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { domain: { name: "ARX" } }]),
    ).toEqual({
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      typedData: '{"domain":{"name":"ARX"}}',
    });
  });
});
