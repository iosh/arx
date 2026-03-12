import { describe, expect, it, vi } from "vitest";
import type { ChainPermissionAuthorization } from "../controllers/permission/types.js";
import { buildWalletPermissions } from "./permissions.js";

const ORIGIN = "https://dapp.example";

describe("buildWalletPermissions", () => {
  it("returns empty list when origin lacks permissions", () => {
    expect(buildWalletPermissions({ origin: ORIGIN })).toEqual([]);
  });

  it("returns only the eth_accounts descriptor for the current chain", () => {
    const authorization: ChainPermissionAuthorization = {
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:1",
      accountIds: ["eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    };

    const getAccounts = vi.fn((chainRef: string) => (chainRef === "eip155:1" ? ["0xabc", "0xabc", "0xdef"] : []));

    expect(buildWalletPermissions({ origin: ORIGIN, authorization, getAccounts })).toEqual([
      {
        invoker: ORIGIN,
        parentCapability: "eth_accounts",
        caveats: [{ type: "restrictReturnedAccounts", value: ["0xabc", "0xdef"] }],
      },
    ]);
  });

  it("returns empty list when the current chain has no account access", () => {
    const authorization: ChainPermissionAuthorization = {
      origin: ORIGIN,
      namespace: "eip155",
      chainRef: "eip155:137",
      accountIds: [],
    };

    expect(buildWalletPermissions({ origin: ORIGIN, authorization })).toEqual([]);
  });
});
