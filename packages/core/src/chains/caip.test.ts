import { describe, expect, it } from "vitest";
import { parseChainRef } from "./caip.js";

describe("parseChainRef", () => {
  it("parses namespace:reference", () => {
    expect(parseChainRef("eip155:1")).toEqual({ namespace: "eip155", reference: "1" });
  });

  it("rejects additional colon segments", () => {
    expect(() => parseChainRef("conflux:cfx:aa...")).toThrow(/exactly one ":"/);
  });
});
