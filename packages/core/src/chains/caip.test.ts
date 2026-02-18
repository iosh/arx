import { ArxReasons } from "@arx/errors";
import { describe, expect, it } from "vitest";
import { parseChainRef } from "./caip.js";

describe("parseChainRef", () => {
  it("parses namespace:reference", () => {
    expect(parseChainRef("eip155:1")).toEqual({ namespace: "eip155", reference: "1" });
  });

  it("rejects additional colon segments", () => {
    try {
      parseChainRef("conflux:cfx:aa...");
      throw new Error("Expected parseChainRef to throw");
    } catch (error) {
      expect(error).toMatchObject({
        reason: ArxReasons.RpcInvalidParams,
        data: { rule: "single_colon" },
      });
    }
  });
});
