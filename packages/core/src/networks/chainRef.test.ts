import { describe, expect, it } from "vitest";
import { parseChainRef } from "./chainRef.js";

describe("parseChainRef", () => {
  it("splits supported CAIP-2 references and rejects invalid input", () => {
    expect(parseChainRef("eip155:1")).toEqual({ namespace: "eip155", reference: "1" });
    const reference = "_Ref-1".padEnd(32, "x");
    expect(parseChainRef(`eip155:${reference}`)).toEqual({ namespace: "eip155", reference });

    for (const value of [
      1,
      "EIP155:1",
      "eip155:",
      " eip155:1",
      "eip155:1 ",
      "eip155:1:account",
      `eip155:${reference}x`,
    ]) {
      expect(() => parseChainRef(value)).toThrow();
    }
  });
});
