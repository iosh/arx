import { ArxReasons } from "@arx/errors";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountCodecRegistry, eip155Codec } from "../../accounts/addressing/codec.js";
import { Messenger } from "../../messenger/index.js";
import { MemoryAccountsPort, MemorySettingsPort } from "../../runtime/__fixtures__/backgroundTestSetup.js";
import { createAccountsService } from "../../services/store/accounts/index.js";
import { createSettingsService } from "../../services/store/settings/index.js";
import { type AccountRecord, AccountRecordSchema, type SettingsRecord } from "../../storage/records.js";
import { StoreAccountsController } from "./StoreAccountsController.js";
import { ACCOUNTS_TOPICS } from "./topics.js";

const chainRef = "eip155:1" as const;
const namespace = "eip155" as const;
const keyringId = "11111111-1111-4111-8111-111111111111";

const makeAccount = (payloadHex: string, createdAt: number, extra?: Partial<AccountRecord>): AccountRecord =>
  AccountRecordSchema.parse({
    accountId: `eip155:${payloadHex}`,
    namespace,
    keyringId,
    createdAt,
    ...extra,
  });

const addressOf = (payloadHex: string) => `0x${payloadHex}`;

const createController = async (params?: { accounts?: AccountRecord[]; settings?: SettingsRecord | null }) => {
  const accountsPort = new MemoryAccountsPort(params?.accounts ?? []);
  const settingsPort = new MemorySettingsPort(params?.settings ?? { id: "settings", updatedAt: 0 });
  const messenger = new Messenger();
  const accounts = createAccountsService({ port: accountsPort });
  const settings = createSettingsService({ port: settingsPort, now: () => 10_000 });
  const controller = new StoreAccountsController({
    messenger: messenger.scope({ name: "accounts", publish: ACCOUNTS_TOPICS }),
    accounts,
    settings,
    accountCodecs: createAccountCodecRegistry([eip155Codec]),
  });

  await controller.refresh();

  return { controller, settingsPort };
};

const createdControllers: StoreAccountsController[] = [];

afterEach(() => {
  for (const controller of createdControllers.splice(0)) {
    controller.destroy?.();
  }
});

describe("StoreAccountsController", () => {
  it("uses visible namespace accounts and falls back to the first available selection", async () => {
    const first = makeAccount("1111111111111111111111111111111111111111", 200);
    const second = makeAccount("2222222222222222222222222222222222222222", 100);
    const hidden = makeAccount("3333333333333333333333333333333333333333", 50, { hidden: true });

    const { controller } = await createController({
      accounts: [first, second, hidden],
      settings: {
        id: "settings",
        selectedAccountIdsByNamespace: {
          eip155: "eip155:ffffffffffffffffffffffffffffffffffffffff",
        },
        updatedAt: 1,
      },
    });
    createdControllers.push(controller);

    expect(controller.getAccountIdsForNamespace(namespace)).toEqual([second.accountId, first.accountId]);
    expect(controller.listOwnedForNamespace({ namespace, chainRef })).toMatchObject([
      {
        accountId: second.accountId,
        canonicalAddress: addressOf("2222222222222222222222222222222222222222"),
      },
      {
        accountId: first.accountId,
        canonicalAddress: addressOf("1111111111111111111111111111111111111111"),
      },
    ]);
    expect(controller.getActiveAccountForNamespace({ namespace, chainRef })).toMatchObject({
      namespace,
      chainRef,
      accountId: second.accountId,
      canonicalAddress: addressOf("2222222222222222222222222222222222222222"),
    });
  });

  it("switches active account for a namespace and clears back to the namespace default", async () => {
    const first = makeAccount("1111111111111111111111111111111111111111", 100);
    const second = makeAccount("2222222222222222222222222222222222222222", 200);

    const { controller, settingsPort } = await createController({
      accounts: [first, second],
      settings: {
        id: "settings",
        selectedAccountIdsByNamespace: {
          other: "other:aa",
        },
        updatedAt: 1,
      },
    });
    createdControllers.push(controller);

    await expect(
      controller.setActiveAccount({
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

    expect(settingsPort.saved.at(-1)).toMatchObject({
      selectedAccountIdsByNamespace: {
        other: "other:aa",
        eip155: second.accountId,
      },
    });
    expect(controller.getSelectedAccountId(namespace)).toBe(second.accountId);

    await expect(controller.setActiveAccount({ namespace, chainRef, accountId: null })).resolves.toMatchObject({
      namespace,
      chainRef,
      accountId: first.accountId,
      canonicalAddress: addressOf("1111111111111111111111111111111111111111"),
    });
    expect(controller.getActiveAccountForNamespace({ namespace, chainRef })).toMatchObject({
      accountId: first.accountId,
      canonicalAddress: addressOf("1111111111111111111111111111111111111111"),
    });
  });

  it("rejects hidden and unknown accounts when switching", async () => {
    const visible = makeAccount("1111111111111111111111111111111111111111", 100);
    const hidden = makeAccount("2222222222222222222222222222222222222222", 200, { hidden: true });

    const { controller } = await createController({ accounts: [visible, hidden] });
    createdControllers.push(controller);

    await expect(
      controller.setActiveAccount({
        namespace,
        chainRef,
        accountId: hidden.accountId,
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.PermissionDenied });

    await expect(
      controller.setActiveAccount({
        namespace,
        chainRef,
        accountId: "eip155:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.KeyringAccountNotFound });
  });

  it("rejects namespace and chainRef mismatch", async () => {
    const { controller } = await createController({
      accounts: [makeAccount("1111111111111111111111111111111111111111", 100)],
    });
    createdControllers.push(controller);

    await expect(
      controller.setActiveAccount({
        namespace: "solana",
        chainRef,
        accountId: "solana:1111111111111111111111111111111111111111",
      }),
    ).rejects.toMatchObject({ reason: ArxReasons.RpcInvalidRequest });
  });
});
