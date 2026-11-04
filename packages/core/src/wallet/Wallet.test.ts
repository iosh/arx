import { Secp256k1 } from "ox";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts } from "../accounts/Accounts.js";
import type { AccountId } from "../accounts/accountId.js";
import type { AccountsChanged } from "../accounts/types.js";
import { Approvals } from "../approvals/Approvals.js";
import { KeyringInvalidMnemonicError, KeyringLockedError } from "../keyring/errors.js";
import { Keyring } from "../keyring/Keyring.js";
import { decodeKeyringSecrets } from "../keyring/secrets.js";
import type { KeyringChanged } from "../keyring/types.js";
import { createEip155AccountSigning } from "../namespaces/eip155/accountSigning.js";
import { eip155AccountsAdapter } from "../namespaces/eip155/accounts.js";
import { EIP155_NAMESPACE } from "../namespaces/eip155/constants.js";
import { eip155KeyringAdapter } from "../namespaces/eip155/keyring.js";
import { Permissions } from "../permissions/Permissions.js";
import type { PermissionRecord } from "../permissions/persistence.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { systemTime } from "../runtime/time.js";
import { AUTO_LOCK_SETTING_KEY } from "../settings/persistence.js";
import { unlockVaultRecord } from "../vault/crypto.js";
import type { EncryptedVaultRecord } from "../vault/persistence.js";
import { AutoLockController, DEFAULT_AUTO_LOCK_DURATION_MS } from "./AutoLockController.js";
import type { WalletStatusChanged } from "./Wallet.js";
import { WalletCoordinator } from "./WalletCoordinator.js";

const PRIMARY_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SECONDARY_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const TERTIARY_MNEMONIC = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
const PRIVATE_KEY = "11".repeat(32);
// Public BIP39 test material at m/44'/60'/0'/0/0 and m/44'/60'/0'/0/1.
const FIRST_PRIVATE_KEY = "1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727";
const NEXT_PRIVATE_KEY = "9a983cb3d832fbde5ab49d692b7a8bf5b5d232479c99333d0fc8e1d21f1b55b6";

const createHarness = (params: { rejectCommit?: Error; autoLockDurationMs?: number } = {}) => {
  let committedVault: EncryptedVaultRecord | null = null;
  const commits: PersistenceChange[][] = [];
  let commitFailure = params.rejectCommit ?? null;
  const write = (changes: readonly PersistenceChange[]) => {
    if (commitFailure) throw commitFailure;
    commits.push([...changes]);
    for (const change of changes) {
      if (change.persistenceType === "encryptedVault") {
        committedVault = change.operation === "put" ? change.value : null;
      }
    }
  };
  const commit = vi.fn(async (changes: readonly PersistenceChange[]) => write(changes));
  const holdNextCommit = () => {
    const started = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    commit.mockImplementationOnce(async (changes) => {
      started.resolve();
      await released.promise;
      write(changes);
    });
    return { started: started.promise, release: () => released.resolve() };
  };
  const events: WalletStatusChanged[] = [];
  const keyringChanges: KeyringChanged[] = [];
  const accountChanges: AccountsChanged[] = [];
  const mutations = createCoreMutationQueue({ commit });
  const publishKeyringChanged = (change: KeyringChanged): void => {
    keyringChanges.push(change);
  };
  const keyring = new Keyring({
    bootstrap: { encryptedVault: null, keySources: [], hdKeyrings: [] },
    namespaceAdapters: {
      [EIP155_NAMESPACE]: eip155KeyringAdapter,
    },
    mutations,
    publishChanged: publishKeyringChanged,
  });
  const publishAccountsChanged = (change: AccountsChanged): void => {
    accountChanges.push(change);
  };
  const accounts = new Accounts({
    adapters: { [EIP155_NAMESPACE]: eip155AccountsAdapter },
    mutations,
    publishChanged: publishAccountsChanged,
  });
  const permissions = new Permissions({
    bootstrap: { records: [] },
    accounts,
  });
  const approvals = new Approvals({
    time: systemTime,
    publishChanged: () => undefined,
  });
  const autoLock = new AutoLockController({
    durationMs: params.autoLockDurationMs ?? DEFAULT_AUTO_LOCK_DURATION_MS,
    time: systemTime,
  });
  const wallet = new WalletCoordinator({
    mutations,
    namespaces: [EIP155_NAMESPACE],
    time: systemTime,
    keyring,
    accounts,
    permissions,
    approvals,
    dappConnections: { refreshAccountsForOpenConnections: () => undefined },
    autoLock,
    publishStatusChanged: (event) => events.push(event),
    publishKeyringChanged,
    publishAccountsChanged,
    publishPermissionsChanged: () => undefined,
  });
  const grantPermission = async (permission: PermissionRecord): Promise<void> => {
    await mutations.run(async (commit) => {
      const update = permissions.prepareSetAccounts(permission);
      if (!update) return;

      await commit(update.persistenceChanges);
      permissions.applyCommittedUpdate(update);
    });
  };
  return {
    wallet,
    accounts,
    approvals,
    getCommittedVault: () => committedVault,
    readCommittedSources: async () => {
      assert(committedVault !== null);
      const decrypted = await unlockVaultRecord(committedVault, "password");
      assert(decrypted !== null);
      try {
        return decodeKeyringSecrets(decrypted.plaintext).keySources;
      } finally {
        decrypted.plaintext.fill(0);
        decrypted.unlocked.encryptionKey.fill(0);
      }
    },
    commits,
    holdNextCommit,
    events,
    keyringChanges,
    accountChanges,
    permissions,
    grantPermission,
    keyring,
    autoLock,
    setCommitFailure: (failure: Error | null) => {
      commitFailure = failure;
    },
  };
};

const memberId = (accounts: Accounts, accountGroupId: string): AccountId => {
  const group = accounts.getGroup(accountGroupId);
  assert(group !== null);
  return group.members[0].accountId;
};
const hdKeyringId = (accounts: Accounts, accountGroupId: string): string => {
  const group = accounts.getGroup(accountGroupId);
  assert(group !== null && group.members[0].origin.type === "hd");
  return group.members[0].origin.hdKeyringId;
};
const groupIdForMember = (accounts: Accounts, accountId: AccountId): string => {
  const member = accounts.getMemberRecord(accountId);
  assert(member !== null);
  return member.accountGroupId;
};

const initializeWallet = async (wallet: WalletCoordinator) => {
  const source = await wallet.createFromMnemonic({
    password: "password",
    mnemonic: PRIMARY_MNEMONIC,
    name: "Wallet 1",
  });
  assert(source.status === "initialized");
  return source;
};

const requestAccountSign = (harness: ReturnType<typeof createHarness>, accountId: AccountId) => {
  const request = harness.approvals.request({
    type: "sign",
    namespace: EIP155_NAMESPACE,
    origin: "https://dapp.example",
    accountId,
    request: {
      account: harness.accounts.getAddress({ accountId, chainRef: "eip155:1" }),
      type: "personalMessage",
      message: { format: "utf8", value: "hello" },
    },
  });
  void request.decision.catch(() => undefined);
  return request;
};

const createWalletWithTwoAuthorizedAccounts = async () => {
  const harness = createHarness();
  const created = await initializeWallet(harness.wallet);
  const accounts = harness.accounts;
  const { account: group } = await harness.wallet.createHdAccountGroup({ keySourceId: created.keySourceId });
  const scope = { origin: "https://dapp.example", namespace: EIP155_NAMESPACE } as const;
  await harness.grantPermission({
    ...scope,
    accountIds: [memberId(accounts, created.accountGroupId), group.members[0].accountId],
  });
  return {
    ...harness,
    accountId: memberId(accounts, created.accountGroupId),
    replacementId: group.members[0].accountId,
    scope,
    requestSign: (accountId: AccountId) => requestAccountSign(harness, accountId),
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("WalletCoordinator", () => {
  it("creates a mnemonic wallet with one complete identity commit", async () => {
    const { wallet, accounts, accountChanges, autoLock, commits, events, keyring, keyringChanges } = createHarness();

    const created = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Personal",
    });
    assert(created.status === "initialized");

    expect(commits).toHaveLength(1);
    expect(accounts.getGroup(created.accountGroupId)).toMatchObject({
      source: { type: "bip39", keySourceId: created.keySourceId, accountIndex: 0 },
      selected: true,
    });
    expect(keyring.getSoftwareKeyStatus()).toBe("unlocked");
    expect(autoLock.getDuration()).toBe(DEFAULT_AUTO_LOCK_DURATION_MS);
    expect(keyring.requireKeySourceSecret(created.keySourceId)).toMatchObject({
      type: "bip39",
      mnemonic: PRIMARY_MNEMONIC,
    });
    expect(keyring.getKeySource(created.keySourceId)).toMatchObject({
      type: "bip39",
      name: "Personal",
      backupStatus: "pending",
    });
    expect(events).toEqual([{ type: "walletStatusChanged", status: "unlocked" }]);
    expect(keyringChanges).toEqual([{ type: "keyringChanged" }]);
    expect(accountChanges).toEqual([
      {
        type: "accountsChanged",
        accountGroupIds: [created.accountGroupId],
        accountIds: [memberId(accounts, created.accountGroupId)],
        namespaces: ["eip155"],
      },
    ]);
  });

  it("restores a mnemonic with confirmed backup status", async () => {
    const { accounts, keyring, wallet } = createHarness();

    const created = await wallet.restoreFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Recovered",
    });
    assert(created.status === "initialized");

    expect(keyring.getKeySource(created.keySourceId)).toMatchObject({
      type: "bip39",
      name: "Recovered",
      backupStatus: "confirmed",
    });
    expect(keyring.getHdKeyring(hdKeyringId(accounts, created.accountGroupId))?.keySourceId).toBe(created.keySourceId);
  });

  it("commits only one wallet when initialization commands compete", async () => {
    const { wallet, commits, events, keyring, keyringChanges, accountChanges } = createHarness();
    const first = wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
    });

    const second = wallet.restoreFromMnemonic({
      password: "password",
      mnemonic: SECONDARY_MNEMONIC,
      name: "Wallet 1",
    });
    const third = wallet.createFromPrivateKey({
      password: "password",
      privateKey: PRIVATE_KEY,
      namespace: "eip155",
    });
    const [created, restored, imported] = await Promise.all([first, second, third]);
    assert(created.status === "initialized");
    expect(restored).toEqual({ status: "already-initialized" });
    expect(imported).toEqual({ status: "already-initialized" });
    await expect(
      wallet.createFromMnemonic({
        password: "password",
        mnemonic: SECONDARY_MNEMONIC,
        name: "Wallet 2",
      }),
    ).resolves.toEqual({ status: "already-initialized" });
    expect(commits).toHaveLength(1);
    expect(events).toEqual([{ type: "walletStatusChanged", status: "unlocked" }]);
    expect(keyringChanges).toHaveLength(1);
    expect(accountChanges).toHaveLength(1);
    expect(keyring.listKeySources()).toHaveLength(1);
    expect(keyring.requireKeySourceSecret(created.keySourceId)).toMatchObject({ mnemonic: PRIMARY_MNEMONIC });
  });

  it("rejects invalid input and returns normalized duplicates without changing the wallet", async () => {
    const { wallet, commits, keyring, accounts } = createHarness();
    await initializeWallet(wallet);
    const commitCount = commits.length;
    const selectedAccount = accounts.getSelectedGroupId();

    await expect(
      wallet.addMnemonic({
        mnemonic: "not a bip39 mnemonic",
        name: "Wallet 2",
        backupStatus: "confirmed",
      }),
    ).rejects.toThrow(KeyringInvalidMnemonicError);

    await expect(
      wallet.addMnemonic({
        mnemonic: `  ${PRIMARY_MNEMONIC.replaceAll(" ", "   ")}  `,
        name: "Wallet 2",
        backupStatus: "confirmed",
      }),
    ).resolves.toEqual({ status: "duplicate", walletName: "Wallet 1" });

    expect(commits).toHaveLength(commitCount);
    expect(keyring.listKeySources()).toHaveLength(1);
    expect(accounts.getSelectedGroupId()).toBe(selectedAccount);
  });

  it("adds mnemonic sources with their backup state and selects each first account", async () => {
    const { accounts, keyring, wallet } = createHarness();
    await initializeWallet(wallet);

    const added = await wallet.addMnemonic({
      mnemonic: SECONDARY_MNEMONIC,
      name: "Savings",
      backupStatus: "pending",
    });
    const imported = await wallet.addMnemonic({
      mnemonic: TERTIARY_MNEMONIC,
      name: "Recovered",
      backupStatus: "confirmed",
    });
    assert(added.status === "added");
    assert(imported.status === "added");

    expect(keyring.getKeySource(added.keySourceId)).toMatchObject({
      type: "bip39",
      name: "Savings",
      backupStatus: "pending",
    });
    expect(keyring.getKeySource(imported.keySourceId)).toMatchObject({
      type: "bip39",
      name: "Recovered",
      backupStatus: "confirmed",
    });
    expect(keyring.getHdKeyring(hdKeyringId(accounts, added.accountGroupId))).toMatchObject({
      keySourceId: added.keySourceId,
      namespace: EIP155_NAMESPACE,
    });
    expect(keyring.getHdKeyring(hdKeyringId(accounts, imported.accountGroupId))).toMatchObject({
      keySourceId: imported.keySourceId,
      namespace: EIP155_NAMESPACE,
    });
    expect(accounts.getMember(memberId(accounts, added.accountGroupId))?.origin).toEqual({
      type: "hd",
      hdKeyringId: hdKeyringId(accounts, added.accountGroupId),
      derivationIndex: 0,
    });
    expect(accounts.getMember(memberId(accounts, imported.accountGroupId))?.origin).toEqual({
      type: "hd",
      hdKeyringId: hdKeyringId(accounts, imported.accountGroupId),
      derivationIndex: 0,
    });
    expect(keyring.listKeySources()).toHaveLength(3);
    expect(keyring.listHdKeyrings()).toHaveLength(3);
    expect(accounts.listGroups()).toHaveLength(3);
    expect(accounts.getSelectedGroupId()).toBe(imported.accountGroupId);
  });

  it("confirms the first account's move once, retaining its identity and later selection", async () => {
    const { accounts, commits, grantPermission, keyring, permissions, readCommittedSources, wallet } = createHarness();
    const imported = await wallet.createFromPrivateKey({
      password: "password",
      privateKey: FIRST_PRIVATE_KEY,
      namespace: EIP155_NAMESPACE,
    });
    assert(imported.status === "initialized");
    const other = await wallet.importPrivateKey({ privateKey: PRIVATE_KEY, namespace: EIP155_NAMESPACE });
    assert(other.status === "added");
    await accounts.rename({ accountGroupId: imported.accountGroupId, alias: "Daily" });
    await accounts.select(other.accountGroupId);
    const scope = { origin: "https://dapp.example", namespace: EIP155_NAMESPACE } as const;
    await grantPermission({ ...scope, accountIds: [memberId(accounts, imported.accountGroupId)] });
    const before = accounts.getGroup(imported.accountGroupId);
    const commitCount = commits.length;
    const input = {
      mnemonic: PRIMARY_MNEMONIC,
      name: "Recovered",
      backupStatus: "confirmed",
    } as const;

    const offered = await wallet.addMnemonic(input);
    assert(offered.status === "move-available");
    expect(offered).toEqual({
      status: "move-available",
      account: before,
      accountId: memberId(accounts, imported.accountGroupId),
    });
    expect(commits).toHaveLength(commitCount);
    expect(accounts.getSelectedGroupId()).toBe(other.accountGroupId);

    const confirmed = { ...input, accountId: offered.accountId };
    const added = await wallet.addMnemonicAndMoveAccount(confirmed);
    expect(commits).toHaveLength(commitCount + 1);
    assert(before !== null);
    expect(accounts.getGroup(added.accountGroupId)).toEqual({
      ...before,
      source: { type: "bip39", keySourceId: added.keySourceId, accountIndex: 0 },
      members: [
        {
          ...before.members[0],
          origin: {
            type: "hd",
            hdKeyringId: keyring.listHdKeyringsByKeySourceIds([added.keySourceId])[0]?.hdKeyringId,
            derivationIndex: 0,
          },
        },
      ],
      selected: true,
    });
    expect(permissions.get(scope)?.accountIds).toEqual([memberId(accounts, imported.accountGroupId)]);
    const expectedSourceIds = new Set([other.keySourceId, added.keySourceId]);
    expect(new Set(keyring.listKeySources().map(({ keySourceId }) => keySourceId))).toEqual(expectedSourceIds);
    expect(accounts.nextAccountIndex(added.keySourceId)).toBe(1);

    await accounts.select(other.accountGroupId);
    const repeatedCommitCount = commits.length;
    expect(await wallet.addMnemonicAndMoveAccount(confirmed)).toEqual(added);
    expect(commits).toHaveLength(repeatedCommitCount);
    expect(accounts.getSelectedGroupId()).toBe(other.accountGroupId);
    expect(new Set((await readCommittedSources()).map((source) => source.keySourceId))).toEqual(expectedSourceIds);
  });

  it("exports the requested secrets only after current-password verification", async () => {
    const { accounts, wallet } = createHarness();
    const source = await initializeWallet(wallet);
    const derived = await wallet.createHdAccountGroup({ keySourceId: source.keySourceId });
    assert(derived.status === "created");
    const imported = await wallet.importPrivateKey({ privateKey: PRIVATE_KEY, namespace: EIP155_NAMESPACE });
    assert(imported.status === "added");
    const keys = [
      { accountId: derived.account.members[0].accountId, privateKey: `0x${NEXT_PRIVATE_KEY}` },
      { accountId: memberId(accounts, imported.accountGroupId), privateKey: PRIVATE_KEY },
    ];

    await expect(wallet.exportMnemonic({ keySourceId: source.keySourceId, password: "password" })).resolves.toEqual({
      mnemonic: PRIMARY_MNEMONIC,
    });
    await expect(wallet.exportMnemonic({ keySourceId: source.keySourceId, password: "incorrect" })).resolves.toBeNull();
    for (const key of keys) {
      await expect(wallet.exportPrivateKey({ accountId: key.accountId, password: "password" })).resolves.toEqual({
        privateKey: key.privateKey,
      });
      await expect(wallet.exportPrivateKey({ accountId: key.accountId, password: "incorrect" })).resolves.toBeNull();
    }
    expect(accounts.getSelectedGroupId()).toBe(imported.accountGroupId);

    await wallet.lock();
    await expect(
      wallet.exportMnemonic({ keySourceId: source.keySourceId, password: "password" }),
    ).rejects.toMatchObject({
      code: "wallet.locked",
    });
    for (const key of keys) {
      await expect(wallet.exportPrivateKey({ accountId: key.accountId, password: "password" })).rejects.toMatchObject({
        code: "wallet.locked",
      });
    }
  }, 15_000);

  it("does not return an account key when the session expires during HD derivation", async () => {
    const { accounts, wallet } = createHarness();
    const created = await initializeWallet(wallet);
    const derive = eip155KeyringAdapter.deriveHdPrivateKey;
    let seed: Uint8Array | undefined;
    vi.spyOn(eip155KeyringAdapter, "deriveHdPrivateKey").mockImplementation((params) => {
      seed = params.seed;
      vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
      return derive(params);
    });
    await expect(
      wallet.exportPrivateKey({ accountId: memberId(accounts, created.accountGroupId), password: "password" }),
    ).rejects.toMatchObject({
      code: "wallet.locked",
    });
    expect(seed).toEqual(new Uint8Array(64));
  });

  it("does not activate wallet state when the initial commit fails", async () => {
    const failure = new Error("commit failed");
    const { wallet, accounts, keyring } = createHarness({ rejectCommit: failure });

    await expect(
      wallet.createFromMnemonic({
        password: "password",
        mnemonic: PRIMARY_MNEMONIC,
        name: "Wallet 1",
      }),
    ).rejects.toBe(failure);

    expect(keyring.getSoftwareKeyStatus()).toBe("uninitialized");
    expect(keyring.listKeySources()).toEqual([]);
    expect(keyring.listHdKeyrings()).toEqual([]);
    expect(accounts.listMemberRecords()).toEqual([]);
  });

  it("moves an imported private-key account into an HD wallet and creates the next account", async () => {
    const { wallet, accounts, keyring, readCommittedSources } = createHarness();
    const first = await initializeWallet(wallet);
    const imported = await wallet.importPrivateKey({
      privateKey: NEXT_PRIVATE_KEY,
      namespace: EIP155_NAMESPACE,
    });
    assert(imported.status === "added");
    await accounts.select(imported.accountGroupId);

    const candidate = await wallet.createHdAccountGroup({ keySourceId: first.keySourceId });
    assert(candidate.status === "move-available");
    expect(candidate).toEqual({
      status: "move-available",
      account: accounts.getGroup(imported.accountGroupId),
      accountId: memberId(accounts, imported.accountGroupId),
    });

    const moved = await wallet.movePrivateKeyAccount({
      accountId: candidate.accountId,
      keySourceId: first.keySourceId,
    });
    expect(moved).toEqual({
      ...candidate.account,
      source: { type: "bip39", keySourceId: first.keySourceId, accountIndex: 1 },
      members: [
        {
          ...candidate.account.members[0],
          origin: { type: "hd", hdKeyringId: hdKeyringId(accounts, first.accountGroupId), derivationIndex: 1 },
        },
      ],
    });
    expect(accounts.getGroup(imported.accountGroupId)).toEqual(moved);
    expect(keyring.getKeySource(imported.keySourceId)).toBeNull();
    expect((await readCommittedSources()).map((source) => source.keySourceId)).toEqual([first.keySourceId]);

    const next = await wallet.createHdAccountGroup({ keySourceId: first.keySourceId });
    expect(next).toMatchObject({
      status: "created",
      account: {
        source: { type: "bip39", keySourceId: first.keySourceId, accountIndex: 2 },
        members: [
          { origin: { type: "hd", hdKeyringId: hdKeyringId(accounts, first.accountGroupId), derivationIndex: 2 } },
        ],
      },
    });
    expect(next.account.members[0].accountId).not.toBe(memberId(accounts, imported.accountGroupId));
    expect(accounts.getSelectedGroupId()).toBe(imported.accountGroupId);
  });

  it("hides an HD account with its permission in one committed cascade", async () => {
    const fixture = await createWalletWithTwoAuthorizedAccounts();
    const { accountId, replacementId, scope, requestSign, accounts } = fixture;
    requestSign(accountId);
    const retained = requestSign(replacementId);
    const commitCount = fixture.commits.length;

    await fixture.wallet.setAccountGroupHidden({ accountGroupId: groupIdForMember(accounts, accountId), hidden: true });
    expect(fixture.commits).toHaveLength(commitCount + 1);
    expect(fixture.accounts.getGroupForMember(accountId)).toMatchObject({ hidden: true, selected: false });
    expect(fixture.accounts.getSelectedGroupId()).toBe(groupIdForMember(accounts, replacementId));
    expect(fixture.permissions.get(scope)?.accountIds).toEqual([replacementId]);
    expect(fixture.approvals.list().map(({ approvalId }) => approvalId)).toEqual([retained.approvalId]);

    await fixture.wallet.setAccountGroupHidden({
      accountGroupId: groupIdForMember(accounts, accountId),
      hidden: false,
    });
    expect(fixture.permissions.get(scope)?.accountIds).toEqual([replacementId]);
  });

  it("cancels account requests only after a successful visibility commit", async () => {
    const fixture = await createWalletWithTwoAuthorizedAccounts();
    const { accountId, replacementId, scope, accounts } = fixture;
    const pending = fixture.requestSign(accountId);
    const failure = new Error("commit failed");
    fixture.setCommitFailure(failure);
    await expect(
      fixture.wallet.setAccountGroupHidden({ accountGroupId: groupIdForMember(accounts, accountId), hidden: true }),
    ).rejects.toBe(failure);
    expect(fixture.accounts.getGroupForMember(accountId)).toMatchObject({ hidden: false, selected: true });
    expect(fixture.permissions.get(scope)?.accountIds).toEqual([accountId, replacementId]);
    expect(fixture.approvals.list().map((approval) => approval.approvalId)).toEqual([pending.approvalId]);

    fixture.setCommitFailure(null);
    const commit = fixture.holdNextCommit();
    const hiding = fixture.wallet.setAccountGroupHidden({
      accountGroupId: groupIdForMember(accounts, accountId),
      hidden: true,
    });
    await commit.started;
    fixture.requestSign(accountId);
    commit.release();
    await hiding;
    expect(fixture.approvals.list()).toEqual([]);
  });

  it("removes a BIP39 source cascade and rejects removal of the last source", async () => {
    const harness = createHarness();
    const { accounts, approvals, commits, grantPermission, keyring, permissions, wallet } = harness;
    const first = await initializeWallet(wallet);
    const commitCount = commits.length;
    await expect(wallet.removeKeySource({ keySourceId: first.keySourceId })).rejects.toMatchObject({
      code: "wallet.last_key_source_removal",
    });
    expect(commits).toHaveLength(commitCount);

    const second = await wallet.addMnemonic({
      mnemonic: SECONDARY_MNEMONIC,
      name: "Wallet 2",
      backupStatus: "confirmed",
    });
    assert(second.status === "added");
    const another = await wallet.createHdAccountGroup({ keySourceId: second.keySourceId });
    const hidden = await wallet.createHdAccountGroup({ keySourceId: second.keySourceId });
    await wallet.setAccountGroupHidden({
      accountGroupId: groupIdForMember(accounts, hidden.account.members[0].accountId),
      hidden: true,
    });
    const scope = { origin: "https://dapp.example", namespace: EIP155_NAMESPACE } as const;
    await grantPermission({
      ...scope,
      accountIds: [
        memberId(accounts, first.accountGroupId),
        memberId(accounts, second.accountGroupId),
        another.account.members[0].accountId,
      ],
    });
    for (const accountId of [
      memberId(accounts, first.accountGroupId),
      memberId(accounts, second.accountGroupId),
      another.account.members[0].accountId,
    ]) {
      requestAccountSign(harness, accountId);
    }

    const removalCommitCount = commits.length;
    const removedKeyringId = hdKeyringId(accounts, second.accountGroupId);
    await wallet.removeKeySource({ keySourceId: second.keySourceId });

    expect(commits).toHaveLength(removalCommitCount + 1);
    expect(keyring.getKeySource(second.keySourceId)).toBeNull();
    expect(keyring.getHdKeyring(removedKeyringId)).toBeNull();
    expect(keyring.listKeySources().map(({ keySourceId }) => keySourceId)).toEqual([first.keySourceId]);
    expect(keyring.listHdKeyrings().map(({ hdKeyringId }) => hdKeyringId)).toEqual([
      hdKeyringId(accounts, first.accountGroupId),
    ]);
    expect(accounts.listGroups().map((group) => group.members[0].accountId)).toEqual([
      memberId(accounts, first.accountGroupId),
    ]);
    expect(accounts.getSelectedGroupId()).toBe(first.accountGroupId);
    expect(permissions.get(scope)?.accountIds).toEqual([memberId(accounts, first.accountGroupId)]);
    expect(approvals.list().map((approval) => approval.accountId)).toEqual([memberId(accounts, first.accountGroupId)]);
    approvals.cancelAll();
  });

  it("imports and selects once while private-key and hidden HD duplicates leave state unchanged", async () => {
    const { accounts, commits, wallet } = createHarness();
    const first = await initializeWallet(wallet);
    const commitCount = commits.length;
    const input = { privateKey: PRIVATE_KEY, namespace: EIP155_NAMESPACE };
    const [imported, duplicate] = await Promise.all([wallet.importPrivateKey(input), wallet.importPrivateKey(input)]);
    assert(imported.status === "added");
    expect(duplicate).toMatchObject({ status: "duplicate", account: { accountGroupId: imported.accountGroupId } });
    expect(commits).toHaveLength(commitCount + 1);
    expect(accounts.getSelectedGroupId()).toBe(imported.accountGroupId);

    await accounts.select(first.accountGroupId);
    const privateDuplicateCommitCount = commits.length;
    await expect(wallet.importPrivateKey({ ...input, privateKey: `0x${PRIVATE_KEY}` })).resolves.toMatchObject({
      status: "duplicate",
      account: { accountGroupId: imported.accountGroupId },
    });
    expect(commits).toHaveLength(privateDuplicateCommitCount);
    expect(accounts.getSelectedGroupId()).toBe(first.accountGroupId);

    await wallet.createHdAccountGroup({ keySourceId: first.keySourceId });
    await accounts.select(imported.accountGroupId);
    await wallet.setAccountGroupHidden({ accountGroupId: first.accountGroupId, hidden: true });
    const hdDuplicateCommitCount = commits.length;
    await expect(wallet.importPrivateKey({ ...input, privateKey: FIRST_PRIVATE_KEY })).resolves.toMatchObject({
      status: "duplicate",
      account: { accountGroupId: first.accountGroupId, hidden: true },
    });
    expect(commits).toHaveLength(hdDuplicateCommitCount);
    expect(accounts.getSelectedGroupId()).toBe(imported.accountGroupId);
  });

  it("removes a private-key source and cancels its requests only after the encrypted commit", async () => {
    const harness = createHarness();
    const {
      accounts,
      approvals,
      commits,
      grantPermission,
      holdNextCommit,
      keyring,
      permissions,
      setCommitFailure,
      readCommittedSources,
      wallet,
    } = harness;
    const first = await initializeWallet(wallet);
    const imported = await wallet.importPrivateKey({
      privateKey: PRIVATE_KEY,
      namespace: EIP155_NAMESPACE,
    });
    assert(imported.status === "added");
    const scope = { origin: "https://dapp.example", namespace: EIP155_NAMESPACE } as const;
    await grantPermission({ ...scope, accountIds: [memberId(accounts, imported.accountGroupId)] });
    const pending = requestAccountSign(harness, memberId(accounts, imported.accountGroupId));
    const failure = new Error("commit failed");
    setCommitFailure(failure);
    await expect(wallet.removeKeySource({ keySourceId: imported.keySourceId })).rejects.toBe(failure);
    expect(keyring.getKeySource(imported.keySourceId)).not.toBeNull();
    expect(accounts.getGroup(imported.accountGroupId)).toMatchObject({ selected: true });
    expect(permissions.get(scope)?.accountIds).toEqual([memberId(accounts, imported.accountGroupId)]);
    expect(approvals.list().map((approval) => approval.approvalId)).toEqual([pending.approvalId]);

    setCommitFailure(null);
    const commitCount = commits.length;
    const commit = holdNextCommit();
    const removing = wallet.removeKeySource({ keySourceId: imported.keySourceId });
    await commit.started;
    requestAccountSign(harness, memberId(accounts, imported.accountGroupId));
    commit.release();
    await removing;

    expect(commits).toHaveLength(commitCount + 1);
    expect(keyring.getKeySource(imported.keySourceId)).toBeNull();
    expect(accounts.getGroup(imported.accountGroupId)).toBeNull();
    expect(accounts.getGroup(first.accountGroupId)).toMatchObject({ selected: true });
    expect(permissions.get(scope)).toBeNull();
    expect(approvals.list()).toEqual([]);
    expect(await readCommittedSources()).toEqual([
      expect.objectContaining({ keySourceId: first.keySourceId, type: "bip39" }),
    ]);
  });

  it("renames a source once while retaining its accounts and encrypted vault", async () => {
    const { wallet, accounts, commits, getCommittedVault, keyring, keyringChanges } = createHarness();
    const initialized = await initializeWallet(wallet);
    const { keySourceId } = initialized;
    const previousSource = keyring.getKeySource(keySourceId);
    const previousAccounts = accounts.listGroups();
    const encryptedVault = getCommittedVault();
    const commitCount = commits.length;
    const eventCount = keyringChanges.length;

    await keyring.renameMnemonicSource({ keySourceId, name: "Savings" });

    const renamedSource = { ...previousSource, name: "Savings" };
    expect(keyring.getKeySource(keySourceId)).toEqual(renamedSource);
    expect(accounts.listGroups()).toEqual(previousAccounts);
    expect(getCommittedVault()).toBe(encryptedVault);
    expect(commits).toHaveLength(commitCount + 1);
    expect(keyringChanges).toHaveLength(eventCount + 1);
    expect(keyringChanges.at(-1)).toEqual({ type: "keyringChanged" });

    await keyring.renameMnemonicSource({ keySourceId, name: "Savings" });

    expect(commits).toHaveLength(commitCount + 1);
    expect(keyringChanges).toHaveLength(eventCount + 1);
  });

  it("keeps the previous source name when persistence rejects a rename", async () => {
    const { wallet, keyring, keyringChanges, setCommitFailure } = createHarness();
    const initialized = await initializeWallet(wallet);
    const { keySourceId } = initialized;
    const previousSource = keyring.getKeySource(keySourceId);
    const eventCount = keyringChanges.length;
    const failure = new Error("Storage transaction failed");
    setCommitFailure(failure);

    await expect(keyring.renameMnemonicSource({ keySourceId, name: "Savings" })).rejects.toBe(failure);

    expect(keyring.getKeySource(keySourceId)).toEqual(previousSource);
    expect(keyringChanges).toHaveLength(eventCount);
  });

  it("confirms mnemonic backup while locked without reading the secret", async () => {
    const { wallet, commits, keyring, keyringChanges } = createHarness();
    await initializeWallet(wallet);
    const source = keyring.listKeySources()[0];
    if (source?.type !== "bip39") throw new Error("missing test source");
    await wallet.lock();

    await keyring.confirmMnemonicBackup({ keySourceId: source.keySourceId });

    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
    expect(keyring.getKeySource(source.keySourceId)).toMatchObject({ backupStatus: "confirmed" });
    expect(commits.at(-1)?.map((change) => change.persistenceType)).toEqual(["keySource"]);
    expect(keyringChanges.at(-1)).toEqual({ type: "keyringChanged" });

    const commitCount = commits.length;
    const eventCount = keyringChanges.length;
    await keyring.confirmMnemonicBackup({ keySourceId: source.keySourceId });

    expect(commits).toHaveLength(commitCount);
    expect(keyringChanges).toHaveLength(eventCount);
  });

  it("restores the private-key account and source after locking and unlocking", async () => {
    const { wallet, accounts, keyring } = createHarness();
    const created = await wallet.createFromPrivateKey({
      password: "password",
      privateKey: PRIVATE_KEY,
      namespace: "eip155",
    });
    assert(created.status === "initialized");

    expect(keyring.getKeySource(created.keySourceId)).toMatchObject({
      type: "private-key",
      namespace: "eip155",
    });
    const group = accounts.getGroup(created.accountGroupId);
    const source = keyring.getKeySource(created.keySourceId);
    await wallet.lock();
    await expect(wallet.unlock("password")).resolves.toBe(true);
    expect(accounts.getGroup(created.accountGroupId)).toEqual(group);
    expect(keyring.getKeySource(created.keySourceId)).toEqual(source);
    expect(keyring.requireKeySourceSecret(created.keySourceId)).toEqual({
      keySourceId: created.keySourceId,
      type: "private-key",
      privateKey: PRIVATE_KEY,
    });
  });

  it("locks by clearing decoded secrets and cancelling a pending approval without committing persistence", async () => {
    const { accounts, approvals, wallet, commits, events, keyring } = createHarness();
    const created = await initializeWallet(wallet);
    const selectableAccounts = [
      accounts.getAddress({ accountId: memberId(accounts, created.accountGroupId), chainRef: "eip155:1" }),
    ] as const;
    const pendingApproval = approvals.request({
      type: "accountAccess",
      namespace: EIP155_NAMESPACE,
      origin: "https://dapp.example",
      request: { selectableAccounts },
    });
    const cancellation = expect(pendingApproval.decision).rejects.toMatchObject({ code: "approval.cancelled" });
    const commitCount = commits.length;

    await wallet.lock();
    await cancellation;

    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
    expect(commits).toHaveLength(commitCount);
    expect(() => keyring.requireKeySourceSecret(created.keySourceId)).toThrow(KeyringLockedError);
    expect(approvals.list()).toEqual([]);
    expect(events).toEqual([
      { type: "walletStatusChanged", status: "unlocked" },
      { type: "walletStatusChanged", status: "locked" },
    ]);

    await wallet.lock();
    expect(events).toHaveLength(2);
  });

  it("serializes a lock requested while unlock is in progress", async () => {
    const { wallet, keyring } = createHarness();
    await initializeWallet(wallet);
    await wallet.lock();

    const unlocking = wallet.unlock("password");
    const locking = wallet.lock();
    await Promise.all([unlocking, locking]);

    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
  });

  it("returns true without checking the password when already unlocked", async () => {
    const { wallet, events } = createHarness();
    await initializeWallet(wallet);

    await expect(wallet.unlock("incorrect-password")).resolves.toBe(true);

    expect(events).toEqual([{ type: "walletStatusChanged", status: "unlocked" }]);
  });

  it("requires the password again after expiry even before the lock timer runs", async () => {
    const { wallet, keyring } = createHarness();
    await initializeWallet(wallet);

    vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
    wallet.notifyUserActivity();
    expect(wallet.getStatus()).toBe("locked");
    expect(keyring.getSoftwareKeyStatus()).toBe("unlocked");

    await expect(wallet.unlock("incorrect-password")).resolves.toBe(false);
    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
  });

  it("does not let a queued expiry lock a newly unlocked session", async () => {
    const { wallet, events } = createHarness();
    await initializeWallet(wallet);

    const unlocking = wallet.unlock("password");
    vi.advanceTimersByTime(DEFAULT_AUTO_LOCK_DURATION_MS);
    await unlocking;
    await vi.advanceTimersByTimeAsync(0);

    expect(wallet.getStatus()).toBe("unlocked");
    expect(events.map((event) => event.status)).toEqual(["unlocked", "locked", "unlocked"]);
  });

  it("does not return a secret when the session expires during password verification", async () => {
    const { keyring, wallet } = createHarness();
    const initialized = await initializeWallet(wallet);
    const { keySourceId } = initialized;
    const verify = keyring.verifyPassword.bind(keyring);
    vi.spyOn(keyring, "verifyPassword").mockImplementation(async (password) => {
      const matches = await verify(password);
      vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
      return matches;
    });

    await expect(wallet.exportMnemonic({ keySourceId, password: "password" })).rejects.toMatchObject({
      code: "wallet.locked",
    });
  });

  it("does not commit a password change that finishes preparation after expiry", async () => {
    const { wallet, commits, keyring } = createHarness();
    await initializeWallet(wallet);
    const prepare = keyring.prepareChangePassword.bind(keyring);
    vi.spyOn(keyring, "prepareChangePassword").mockImplementation(async (input) => {
      const update = await prepare(input);
      vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
      return update;
    });

    await expect(
      wallet.changePassword({ currentPassword: "password", newPassword: "new-password" }),
    ).rejects.toMatchObject({ code: "wallet.locked" });
    expect(commits).toHaveLength(1);
    await expect(wallet.unlock("password")).resolves.toBe(true);
  });

  it("finishes an in-flight commit successfully and then clears the expired session", async () => {
    const { wallet, holdNextCommit, keyring } = createHarness();
    await initializeWallet(wallet);
    const commit = holdNextCommit();

    const importing = wallet.addMnemonic({
      mnemonic: SECONDARY_MNEMONIC,
      name: "Wallet 2",
      backupStatus: "confirmed",
    });
    await commit.started;
    vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
    wallet.notifyUserActivity();
    expect(wallet.getStatus()).toBe("locked");
    commit.release();

    const added = await importing;
    assert(added.status === "added");
    expect(keyring.getKeySource(added.keySourceId)).toMatchObject({ type: "bip39", name: "Wallet 2" });
    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
    await expect(wallet.unlock("password")).resolves.toBe(true);
    expect(keyring.requireKeySourceSecret(added.keySourceId)).toMatchObject({ mnemonic: SECONDARY_MNEMONIC });
  });

  it("changes the password without renewing the session or publishing a status event", async () => {
    const { wallet, commits, events, keyring } = createHarness();
    await initializeWallet(wallet);
    const eventCount = events.length;
    vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS / 2);

    await wallet.changePassword({ currentPassword: "password", newPassword: "new-password" });

    expect(commits).toHaveLength(2);
    expect(events).toHaveLength(eventCount);
    vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
    expect(wallet.getStatus()).toBe("locked");

    await wallet.lock();
    await expect(wallet.unlock("password")).resolves.toBe(false);
    await expect(wallet.unlock("new-password")).resolves.toBe(true);
    expect(keyring.getSoftwareKeyStatus()).toBe("unlocked");
  });

  it.each([
    {
      label: "source addition",
      change: (wallet: WalletCoordinator) =>
        wallet.addMnemonic({
          mnemonic: SECONDARY_MNEMONIC,
          name: "Wallet 2",
          backupStatus: "confirmed",
        }),
    },
    {
      label: "password change",
      change: (wallet: WalletCoordinator) =>
        wallet.changePassword({
          currentPassword: "password",
          newPassword: "new-password",
        }),
    },
  ])("allows an in-flight HD signature to finish across a $label", async ({ change }) => {
    const { accounts, holdNextCommit, keyring, wallet } = createHarness();
    const initialized = await initializeWallet(wallet);
    const accountId = memberId(accounts, initialized.accountGroupId);
    const signing = createEip155AccountSigning({ accounts, keyring, wallet });
    const commit = holdNextCommit();
    const digest = new Uint8Array(32);

    const changing = change(wallet);
    await commit.started;
    const pendingSignature = signing.signDigest({ accountId, digest });
    commit.release();

    const [signature] = await Promise.all([pendingSignature, changing]);
    expect(Secp256k1.recoverAddress({ payload: digest, signature }).toLowerCase()).toBe(
      "0x9858effd232b4033e47d90003d41ec34ecaeda94",
    );
    expect(wallet.getStatus()).toBe("unlocked");
  });

  it("keeps the private-key account intact when its mnemonic addition fails to commit", async () => {
    const { wallet, getCommittedVault, accounts, keyring, keyringChanges, setCommitFailure } = createHarness();
    const imported = await wallet.createFromPrivateKey({
      password: "password",
      privateKey: FIRST_PRIVATE_KEY,
      namespace: EIP155_NAMESPACE,
    });
    assert(imported.status === "initialized");
    const committedRecord = getCommittedVault();
    const originalAccount = accounts.getGroup(imported.accountGroupId);
    const eventCount = keyringChanges.length;
    const input = {
      mnemonic: PRIMARY_MNEMONIC,
      name: "Recovered",
      backupStatus: "confirmed",
      accountId: memberId(accounts, imported.accountGroupId),
    } as const;
    const failure = new Error("commit failed");
    setCommitFailure(failure);

    await expect(wallet.addMnemonicAndMoveAccount(input)).rejects.toBe(failure);
    expect(getCommittedVault()).toBe(committedRecord);
    expect(accounts.getGroup(imported.accountGroupId)).toEqual(originalAccount);
    expect(keyring.listKeySources().map((source) => source.keySourceId)).toEqual([imported.keySourceId]);
    expect(keyring.listHdKeyrings()).toEqual([]);
    expect(keyring.requireKeySourceSecret(imported.keySourceId)).toMatchObject({ privateKey: FIRST_PRIVATE_KEY });
    expect(keyringChanges).toHaveLength(eventCount);

    setCommitFailure(null);
    await expect(wallet.addMnemonicAndMoveAccount(input)).resolves.toMatchObject({
      keySourceId: expect.any(String),
      accountGroupId: imported.accountGroupId,
    });
  });

  it("keeps the active deadline and auto-lock duration unchanged when persistence fails", async () => {
    const failure = new Error("commit failed");
    const { autoLock, wallet, setCommitFailure } = createHarness();
    await initializeWallet(wallet);
    vi.setSystemTime(91_000);
    setCommitFailure(failure);

    await expect(wallet.setAutoLockDuration(60_000)).rejects.toBe(failure);

    expect(autoLock.getDuration()).toBe(DEFAULT_AUTO_LOCK_DURATION_MS);
    expect(wallet.getStatus()).toBe("unlocked");
    vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
    expect(wallet.getStatus()).toBe("locked");
  });

  it("locks immediately when a shorter duration puts the last input beyond the deadline", async () => {
    const { wallet, keyring } = createHarness();
    await initializeWallet(wallet);
    vi.setSystemTime(91_000);

    await wallet.setAutoLockDuration(60_000);

    expect(wallet.getStatus()).toBe("locked");
    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
  });

  it("persists only a non-default auto-lock duration", async () => {
    const { autoLock, wallet, commits } = createHarness();

    await wallet.setAutoLockDuration(120_000);

    expect(commits.at(-1)).toEqual([
      {
        persistenceType: "setting",
        operation: "put",
        value: { key: AUTO_LOCK_SETTING_KEY, durationMs: 120_000 },
      },
    ]);
    expect(autoLock.getDuration()).toBe(120_000);

    const commitCount = commits.length;
    await wallet.setAutoLockDuration(120_000);
    expect(commits).toHaveLength(commitCount);

    await wallet.setAutoLockDuration(DEFAULT_AUTO_LOCK_DURATION_MS);
    expect(commits.at(-1)).toEqual([{ persistenceType: "setting", operation: "remove", key: AUTO_LOCK_SETTING_KEY }]);
    expect(autoLock.getDuration()).toBe(DEFAULT_AUTO_LOCK_DURATION_MS);
  });

  it("locks through the mutation queue when the auto-lock timer expires", async () => {
    const { wallet, events, keyring } = createHarness({ autoLockDurationMs: 60_000 });
    await initializeWallet(wallet);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
    expect(events.at(-1)).toEqual({ type: "walletStatusChanged", status: "locked" });
  });
});
