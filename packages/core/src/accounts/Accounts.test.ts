import { describe, expect, it, vi } from "vitest";
import { eip155AccountsAdapter } from "../namespaces/eip155/accounts.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { Accounts } from "./Accounts.js";
import { type AccountsBootstrap, loadAccountsBootstrap } from "./bootstrap.js";
import {
  AccountAlreadyExistsError,
  AccountNamespaceUnsupportedError,
  AccountRemovalSelectionUnavailableError,
  AccountSelectionMissingError,
  LastVisibleAccountHiddenError,
  PrivateKeyAccountHiddenUnsupportedError,
} from "./errors.js";
import type { AccountRecord, AccountSelectionRecord } from "./persistence.js";
import type { AccountsChanged } from "./types.js";

const adapters = { eip155: eip155AccountsAdapter } as const;
const emptyBootstrap: AccountsBootstrap = { records: [], selections: [] };

const createAccounts = (
  bootstrap: AccountsBootstrap = emptyBootstrap,
  options: {
    commit?(changes: readonly PersistenceChange[]): Promise<void>;
    publishChanged?(change: AccountsChanged): void;
  } = {},
): Accounts =>
  new Accounts({
    adapters,
    bootstrap,
    mutations: createCoreMutationQueue({ commit: options.commit ?? (async () => {}) }),
    publishChanged: options.publishChanged ?? (() => {}),
  });

const accountId = (value: number) => `eip155:${value.toString(16).padStart(40, "0")}`;

const newHdAccount = (params: {
  value: number;
  createdAt: number;
  hdKeyringId?: string;
}): Omit<AccountRecord, "hidden"> => ({
  accountId: accountId(params.value),
  origin: {
    type: "hd",
    hdKeyringId: params.hdKeyringId ?? "hd-keyring-1",
    derivationIndex: params.value,
  },
  createdAt: params.createdAt,
});

const hdAccount = (params: {
  value: number;
  createdAt: number;
  hdKeyringId?: string;
  hidden?: boolean;
}): AccountRecord => ({
  ...newHdAccount(params),
  hidden: params.hidden ?? false,
});

const privateKeyAccount = (value: number): AccountRecord => ({
  accountId: accountId(value),
  origin: { type: "private-key", keySourceId: `source-${value}` },
  hidden: false,
  createdAt: value,
});

const selection = (record: AccountRecord): AccountSelectionRecord => ({
  namespace: "eip155",
  accountId: record.accountId,
});

describe("Accounts", () => {
  it("loads account records and selections for runtime construction", async () => {
    const record = hdAccount({ value: 1, createdAt: 1 });
    const selected = selection(record);

    await expect(
      loadAccountsBootstrap({
        accounts: {
          listRecords: async () => [record],
          listSelections: async () => [selected],
        },
      }),
    ).resolves.toEqual({ records: [record], selections: [selected] });
  });

  it("serves stable account metadata and selection from memory", () => {
    const later = hdAccount({ value: 2, createdAt: 2 });
    const first = hdAccount({ value: 1, createdAt: 1 });
    const accounts = createAccounts({
      records: [later, first],
      selections: [selection(later)],
    });

    expect(accounts.listAccounts().map((account) => account.accountId)).toEqual([first.accountId, later.accountId]);
    expect(accounts.getAccount(first.accountId)).toMatchObject({ selected: false });
    expect(accounts.getAccount(later.accountId)).toMatchObject({ selected: true });
    expect(accounts.getAccount(accountId(3))).toBeNull();
  });

  it("projects canonical and display addresses without requiring ownership", () => {
    const accounts = createAccounts();
    const derivedAccountId = accounts.accountIdFromAddress({
      chainRef: "eip155:1",
      address: "0x52908400098527886E0F7030069857D2E4169EE7",
    });

    expect(derivedAccountId).toBe("eip155:52908400098527886e0f7030069857d2e4169ee7");
    expect(accounts.getAddress({ chainRef: "eip155:1", accountId: derivedAccountId })).toEqual({
      accountId: derivedAccountId,
      chainRef: "eip155:1",
      canonicalAddress: "0x52908400098527886e0f7030069857d2e4169ee7",
      displayAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
    });
  });

  it("requires a selected account for selected-address queries", () => {
    const account = hdAccount({ value: 1, createdAt: 1 });
    const accounts = createAccounts({
      records: [account],
      selections: [selection(account)],
    });

    expect(accounts.getSelectedAddress("eip155:1")).toMatchObject({ accountId: account.accountId });
    expect(() => createAccounts().getSelectedAddress("eip155:1")).toThrow(AccountSelectionMissingError);
  });

  it("rejects unsupported namespaces even when an address query would be empty", () => {
    const accounts = createAccounts();

    expect(() => accounts.listAddresses("solana:mainnet")).toThrow(AccountNamespaceUnsupportedError);
    expect(() => accounts.listSelectableAddresses("solana:mainnet")).toThrow(AccountNamespaceUnsupportedError);
  });

  it("selects the first account added to a namespace", () => {
    const accounts = createAccounts();
    const first = newHdAccount({ value: 1, createdAt: 1 });
    const second = newHdAccount({ value: 2, createdAt: 2 });

    const firstUpdate = accounts.prepareAddAccount(first);
    expect(accounts.listAccounts()).toEqual([]);
    expect(firstUpdate.persistenceChanges.map((change) => change.persistenceType)).toEqual([
      "account",
      "accountSelection",
    ]);

    accounts.applyCommittedUpdate(firstUpdate);
    expect(accounts.getAccountRecord(first.accountId)).toMatchObject({ hidden: false });
    expect(accounts.getSelectedAccountId("eip155")).toBe(first.accountId);

    const secondUpdate = accounts.prepareAddAccount(second);
    expect(secondUpdate.persistenceChanges.map((change) => change.persistenceType)).toEqual(["account"]);
    accounts.applyCommittedUpdate(secondUpdate);
    expect(accounts.getSelectedAccountId("eip155")).toBe(first.accountId);
  });

  it("rejects a duplicate account identity", () => {
    const account = hdAccount({ value: 1, createdAt: 1 });
    const accounts = createAccounts({
      records: [account],
      selections: [selection(account)],
    });

    expect(() => accounts.prepareAddAccount(newHdAccount({ value: 1, createdAt: 1 }))).toThrow(
      AccountAlreadyExistsError,
    );
  });

  it("commits and publishes an account rename only when the alias changes", async () => {
    const account = hdAccount({ value: 1, createdAt: 1 });
    const commits: PersistenceChange[][] = [];
    const changes: AccountsChanged[] = [];
    const accounts = createAccounts(
      {
        records: [account],
        selections: [selection(account)],
      },
      {
        commit: async (persistenceChanges) => {
          commits.push([...persistenceChanges]);
        },
        publishChanged: (change) => changes.push(change),
      },
    );

    await accounts.rename({ accountId: account.accountId, alias: "Primary" });
    expect(accounts.getAccount(account.accountId)).toMatchObject({ alias: "Primary" });
    expect(commits).toHaveLength(1);
    expect(changes).toEqual([
      {
        type: "accountsChanged",
        accountIds: [account.accountId],
        namespaces: ["eip155"],
      },
    ]);

    await accounts.rename({ accountId: account.accountId, alias: "Primary" });
    expect(commits).toHaveLength(1);
    expect(changes).toHaveLength(1);
  });

  it("selects a visible account and ignores the current selection", async () => {
    const first = hdAccount({ value: 1, createdAt: 1 });
    const second = hdAccount({ value: 2, createdAt: 2 });
    const accounts = createAccounts({
      records: [first, second],
      selections: [selection(first)],
    });

    await accounts.select(second.accountId);
    expect(accounts.getSelectedAccountId("eip155")).toBe(second.accountId);

    await accounts.select(second.accountId);
    expect(accounts.getSelectedAccountId("eip155")).toBe(second.accountId);
  });

  it("does not activate or publish a rename when persistence fails", async () => {
    const account = hdAccount({ value: 1, createdAt: 1 });
    const failure = new Error("commit failed");
    const publishChanged = vi.fn();
    const accounts = createAccounts(
      {
        records: [account],
        selections: [selection(account)],
      },
      {
        commit: async () => {
          throw failure;
        },
        publishChanged,
      },
    );

    await expect(accounts.rename({ accountId: account.accountId, alias: "Primary" })).rejects.toBe(failure);
    expect(accounts.getAccount(account.accountId)).not.toHaveProperty("alias");
    expect(publishChanged).not.toHaveBeenCalled();
  });

  it("hides a selected HD account and chooses the first remaining visible account", () => {
    const first = hdAccount({ value: 1, createdAt: 1 });
    const second = hdAccount({ value: 2, createdAt: 2 });
    const accounts = createAccounts({
      records: [second, first],
      selections: [selection(first)],
    });

    const update = accounts.prepareSetAccountHidden(first.accountId, true);
    if (!update) throw new Error("missing hidden update");
    expect(update.persistenceChanges.map((change) => change.persistenceType)).toEqual(["account", "accountSelection"]);

    accounts.applyCommittedUpdate(update);
    expect(accounts.getAccount(first.accountId)).toMatchObject({ hidden: true, selected: false });
    expect(accounts.getAccount(second.accountId)).toMatchObject({ hidden: false, selected: true });
    expect(accounts.getSelectedAccountId("eip155")).toBe(second.accountId);
  });

  it("excludes hidden accounts only from selectable queries", () => {
    const hidden = hdAccount({ value: 1, createdAt: 1, hidden: true });
    const visible = hdAccount({ value: 2, createdAt: 2 });
    const accounts = createAccounts({
      records: [hidden, visible],
      selections: [selection(visible)],
    });

    expect(accounts.listSelectableAccounts("eip155").map((account) => account.accountId)).toEqual([visible.accountId]);
    expect(accounts.listSelectableAddresses("eip155:1").map((account) => account.accountId)).toEqual([
      visible.accountId,
    ]);
    expect(accounts.listAddresses("eip155:1").map((account) => account.accountId)).toEqual([
      hidden.accountId,
      visible.accountId,
    ]);
  });

  it("rejects hiding a private-key account", () => {
    const account = privateKeyAccount(1);
    const accounts = createAccounts({
      records: [account],
      selections: [selection(account)],
    });

    expect(() => accounts.prepareSetAccountHidden(account.accountId, true)).toThrow(
      PrivateKeyAccountHiddenUnsupportedError,
    );
  });

  it("rejects hiding the last visible account", () => {
    const account = hdAccount({ value: 1, createdAt: 1 });
    const accounts = createAccounts({
      records: [account],
      selections: [selection(account)],
    });

    expect(() => accounts.prepareSetAccountHidden(account.accountId, true)).toThrow(LastVisibleAccountHiddenError);
  });

  it("selects the first visible account remaining after removal", () => {
    const first = hdAccount({ value: 1, createdAt: 1, hdKeyringId: "hd-keyring-1" });
    const second = hdAccount({ value: 2, createdAt: 2, hdKeyringId: "hd-keyring-2" });
    const accounts = createAccounts({
      records: [first, second],
      selections: [selection(first)],
    });

    const firstRemoval = accounts.prepareRemoveHdAccounts(["hd-keyring-1"]);
    if (!firstRemoval) throw new Error("missing removal update");
    expect(firstRemoval.changedAccountIds).toEqual([first.accountId, second.accountId]);
    expect(firstRemoval.removedAccountIds).toEqual([first.accountId]);
    accounts.applyCommittedUpdate(firstRemoval);
    expect(accounts.getSelectedAccountId("eip155")).toBe(second.accountId);
  });

  it("removes the namespace selection with its final account", () => {
    const account = hdAccount({ value: 1, createdAt: 1 });
    const accounts = createAccounts({
      records: [account],
      selections: [selection(account)],
    });

    const removal = accounts.prepareRemoveHdAccounts(["hd-keyring-1"]);
    if (!removal) throw new Error("missing removal update");
    accounts.applyCommittedUpdate(removal);
    expect(accounts.listAccounts()).toEqual([]);
    expect(accounts.getSelectedAccountId("eip155")).toBeNull();
  });

  it("rejects removal when hidden records would be left without a visible selection", () => {
    const selected = hdAccount({ value: 1, createdAt: 1, hdKeyringId: "selected" });
    const hidden = hdAccount({ value: 2, createdAt: 2, hdKeyringId: "hidden", hidden: true });
    const accounts = createAccounts({
      records: [selected, hidden],
      selections: [selection(selected)],
    });

    expect(() => accounts.prepareRemoveHdAccounts(["selected"])).toThrow(AccountRemovalSelectionUnavailableError);
  });

  it("fails construction when a namespace has records but no selection", () => {
    const record = hdAccount({ value: 1, createdAt: 1 });
    expect(() => createAccounts({ records: [record], selections: [] })).toThrow(AccountSelectionMissingError);
  });
});
