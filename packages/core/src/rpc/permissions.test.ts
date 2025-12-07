import { describe, expect, it, vi } from "vitest";
import { type OriginPermissionState, PermissionScopes } from "../controllers/permission/types.js";
import { buildWalletPermissions } from "./permissions.js";

const ORIGIN = "https://dapp.example";

describe("buildWalletPermissions", () => {
  it("returns empty list when origin lacks permissions", () => {
    expect(buildWalletPermissions({ origin: ORIGIN })).toEqual([]);
  });

  it("emits chain caveat per scope", () => {
    const permissions: OriginPermissionState = {
      eip155: {
        scopes: [PermissionScopes.Basic],
        chains: ["eip155:1", "eip155:1", "eip155:137"],
      },
    };

    expect(buildWalletPermissions({ origin: ORIGIN, permissions })).toEqual([
      {
        invoker: ORIGIN,
        parentCapability: "wallet_basic",
        caveats: [{ type: "arx:permittedChains", value: ["eip155:1", "eip155:137"] }],
      },
    ]);
  });

  it("adds restrictReturnedAccounts for eth_accounts", () => {
    const permissions: OriginPermissionState = {
      eip155: {
        scopes: [PermissionScopes.Accounts],
        chains: ["eip155:1"],
      },
    };
    const getAccounts = vi.fn((chainRef: string) => (chainRef === "eip155:1" ? ["0xabc", "0xabc", "0xdef"] : []));

    expect(buildWalletPermissions({ origin: ORIGIN, permissions, getAccounts })).toEqual([
      {
        invoker: ORIGIN,
        parentCapability: "eth_accounts",
        caveats: [
          { type: "arx:permittedChains", value: ["eip155:1"] },
          { type: "restrictReturnedAccounts", value: ["0xabc", "0xdef"] },
        ],
      },
    ]);
  });
});
