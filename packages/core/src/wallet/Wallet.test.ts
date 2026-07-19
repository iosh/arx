import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts } from "../accounts/Accounts.js";
import { type AccountId, formatAccountId, parseAccountId } from "../accounts/accountId.js";
import type { AccountsNamespaceAdapter } from "../accounts/namespaceAdapter.js";
import type { AccountRecord, AccountSelectionRecord } from "../accounts/persistence.js";
import type { AccountsChanged } from "../accounts/types.js";
import { Keyring, type KeyringChanged } from "../keyring/Keyring.js";
import type { KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { HdKeyringRecord, KeySourceRecord } from "../keyring/persistence.js";
import { eip155AccountsAdapter } from "../namespaces/eip155/accounts.js";
import type { PermissionRecord } from "../permissions/persistence.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { createUnlockedVault } from "../vault/crypto.js";
import { VaultPasswordTooShortError } from "../vault/errors.js";
import type { EncryptedVaultRecord } from "../vault/persistence.js";
import { createWallet, type WalletChanged, type WalletContext } from "./Wallet.js";

const PRIMARY_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SECONDARY_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const EIP155_NAMESPACE = "eip155";
const SECOND_NAMESPACE = "test";

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

const accountIdFor = (sourceId: string, index: number, namespace = EIP155_NAMESPACE): AccountId => {
  const sourcePayload = bytesToHex(keccak_256(new TextEncoder().encode(sourceId))).slice(0, 32);
  const payload = `${sourcePayload}${index.toString(16).padStart(8, "0")}`;
  return formatAccountId({ namespace, payload });
};

const createAdapter = (namespace = EIP155_NAMESPACE) => {
  const deriveHdAccountId = vi.fn(({ seed, derivationIndex }: { seed: Uint8Array; derivationIndex: number }) =>
    accountIdFor(bytesToHex(seed.slice(0, 16)), derivationIndex, namespace),
  );
  const accountIdFromPrivateKey = vi.fn((privateKey: string) => accountIdFor(privateKey, 0, namespace));
  const adapter: KeyringNamespaceAdapter = {
    namespace,
    deriveHdAccountId,
    accountIdFromPrivateKey,
  };
  return { adapter, deriveHdAccountId, accountIdFromPrivateKey };
};

const secondAccountsAdapter: AccountsNamespaceAdapter = {
  namespace: SECOND_NAMESPACE,
  accountIdFromAddress: ({ address }) => formatAccountId({ namespace: SECOND_NAMESPACE, payload: address }),
  addressForAccountId: ({ accountId }) => {
    const address = parseAccountId(accountId).payload;
    return { canonicalAddress: address, displayAddress: address };
  },
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
  const { adapter, deriveHdAccountId, accountIdFromPrivateKey } = createAdapter();
  const { adapter: secondKeyringAdapter } = createAdapter(SECOND_NAMESPACE);
  const keyring = new Keyring({
    keySources: [...state.keySources.values()],
    hdKeyrings: [...state.keyrings.values()],
  });
  const changes: WalletChanged[] = [];
  const keyringChanges: KeyringChanged[] = [];
  const accountChanges: AccountsChanged[] = [];
  const mutations = createCoreMutationQueue({ commit });
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
  const wallet = createWallet({
    readers,
    mutations,
    keyring,
    accounts,
    adapters: { [adapter.namespace]: adapter, [secondKeyringAdapter.namespace]: secondKeyringAdapter },
    bootstrap: {
      encryptedVault: state.encryptedVault,
      autoLockDurationMs: state.autoLockDurationMs ?? 60_000,
    },
    publishChanged: (change) => changes.push(change),
    publishKeyringChanged: () => keyringChanges.push({ type: "keyringChanged" }),
    publishAccountsChanged,
  });
  return {
    wallet,
    accounts,
    state,
    commits,
    commit,
    changes,
    keyringChanges,
    accountChanges,
    keyring,
    deriveHdAccountId,
    accountIdFromPrivateKey,
    setCommitFailure: (failure: Error | null) => {
      commitFailure = failure;
    },
  };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Wallet", () => {
  it("initializes a mnemonic wallet with one five-record commit", async () => {
    const { wallet, accounts, accountChanges, commits, keyring, keyringChanges, state } = createHarness();

    const accountId = await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: `  ${PRIMARY_MNEMONIC.replaceAll(" ", "   ")}  `,
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
    expect(accounts.getAccountRecord(accountId)).not.toBeNull();
    expect(keyring.getSecrets()?.keySources).toHaveLength(1);
    expect([...state.keySources.values()][0]).toMatchObject({
      type: "bip39",
      backupStatus: "pending",
      createdAt: expect.any(Number),
    });
    expect([...state.keyrings.values()][0]).toMatchObject({ createdAt: expect.any(Number) });
    expect(keyringChanges).toEqual([{ type: "keyringChanged" }]);
    expect(accountChanges).toEqual([
      {
        type: "accountsChanged",
        accountIds: [accountId],
        namespaces: ["eip155"],
      },
    ]);
  });

  it("rejects an invalid mnemonic before commit or activation", async () => {
    const { wallet, commits, keyring } = createHarness();

    await expect(
      wallet.initializeWithNewMnemonic({
        password: "password",
        mnemonic: "not a bip39 mnemonic",
        namespace: "eip155",
      }),
    ).rejects.toMatchObject({ code: "keyring.invalid_mnemonic" });

    expect(commits).toHaveLength(0);
    expect(keyring.listKeySources()).toEqual([]);
    expect(keyring.getSecrets()).toBeNull();
  });

  it("rejects a duplicate normalized mnemonic source without committing", async () => {
    const { wallet, commits, keyring } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const existingSource = keyring.listKeySources()[0];
    if (!existingSource) throw new Error("missing test source");
    const commitCount = commits.length;

    await expect(
      wallet.keySources.importMnemonic({
        mnemonic: `  ${PRIMARY_MNEMONIC.replaceAll(" ", "   ")}  `,
        namespace: "eip155",
      }),
    ).rejects.toMatchObject({
      code: "keyring.source_duplicate",
      details: { existingKeySourceId: existingSource.keySourceId },
    });

    expect(commits).toHaveLength(commitCount);
    expect(keyring.listKeySources()).toHaveLength(1);
  });

  it("rejects a short initial password before commit or activation", async () => {
    const { wallet, commits, keyring } = createHarness();

    await expect(
      wallet.initializeWithNewMnemonic({
        password: "short",
        mnemonic: PRIMARY_MNEMONIC,
        namespace: "eip155",
      }),
    ).rejects.toMatchObject({ code: VaultPasswordTooShortError.code });

    expect(commits).toHaveLength(0);
    expect(wallet.getStatus()).toBe("uninitialized");
    expect(keyring.getSecrets()).toBeNull();
  });

  it("does not activate wallet state when the initial commit fails", async () => {
    const failure = new Error("commit failed");
    const { wallet, accounts, keyring } = createHarness({ rejectCommit: failure });

    await expect(
      wallet.initializeWithNewMnemonic({
        password: "password",
        mnemonic: PRIMARY_MNEMONIC,
        namespace: "eip155",
      }),
    ).rejects.toBe(failure);

    expect(wallet.getStatus()).toBe("uninitialized");
    expect(wallet.getAutoLock().deadline).toBeNull();
    expect(keyring.listKeySources()).toEqual([]);
    expect(keyring.listHdKeyrings()).toEqual([]);
    expect(keyring.getSecrets()).toBeNull();
    expect(accounts.listAccountRecords()).toEqual([]);
  });

  it("commits a derived account and the advanced cursor together", async () => {
    const { wallet, accounts, commits, state } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const keyring = [...state.keyrings.values()][0];
    if (!keyring) throw new Error("missing test keyring");

    await wallet.keyrings.deriveAccount(keyring.hdKeyringId);

    expect(commits[1]?.map((change) => change.persistenceType)).toEqual(["account", "hdKeyring"]);
    expect(commits[1]?.[1]).toMatchObject({
      operation: "put",
      value: { hdKeyringId: keyring.hdKeyringId, nextDerivationIndex: 2 },
    });
    expect(accounts.listAccountRecords()).toHaveLength(2);
  });

  it("confirms mnemonic backup while locked without reading the secret", async () => {
    const { wallet, commits, keyring, keyringChanges } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const source = keyring.listKeySources()[0];
    if (source?.type !== "bip39") throw new Error("missing test source");
    await wallet.lock();

    await wallet.keySources.confirmBackup({ keySourceId: source.keySourceId });

    expect(wallet.getStatus()).toBe("locked");
    expect(keyring.getKeySource(source.keySourceId)).toMatchObject({ backupStatus: "confirmed" });
    expect(commits.at(-1)?.map((change) => change.persistenceType)).toEqual(["keySource"]);
    expect(keyringChanges.at(-1)).toEqual({ type: "keyringChanged" });

    const commitCount = commits.length;
    const eventCount = keyringChanges.length;
    await wallet.keySources.confirmBackup({ keySourceId: source.keySourceId });

    expect(commits).toHaveLength(commitCount);
    expect(keyringChanges).toHaveLength(eventCount);
  });

  it("removes a non-final HD keyring while locked", async () => {
    const { wallet, accounts, keyring, state } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const source = keyring.listKeySources()[0];
    if (!source) throw new Error("missing test source");

    const removable: HdKeyringRecord = {
      hdKeyringId: "removable-hd-keyring",
      keySourceId: source.keySourceId,
      namespace: SECOND_NAMESPACE,
      nextDerivationIndex: 1,
      createdAt: Date.now(),
    };
    const keyringUpdate = keyring.prepareAddHdKeyring(removable);
    const accountsUpdate = accounts.prepareAddAccount({
      accountId: accountIdFor(removable.hdKeyringId, 0, SECOND_NAMESPACE),
      origin: { type: "hd", hdKeyringId: removable.hdKeyringId, derivationIndex: 0 },
      createdAt: removable.createdAt,
    });
    applyChanges(state, [...keyringUpdate.persistenceChanges, ...accountsUpdate.persistenceChanges]);
    keyring.applyCommittedUpdate(keyringUpdate);
    accounts.applyCommittedUpdate(accountsUpdate);

    await wallet.lock();

    await wallet.keyrings.remove(removable.hdKeyringId);

    expect(wallet.getStatus()).toBe("locked");
    expect(state.keyrings.has(removable.hdKeyringId)).toBe(false);
    expect(keyring.getHdKeyring(removable.hdKeyringId)).toBeNull();
  });

  it("stores private keys with an explicit namespace without deriving accounts on unlock", async () => {
    const { wallet, state, keyring, deriveHdAccountId, accountIdFromPrivateKey } = createHarness();
    await wallet.initializeFromPrivateKey({
      password: "password",
      privateKey: "private-key",
      namespace: "eip155",
    });

    expect([...state.keySources.values()][0]).toMatchObject({
      type: "private-key",
      namespace: "eip155",
      createdAt: expect.any(Number),
    });
    const source = [...state.keySources.values()][0];
    if (!source) throw new Error("missing test source");

    deriveHdAccountId.mockClear();
    accountIdFromPrivateKey.mockClear();
    await wallet.lock();
    await wallet.unlock("password");
    expect(keyring.getSecrets()?.keySources).toEqual([
      expect.objectContaining({ keySourceId: source.keySourceId, type: "private-key" }),
    ]);
    expect(deriveHdAccountId).not.toHaveBeenCalled();
    expect(accountIdFromPrivateKey).not.toHaveBeenCalled();
  });

  it("removes a source and its dependent records in one commit", async () => {
    const { wallet, accounts, commits, keyring, state } = createHarness();
    const firstAccountId = await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const firstSource = [...state.keySources.values()][0];
    if (!firstSource) throw new Error("missing test source");
    const secondAccountId = await wallet.keySources.importMnemonic({
      mnemonic: SECONDARY_MNEMONIC,
      namespace: "eip155",
    });
    const permission: PermissionRecord = {
      origin: "https://example.test",
      namespace: "eip155",
      chainScopes: { "eip155:1": [firstAccountId, secondAccountId] },
    };
    state.permissions.set(permissionKey(permission), permission);

    await wallet.keySources.remove(firstSource.keySourceId);

    expect(commits.at(-1)?.map((change) => `${change.persistenceType}.${change.operation}`)).toEqual([
      "encryptedVault.put",
      "keySource.remove",
      "hdKeyring.remove",
      "account.remove",
      "accountSelection.put",
      "permission.put",
    ]);
    expect(state.keySources.has(firstSource.keySourceId)).toBe(false);
    expect(state.accounts.has(firstAccountId)).toBe(false);
    expect(accounts.getAccountRecord(firstAccountId)).toBeNull();
    expect(accounts.getSelectedAccountId("eip155")).toBe(secondAccountId);
    expect(keyring.getSecrets()?.keySources.some((source) => source.keySourceId === firstSource.keySourceId)).toBe(
      false,
    );
    expect([...state.permissions.values()][0]?.chainScopes["eip155:1"]).toEqual([secondAccountId]);
  });

  it("locks by clearing decoded keyring secrets without committing persistence", async () => {
    const { wallet, commits, keyring } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
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
      mnemonic: PRIMARY_MNEMONIC,
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
    const { wallet, state, keyring, keyringChanges, setCommitFailure } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const committedRecord = state.encryptedVault;
    const keySourceIds = keyring.listKeySources().map((source) => source.keySourceId);
    const secretIds = keyring.getSecrets()?.keySources.map((source) => source.keySourceId);
    const eventCount = keyringChanges.length;
    const failure = new Error("commit failed");
    setCommitFailure(failure);

    await expect(wallet.keySources.importMnemonic({ mnemonic: SECONDARY_MNEMONIC, namespace: "eip155" })).rejects.toBe(
      failure,
    );
    expect(state.encryptedVault).toBe(committedRecord);
    expect(keyring.listKeySources().map((source) => source.keySourceId)).toEqual(keySourceIds);
    expect(keyring.getSecrets()?.keySources.map((source) => source.keySourceId)).toEqual(secretIds);
    expect(keyringChanges).toHaveLength(eventCount);

    setCommitFailure(null);
    await expect(
      wallet.keySources.importMnemonic({ mnemonic: SECONDARY_MNEMONIC, namespace: "eip155" }),
    ).resolves.toMatch(/^eip155:/);
  });

  it("updates the auto-lock timer only after the setting commit", async () => {
    const failure = new Error("commit failed");
    const { wallet } = createHarness({ rejectCommit: failure });

    await expect(wallet.setAutoLockDuration(120_000)).rejects.toBe(failure);

    expect(wallet.getAutoLock().durationMs).toBe(60_000);
  });

  it("deletes identity records without deleting transaction history", async () => {
    const { wallet, accounts, state } = createHarness();
    await wallet.initializeWithNewMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });

    await wallet.deleteIdentity();

    expect(wallet.getStatus()).toBe("uninitialized");
    expect(state.encryptedVault).toBeNull();
    expect(state.keySources.size).toBe(0);
    expect(state.keyrings.size).toBe(0);
    expect(state.accounts.size).toBe(0);
    expect(state.selections.size).toBe(0);
    expect(accounts.listAccountRecords()).toEqual([]);
  });
});
