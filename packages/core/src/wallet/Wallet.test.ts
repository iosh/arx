import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AccountId, getAccountIdNamespace } from "../accounts/accountId.js";
import type { AccountRecord, AccountSelectionRecord } from "../accounts/persistence.js";
import { Keyring } from "../keyring/Keyring.js";
import type { KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { HdKeyringRecord, KeySourceRecord } from "../keyring/persistence.js";
import type { Bip39KeySourceSecret, PrivateKeySourceSecret } from "../keyring/secrets.js";
import type { PermissionRecord } from "../permissions/persistence.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { createUnlockedVault } from "../vault/crypto.js";
import { VaultPasswordTooShortError } from "../vault/errors.js";
import type { EncryptedVaultRecord } from "../vault/persistence.js";
import { createWallet, type WalletChanged, type WalletContext } from "./Wallet.js";

type State = {
  encryptedVault: EncryptedVaultRecord | null;
  keySources: Map<string, KeySourceRecord>;
  keyrings: Map<string, HdKeyringRecord>;
  accounts: Map<AccountId, AccountRecord>;
  selections: Map<string, AccountSelectionRecord>;
  permissions: Map<string, PermissionRecord>;
  autoLockDurationMs: number | null;
};

const emptyState = (): State => ({
  encryptedVault: null,
  keySources: new Map(),
  keyrings: new Map(),
  accounts: new Map(),
  selections: new Map(),
  permissions: new Map(),
  autoLockDurationMs: null,
});

const accountIdFor = (sourceId: string, index: number): AccountId => {
  const payload = `${sourceId.replaceAll("-", "")}${index.toString(16).padStart(8, "0")}`.slice(0, 40).padEnd(40, "0");
  return `eip155:${payload}`;
};

const createAdapter = () => {
  const deriveAccount = vi.fn(
    ({ source, derivationIndex }: { source: Bip39KeySourceSecret; derivationIndex: number }) => ({
      accountId: accountIdFor(source.keySourceId, derivationIndex),
    }),
  );
  const importPrivateKey = vi.fn((source: PrivateKeySourceSecret) => ({
    accountId: accountIdFor(source.keySourceId, 0),
  }));
  const adapter: KeyringNamespaceAdapter = {
    namespace: "eip155",
    defaultDerivationProfileId: "default",
    deriveAccount,
    importPrivateKey,
  };
  return { adapter, deriveAccount, importPrivateKey };
};

const permissionKey = (record: Pick<PermissionRecord, "origin" | "namespace">): string =>
  `${record.origin}\u0000${record.namespace}`;

const applyChanges = (state: State, changes: readonly PersistenceChange[]): void => {
  for (const change of changes) {
    switch (change.persistenceType) {
      case "encryptedVault":
        state.encryptedVault = change.operation === "put" ? change.value : null;
        break;
      case "setting":
        if (change.operation === "put") state.autoLockDurationMs = change.value.value.durationMs;
        break;
      case "keySource":
        if (change.operation === "put") state.keySources.set(change.value.keySourceId, change.value);
        else state.keySources.delete(change.key);
        break;
      case "hdKeyring":
        if (change.operation === "put") state.keyrings.set(change.value.keyringId, change.value);
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
        if (change.operation === "put") state.permissions.set(permissionKey(change.value), change.value);
        else state.permissions.delete(permissionKey(change.key));
        break;
    }
  }
};

const createHarness = (params: { state?: State; rejectCommit?: Error } = {}) => {
  const state = params.state ?? emptyState();
  const commits: readonly PersistenceChange[][] = [];
  let commitFailure = params.rejectCommit ?? null;
  const commit = vi.fn(async (changes: readonly PersistenceChange[]) => {
    if (commitFailure) throw commitFailure;
    (commits as PersistenceChange[][]).push([...changes]);
    applyChanges(state, changes);
  });
  const readers: WalletContext["readers"] = {
    encryptedVault: { get: vi.fn(async () => state.encryptedVault) },
    keySources: {
      get: vi.fn(async (keySourceId) => state.keySources.get(keySourceId) ?? null),
      listAll: vi.fn(async () => [...state.keySources.values()]),
    },
    hdKeyrings: {
      get: vi.fn(async (keyringId) => state.keyrings.get(keyringId) ?? null),
      listByKeySourceIds: vi.fn(async (keySourceIds) => {
        const ids = new Set(keySourceIds);
        return [...state.keyrings.values()].filter((keyring) => ids.has(keyring.keySourceId));
      }),
      listByNamespace: vi.fn(async (namespace) =>
        [...state.keyrings.values()].filter((keyring) => keyring.namespace === namespace),
      ),
      listAll: vi.fn(async () => [...state.keyrings.values()]),
    },
    accounts: {
      get: vi.fn(async (accountId) => state.accounts.get(accountId) ?? null),
      getMany: vi.fn(async (accountIds) =>
        accountIds.flatMap((accountId) => {
          const account = state.accounts.get(accountId);
          return account ? [account] : [];
        }),
      ),
      getNamespaceAccounts: vi.fn(async (namespace) => {
        const accounts = [...state.accounts.values()].filter(
          (account) => getAccountIdNamespace(account.accountId) === namespace,
        );
        if (accounts.length === 0) return null;
        const selection = state.selections.get(namespace);
        if (!selection) throw new Error("missing test selection");
        return { accounts, selection };
      }),
      listByKeyringIds: vi.fn(async (keyringIds) => {
        const ids = new Set(keyringIds);
        return [...state.accounts.values()].filter(
          (account) => account.origin.type === "hd" && ids.has(account.origin.keyringId),
        );
      }),
      listByPrivateKeySourceIds: vi.fn(async (keySourceIds) => {
        const ids = new Set(keySourceIds);
        return [...state.accounts.values()].filter(
          (account) => account.origin.type === "private-key" && ids.has(account.origin.keySourceId),
        );
      }),
      listIds: vi.fn(async () => [...state.accounts.keys()]),
    },
    permissions: {
      get: vi.fn(async (key) => state.permissions.get(permissionKey(key)) ?? null),
      listByOrigin: vi.fn(async (origin) =>
        [...state.permissions.values()].filter((permission) => permission.origin === origin),
      ),
      listReferencingAccountIds: vi.fn(async (accountIds) => {
        const ids = new Set(accountIds);
        return [...state.permissions.values()].filter((permission) =>
          Object.values(permission.chainScopes).some((scope) => scope.some((accountId) => ids.has(accountId))),
        );
      }),
      listReferencingChainRef: vi.fn(async (chainRef) =>
        [...state.permissions.values()].filter((permission) => chainRef in permission.chainScopes),
      ),
      listAll: vi.fn(async () => [...state.permissions.values()]),
    },
  };
  const { adapter, deriveAccount, importPrivateKey } = createAdapter();
  const keyring = new Keyring();
  const changes: WalletChanged[] = [];
  const wallet = createWallet({
    readers,
    mutations: createCoreMutationQueue({ commit }),
    keyring,
    adapters: new Map([[adapter.namespace, adapter]]),
    bootstrap: {
      encryptedVault: state.encryptedVault,
      autoLockDurationMs: state.autoLockDurationMs ?? 60_000,
    },
    publishChanged: (change) => changes.push(change),
  });
  return {
    wallet,
    state,
    commits,
    commit,
    changes,
    keyring,
    deriveAccount,
    importPrivateKey,
    setCommitFailure: (failure: Error | null) => {
      commitFailure = failure;
    },
  };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Wallet", () => {
  it("initializes a mnemonic wallet with one five-record commit", async () => {
    const { wallet, commits, keyring, state } = createHarness();

    const accountId = await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: "  test   mnemonic ",
      namespace: "eip155",
    });

    expect(commits).toHaveLength(1);
    expect(commits[0]?.map((change) => `${change.persistenceType}.${change.operation}`)).toEqual([
      "encryptedVault.put",
      "keySource.put",
      "hdKeyring.put",
      "account.put",
      "accountSelection.put",
    ]);
    expect(wallet.getStatus()).toBe("unlocked");
    expect(state.accounts.has(accountId)).toBe(true);
    expect(keyring.getSecrets()?.keySources).toHaveLength(1);
    expect([...state.keySources.values()][0]).toMatchObject({
      type: "bip39",
      backupStatus: "pending",
      createAt: expect.any(Number),
    });
    expect([...state.keyrings.values()][0]).toMatchObject({ createAt: expect.any(Number) });
  });

  it("rejects a short initial password before commit or activation", async () => {
    const { wallet, commits, keyring } = createHarness();

    await expect(
      wallet.initializeWithNewMnemonic({
        password: "short",
        mnemonic: "test mnemonic",
        namespace: "eip155",
      }),
    ).rejects.toMatchObject({ code: VaultPasswordTooShortError.code });

    expect(commits).toHaveLength(0);
    expect(wallet.getStatus()).toBe("uninitialized");
    expect(keyring.getSecrets()).toBeNull();
  });

  it("does not activate wallet state when the initial commit fails", async () => {
    const failure = new Error("commit failed");
    const { wallet, keyring } = createHarness({ rejectCommit: failure });

    await expect(
      wallet.initializeWithNewMnemonic({
        password: "password",
        mnemonic: "test mnemonic",
        namespace: "eip155",
      }),
    ).rejects.toBe(failure);

    expect(wallet.getStatus()).toBe("uninitialized");
    expect(wallet.getAutoLock().deadline).toBeNull();
    expect(keyring.getSecrets()).toBeNull();
  });

  it("commits a derived account and the advanced cursor together", async () => {
    const { wallet, commits, state } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: "test mnemonic",
      namespace: "eip155",
    });
    const keyring = [...state.keyrings.values()][0];
    if (!keyring) throw new Error("missing test keyring");

    await wallet.keyrings.deriveAccount(keyring.keyringId);

    expect(commits[1]?.map((change) => change.persistenceType)).toEqual(["account", "hdKeyring"]);
    expect(commits[1]?.[1]).toMatchObject({
      operation: "put",
      value: { keyringId: keyring.keyringId, nextDerivationIndex: 2 },
    });
  });

  it("rejects hiding the selected account", async () => {
    const { wallet } = createHarness();
    const accountId = await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: "test mnemonic",
      namespace: "eip155",
    });

    await expect(wallet.accounts.setHidden({ accountId, hidden: true })).rejects.toMatchObject({
      code: "account.operation_rejected",
    });
  });

  it("stores private keys with an explicit namespace and does not allow hiding them", async () => {
    const { wallet, state, keyring, deriveAccount, importPrivateKey } = createHarness();
    const accountId = await wallet.initializeFromPrivateKey({
      password: "password",
      privateKey: "private-key",
      namespace: "eip155",
    });

    expect([...state.keySources.values()][0]).toMatchObject({
      type: "private-key",
      namespace: "eip155",
      createAt: expect.any(Number),
    });
    const source = [...state.keySources.values()][0];
    if (!source) throw new Error("missing test source");
    await expect(wallet.accounts.setHidden({ accountId, hidden: true })).rejects.toMatchObject({
      details: { reason: "only_hd_accounts_can_be_hidden" },
    });

    deriveAccount.mockClear();
    importPrivateKey.mockClear();
    await wallet.lock();
    await wallet.unlock("password");
    expect(keyring.getSecrets()?.keySources).toEqual([
      expect.objectContaining({ keySourceId: source.keySourceId, type: "private-key" }),
    ]);
    expect(deriveAccount).not.toHaveBeenCalled();
    expect(importPrivateKey).not.toHaveBeenCalled();
  });

  it("removes a source and its dependent records in one commit", async () => {
    const { wallet, commits, keyring, state } = createHarness();
    const firstAccountId = await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: "first mnemonic",
      namespace: "eip155",
    });
    const firstSource = [...state.keySources.values()][0];
    if (!firstSource) throw new Error("missing test source");
    const secondAccountId = await wallet.keySources.importMnemonic({
      mnemonic: "second mnemonic",
      namespace: "eip155",
    });
    const permission: PermissionRecord = {
      origin: "https://example.test",
      namespace: "eip155",
      chainScopes: { "eip155:1": [firstAccountId] },
    };
    state.permissions.set(permissionKey(permission), permission);
    await wallet.accounts.select(secondAccountId);

    await wallet.keySources.remove(firstSource.keySourceId);

    expect(commits.at(-1)?.map((change) => `${change.persistenceType}.${change.operation}`)).toEqual([
      "encryptedVault.put",
      "keySource.remove",
      "hdKeyring.remove",
      "account.remove",
      "permission.put",
    ]);
    expect(state.keySources.has(firstSource.keySourceId)).toBe(false);
    expect(state.accounts.has(firstAccountId)).toBe(false);
    expect(keyring.getSecrets()?.keySources.some((source) => source.keySourceId === firstSource.keySourceId)).toBe(
      false,
    );
    expect([...state.permissions.values()][0]?.chainScopes["eip155:1"]).toEqual([]);
  });

  it("locks by clearing decoded keyring secrets without committing persistence", async () => {
    const { wallet, commits, keyring } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: "test mnemonic",
      namespace: "eip155",
    });
    const commitCount = commits.length;

    await wallet.lock();

    expect(wallet.getStatus()).toBe("locked");
    expect(wallet.getAutoLock().deadline).toBeNull();
    expect(commits).toHaveLength(commitCount);
    expect(keyring.getSecrets()).toBeNull();
  });

  it("serializes a lock requested while unlock is in progress", async () => {
    const { wallet } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: "test mnemonic",
      namespace: "eip155",
    });
    await wallet.lock();

    const unlocking = wallet.unlock("password");
    const locking = wallet.lock();
    await Promise.all([unlocking, locking]);

    expect(wallet.getStatus()).toBe("locked");
    expect(wallet.getAutoLock().deadline).toBeNull();
  });

  it("does not activate Vault or Keyring state when decrypted secrets cannot be decoded", async () => {
    const state = emptyState();
    const unlocked = await createUnlockedVault({
      password: "password",
      plaintext: new TextEncoder().encode("not keyring secrets"),
    });
    state.encryptedVault = unlocked.record;
    const { wallet, keyring } = createHarness({ state });

    await expect(wallet.unlock("password")).rejects.toMatchObject({
      code: "wallet.unlock_failed",
    });
    expect(wallet.getStatus()).toBe("locked");
    expect(wallet.getAutoLock().deadline).toBeNull();
    expect(keyring.getSecrets()).toBeNull();
  });

  it("does not activate a secret update when its commit fails", async () => {
    const { wallet, state, setCommitFailure } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: "first mnemonic",
      namespace: "eip155",
    });
    const committedRecord = state.encryptedVault;
    const failure = new Error("commit failed");
    setCommitFailure(failure);

    await expect(wallet.keySources.importMnemonic({ mnemonic: "second mnemonic", namespace: "eip155" })).rejects.toBe(
      failure,
    );
    expect(state.encryptedVault).toBe(committedRecord);

    setCommitFailure(null);
    await expect(
      wallet.keySources.importMnemonic({ mnemonic: "second mnemonic", namespace: "eip155" }),
    ).resolves.toMatch(/^eip155:/);
  });

  it("updates the auto-lock timer only after the setting commit", async () => {
    const failure = new Error("commit failed");
    const { wallet } = createHarness({ rejectCommit: failure });

    await expect(wallet.setAutoLockDuration(120_000)).rejects.toBe(failure);

    expect(wallet.getAutoLock().durationMs).toBe(60_000);
  });

  it("deletes identity records without deleting transaction history", async () => {
    const { wallet, state } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: "test mnemonic",
      namespace: "eip155",
    });

    await wallet.deleteIdentity();

    expect(wallet.getStatus()).toBe("uninitialized");
    expect(state.encryptedVault).toBeNull();
    expect(state.keySources.size).toBe(0);
    expect(state.keyrings.size).toBe(0);
    expect(state.accounts.size).toBe(0);
    expect(state.selections.size).toBe(0);
  });
});
