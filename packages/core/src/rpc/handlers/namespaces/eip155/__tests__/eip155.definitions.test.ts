import { describe, expect, it } from "vitest";
import { buildEip155Definitions } from "../definitions.js";

describe("eip155 definitions", () => {
  it("requires validateParams for all locally implemented methods", () => {
    const definitions = buildEip155Definitions();

    for (const [method, def] of Object.entries(definitions)) {
      expect(def.handler, `${method}: missing handler`).toBeTypeOf("function");
      expect(def.validateParams, `${method}: missing validateParams`).toBeTypeOf("function");
    }
  });
});
