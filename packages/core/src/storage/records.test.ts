import { describe, expect, it } from "vitest";
import { AccountIdSchema } from "./records.js";

describe("AccountIdSchema", () => {
  it("accepts namespace-prefixed lowercase hex account keys", () => {
    expect(AccountIdSchema.parse("eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("rejects uppercase and odd-length hex account keys", () => {
    expect(() => AccountIdSchema.parse("eip155:AA")).toThrow();
    expect(() => AccountIdSchema.parse("eip155:aaa")).toThrow();
  });

  it("rejects account keys without namespace separator", () => {
    expect(() => AccountIdSchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow();
  });
});
