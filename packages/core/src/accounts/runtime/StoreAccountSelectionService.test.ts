import { afterEach, describe, expect, it } from "vitest";
import { buildAccountAddressingByNamespace, eip155AccountAddressing } from "../../accounts/addressing/addressing.js";
import { createMessenger } from "../../messenger/index.js";
import { MemoryAccountsPort } from "../../runtime/__fixtures__/backgroundTestSetup.js";
import { createAccountsService } from "../../services/store/accounts/index.js";
import type { AccountRecord, AccountSelectionStateRecord } from "../../storage/records.js";
import { StoreAccountSelectionService } from "./StoreAccountSelectionService.js";

const chainRef = "eip155:1" as const;
const namespace = "eip155" as const;
const keyringId = "11111111-1111-4111-8111-111111111111";

const makeAccount = (payloadHex: string, createdAt: number, extra?: Partial<AccountRecord>): AccountRecord =>
  ({
    accountId: `eip155:${payloadHex}`,
    keyringId,
    createdAt,
    ...extra,
  }) satisfies AccountRecord;

const addressOf = (payloadHex: string) => `0x${payloadHex}`;

const createService = async (params?: {
  accounts?: AccountRecord[];
  selectionState?: AccountSelectionStateRecord | null;
}) => {
  const accountsPort = new MemoryAccountsPort(params?.accounts ?? [], params?.selectionState ?? null);
  const messenger = createMessenger();
  const accounts = createAccountsService({ messenger, port: accountsPort });
  const service = new StoreAccountSelectionService({
    messenger,
    accounts,
    accountAddressing: buildAccountAddressingByNamespace([eip155AccountAddressing]),
  });

  await service.refresh();

  return { service, accountsPort };
};

const createdServices: StoreAccountSelectionService[] = [];

afterEach(() => {
  for (const service of createdServices.splice(0)) {
    service.destroy?.();
  }
});

describe("StoreAccountSelectionService", () => {
  it("uses visible namespace accounts and falls back to the first available selection", async () => {
    const first = makeAccount("1111111111111111111111111111111111111111", 200);
    const second = makeAccount("2222222222222222222222222222222222222222", 100);
    const hidden = makeAccount("3333333333333333333333333333333333333333", 50, { hidden: true });

    const { service } = await createService({
      accounts: [first, second, hidden],
      selectionState: {
        id: "account-selection",
        selectedAccountIdsByNamespace: {
          eip155: "eip155:ffffffffffffffffffffffffffffffffffffffff",
        },
      },
    });
    createdServices.push(service);

    expect(service.getAccountIdsForNamespace(namespace)).toEqual([second.accountId, first.accountId]);
    expect(service.listOwnedForNamespace({ namespace, chainRef })).toMatchObject([
      {
        accountId: second.accountId,
        canonicalAddress: addressOf("2222222222222222222222222222222222222222"),
      },
      {
        accountId: first.accountId,
        canonicalAddress: addressOf("1111111111111111111111111111111111111111"),
      },
    ]);
    expect(service.getActiveAccountForNamespace({ namespace, chainRef })).toMatchObject({
      namespace,
      chainRef,
      accountId: second.accountId,
      canonicalAddress: addressOf("2222222222222222222222222222222222222222"),
    });
  });

  it("switches active account for a namespace and clears back to the namespace default", async () => {
    const first = makeAccount("1111111111111111111111111111111111111111", 100);
    const second = makeAccount("2222222222222222222222222222222222222222", 200);

    const { service, accountsPort } = await createService({
      accounts: [first, second],
      selectionState: {
        id: "account-selection",
        selectedAccountIdsByNamespace: {
          other: "other:aa",
        },
      },
    });
    createdServices.push(service);

    await expect(
      service.setActiveAccount({
        namespace,
        chainRef,
        accountId: second.accountId,
      }),
    ).resolves.toMatchObject({
      namespace,
      chainRef,
      accountId: second.accountId,
      canonicalAddress: addressOf("2222222222222222222222222222222222222222"),
    });

    expect(accountsPort.savedSelectionStates.at(-1)).toMatchObject({
      selectedAccountIdsByNamespace: {
        other: "other:aa",
        eip155: second.accountId,
      },
    });
    expect(service.getSelectedAccountId(namespace)).toBe(second.accountId);

    await expect(service.setActiveAccount({ namespace, chainRef, accountId: null })).resolves.toMatchObject({
      namespace,
      chainRef,
      accountId: first.accountId,
      canonicalAddress: addressOf("1111111111111111111111111111111111111111"),
    });
    expect(service.getActiveAccountForNamespace({ namespace, chainRef })).toMatchObject({
      accountId: first.accountId,
      canonicalAddress: addressOf("1111111111111111111111111111111111111111"),
    });
  });

  it("rejects hidden and unknown accounts when switching", async () => {
    const visible = makeAccount("1111111111111111111111111111111111111111", 100);
    const hidden = makeAccount("2222222222222222222222222222222222222222", 200, { hidden: true });

    const { service } = await createService({ accounts: [visible, hidden] });
    createdServices.push(service);

    await expect(
      service.setActiveAccount({
        namespace,
        chainRef,
        accountId: hidden.accountId,
      }),
    ).rejects.toMatchObject({ code: "global.permission.denied" });

    await expect(
      service.setActiveAccount({
        namespace,
        chainRef,
        accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).rejects.toMatchObject({ code: "keyring.account_not_found" });
  });

  it("rejects namespace and chainRef mismatch", async () => {
    const { service } = await createService({
      accounts: [makeAccount("1111111111111111111111111111111111111111", 100)],
    });
    createdServices.push(service);

    await expect(
      service.setActiveAccount({
        namespace: "solana",
        chainRef,
        accountId: "solana:1111111111111111111111111111111111111111",
      }),
    ).rejects.toMatchObject({ code: "global.rpc.invalid_request" });
  });
});
