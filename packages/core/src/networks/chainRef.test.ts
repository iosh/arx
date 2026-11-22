import { describe, expect, it } from "vitest";
import { parseChainRef } from "./chainRef.js";
import { InvalidChainRefError } from "./errors.js";

describe("parseChainRef", () => {
  it("parses chain references for supported namespaces", () => {
    expect(parseChainRef("eip155:1")).toEqual({ namespace: "eip155", reference: "1" });
    expect(parseChainRef("eip155:_Ref-1")).toEqual({ namespace: "eip155", reference: "_Ref-1" });
  });

  it("preserves case and does not trim", () => {
    expect(parseChainRef("eip155:MainNet")).toEqual({ namespace: "eip155", reference: "MainNet" });
    expect(() => parseChainRef(" eip155:1")).toThrow(InvalidChainRefError);
    expect(() => parseChainRef("eip155:1 ")).toThrow(InvalidChainRefError);
  });

  it("rejects unsupported namespaces and invalid reference or separator shapes", () => {
    expect(() => parseChainRef("foo-bar:_Ref-1")).toThrow(InvalidChainRefError);
    expect(() => parseChainRef("EIP155:1")).toThrow(
      expect.objectContaining({ code: "network.invalid_chain_ref", details: { rule: "namespace" } }),
    );
    expect(() => parseChainRef("eip155:chain/ref")).toThrow(
      expect.objectContaining({ code: "network.invalid_chain_ref", details: { rule: "reference" } }),
    );
    expect(() => parseChainRef("eip155:1:account")).toThrow(
      expect.objectContaining({ code: "network.invalid_chain_ref", details: { rule: "single_colon" } }),
    );
  });

  it("enforces the CAIP-2 reference length limit and string input", () => {
    expect(parseChainRef(`eip155:${"x".repeat(32)}`)).toEqual({
      namespace: "eip155",
      reference: "x".repeat(32),
    });
    expect(() => parseChainRef(`eip155:${"x".repeat(33)}`)).toThrow(InvalidChainRefError);
    expect(() => parseChainRef(1)).toThrow(
      expect.objectContaining({ code: "network.invalid_chain_ref", details: { rule: "type" } }),
    );
  });
});
