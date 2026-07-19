import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Accounts } from "../accounts/Accounts.js";
import { type AccountId, formatAccountId, parseAccountId } from "../accounts/accountId.js";
import type { AccountsNamespaceAdapter } from "../accounts/namespaceAdapter.js";
import type { AccountRecord, AccountSelectionRecord } from "../accounts/persistence.js";
import type { AccountsChanged } from "../accounts/types.js";
import { Keyring } from "../keyring/Keyring.js";
import type { KeyringNamespaceAdapter } from "../keyring/namespaceAdapter.js";
import type { HdKeyringRecord, KeySourceRecord } from "../keyring/persistence.js";
import type { KeyringChanged } from "../keyring/types.js";
import { eip155AccountsAdapter } from "../namespaces/eip155/accounts.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { systemTime } from "../runtime/time.js";
import { AUTO_LOCK_SETTING_KEY, type AutoLockSetting } from "../settings/persistence.js";
import { createUnlockedVault } from "../vault/crypto.js";
import { VaultPasswordTooShortError } from "../vault/errors.js";
import type { EncryptedVaultRecord } from "../vault/persistence.js";
import { DEFAULT_AUTO_LOCK_DURATION_MS } from "./AutoLockController.js";
import { createWallet, type WalletStatusChanged } from "./Wallet.js";

const PRIMARY_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SECONDARY_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const TERTIARY_MNEMONIC = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
const EIP155_NAMESPACE = "eip155";
const SECOND_NAMESPACE = "test";

type State = {
  encryptedVault: EncryptedVaultRecord | null;
  keySources: Map<string, KeySourceRecord>;
  keyrings: Map<string, HdKeyringRecord>;
  accounts: Map<AccountId, AccountRecord>;
  selections: Map<string, AccountSelectionRecord>;
  autoLock: AutoLockSetting | null;
};

const emptyState = (): State => ({
  encryptedVault: null,
  keySources: new Map(),
  keyrings: new Map(),
  accounts: new Map(),
  selections: new Map(),
  autoLock: null,
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
  const { adapter, deriveHdAccountId, accountIdFromPrivateKey } = createAdapter();
  const { adapter: secondKeyringAdapter } = createAdapter(SECOND_NAMESPACE);
  const keyring = new Keyring({
    keySources: [...state.keySources.values()],
    hdKeyrings: [...state.keyrings.values()],
  });
  const events: WalletStatusChanged[] = [];
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
    mutations,
    keyring,
    accounts,
    adapters: { [adapter.namespace]: adapter, [secondKeyringAdapter.namespace]: secondKeyringAdapter },
    time: systemTime,
    vaultBootstrap: { encryptedVault: state.encryptedVault },
    walletBootstrap: {
      autoLockDurationMs: state.autoLock?.durationMs ?? DEFAULT_AUTO_LOCK_DURATION_MS,
    },
    publishStatusChanged: (event) => events.push(event),
    publishKeyringChanged: () => keyringChanges.push({ type: "keyringChanged" }),
    publishAccountsChanged,
  });
  return {
    wallet,
    accounts,
    state,
    commits,
    commit,
    events,
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
});
afterEach(() => vi.useRealTimers());

describe("Wallet", () => {
  it("creates a mnemonic wallet with one five-record commit", async () => {
    const { wallet, accounts, accountChanges, commits, events, keyring, keyringChanges, state } = createHarness();

    const created = await wallet.createFromMnemonic({
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
    expect(wallet.getAutoLockDuration()).toBe(DEFAULT_AUTO_LOCK_DURATION_MS);
    expect(state.autoLock).toBeNull();
    expect(state.accounts.has(created.accountId)).toBe(true);
    expect(accounts.getAccountRecord(created.accountId)).not.toBeNull();
    expect(keyring.getSecrets()?.keySources).toHaveLength(1);
    expect([...state.keySources.values()][0]).toMatchObject({
      type: "bip39",
      backupStatus: "pending",
      createdAt: expect.any(Number),
    });
    expect([...state.keyrings.values()][0]).toMatchObject({ createdAt: expect.any(Number) });
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
      namespace: "eip155",
    });

    expect(state.keySources.get(created.keySourceId)).toMatchObject({
      type: "bip39",
      backupStatus: "confirmed",
    });
    expect(state.keyrings.get(created.hdKeyringId)?.keySourceId).toBe(created.keySourceId);
  });

  it("rejects another create command after initialization", async () => {
    const { wallet, commits } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });

    await expect(
      wallet.restoreFromMnemonic({
        password: "password",
        mnemonic: SECONDARY_MNEMONIC,
        namespace: "eip155",
      }),
    ).rejects.toMatchObject({ code: "wallet.already_initialized" });
    expect(commits).toHaveLength(1);
  });

  it("rejects an invalid mnemonic before commit or activation", async () => {
    const { wallet, commits, keyring } = createHarness();

    await expect(
      wallet.createFromMnemonic({
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
    await wallet.createFromMnemonic({
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

  it("adds and imports mnemonic sources with complete identity results", async () => {
    const { state, wallet } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: EIP155_NAMESPACE,
    });

    const added = await wallet.keySources.addMnemonic({
      mnemonic: SECONDARY_MNEMONIC,
      namespace: EIP155_NAMESPACE,
    });
    const imported = await wallet.keySources.importMnemonic({
      mnemonic: TERTIARY_MNEMONIC,
      namespace: EIP155_NAMESPACE,
    });

    expect(wallet.keySources.get(added.keySourceId)).toMatchObject({
      type: "bip39",
      backupStatus: "pending",
    });
    expect(wallet.keySources.get(imported.keySourceId)).toMatchObject({
      type: "bip39",
      backupStatus: "confirmed",
    });
    expect(wallet.hdKeyrings.get(added.hdKeyringId)).toMatchObject({
      keySourceId: added.keySourceId,
      namespace: EIP155_NAMESPACE,
    });
    expect(wallet.hdKeyrings.get(imported.hdKeyringId)).toMatchObject({
      keySourceId: imported.keySourceId,
      namespace: EIP155_NAMESPACE,
    });
    expect(wallet.accounts.get(added.accountId).origin).toEqual({
      type: "hd",
      hdKeyringId: added.hdKeyringId,
      derivationIndex: 0,
    });
    expect(wallet.accounts.get(imported.accountId).origin).toEqual({
      type: "hd",
      hdKeyringId: imported.hdKeyringId,
      derivationIndex: 0,
    });
    expect(wallet.keySources.list()).toHaveLength(3);
    expect(wallet.hdKeyrings.list()).toHaveLength(3);
    expect(wallet.accounts.list()).toHaveLength(3);
    expect(state.keySources.has(added.keySourceId)).toBe(true);
    expect(state.keySources.has(imported.keySourceId)).toBe(true);
  });

  it("adds an HD keyring and its first account in one commit", async () => {
    const { commits, wallet } = createHarness();
    const created = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: EIP155_NAMESPACE,
    });

    const added = await wallet.hdKeyrings.add({
      keySourceId: created.keySourceId,
      namespace: SECOND_NAMESPACE,
    });

    expect(commits.at(-1)?.map((change) => change.persistenceType)).toEqual([
      "hdKeyring",
      "account",
      "accountSelection",
    ]);
    expect(wallet.hdKeyrings.get(added.hdKeyringId)).toMatchObject({
      keySourceId: created.keySourceId,
      namespace: SECOND_NAMESPACE,
      nextDerivationIndex: 1,
    });
    expect(wallet.accounts.get(added.accountId)).toMatchObject({
      namespace: SECOND_NAMESPACE,
      origin: { type: "hd", hdKeyringId: added.hdKeyringId, derivationIndex: 0 },
      selected: true,
    });
  });

  it("exports source secrets only after current-password verification", async () => {
    const { commits, keyringChanges, wallet } = createHarness();
    const mnemonicSource = await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: EIP155_NAMESPACE,
    });
    const privateKeySource = await wallet.keySources.importPrivateKey({
      privateKey: "private-key",
      namespace: EIP155_NAMESPACE,
    });
    const commitCount = commits.length;
    const eventCount = keyringChanges.length;

    await expect(
      wallet.keySources.exportMnemonic({
        keySourceId: mnemonicSource.keySourceId,
        password: "password",
      }),
    ).resolves.toEqual({ mnemonic: PRIMARY_MNEMONIC });
    await expect(
      wallet.keySources.exportPrivateKey({
        keySourceId: privateKeySource.keySourceId,
        password: "password",
      }),
    ).resolves.toEqual({ privateKey: "private-key" });
    await expect(
      wallet.keySources.exportMnemonic({
        keySourceId: mnemonicSource.keySourceId,
        password: "incorrect",
      }),
    ).rejects.toMatchObject({ code: "vault.incorrect_password" });
    await expect(
      wallet.keySources.exportPrivateKey({
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

    expect(wallet.getStatus()).toBe("unlocked");
    expect(commits).toHaveLength(commitCount);
    expect(keyringChanges).toHaveLength(eventCount);

    await wallet.lock();
    await expect(
      wallet.keySources.exportMnemonic({
        keySourceId: mnemonicSource.keySourceId,
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
      wallet.createFromMnemonic({
        password: "password",
        mnemonic: PRIMARY_MNEMONIC,
        namespace: "eip155",
      }),
    ).rejects.toBe(failure);

    expect(wallet.getStatus()).toBe("uninitialized");
    expect(keyring.listKeySources()).toEqual([]);
    expect(keyring.listHdKeyrings()).toEqual([]);
    expect(keyring.getSecrets()).toBeNull();
    expect(accounts.listAccountRecords()).toEqual([]);
  });

  it("commits a derived account and the advanced cursor together", async () => {
    const { wallet, accounts, commits, state } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const keyring = [...state.keyrings.values()][0];
    if (!keyring) throw new Error("missing test keyring");

    await wallet.hdKeyrings.deriveAccount({ hdKeyringId: keyring.hdKeyringId });

    expect(commits[1]?.map((change) => change.persistenceType)).toEqual(["account", "hdKeyring"]);
    expect(commits[1]?.[1]).toMatchObject({
      operation: "put",
      value: { hdKeyringId: keyring.hdKeyringId, nextDerivationIndex: 2 },
    });
    expect(accounts.listAccountRecords()).toHaveLength(2);
  });

  it("confirms mnemonic backup while locked without reading the secret", async () => {
    const { wallet, commits, keyring, keyringChanges } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const source = keyring.listKeySources()[0];
    if (source?.type !== "bip39") throw new Error("missing test source");
    await wallet.lock();

    await wallet.keySources.confirmMnemonicBackup({ keySourceId: source.keySourceId });

    expect(wallet.getStatus()).toBe("locked");
    expect(keyring.getKeySource(source.keySourceId)).toMatchObject({ backupStatus: "confirmed" });
    expect(commits.at(-1)?.map((change) => change.persistenceType)).toEqual(["keySource"]);
    expect(keyringChanges.at(-1)).toEqual({ type: "keyringChanged" });

    const commitCount = commits.length;
    const eventCount = keyringChanges.length;
    await wallet.keySources.confirmMnemonicBackup({ keySourceId: source.keySourceId });

    expect(commits).toHaveLength(commitCount);
    expect(keyringChanges).toHaveLength(eventCount);
  });

  it("stores private keys with an explicit namespace without deriving accounts on unlock", async () => {
    const { wallet, state, keyring, deriveHdAccountId, accountIdFromPrivateKey } = createHarness();
    const created = await wallet.createFromPrivateKey({
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
    expect(created.keySourceId).toBe(source.keySourceId);
    expect(created.accountId).toBe([...state.accounts.keys()][0]);

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

  it("locks by clearing decoded keyring secrets without committing persistence", async () => {
    const { wallet, commits, events, keyring } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const commitCount = commits.length;

    await wallet.lock();

    expect(wallet.getStatus()).toBe("locked");
    expect(commits).toHaveLength(commitCount);
    expect(keyring.getSecrets()).toBeNull();
    expect(events).toEqual([
      { type: "walletStatusChanged", status: "unlocked" },
      { type: "walletStatusChanged", status: "locked" },
    ]);

    await wallet.lock();
    expect(events).toHaveLength(2);
  });

  it("serializes a lock requested while unlock is in progress", async () => {
    const { wallet } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    await wallet.lock();

    const unlocking = wallet.unlock("password");
    const locking = wallet.lock();
    await Promise.all([unlocking, locking]);

    expect(wallet.getStatus()).toBe("locked");
  });

  it("does not publish another event when unlock is already satisfied", async () => {
    const { wallet, events } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });

    await wallet.unlock("password");

    expect(events).toEqual([{ type: "walletStatusChanged", status: "unlocked" }]);
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
    expect(keyring.getSecrets()).toBeNull();
  });

  it("changes the password without publishing a status event", async () => {
    const { wallet, commits, events } = createHarness();
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });
    const eventCount = events.length;

    await wallet.changePassword({ currentPassword: "password", newPassword: "new-password" });

    expect(commits).toHaveLength(2);
    expect(events).toHaveLength(eventCount);

    await wallet.lock();
    await expect(wallet.unlock("password")).rejects.toMatchObject({ code: "vault.incorrect_password" });
    await expect(wallet.unlock("new-password")).resolves.toBeUndefined();
    expect(wallet.getStatus()).toBe("unlocked");
  });

  it("does not activate a secret update when its commit fails", async () => {
    const { wallet, state, keyring, keyringChanges, setCommitFailure } = createHarness();
    await wallet.createFromMnemonic({
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
    ).resolves.toMatchObject({
      keySourceId: expect.any(String),
      hdKeyringId: expect.any(String),
      accountId: expect.stringMatching(/^eip155:/),
    });
  });

  it("keeps the auto-lock duration unchanged when persistence fails", async () => {
    const failure = new Error("commit failed");
    const { wallet } = createHarness({ rejectCommit: failure });

    await expect(wallet.setAutoLockDuration(120_000)).rejects.toBe(failure);

    expect(wallet.getAutoLockDuration()).toBe(DEFAULT_AUTO_LOCK_DURATION_MS);
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
    const { wallet, commits, state } = createHarness();

    await wallet.setAutoLockDuration(120_000);

    expect(commits.at(-1)).toEqual([
      {
        persistenceType: "setting",
        operation: "put",
        value: { key: AUTO_LOCK_SETTING_KEY, durationMs: 120_000 },
      },
    ]);
    expect(state.autoLock).toEqual({ key: AUTO_LOCK_SETTING_KEY, durationMs: 120_000 });
    expect(wallet.getAutoLockDuration()).toBe(120_000);

    const commitCount = commits.length;
    await wallet.setAutoLockDuration(120_000);
    expect(commits).toHaveLength(commitCount);

    await wallet.setAutoLockDuration(DEFAULT_AUTO_LOCK_DURATION_MS);
    expect(commits.at(-1)).toEqual([{ persistenceType: "setting", operation: "remove", key: AUTO_LOCK_SETTING_KEY }]);
    expect(state.autoLock).toBeNull();
    expect(wallet.getAutoLockDuration()).toBe(DEFAULT_AUTO_LOCK_DURATION_MS);
  });

  it("locks through the mutation queue when the auto-lock timer expires", async () => {
    const state = emptyState();
    state.autoLock = { key: AUTO_LOCK_SETTING_KEY, durationMs: 60_000 };
    const { wallet, events, keyring } = createHarness({ state });
    await wallet.createFromMnemonic({
      password: "password",
      mnemonic: PRIMARY_MNEMONIC,
      namespace: "eip155",
    });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(wallet.getStatus()).toBe("locked");
    expect(keyring.getSecrets()).toBeNull();
    expect(events.at(-1)).toEqual({ type: "walletStatusChanged", status: "locked" });
  });
});
