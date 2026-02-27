import { describe, expect, it, vi } from "vitest";
import { PermissionCapabilities, type PermissionGrant } from "../controllers/permission/types.js";
import { buildWalletPermissions } from "./permissions.js";

const ORIGIN = "https://dapp.example";

describe("buildWalletPermissions", () => {
  it("returns empty list when origin lacks permissions", () => {
    expect(buildWalletPermissions({ origin: ORIGIN })).toEqual([]);
  });

  it("emits chain caveat per capability", () => {
    const grants: PermissionGrant[] = [
      { origin: ORIGIN, namespace: "eip155", chainRef: "eip155:1", capabilities: [PermissionCapabilities.Basic] },
      { origin: ORIGIN, namespace: "eip155", chainRef: "eip155:137", capabilities: [PermissionCapabilities.Basic] },
    ];

    expect(buildWalletPermissions({ origin: ORIGIN, grants })).toEqual([
      {
        invoker: ORIGIN,
        parentCapability: "wallet_basic",
        caveats: [{ type: "arx:permittedChains", value: ["eip155:1", "eip155:137"] }],
      },
    ]);
  });

  it("adds restrictReturnedAccounts for eth_accounts", () => {
    const grants: PermissionGrant[] = [
      { origin: ORIGIN, namespace: "eip155", chainRef: "eip155:1", capabilities: [PermissionCapabilities.Accounts] },
    ];
    const getAccounts = vi.fn((chainRef: string) => (chainRef === "eip155:1" ? ["0xabc", "0xabc", "0xdef"] : []));

    expect(buildWalletPermissions({ origin: ORIGIN, grants, getAccounts })).toEqual([
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
