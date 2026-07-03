import { describe, expect, it } from "vitest";
import {
  accountAddressingForNamespace,
  buildAccountAddressingByNamespace,
  eip155AccountAddressing,
} from "./addressing.js";

describe("accounts/addressing namespace account addressing", () => {
  it("indexes namespace account addressing by namespace", () => {
    const accountAddressing = buildAccountAddressingByNamespace([eip155AccountAddressing]);

    expect(Object.keys(accountAddressing)).toEqual(["eip155"]);
    expect(accountAddressingForNamespace(accountAddressing, "eip155")).toBe(eip155AccountAddressing);
  });
});
