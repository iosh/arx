import { describe, expect, it } from "vitest";
import { parseChainRef } from "./chainRef.js";
import { InvalidChainRefError } from "./errors.js";

describe("parseChainRef", () => {
  it("parses the complete CAIP-2 namespace and reference grammar", () => {
    expect(parseChainRef("eip155:1")).toEqual({ namespace: "eip155", reference: "1" });
    expect(parseChainRef("foo-bar:_Ref-1")).toEqual({ namespace: "foo-bar", reference: "_Ref-1" });
  });

  it("preserves case and does not trim", () => {
    expect(parseChainRef("eip155:MainNet")).toEqual({ namespace: "eip155", reference: "MainNet" });
    expect(() => parseChainRef(" eip155:1")).toThrow(InvalidChainRefError);
    expect(() => parseChainRef("eip155:1 ")).toThrow(InvalidChainRefError);
  });

  it("rejects invalid namespace, reference, and separator shapes", () => {
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

  it("enforces CAIP-2 length limits and string input", () => {
    expect(parseChainRef(`abcdefgh:${"x".repeat(32)}`)).toEqual({
      namespace: "abcdefgh",
      reference: "x".repeat(32),
    });
    expect(() => parseChainRef(`abcdefghi:${"x".repeat(32)}`)).toThrow(InvalidChainRefError);
    expect(() => parseChainRef(`eip155:${"x".repeat(33)}`)).toThrow(InvalidChainRefError);
    expect(() => parseChainRef(1)).toThrow(
      expect.objectContaining({ code: "network.invalid_chain_ref", details: { rule: "type" } }),
    );
  });
});
