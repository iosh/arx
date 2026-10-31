import { bytesToHex } from "@noble/hashes/utils.js";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts } from "../accounts/Accounts.js";
import { type AccountId, formatAccountId, parseAccountId } from "../accounts/accountId.js";
import type { AccountsNamespaceAdapter } from "../accounts/namespaceAdapter.js";
import type { AccountRecord, AccountSelectionRecord } from "../accounts/persistence.js";
import type { AccountsChanged } from "../accounts/types.js";
import { Approvals } from "../approvals/Approvals.js";
import { dappConnectionScopeKey } from "../dappConnections/scope.js";
import { KeyringInvalidMnemonicError, KeyringLockedError } from "../keyring/errors.js";
import { Keyring } from "../keyring/Keyring.js";
import type { KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { HdKeyringRecord, KeySourceRecord } from "../keyring/persistence.js";
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
import { AUTO_LOCK_SETTING_KEY, type AutoLockSetting } from "../settings/persistence.js";
import { unlockVaultRecord } from "../vault/crypto.js";
import { VaultPasswordTooShortError } from "../vault/errors.js";
import type { EncryptedVaultRecord } from "../vault/persistence.js";
import { AutoLockController, DEFAULT_AUTO_LOCK_DURATION_MS } from "./AutoLockController.js";
import type { WalletStatusChanged } from "./Wallet.js";
import { WalletCoordinator } from "./WalletCoordinator.js";

const PRIMARY_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SECONDARY_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const TERTIARY_MNEMONIC = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
const SECOND_NAMESPACE = "test";
const PRIVATE_KEY = "11".repeat(32);
const FIRST_PRIVATE_KEY = bytesToHex(
  HDKey.fromMasterSeed(mnemonicToSeedSync(PRIMARY_MNEMONIC)).derive("m/44'/60'/0'/0/0").privateKey as Uint8Array,
);
const NEXT_PRIVATE_KEY = bytesToHex(
  HDKey.fromMasterSeed(mnemonicToSeedSync(PRIMARY_MNEMONIC)).derive("m/44'/60'/0'/0/1").privateKey as Uint8Array,
);

type State = {
  encryptedVault: EncryptedVaultRecord | null;
  keySources: Map<string, KeySourceRecord>;
  keyrings: Map<string, HdKeyringRecord>;
  accounts: Map<AccountId, AccountRecord>;
  selections: Map<string, AccountSelectionRecord>;
  permissions: Map<string, PermissionRecord>;
  autoLock: AutoLockSetting | null;
};

const emptyState = (): State => ({
  encryptedVault: null,
  keySources: new Map(),
  keyrings: new Map(),
  accounts: new Map(),
  selections: new Map(),
  permissions: new Map(),
  autoLock: null,
});

const decryptStoredSources = async (state: State) => {
  assert(state.encryptedVault !== null);
  const decrypted = await unlockVaultRecord(state.encryptedVault, "password");
  assert(decrypted !== null);
  return decodeKeyringSecrets(decrypted.plaintext).keySources;
};

// A synthetic namespace exercises source sharing and removal, not another chain's cryptography.
const secondKeyringAdapter: KeyringNamespaceAdapter = {
  namespace: SECOND_NAMESPACE,
  deriveHdAccountId: (params) =>
    formatAccountId({
      namespace: SECOND_NAMESPACE,
      payload: parseAccountId(eip155KeyringAdapter.deriveHdAccountId(params)).payload,
    }),
  accountIdFromPrivateKey: (privateKey) =>
    formatAccountId({
      namespace: SECOND_NAMESPACE,
      payload: parseAccountId(eip155KeyringAdapter.accountIdFromPrivateKey(privateKey)).payload,
    }),
};

const secondAccountsAdapter: AccountsNamespaceAdapter = {
  namespace: SECOND_NAMESPACE,
  accountIdFromAddress: ({ address }) => formatAccountId({ namespace: SECOND_NAMESPACE, payload: address }),
  addressForAccountId: ({ accountId }) => {
    const address = parseAccountId(accountId).payload;
    return { canonicalAddress: address, displayAddress: address };
  },
};

const applyChanges = (state: State, changes: readonly PersistenceChange[]): void => {
  for (const change of changes) {
    switch (change.persistenceType) {
      case "encryptedVault":
        state.encryptedVault = change.operation === "put" ? change.value : null;
        break;
      case "setting":
        state.autoLock = change.operation === "put" ? change.value : null;
        break;
      case "keySource":
        if (change.operation === "put") state.keySources.set(change.value.keySourceId, change.value);
        else state.keySources.delete(change.key);
        break;
      case "hdKeyring":
        if (change.operation === "put") state.keyrings.set(change.value.hdKeyringId, change.value);
        else state.keyrings.delete(change.key);
        break;
      case "account":
        if (change.operation === "put") state.accounts.set(change.value.accountId, change.value);
        else state.accounts.delete(change.key);
        break;
      case "accountSelection":
        if (change.operation === "put") state.selections.set(change.value.namespace, change.value);
        else state.selections.delete(change.key);
        break;
      case "permission":
        if (change.operation === "put") state.permissions.set(dappConnectionScopeKey(change.value), change.value);
        else state.permissions.delete(dappConnectionScopeKey(change.key));
        break;
    }
  }
};

const createHarness = (params: { state?: State; rejectCommit?: Error } = {}) => {
  const state = params.state ?? emptyState();
  const commits: PersistenceChange[][] = [];
  let commitFailure = params.rejectCommit ?? null;
  const write = (changes: readonly PersistenceChange[]) => {
    if (commitFailure) throw commitFailure;
    commits.push([...changes]);
    applyChanges(state, changes);
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
    bootstrap: {
      encryptedVault: state.encryptedVault,
      keySources: [...state.keySources.values()],
      hdKeyrings: [...state.keyrings.values()],
    },
    namespaceAdapters: {
      [EIP155_NAMESPACE]: eip155KeyringAdapter,
      [SECOND_NAMESPACE]: secondKeyringAdapter,
    },
    mutations,
    publishChanged: publishKeyringChanged,
  });
  const publishAccountsChanged = (change: AccountsChanged): void => {
    accountChanges.push(change);
  };
  const accounts = new Accounts({
    adapters: { [EIP155_NAMESPACE]: eip155AccountsAdapter, [SECOND_NAMESPACE]: secondAccountsAdapter },
    bootstrap: {
      records: [...state.accounts.values()],
      selections: [...state.selections.values()],
    },
    mutations,
    publishChanged: publishAccountsChanged,
  });
  const permissions = new Permissions({
    bootstrap: { records: [...state.permissions.values()] },
    accounts,
  });
  const approvals = new Approvals({
    time: systemTime,
    publishChanged: () => undefined,
  });
  const autoLock = new AutoLockController({
    durationMs: state.autoLock?.durationMs ?? DEFAULT_AUTO_LOCK_DURATION_MS,
    time: systemTime,
  });
  const wallet = new WalletCoordinator({
    mutations,
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
    state,
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
  const created = await harness.wallet.createFromMnemonic({
    password: "password",
    mnemonic: PRIMARY_MNEMONIC,
    name: "Wallet 1",
    namespace: EIP155_NAMESPACE,
  });
  assert(created.status === "initialized");
  const { account } = await harness.wallet.createHdAccount({ hdKeyringId: created.hdKeyringId });
  const scope = { origin: "https://dapp.example", namespace: EIP155_NAMESPACE } as const;
  await harness.grantPermission({ ...scope, accountIds: [created.accountId, account.accountId] });
  return {
    ...harness,
    accountId: created.accountId,
    replacementId: account.accountId,
    scope,
    requestSign: (accountId: AccountId) => requestAccountSign(harness, accountId),
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
});
afterEach(() => vi.useRealTimers());

describe("WalletCoordinator", () => {
  it("creates a mnemonic wallet with one five-record commit", async () => {
    const { wallet, accounts, accountChanges, autoLock, commits, events, keyring, keyringChanges, state } =
      createHarness();

    const created = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Personal",
      namespace: "eip155",
    });
    assert(created.status === "initialized");

    expect(commits).toHaveLength(1);
    expect(commits[0]?.map((change) => `${change.persistenceType}.${change.operation}`)).toEqual([
      "encryptedVault.put",
      "keySource.put",
      "hdKeyring.put",
      "account.put",
      "accountSelection.put",
    ]);
    expect(keyring.getSoftwareKeyStatus()).toBe("unlocked");
    expect(autoLock.getDuration()).toBe(DEFAULT_AUTO_LOCK_DURATION_MS);
    expect(state.autoLock).toBeNull();
    expect(state.accounts.has(created.accountId)).toBe(true);
    expect(accounts.getAccountRecord(created.accountId)).not.toBeNull();
    expect(keyring.requireKeySourceSecret(created.keySourceId)).toMatchObject({
      type: "bip39",
      mnemonic: PRIMARY_MNEMONIC,
    });
    expect([...state.keySources.values()][0]).toMatchObject({
      type: "bip39",
      name: "Personal",
      backupStatus: "pending",
    });
    expect(created.keySourceId).toBe([...state.keySources.keys()][0]);
    expect(created.hdKeyringId).toBe([...state.keyrings.keys()][0]);
    expect(events).toEqual([{ type: "walletStatusChanged", status: "unlocked" }]);
    expect(keyringChanges).toEqual([{ type: "keyringChanged" }]);
    expect(accountChanges).toEqual([
      {
        type: "accountsChanged",
        accountIds: [created.accountId],
        namespaces: ["eip155"],
      },
    ]);
  });

  it("restores a mnemonic with confirmed backup status", async () => {
    const { wallet, state } = createHarness();

    const created = await wallet.restoreFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Recovered",
      namespace: "eip155",
    });
    assert(created.status === "initialized");

    expect(state.keySources.get(created.keySourceId)).toMatchObject({
      type: "bip39",
      name: "Recovered",
      backupStatus: "confirmed",
    });
    expect(state.keyrings.get(created.hdKeyringId)?.keySourceId).toBe(created.keySourceId);
  });

  it("commits only one wallet when initialization commands compete", async () => {
    const { wallet, commits, events, keyring, keyringChanges, accountChanges } = createHarness();
    const first = wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });

    const second = wallet.restoreFromMnemonic({
      password: "password",
      mnemonic: SECONDARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
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
        namespace: "eip155",
      }),
    ).resolves.toEqual({ status: "already-initialized" });
    expect(commits).toHaveLength(1);
    expect(events).toEqual([{ type: "walletStatusChanged", status: "unlocked" }]);
    expect(keyringChanges).toHaveLength(1);
    expect(accountChanges).toHaveLength(1);
    expect(keyring.listKeySources()).toHaveLength(1);
    expect(keyring.requireKeySourceSecret(created.keySourceId)).toMatchObject({ mnemonic: PRIMARY_MNEMONIC });
  });

  it("rejects an invalid restore before commit or activation", async () => {
    const { wallet, commits, keyring } = createHarness();

    await expect(
      wallet.restoreFromMnemonic({
        password: "password",
        mnemonic: "not a bip39 mnemonic",
        name: "Wallet 1",
        namespace: "eip155",
      }),
    ).rejects.toThrow(KeyringInvalidMnemonicError);

    expect(commits).toHaveLength(0);
    expect(keyring.listKeySources()).toEqual([]);
    expect(keyring.getSoftwareKeyStatus()).toBe("uninitialized");
  });

  it("rejects invalid input and returns normalized duplicates without changing the wallet", async () => {
    const { wallet, commits, keyring, accounts } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
    const commitCount = commits.length;
    const selectedAccount = accounts.getSelectedAccountId("eip155");

    await expect(
      wallet.addMnemonic({
        mnemonic: "not a bip39 mnemonic",
        name: "Wallet 2",
        namespace: "eip155",
        backupStatus: "confirmed",
      }),
    ).rejects.toThrow(KeyringInvalidMnemonicError);

    await expect(
      wallet.addMnemonic({
        mnemonic: `  ${PRIMARY_MNEMONIC.replaceAll(" ", "   ")}  `,
        name: "Wallet 2",
        namespace: "eip155",
        backupStatus: "confirmed",
      }),
    ).resolves.toEqual({ status: "duplicate", walletName: "Wallet 1" });

    expect(commits).toHaveLength(commitCount);
    expect(keyring.listKeySources()).toHaveLength(1);
    expect(accounts.getSelectedAccountId("eip155")).toBe(selectedAccount);
  });

  it("adds mnemonic sources with their backup state and selects each first account", async () => {
    const { accounts, keyring, state, wallet } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });

    const added = await wallet.addMnemonic({
      mnemonic: SECONDARY_MNEMONIC,
      name: "Savings",
      namespace: EIP155_NAMESPACE,
      backupStatus: "pending",
    });
    const imported = await wallet.addMnemonic({
      mnemonic: TERTIARY_MNEMONIC,
      name: "Recovered",
      namespace: EIP155_NAMESPACE,
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
    expect(keyring.getHdKeyring(added.hdKeyringId)).toMatchObject({
      keySourceId: added.keySourceId,
      namespace: EIP155_NAMESPACE,
    });
    expect(keyring.getHdKeyring(imported.hdKeyringId)).toMatchObject({
      keySourceId: imported.keySourceId,
      namespace: EIP155_NAMESPACE,
    });
    expect(accounts.getAccount(added.accountId)?.origin).toEqual({
      type: "hd",
      hdKeyringId: added.hdKeyringId,
      derivationIndex: 0,
    });
    expect(accounts.getAccount(imported.accountId)?.origin).toEqual({
      type: "hd",
      hdKeyringId: imported.hdKeyringId,
      derivationIndex: 0,
    });
    expect(keyring.listKeySources()).toHaveLength(3);
    expect(keyring.listHdKeyrings()).toHaveLength(3);
    expect(accounts.listAccounts()).toHaveLength(3);
    expect(state.keySources.has(added.keySourceId)).toBe(true);
    expect(state.keySources.has(imported.keySourceId)).toBe(true);
    expect(accounts.getSelectedAccountId(EIP155_NAMESPACE)).toBe(imported.accountId);
    expect(state.selections.get(EIP155_NAMESPACE)?.accountId).toBe(imported.accountId);
  });

  it("confirms the first account's move once, retaining its identity and later selection", async () => {
    const { accounts, commits, grantPermission, keyring, permissions, state, wallet } = createHarness();
    const imported = await wallet.createFromPrivateKey({
      password: "password",
      privateKey: FIRST_PRIVATE_KEY,
      namespace: EIP155_NAMESPACE,
    });
    assert(imported.status === "initialized");
    const other = await wallet.importPrivateKey({ privateKey: PRIVATE_KEY, namespace: EIP155_NAMESPACE });
    assert(other.status === "added");
    await accounts.rename({ accountId: imported.accountId, alias: "Daily" });
    await accounts.select(other.accountId);
    const scope = { origin: "https://dapp.example", namespace: EIP155_NAMESPACE } as const;
    await grantPermission({ ...scope, accountIds: [imported.accountId] });
    const before = accounts.getAccount(imported.accountId);
    const commitCount = commits.length;
    const input = {
      mnemonic: PRIMARY_MNEMONIC,
      name: "Recovered",
      namespace: EIP155_NAMESPACE,
      backupStatus: "confirmed",
    } as const;

    expect(await wallet.addMnemonic(input)).toEqual({ status: "move-available", account: before });
    expect(commits).toHaveLength(commitCount);
    expect(accounts.getSelectedAccountId(EIP155_NAMESPACE)).toBe(other.accountId);

    const confirmed = { ...input, accountId: imported.accountId };
    const added = await wallet.addMnemonicAndMoveAccount(confirmed);
    expect(commits).toHaveLength(commitCount + 1);
    expect(accounts.getAccount(added.accountId)).toEqual({
      ...before,
      origin: { type: "hd", hdKeyringId: added.hdKeyringId, derivationIndex: 0 },
      selected: true,
    });
    expect(state.selections.get(EIP155_NAMESPACE)?.accountId).toBe(imported.accountId);
    expect(permissions.get(scope)?.accountIds).toEqual([imported.accountId]);
    const expectedSourceIds = new Set([other.keySourceId, added.keySourceId]);
    expect(new Set(state.keySources.keys())).toEqual(expectedSourceIds);
    expect(keyring.getHdKeyring(added.hdKeyringId)?.nextDerivationIndex).toBe(1);

    await accounts.select(other.accountId);
    const repeatedCommitCount = commits.length;
    expect(await wallet.addMnemonicAndMoveAccount(confirmed)).toEqual(added);
    expect(commits).toHaveLength(repeatedCommitCount);
    expect(accounts.getSelectedAccountId(EIP155_NAMESPACE)).toBe(other.accountId);
    expect(new Set((await decryptStoredSources(state)).map((source) => source.keySourceId))).toEqual(expectedSourceIds);
  });

  it("adds an HD keyring and its first account in one commit", async () => {
    const { accounts, commits, keyring, wallet } = createHarness();
    const created = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(created.status === "initialized");

    const added = await wallet.addHdKeyring({
      keySourceId: created.keySourceId,
      namespace: SECOND_NAMESPACE,
    });

    expect(commits.at(-1)?.map((change) => change.persistenceType)).toEqual([
      "hdKeyring",
      "account",
      "accountSelection",
    ]);
    expect(keyring.getHdKeyring(added.hdKeyringId)).toMatchObject({
      keySourceId: created.keySourceId,
      namespace: SECOND_NAMESPACE,
      nextDerivationIndex: 1,
    });
    expect(accounts.getAccount(added.accountId)).toMatchObject({
      namespace: SECOND_NAMESPACE,
      origin: { type: "hd", hdKeyringId: added.hdKeyringId, derivationIndex: 0 },
      selected: true,
    });
    const commitCount = commits.length;
    await expect(
      wallet.addHdKeyring({ keySourceId: created.keySourceId, namespace: SECOND_NAMESPACE }),
    ).rejects.toMatchObject({
      code: "keyring.hd_keyring_already_exists",
    });
    expect(commits).toHaveLength(commitCount);
  });

  it("exports source secrets only after current-password verification", async () => {
    const { commits, keyringChanges, keyring, wallet } = createHarness();
    const mnemonicSource = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(mnemonicSource.status === "initialized");
    const privateKeySource = await wallet.importPrivateKey({
      privateKey: PRIVATE_KEY,
      namespace: EIP155_NAMESPACE,
    });
    assert(privateKeySource.status === "added");
    const commitCount = commits.length;
    const eventCount = keyringChanges.length;

    await expect(
      wallet.exportMnemonic({
        keySourceId: mnemonicSource.keySourceId,
        password: "password",
      }),
    ).resolves.toEqual({ mnemonic: PRIMARY_MNEMONIC });
    await expect(
      wallet.exportPrivateKey({
        keySourceId: privateKeySource.keySourceId,
        password: "password",
      }),
    ).resolves.toEqual({ privateKey: PRIVATE_KEY });
    await expect(
      wallet.exportMnemonic({
        keySourceId: mnemonicSource.keySourceId,
        password: "incorrect",
      }),
    ).resolves.toBeNull();
    await expect(
      wallet.exportPrivateKey({
        keySourceId: privateKeySource.keySourceId,
        password: "incorrect",
      }),
    ).resolves.toBeNull();
    await expect(
      wallet.exportPrivateKey({
        keySourceId: mnemonicSource.keySourceId,
        password: "password",
      }),
    ).rejects.toMatchObject({
      code: "keyring.key_source_type_mismatch",
      details: {
        keySourceId: mnemonicSource.keySourceId,
        expectedType: "private-key",
        actualType: "bip39",
      },
    });

    expect(keyring.getSoftwareKeyStatus()).toBe("unlocked");
    expect(commits).toHaveLength(commitCount);
    expect(keyringChanges).toHaveLength(eventCount);

    await wallet.lock();
    await expect(
      wallet.exportMnemonic({
        keySourceId: mnemonicSource.keySourceId,
        password: "password",
      }),
    ).rejects.toMatchObject({ code: "wallet.locked" });
    await expect(
      wallet.exportPrivateKey({
        keySourceId: privateKeySource.keySourceId,
        password: "password",
      }),
    ).rejects.toMatchObject({ code: "wallet.locked" });
  });

  it("rejects a short initial password before commit or activation", async () => {
    const { wallet, commits, keyring } = createHarness();

    await expect(
      wallet.createFromMnemonic({
        password: "short",
        mnemonic: PRIMARY_MNEMONIC,
        name: "Wallet 1",
        namespace: "eip155",
      }),
    ).rejects.toMatchObject({ code: VaultPasswordTooShortError.code });

    expect(commits).toHaveLength(0);
    expect(keyring.getSoftwareKeyStatus()).toBe("uninitialized");
  });

  it("does not activate wallet state when the initial commit fails", async () => {
    const failure = new Error("commit failed");
    const { wallet, accounts, keyring } = createHarness({ rejectCommit: failure });

    await expect(
      wallet.createFromMnemonic({
        password: "password",
        mnemonic: PRIMARY_MNEMONIC,
        name: "Wallet 1",
        namespace: "eip155",
      }),
    ).rejects.toBe(failure);

    expect(keyring.getSoftwareKeyStatus()).toBe("uninitialized");
    expect(keyring.listKeySources()).toEqual([]);
    expect(keyring.listHdKeyrings()).toEqual([]);
    expect(accounts.listAccountRecords()).toEqual([]);
  });

  it("commits a derived account and the advanced cursor together", async () => {
    const { wallet, accounts, commits, state } = createHarness();
    const first = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
    assert(first.status === "initialized");
    const result = await wallet.createHdAccount({ hdKeyringId: first.hdKeyringId });

    expect(result).toMatchObject({
      status: "created",
      account: {
        accountId: eip155KeyringAdapter.accountIdFromPrivateKey(NEXT_PRIVATE_KEY),
        origin: { type: "hd", hdKeyringId: first.hdKeyringId, derivationIndex: 1 },
        selected: false,
        hidden: false,
      },
    });
    expect(result.account).toEqual(accounts.getAccount(result.account.accountId));
    expect(accounts.getSelectedAccountId(EIP155_NAMESPACE)).toBe(first.accountId);
    expect(commits).toHaveLength(2);
    expect(commits[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ persistenceType: "account", operation: "put" }),
        expect.objectContaining({ persistenceType: "hdKeyring", operation: "put" }),
      ]),
    );
    expect(state.accounts.get(result.account.accountId)?.origin).toEqual(result.account.origin);
    expect(state.keyrings.get(first.hdKeyringId)?.nextDerivationIndex).toBe(2);
    expect(accounts.listAccountRecords()).toHaveLength(2);
  });

  it("moves an imported private-key account into an HD wallet and creates the next account", async () => {
    const { wallet, accounts, keyring, state } = createHarness();
    const first = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(first.status === "initialized");
    const imported = await wallet.importPrivateKey({
      privateKey: NEXT_PRIVATE_KEY,
      namespace: EIP155_NAMESPACE,
    });
    assert(imported.status === "added");
    await accounts.select(imported.accountId);

    const candidate = await wallet.createHdAccount({ hdKeyringId: first.hdKeyringId });
    expect(candidate).toEqual({
      status: "move-available",
      account: accounts.getAccount(imported.accountId),
    });

    const moved = await wallet.movePrivateKeyAccount({
      accountId: candidate.account.accountId,
      hdKeyringId: first.hdKeyringId,
    });
    expect(moved).toEqual({
      ...candidate.account,
      origin: { type: "hd", hdKeyringId: first.hdKeyringId, derivationIndex: 1 },
    });
    expect(accounts.getAccount(imported.accountId)).toEqual(moved);
    expect(keyring.getKeySource(imported.keySourceId)).toBeNull();
    expect((await decryptStoredSources(state)).map((source) => source.keySourceId)).toEqual([first.keySourceId]);

    const next = await wallet.createHdAccount({ hdKeyringId: first.hdKeyringId });
    expect(next).toMatchObject({
      status: "created",
      account: {
        origin: { type: "hd", hdKeyringId: first.hdKeyringId, derivationIndex: 2 },
      },
    });
    expect(next.account.accountId).not.toBe(imported.accountId);
    expect(accounts.getSelectedAccountId(EIP155_NAMESPACE)).toBe(imported.accountId);
  });

  it("hides an HD account with its permission in one committed cascade", async () => {
    const fixture = await createWalletWithTwoAuthorizedAccounts();
    const { accountId, replacementId, scope, requestSign } = fixture;
    requestSign(accountId);
    const retained = requestSign(replacementId);
    const commitCount = fixture.commits.length;

    await fixture.wallet.setAccountHidden({ accountId, hidden: true });
    expect(fixture.commits).toHaveLength(commitCount + 1);
    expect(fixture.state.accounts.get(accountId)?.hidden).toBe(true);
    expect(fixture.state.selections.get(EIP155_NAMESPACE)?.accountId).toBe(replacementId);
    expect(fixture.state.permissions.get(dappConnectionScopeKey(scope))?.accountIds).toEqual([replacementId]);
    expect(fixture.accounts.getAccount(accountId)).toMatchObject({ hidden: true, selected: false });
    expect(fixture.permissions.get(scope)?.accountIds).toEqual([replacementId]);
    expect(fixture.approvals.list().map(({ approvalId }) => approvalId)).toEqual([retained.approvalId]);

    await fixture.wallet.setAccountHidden({ accountId, hidden: false });
    expect(fixture.permissions.get(scope)?.accountIds).toEqual([replacementId]);
  });

  it("cancels account requests only after a successful visibility commit", async () => {
    const fixture = await createWalletWithTwoAuthorizedAccounts();
    const { accountId, replacementId, scope } = fixture;
    const pending = fixture.requestSign(accountId);
    const failure = new Error("commit failed");
    fixture.setCommitFailure(failure);
    await expect(fixture.wallet.setAccountHidden({ accountId, hidden: true })).rejects.toBe(failure);
    expect(fixture.accounts.getAccount(accountId)).toMatchObject({ hidden: false, selected: true });
    expect(fixture.permissions.get(scope)?.accountIds).toEqual([accountId, replacementId]);
    expect(fixture.approvals.list().map((approval) => approval.approvalId)).toEqual([pending.approvalId]);

    fixture.setCommitFailure(null);
    const commit = fixture.holdNextCommit();
    const hiding = fixture.wallet.setAccountHidden({ accountId, hidden: true });
    await commit.started;
    fixture.requestSign(accountId);
    commit.release();
    await hiding;
    expect(fixture.approvals.list()).toEqual([]);
  });

  it("removes a non-last HD keyring and its permission while locked", async () => {
    const { accounts, commits, grantPermission, keyring, permissions, wallet } = createHarness();
    const created = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(created.status === "initialized");
    const added = await wallet.addHdKeyring({
      keySourceId: created.keySourceId,
      namespace: SECOND_NAMESPACE,
    });
    const scope = { origin: "https://dapp.example", namespace: SECOND_NAMESPACE } as const;
    await grantPermission({ ...scope, accountIds: [added.accountId] });
    await wallet.lock();

    const commitCount = commits.length;
    await wallet.removeHdKeyring({ hdKeyringId: added.hdKeyringId });

    expect(commits).toHaveLength(commitCount + 1);
    expect(commits.at(-1)?.map((change) => `${change.persistenceType}.${change.operation}`)).toEqual([
      "hdKeyring.remove",
      "account.remove",
      "accountSelection.remove",
      "permission.remove",
    ]);
    expect(keyring.getKeySource(created.keySourceId)).not.toBeNull();
    expect(keyring.getHdKeyring(added.hdKeyringId)).toBeNull();
    expect(accounts.getAccount(added.accountId)).toBeNull();
    expect(permissions.get(scope)).toBeNull();
    await expect(wallet.removeHdKeyring({ hdKeyringId: created.hdKeyringId })).rejects.toMatchObject({
      code: "keyring.key_source_requires_hd_keyring",
    });
    expect(commits).toHaveLength(commitCount + 1);
  });

  it("removes a BIP39 source cascade and rejects removal of the last source", async () => {
    const harness = createHarness();
    const { accounts, approvals, commits, grantPermission, keyring, permissions, state, wallet } = harness;
    const first = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(first.status === "initialized");
    const commitCount = commits.length;
    await expect(wallet.removeKeySource({ keySourceId: first.keySourceId })).rejects.toMatchObject({
      code: "wallet.last_key_source_removal",
    });
    expect(commits).toHaveLength(commitCount);

    const second = await wallet.addMnemonic({
      mnemonic: SECONDARY_MNEMONIC,
      name: "Wallet 2",
      namespace: EIP155_NAMESPACE,
      backupStatus: "confirmed",
    });
    assert(second.status === "added");
    const another = await wallet.createHdAccount({ hdKeyringId: second.hdKeyringId });
    const hidden = await wallet.createHdAccount({ hdKeyringId: second.hdKeyringId });
    await wallet.setAccountHidden({ accountId: hidden.account.accountId, hidden: true });
    const scope = { origin: "https://dapp.example", namespace: EIP155_NAMESPACE } as const;
    await grantPermission({ ...scope, accountIds: [first.accountId, second.accountId, another.account.accountId] });
    for (const accountId of [first.accountId, second.accountId, another.account.accountId]) {
      requestAccountSign(harness, accountId);
    }

    const removalCommitCount = commits.length;
    await wallet.removeKeySource({ keySourceId: second.keySourceId });

    expect(commits).toHaveLength(removalCommitCount + 1);
    expect(keyring.getKeySource(second.keySourceId)).toBeNull();
    expect(keyring.getHdKeyring(second.hdKeyringId)).toBeNull();
    expect([...state.keySources.keys()]).toEqual([first.keySourceId]);
    expect([...state.keyrings.keys()]).toEqual([first.hdKeyringId]);
    expect([...state.accounts.keys()]).toEqual([first.accountId]);
    expect(accounts.listAccounts().map((account) => account.accountId)).toEqual([first.accountId]);
    expect(accounts.getSelectedAccountId(EIP155_NAMESPACE)).toBe(first.accountId);
    expect(permissions.get(scope)?.accountIds).toEqual([first.accountId]);
    expect(approvals.list().map((approval) => approval.accountId)).toEqual([first.accountId]);
    approvals.cancelAll();
  });

  it("imports and selects once while private-key and hidden HD duplicates leave state unchanged", async () => {
    const { accounts, commits, state, wallet } = createHarness();
    const first = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(first.status === "initialized");
    const commitCount = commits.length;
    const input = { privateKey: PRIVATE_KEY, namespace: EIP155_NAMESPACE };
    const [imported, duplicate] = await Promise.all([wallet.importPrivateKey(input), wallet.importPrivateKey(input)]);
    assert(imported.status === "added");
    expect(duplicate).toMatchObject({ status: "duplicate", account: { accountId: imported.accountId } });
    expect(commits).toHaveLength(commitCount + 1);
    expect(accounts.getSelectedAccountId(EIP155_NAMESPACE)).toBe(imported.accountId);
    expect(state.selections.get(EIP155_NAMESPACE)?.accountId).toBe(imported.accountId);

    await accounts.select(first.accountId);
    const privateDuplicateCommitCount = commits.length;
    await expect(wallet.importPrivateKey({ ...input, privateKey: `0x${PRIVATE_KEY}` })).resolves.toMatchObject({
      status: "duplicate",
      account: { accountId: imported.accountId },
    });
    expect(commits).toHaveLength(privateDuplicateCommitCount);
    expect(accounts.getSelectedAccountId(EIP155_NAMESPACE)).toBe(first.accountId);

    await wallet.createHdAccount({ hdKeyringId: first.hdKeyringId });
    await accounts.select(imported.accountId);
    await wallet.setAccountHidden({ accountId: first.accountId, hidden: true });
    const hdDuplicateCommitCount = commits.length;
    await expect(wallet.importPrivateKey({ ...input, privateKey: FIRST_PRIVATE_KEY })).resolves.toMatchObject({
      status: "duplicate",
      account: { accountId: first.accountId, hidden: true },
    });
    expect(commits).toHaveLength(hdDuplicateCommitCount);
    expect(accounts.getSelectedAccountId(EIP155_NAMESPACE)).toBe(imported.accountId);
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
      state,
      wallet,
    } = harness;
    const first = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(first.status === "initialized");
    const imported = await wallet.importPrivateKey({
      privateKey: PRIVATE_KEY,
      namespace: EIP155_NAMESPACE,
    });
    assert(imported.status === "added");
    const scope = { origin: "https://dapp.example", namespace: EIP155_NAMESPACE } as const;
    await grantPermission({ ...scope, accountIds: [imported.accountId] });
    const pending = requestAccountSign(harness, imported.accountId);
    const failure = new Error("commit failed");
    setCommitFailure(failure);
    await expect(wallet.removeKeySource({ keySourceId: imported.keySourceId })).rejects.toBe(failure);
    expect(keyring.getKeySource(imported.keySourceId)).not.toBeNull();
    expect(accounts.getAccount(imported.accountId)).toMatchObject({ selected: true });
    expect(permissions.get(scope)?.accountIds).toEqual([imported.accountId]);
    expect(approvals.list().map((approval) => approval.approvalId)).toEqual([pending.approvalId]);

    setCommitFailure(null);
    const commitCount = commits.length;
    const commit = holdNextCommit();
    const removing = wallet.removeKeySource({ keySourceId: imported.keySourceId });
    await commit.started;
    requestAccountSign(harness, imported.accountId);
    commit.release();
    await removing;

    expect(commits).toHaveLength(commitCount + 1);
    expect(keyring.getKeySource(imported.keySourceId)).toBeNull();
    expect(accounts.getAccount(imported.accountId)).toBeNull();
    expect(accounts.getAccount(first.accountId)).toMatchObject({ selected: true });
    expect(permissions.get(scope)).toBeNull();
    expect(approvals.list()).toEqual([]);
    expect(await decryptStoredSources(state)).toEqual([
      expect.objectContaining({ keySourceId: first.keySourceId, type: "bip39" }),
    ]);
  });

  it("persists a source rename without changing its accounts or encrypted vault", async () => {
    const { wallet, accounts, commits, keyring, keyringChanges, state } = createHarness();
    const initialized = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(initialized.status === "initialized");
    const { keySourceId } = initialized;
    const previousSource = keyring.getKeySource(keySourceId);
    const previousAccounts = accounts.listAccounts();
    const encryptedVault = state.encryptedVault;
    const commitCount = commits.length;
    const eventCount = keyringChanges.length;

    await keyring.renameMnemonicSource({ keySourceId, name: "Savings" });

    const renamedSource = { ...previousSource, name: "Savings" };
    expect(keyring.getKeySource(keySourceId)).toEqual(renamedSource);
    expect(state.keySources.get(keySourceId)).toEqual(renamedSource);
    expect(accounts.listAccounts()).toEqual(previousAccounts);
    expect(state.encryptedVault).toBe(encryptedVault);
    expect(commits).toHaveLength(commitCount + 1);
    expect(keyringChanges).toHaveLength(eventCount + 1);
    expect(keyringChanges.at(-1)).toEqual({ type: "keyringChanged" });

    await keyring.renameMnemonicSource({ keySourceId, name: "Savings" });

    expect(commits).toHaveLength(commitCount + 1);
    expect(keyringChanges).toHaveLength(eventCount + 1);
    expect(createHarness({ state }).keyring.getKeySource(keySourceId)).toEqual(renamedSource);
  });

  it("keeps the previous source name when persistence rejects a rename", async () => {
    const { wallet, keyring, keyringChanges, state, setCommitFailure } = createHarness();
    const initialized = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(initialized.status === "initialized");
    const { keySourceId } = initialized;
    const previousSource = keyring.getKeySource(keySourceId);
    const eventCount = keyringChanges.length;
    const failure = new Error("Storage transaction failed");
    setCommitFailure(failure);

    await expect(keyring.renameMnemonicSource({ keySourceId, name: "Savings" })).rejects.toBe(failure);

    expect(keyring.getKeySource(keySourceId)).toEqual(previousSource);
    expect(state.keySources.get(keySourceId)).toEqual(previousSource);
    expect(keyringChanges).toHaveLength(eventCount);
  });

  it("preserves a source rename when an account is derived concurrently", async () => {
    const { wallet, accounts, keyring, state } = createHarness();
    const initialized = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(initialized.status === "initialized");
    const { keySourceId, hdKeyringId } = initialized;

    const [, derived] = await Promise.all([
      keyring.renameMnemonicSource({ keySourceId, name: "Savings" }),
      wallet.createHdAccount({ hdKeyringId }),
    ]);
    const derivedAccountId = derived.account.accountId;

    expect(keyring.getKeySource(keySourceId)).toMatchObject({ name: "Savings" });
    expect(keyring.getHdKeyring(hdKeyringId)?.nextDerivationIndex).toBe(2);
    expect(accounts.getAccount(derivedAccountId)?.origin).toEqual({ type: "hd", hdKeyringId, derivationIndex: 1 });
    const restarted = createHarness({ state });
    expect(restarted.keyring.getKeySource(keySourceId)).toEqual(keyring.getKeySource(keySourceId));
    expect(restarted.keyring.getHdKeyring(hdKeyringId)).toEqual(keyring.getHdKeyring(hdKeyringId));
    expect(restarted.accounts.getAccount(derivedAccountId)).toEqual(accounts.getAccount(derivedAccountId));
  });

  it("confirms mnemonic backup while locked without reading the secret", async () => {
    const { wallet, commits, keyring, keyringChanges } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
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
    const { wallet, state, accounts, keyring } = createHarness();
    const created = await wallet.createFromPrivateKey({
      password: "password",
      privateKey: PRIVATE_KEY,
      namespace: "eip155",
    });
    assert(created.status === "initialized");

    expect([...state.keySources.values()][0]).toMatchObject({
      type: "private-key",
      namespace: "eip155",
    });
    const account = accounts.getAccount(created.accountId);
    const source = keyring.getKeySource(created.keySourceId);
    await wallet.lock();
    await expect(wallet.unlock("password")).resolves.toBe(true);
    expect(accounts.getAccount(created.accountId)).toEqual(account);
    expect(keyring.getKeySource(created.keySourceId)).toEqual(source);
    expect(keyring.requireKeySourceSecret(created.keySourceId)).toEqual({
      keySourceId: created.keySourceId,
      type: "private-key",
      privateKey: PRIVATE_KEY,
    });
  });

  it("locks by clearing decoded secrets and cancelling a pending approval without committing persistence", async () => {
    const { accounts, approvals, wallet, commits, events, keyring } = createHarness();
    const created = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
    assert(created.status === "initialized");
    const selectableAccounts = [accounts.getAddress({ accountId: created.accountId, chainRef: "eip155:1" })] as const;
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
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
    await wallet.lock();

    const unlocking = wallet.unlock("password");
    const locking = wallet.lock();
    await Promise.all([unlocking, locking]);

    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
  });

  it("returns true without checking the password when already unlocked", async () => {
    const { wallet, events } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });

    await expect(wallet.unlock("incorrect-password")).resolves.toBe(true);

    expect(events).toEqual([{ type: "walletStatusChanged", status: "unlocked" }]);
  });

  it("requires the password again after expiry even before the lock timer runs", async () => {
    const { wallet, keyring } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });

    vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
    wallet.notifyUserActivity();
    expect(wallet.getStatus()).toBe("locked");
    expect(keyring.getSoftwareKeyStatus()).toBe("unlocked");

    await expect(wallet.unlock("incorrect-password")).resolves.toBe(false);
    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
  });

  it("does not let a queued expiry lock a newly unlocked session", async () => {
    const { wallet, events } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });

    const unlocking = wallet.unlock("password");
    vi.advanceTimersByTime(DEFAULT_AUTO_LOCK_DURATION_MS);
    await unlocking;
    await vi.advanceTimersByTimeAsync(0);

    expect(wallet.getStatus()).toBe("unlocked");
    expect(events.map((event) => event.status)).toEqual(["unlocked", "locked", "unlocked"]);
  });

  it("does not return a secret when the session expires during password verification", async () => {
    const { wallet } = createHarness();
    const initialized = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
    assert(initialized.status === "initialized");
    const { keySourceId } = initialized;
    const exporting = wallet.exportMnemonic({ keySourceId, password: "password" });
    await Promise.resolve();

    vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
    await expect(exporting).rejects.toMatchObject({ code: "wallet.locked" });
  });

  it("does not commit a password change that finishes preparation after expiry", async () => {
    const { wallet, commits } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
    const changing = wallet.changePassword({ currentPassword: "password", newPassword: "new-password" });
    await Promise.resolve();

    vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
    await expect(changing).rejects.toMatchObject({ code: "wallet.locked" });
    expect(commits).toHaveLength(1);
    await expect(wallet.unlock("password")).resolves.toBe(true);
  });

  it("finishes an in-flight commit successfully and then clears the expired session", async () => {
    const { wallet, holdNextCommit, keyring, state } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
    const commit = holdNextCommit();

    const importing = wallet.addMnemonic({
      mnemonic: SECONDARY_MNEMONIC,
      name: "Wallet 2",
      namespace: "eip155",
      backupStatus: "confirmed",
    });
    await commit.started;
    vi.setSystemTime(1_000 + DEFAULT_AUTO_LOCK_DURATION_MS);
    wallet.notifyUserActivity();
    expect(wallet.getStatus()).toBe("locked");
    commit.release();

    const added = await importing;
    assert(added.status === "added");
    expect(state.keySources.has(added.keySourceId)).toBe(true);
    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
    await expect(wallet.unlock("password")).resolves.toBe(true);
    expect(keyring.requireKeySourceSecret(added.keySourceId)).toMatchObject({ mnemonic: SECONDARY_MNEMONIC });
  });

  it("changes the password without renewing the session or publishing a status event", async () => {
    const { wallet, commits, events, keyring } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
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
          namespace: EIP155_NAMESPACE,
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
    const initialized = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: EIP155_NAMESPACE,
    });
    assert(initialized.status === "initialized");
    const { accountId } = initialized;
    const signing = createEip155AccountSigning({ accounts, keyring, wallet });
    const commit = holdNextCommit();

    const changing = change(wallet);
    await commit.started;
    const pendingSignature = signing.signDigest({ accountId, digest: new Uint8Array(32) });
    commit.release();

    const [signature] = await Promise.all([pendingSignature, changing]);
    expect(signature.bytes).toHaveLength(64);
    expect(wallet.getStatus()).toBe("unlocked");
  });

  it("keeps the private-key account intact when its mnemonic addition fails to commit", async () => {
    const { wallet, state, accounts, keyring, keyringChanges, setCommitFailure } = createHarness();
    const imported = await wallet.createFromPrivateKey({
      password: "password",
      privateKey: FIRST_PRIVATE_KEY,
      namespace: EIP155_NAMESPACE,
    });
    assert(imported.status === "initialized");
    const committedRecord = state.encryptedVault;
    const originalAccount = accounts.getAccount(imported.accountId);
    const eventCount = keyringChanges.length;
    const input = {
      mnemonic: PRIMARY_MNEMONIC,
      name: "Recovered",
      namespace: EIP155_NAMESPACE,
      backupStatus: "confirmed",
      accountId: imported.accountId,
    } as const;
    const failure = new Error("commit failed");
    setCommitFailure(failure);

    await expect(wallet.addMnemonicAndMoveAccount(input)).rejects.toBe(failure);
    expect(state.encryptedVault).toBe(committedRecord);
    expect(accounts.getAccount(imported.accountId)).toEqual(originalAccount);
    expect(keyring.listKeySources().map((source) => source.keySourceId)).toEqual([imported.keySourceId]);
    expect(keyring.listHdKeyrings()).toEqual([]);
    expect(keyring.requireKeySourceSecret(imported.keySourceId)).toMatchObject({ privateKey: FIRST_PRIVATE_KEY });
    expect(keyringChanges).toHaveLength(eventCount);

    setCommitFailure(null);
    await expect(wallet.addMnemonicAndMoveAccount(input)).resolves.toMatchObject({
      keySourceId: expect.any(String),
      hdKeyringId: expect.any(String),
      accountId: imported.accountId,
    });
  });

  it("keeps the active deadline and auto-lock duration unchanged when persistence fails", async () => {
    const failure = new Error("commit failed");
    const { autoLock, wallet, setCommitFailure } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
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
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });
    vi.setSystemTime(91_000);

    await wallet.setAutoLockDuration(60_000);

    expect(wallet.getStatus()).toBe("locked");
    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
  });

  it("rejects an unsupported auto-lock duration before persistence", async () => {
    const { wallet, commits } = createHarness();

    await expect(wallet.setAutoLockDuration(30_000)).rejects.toMatchObject({
      code: "wallet.auto_lock_duration_out_of_range",
      details: { durationMs: 30_000 },
    });

    expect(commits).toHaveLength(0);
  });

  it("persists only a non-default auto-lock duration", async () => {
    const { autoLock, wallet, commits, state } = createHarness();

    await wallet.setAutoLockDuration(120_000);

    expect(commits.at(-1)).toEqual([
      {
        persistenceType: "setting",
        operation: "put",
        value: { key: AUTO_LOCK_SETTING_KEY, durationMs: 120_000 },
      },
    ]);
    expect(state.autoLock).toEqual({ key: AUTO_LOCK_SETTING_KEY, durationMs: 120_000 });
    expect(autoLock.getDuration()).toBe(120_000);

    const commitCount = commits.length;
    await wallet.setAutoLockDuration(120_000);
    expect(commits).toHaveLength(commitCount);

    await wallet.setAutoLockDuration(DEFAULT_AUTO_LOCK_DURATION_MS);
    expect(commits.at(-1)).toEqual([{ persistenceType: "setting", operation: "remove", key: AUTO_LOCK_SETTING_KEY }]);
    expect(state.autoLock).toBeNull();
    expect(autoLock.getDuration()).toBe(DEFAULT_AUTO_LOCK_DURATION_MS);
  });

  it("locks through the mutation queue when the auto-lock timer expires", async () => {
    const state = emptyState();
    state.autoLock = { key: AUTO_LOCK_SETTING_KEY, durationMs: 60_000 };
    const { wallet, events, keyring } = createHarness({ state });
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      name: "Wallet 1",
      namespace: "eip155",
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(keyring.getSoftwareKeyStatus()).toBe("locked");
    expect(events.at(-1)).toEqual({ type: "walletStatusChanged", status: "locked" });
  });
});
