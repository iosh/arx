import { describe, expect, it } from "vitest";
import { AccountKeySchema } from "./records.js";

describe("AccountKeySchema", () => {
  it("accepts namespace-prefixed lowercase hex account keys", () => {
    expect(AccountKeySchema.parse("eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("rejects uppercase and odd-length hex account keys", () => {
    expect(() => AccountKeySchema.parse("eip155:AA")).toThrow();
    expect(() => AccountKeySchema.parse("eip155:aaa")).toThrow();
  });

  it("rejects account keys without namespace separator", () => {
    expect(() => AccountKeySchema.parse("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow();
  });
});
