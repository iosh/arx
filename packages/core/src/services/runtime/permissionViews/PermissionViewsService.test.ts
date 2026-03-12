import { ArxReasons } from "@arx/errors";
import { describe, expect, it } from "vitest";
import { createPermissionViewsService } from "./PermissionViewsService.js";

const ORIGIN = "https://example.com";
const VALID_ACCOUNT_ID = "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const STALE_ACCOUNT_ID = "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("createPermissionViewsService", () => {
  it("filters stale accounts across connection, wallet permissions, and UI projections", async () => {
    const service = createPermissionViewsService({
      permissions: {
        getAuthorization: (origin, options) => {
          if (origin !== ORIGIN || options.namespace !== "eip155") {
            return null;
          }

          return {
            origin,
            namespace: "eip155",
            chains: {
              "eip155:1": {
                accountIds: [VALID_ACCOUNT_ID, STALE_ACCOUNT_ID],
              },
              "eip155:10": {
                accountIds: [STALE_ACCOUNT_ID],
              },
            },
          };
        },
        getState: () => ({
          origins: {
            [ORIGIN]: {
              eip155: {
                chains: {
                  "eip155:1": {
                    accountIds: [VALID_ACCOUNT_ID, STALE_ACCOUNT_ID],
                  },
                  "eip155:10": {
                    accountIds: [STALE_ACCOUNT_ID],
                  },
                },
              },
            },
          },
        }),
      },
      accounts: {
        getOwnedAccount: ({ accountId }) => {
          if (accountId !== VALID_ACCOUNT_ID) {
            return null;
          }

          return {
            accountId,
            namespace: "eip155",
            canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            displayAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          };
        },
      },
    });

    expect(service.getConnectionSnapshot(ORIGIN, { chainRef: "eip155:1" })).toEqual({
      namespace: "eip155",
      chainRef: "eip155:1",
      isPermittedChain: true,
      permittedChainRefs: ["eip155:1", "eip155:10"],
      permittedAccountIds: [VALID_ACCOUNT_ID],
      accounts: [
        {
          accountId: VALID_ACCOUNT_ID,
          canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          displayAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
      isConnected: true,
    });

    expect(service.getConnectionSnapshot(ORIGIN, { chainRef: "eip155:10" })).toMatchObject({
      namespace: "eip155",
      chainRef: "eip155:10",
      isPermittedChain: true,
      permittedChainRefs: ["eip155:1", "eip155:10"],
      permittedAccountIds: [],
      accounts: [],
      isConnected: false,
    });

    await expect(service.assertConnected(ORIGIN, { chainRef: "eip155:10" })).rejects.toMatchObject({
      reason: ArxReasons.PermissionNotConnected,
    });

    expect(service.buildWalletPermissions(ORIGIN, { chainRef: "eip155:1" })).toEqual([
      {
        invoker: ORIGIN,
        parentCapability: "eth_accounts",
        caveats: [
          {
            type: "restrictReturnedAccounts",
            value: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          },
        ],
      },
    ]);
    expect(service.buildWalletPermissions(ORIGIN, { chainRef: "eip155:10" })).toEqual([]);

    expect(service.buildUiPermissionsSnapshot()).toEqual({
      origins: {
        [ORIGIN]: {
          eip155: {
            chains: {
              "eip155:1": {
                accountIds: [VALID_ACCOUNT_ID],
              },
              "eip155:10": {
                accountIds: [],
              },
            },
          },
        },
      },
    });
  });
});
