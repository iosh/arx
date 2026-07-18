import { describe, expect, it } from "vitest";
import type { AccountId } from "../../accounts/accountId.js";
import { AccountNotFoundError } from "../../accounts/errors.js";
import { createPermissionViewsService } from "./PermissionViewsService.js";

const ORIGIN = "https://example.com";
const CHAIN_REF = "eip155:1";
const ACCOUNT_ID: AccountId = "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const MISSING_ACCOUNT_ID: AccountId = "eip155:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const createService = (accountIds: readonly AccountId[]) =>
  createPermissionViewsService({
    permissions: {
      getAuthorization: (origin, options) =>
        origin === ORIGIN && options.namespace === "eip155"
          ? {
              origin,
              namespace: "eip155",
              chains: { [CHAIN_REF]: { accountIds: [...accountIds] } },
            }
          : null,
      getState: () => ({
        origins: {
          [ORIGIN]: {
            eip155: {
              chains: { [CHAIN_REF]: { accountIds: [...accountIds] } },
            },
          },
        },
      }),
    },
    accounts: {
      getAccount: (accountId) =>
        accountId === ACCOUNT_ID
          ? {
              accountId,
              namespace: "eip155",
              origin: { type: "private-key", keySourceId: "source-1" },
              hidden: false,
              selected: true,
              createdAt: 1,
            }
          : null,
      getAddress: ({ accountId, chainRef }) => ({
        accountId,
        chainRef,
        canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        displayAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    },
  });

describe("createPermissionViewsService", () => {
  it("projects permitted account addresses", () => {
    const service = createService([ACCOUNT_ID]);

    expect(service.getAuthorizationSnapshot(ORIGIN, { chainRef: CHAIN_REF })).toEqual({
      namespace: "eip155",
      chainRef: CHAIN_REF,
      isPermittedChain: true,
      permittedChainRefs: [CHAIN_REF],
      permittedAccountIds: [ACCOUNT_ID],
      accounts: [
        {
          accountId: ACCOUNT_ID,
          canonicalAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          displayAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
      isAuthorized: true,
    });
  });

  it("rejects a permission that references a missing account", () => {
    const service = createService([MISSING_ACCOUNT_ID]);

    expect(() => service.getAuthorizationSnapshot(ORIGIN, { chainRef: CHAIN_REF })).toThrow(AccountNotFoundError);
  });
});
