import "fake-indexeddb/auto";

import { PersistenceCommitError } from "@arx/core/persistence";
import { RpcUnsupportedMethodError } from "@arx/core/rpc";
import { type CoreRuntime, createCoreRuntime } from "@arx/core/runtime";
import type { WalletApiEvent } from "@arx/core/wallet";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { createDexiePersistence, type DexiePersistence } from "./createDexiePersistence.js";

const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
// Public BIP39 test material at m/44'/60'/0'/0/0 and m/44'/60'/0'/0/1.
const FIRST_PRIVATE_KEY = "0x1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727";
const NEXT_PRIVATE_KEY = "0x9a983cb3d832fbde5ab49d692b7a8bf5b5d232479c99333d0fc8e1d21f1b55b6";

const opened: { runtime: CoreRuntime; persistence: DexiePersistence }[] = [];
let nextDatabaseId = 0;

const openRuntime = async (databaseName: string) => {
  const persistence = createDexiePersistence({ databaseName });
  const runtime = await createCoreRuntime({ persistence });
  const result = { runtime, persistence };
  opened.push(result);
  return result;
};

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { runtime, persistence } of opened.splice(0)) {
    await runtime.wallet.lock();
    await persistence.close();
  }
});

describe("CoreRuntime persistence", () => {
  it("restores a moved group's identity, key and account grant after reopening", async () => {
    const databaseName = `arx-account-group-runtime-${nextDatabaseId++}`;
    const { runtime, persistence } = await openRuntime(databaseName);
    const wallet = runtime.wallet;
    const imported = await wallet.createFromPrivateKey({
      password: "password",
      privateKey: FIRST_PRIVATE_KEY,
      namespace: "eip155",
    });
    assert(imported.status === "initialized");
    await wallet.accounts.rename({ accountGroupId: imported.accountGroupId, alias: "Daily" });
    const before = await wallet.accounts.getGroup(imported.accountGroupId);
    const accountId = before.members[0].accountId;
    const grant = { origin: "https://account-groups.example", namespace: "eip155", accountIds: [accountId] } as const;
    await wallet.permissions.setAccounts(grant);

    const moved = await wallet.keySources.addMnemonicAndMoveAccount({
      mnemonic: MNEMONIC,
      name: "Recovered",
      backupStatus: "confirmed",
      accountId,
    });
    await wallet.lock();
    await persistence.close();

    const reopened = await openRuntime(databaseName);
    expect(await reopened.runtime.wallet.getStatus()).toBe("locked");
    expect(await reopened.runtime.wallet.accounts.getGroup(imported.accountGroupId)).toMatchObject({
      accountGroupId: imported.accountGroupId,
      alias: "Daily",
      createdAt: before.createdAt,
      source: { type: "bip39", keySourceId: moved.keySourceId, accountIndex: 0 },
      members: [{ accountId, origin: { type: "hd", derivationIndex: 0 } }],
      selected: true,
    });
    expect(await reopened.runtime.wallet.permissions.get(grant)).toEqual(grant);
    await reopened.runtime.wallet.unlock({ password: "password" });
    expect(await reopened.runtime.wallet.accounts.exportPrivateKey({ accountId, password: "password" })).toEqual({
      privateKey: FIRST_PRIVATE_KEY,
    });
  }, 15_000);

  it("restores hidden-group constraints, replacement selection and revoked grants", async () => {
    const databaseName = `arx-account-group-runtime-${nextDatabaseId++}`;
    const { runtime, persistence } = await openRuntime(databaseName);
    const wallet = runtime.wallet;
    const created = await wallet.createFromMnemonic({ password: "password", mnemonic: MNEMONIC, name: "Personal" });
    assert(created.status === "initialized");
    const first = await wallet.accounts.getGroup(created.accountGroupId);
    const second = await wallet.accounts.create({ keySourceId: created.keySourceId });
    assert(second.status === "created");
    const scope = { origin: "https://hidden-accounts.example", namespace: "eip155" };
    await wallet.permissions.setAccounts({ ...scope, accountIds: [first.members[0].accountId] });

    await wallet.accounts.setHidden({ accountGroupId: first.accountGroupId, hidden: true });
    await wallet.lock();
    await persistence.close();

    const reopened = await openRuntime(databaseName);
    const restoredWallet = reopened.runtime.wallet;
    expect(await restoredWallet.accounts.getGroup(first.accountGroupId)).toMatchObject({
      hidden: true,
      members: [{ accountId: first.members[0].accountId, hidden: true }],
    });
    expect((await restoredWallet.accounts.getSelectedGroup()).accountGroupId).toBe(second.account.accountGroupId);
    expect(await restoredWallet.permissions.get(scope)).toBeNull();
    await expect(restoredWallet.accounts.select({ accountGroupId: first.accountGroupId })).rejects.toMatchObject({
      code: "account.hidden_not_selectable",
    });
    await expect(
      restoredWallet.accounts.setHidden({ accountGroupId: second.account.accountGroupId, hidden: true }),
    ).rejects.toMatchObject({ code: "account.last_visible_hide_unsupported" });

    await restoredWallet.accounts.setHidden({ accountGroupId: first.accountGroupId, hidden: false });
    expect((await restoredWallet.accounts.getGroup(first.accountGroupId)).hidden).toBe(false);
    expect((await restoredWallet.accounts.getSelectedGroup()).accountGroupId).toBe(second.account.accountGroupId);
    expect(await restoredWallet.permissions.get(scope)).toBeNull();
  }, 15_000);

  it("restores a site's selected chain without restoring revoked account access", async () => {
    const databaseName = `arx-account-group-runtime-${nextDatabaseId++}`;
    const { runtime, persistence } = await openRuntime(databaseName);
    const scope = { origin: "https://network-context.example", namespace: "eip155" };
    const created = await runtime.wallet.createFromMnemonic({
      password: "password",
      mnemonic: MNEMONIC,
      name: "Personal",
    });
    assert(created.status === "initialized");
    const group = await runtime.wallet.accounts.getGroup(created.accountGroupId);
    await runtime.wallet.permissions.setAccounts({ ...scope, accountIds: [group.members[0].accountId] });
    expect(runtime.dappConnections.openConnection(scope)).toEqual({
      chainRef: "eip155:1",
      accounts: ["0x9858effd232b4033e47d90003d41ec34ecaeda94"],
    });

    const switching = runtime.dappConnections.request({
      scope,
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xa" }],
    });
    const [approval] = await runtime.wallet.approvals.list();
    assert(approval?.type === "switchNetwork");
    await runtime.wallet.approvals.approve({ approvalId: approval.approvalId, type: "switchNetwork" });
    await switching;
    await runtime.wallet.permissions.disconnectOrigin({ origin: scope.origin });
    await runtime.wallet.lock();
    await persistence.close();

    const reopened = await openRuntime(databaseName);
    expect(reopened.runtime.dappConnections.openConnection(scope)).toEqual({ chainRef: "eip155:10", accounts: [] });
    expect(await reopened.runtime.wallet.permissions.get(scope)).toBeNull();
  }, 15_000);
});

describe("CoreRuntime commands", () => {
  it("rejects a namespace without a registered implementation", async () => {
    const { runtime } = await openRuntime(`arx-account-group-runtime-${nextDatabaseId++}`);
    expect(() =>
      runtime.dappConnections.openConnection({ origin: "https://dapp.example", namespace: "constructor" }),
    ).toThrow(RpcUnsupportedMethodError);
  });

  it("keeps account groups, events and the next index unchanged when creation cannot commit", async () => {
    const persistence = createDexiePersistence({ databaseName: `arx-account-group-runtime-${nextDatabaseId++}` });
    // The mutation queue binds the writer when the runtime is created.
    const commit = vi.spyOn(persistence.writer, "commit");
    const runtime = await createCoreRuntime({ persistence });
    opened.push({ runtime, persistence });
    const wallet = runtime.wallet;
    const created = await wallet.createFromMnemonic({ password: "password", mnemonic: MNEMONIC, name: "Personal" });
    assert(created.status === "initialized");
    const before = await wallet.accounts.listGroups();
    const events: WalletApiEvent[] = [];
    wallet.subscribe((event) => events.push(event));
    const failure = new PersistenceCommitError(new Error("IndexedDB transaction aborted"));
    commit.mockRejectedValueOnce(failure);

    await expect(wallet.accounts.create({ keySourceId: created.keySourceId })).rejects.toBe(failure);
    expect(await wallet.accounts.listGroups()).toEqual(before);
    expect(events).toEqual([]);

    const added = await wallet.accounts.create({ keySourceId: created.keySourceId });
    assert(added.status === "created");
    expect(added.account.source).toEqual({ type: "bip39", keySourceId: created.keySourceId, accountIndex: 1 });
  }, 15_000);

  it("uses the current group when confirming a member's move after deletion and reimport", async () => {
    const { runtime } = await openRuntime(`arx-account-group-runtime-${nextDatabaseId++}`);
    const wallet = runtime.wallet;
    const created = await wallet.createFromMnemonic({ password: "password", mnemonic: MNEMONIC, name: "Personal" });
    assert(created.status === "initialized");
    const imported = await wallet.keySources.importPrivateKey({ privateKey: NEXT_PRIVATE_KEY, namespace: "eip155" });
    assert(imported.status === "added");
    const offered = await wallet.accounts.create({ keySourceId: created.keySourceId });
    assert(offered.status === "move-available");
    const accountId = offered.accountId;

    await wallet.keySources.remove({ keySourceId: imported.keySourceId });
    const reimported = await wallet.keySources.importPrivateKey({ privateKey: NEXT_PRIVATE_KEY, namespace: "eip155" });
    assert(reimported.status === "added");
    expect(reimported.accountGroupId).not.toBe(imported.accountGroupId);

    const moved = await wallet.accounts.move({ accountId, keySourceId: created.keySourceId });
    expect(moved).toMatchObject({
      accountGroupId: reimported.accountGroupId,
      source: { type: "bip39", keySourceId: created.keySourceId, accountIndex: 1 },
      members: [{ accountId }],
    });
    expect(await wallet.accounts.getGroup(reimported.accountGroupId)).toEqual(moved);
  }, 15_000);
});
