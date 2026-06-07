import { afterEach, describe, expect, it } from "vitest";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import { Messenger } from "../../messenger/index.js";
import { MemoryAccountsPort, MemorySettingsPort } from "../../runtime/__fixtures__/backgroundTestSetup.js";
import { createAccountsService } from "../../services/store/accounts/index.js";
import { createSettingsService } from "../../services/store/settings/index.js";
import type { AccountRecord, SettingsRecord } from "../../storage/records.js";
import { StoreAccountSelectionService } from "./StoreAccountSelectionService.js";
import { ACCOUNTS_TOPICS } from "./topics.js";

const chainRef = "eip155:1" as const;
const namespace = "eip155" as const;
const keyringId = "11111111-1111-4111-8111-111111111111";

const makeAccount = (payloadHex: string, createdAt: number, extra?: Partial<AccountRecord>): AccountRecord =>
  ({
    accountKey: `eip155:${payloadHex}`,
    namespace,
    keyringId,
    createdAt,
    ...extra,
  }) satisfies AccountRecord;

const addressOf = (payloadHex: string) => `0x${payloadHex}`;

const createService = async (params?: { accounts?: AccountRecord[]; settings?: SettingsRecord | null }) => {
  const accountsPort = new MemoryAccountsPort(params?.accounts ?? []);
  const settingsPort = new MemorySettingsPort(params?.settings ?? { id: "settings", updatedAt: 0 });
  const messenger = new Messenger();
  const accounts = createAccountsService({ port: accountsPort });
  const settings = createSettingsService({ port: settingsPort, now: () => 10_000 });
  const service = new StoreAccountSelectionService({
    messenger: messenger.scope({ name: "accounts", publish: ACCOUNTS_TOPICS }),
    accounts,
    settings,
    accountCodecs: createAccountCodecRegistry([eip155Codec]),
  });

  await service.refresh();

  return { service, settingsPort };
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
      settings: {
        id: "settings",
        selectedAccountKeysByNamespace: {
          eip155: "eip155:ffffffffffffffffffffffffffffffffffffffff",
        },
        updatedAt: 1,
      },
    });
    createdServices.push(service);

    expect(service.getAccountKeysForNamespace(namespace)).toEqual([second.accountKey, first.accountKey]);
    expect(service.listOwnedForNamespace({ namespace, chainRef })).toMatchObject([
      {
        accountKey: second.accountKey,
        canonicalAddress: addressOf("2222222222222222222222222222222222222222"),
      },
      {
        accountKey: first.accountKey,
        canonicalAddress: addressOf("1111111111111111111111111111111111111111"),
      },
    ]);
    expect(service.getActiveAccountForNamespace({ namespace, chainRef })).toMatchObject({
      namespace,
      chainRef,
      accountKey: second.accountKey,
      canonicalAddress: addressOf("2222222222222222222222222222222222222222"),
    });
  });

  it("switches active account for a namespace and clears back to the namespace default", async () => {
    const first = makeAccount("1111111111111111111111111111111111111111", 100);
    const second = makeAccount("2222222222222222222222222222222222222222", 200);

    const { service, settingsPort } = await createService({
      accounts: [first, second],
      settings: {
        id: "settings",
        selectedAccountKeysByNamespace: {
          other: "other:aa",
        },
        updatedAt: 1,
      },
    });
    createdServices.push(service);

    await expect(
      service.setActiveAccount({
        namespace,
        chainRef,
        accountKey: second.accountKey,
      }),
    ).resolves.toMatchObject({
      namespace,
      chainRef,
      accountKey: second.accountKey,
      canonicalAddress: addressOf("2222222222222222222222222222222222222222"),
    });

    expect(settingsPort.saved.at(-1)).toMatchObject({
      selectedAccountKeysByNamespace: {
        other: "other:aa",
        eip155: second.accountKey,
      },
    });
    expect(service.getSelectedAccountKey(namespace)).toBe(second.accountKey);

    await expect(service.setActiveAccount({ namespace, chainRef, accountKey: null })).resolves.toMatchObject({
      namespace,
      chainRef,
      accountKey: first.accountKey,
      canonicalAddress: addressOf("1111111111111111111111111111111111111111"),
    });
    expect(service.getActiveAccountForNamespace({ namespace, chainRef })).toMatchObject({
      accountKey: first.accountKey,
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
        accountKey: hidden.accountKey,
      }),
    ).rejects.toMatchObject({ code: "global.permission.denied" });

    await expect(
      service.setActiveAccount({
        namespace,
        chainRef,
        accountKey: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
        accountKey: "solana:1111111111111111111111111111111111111111",
      }),
    ).rejects.toMatchObject({ code: "global.rpc.invalid_request" });
  });
});
