import { describe, expect, it, vi } from "vitest";
import { buildEip2255Permissions, buildEip2255PermissionsFromAuthorizationSnapshot } from "./permissions.js";

const ORIGIN = "https://dapp.example";

describe("buildEip2255Permissions", () => {
  it("returns empty list when origin lacks connected account addresses", () => {
    expect(buildEip2255Permissions({ origin: ORIGIN })).toEqual([]);
  });

  it("returns only the eth_accounts descriptor for the current connection scope", () => {
    const accountAddresses = vi.fn(() => ["0xabc", "0xabc", "0xdef"])();

    expect(buildEip2255Permissions({ origin: ORIGIN, accountAddresses })).toEqual([
      {
        invoker: ORIGIN,
        parentCapability: "eth_accounts",
        caveats: [{ type: "restrictReturnedAccounts", value: ["0xabc", "0xdef"] }],
      },
    ]);
  });

  it("adapts connection snapshots into EIP-2255 descriptors", () => {
    expect(
      buildEip2255PermissionsFromAuthorizationSnapshot({
        origin: ORIGIN,
        snapshot: {
          accounts: [{ canonicalAddress: "0xabc" }, { canonicalAddress: "0xabc" }, { canonicalAddress: "0xdef" }],
        },
      }),
    ).toEqual([
      {
        invoker: ORIGIN,
        parentCapability: "eth_accounts",
        caveats: [{ type: "restrictReturnedAccounts", value: ["0xabc", "0xdef"] }],
      },
    ]);
  });

  it("returns empty list when the current connection scope has no permitted accounts", () => {
    expect(buildEip2255Permissions({ origin: ORIGIN, accountAddresses: [] })).toEqual([]);
  });
});
