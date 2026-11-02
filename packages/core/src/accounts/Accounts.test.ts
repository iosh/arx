import { describe, expect, it, vi } from "vitest";
import { eip155AccountsAdapter } from "../namespaces/eip155/accounts.js";
import { PersistenceCommitError } from "../persistence/errors.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { Accounts } from "./Accounts.js";
import type { AccountsBootstrap } from "./bootstrap.js";
import type { AccountGroupRecord, AccountMemberRecord } from "./persistence.js";
import type { AccountsChanged } from "./types.js";

const group: AccountGroupRecord = {
  accountGroupId: "95fe9605-6848-47b8-ae46-a842cf29dd7d",
  source: { type: "private-key", keySourceId: "source-1" },
  alias: "Daily",
  hidden: false,
  createdAt: 1,
};
const member: AccountMemberRecord = {
  accountId: "eip155:9858effd232b4033e47d90003d41ec34ecaeda94",
  accountGroupId: group.accountGroupId,
  origin: { type: "private-key", keySourceId: "source-1" },
};

const createAccounts = (
  bootstrap: AccountsBootstrap = {
    groups: [group],
    records: [member],
    selection: { accountGroupId: group.accountGroupId },
  },
) => {
  const commit = vi.fn<(changes: readonly PersistenceChange[]) => Promise<void>>(async () => {});
  const events: AccountsChanged[] = [];
  const accounts = new Accounts({
    adapters: { eip155: eip155AccountsAdapter },
    bootstrap,
    mutations: createCoreMutationQueue({ commit }),
    publishChanged: (event) => events.push(event),
  });
  return { accounts, commit, events };
};

describe("Accounts", () => {
  it("changes the group name once and ignores a repeated rename", async () => {
    const { accounts, commit, events } = createAccounts();
    const before = accounts.getGroup(group.accountGroupId);

    await accounts.rename({ accountGroupId: group.accountGroupId, alias: "Primary" });
    expect(accounts.getGroup(group.accountGroupId)).toEqual({ ...before, alias: "Primary" });
    expect(commit).toHaveBeenCalledOnce();
    expect(events).toEqual([
      {
        type: "accountsChanged",
        accountGroupIds: [group.accountGroupId],
        accountIds: [member.accountId],
        namespaces: ["eip155"],
      },
    ]);

    await accounts.rename({ accountGroupId: group.accountGroupId, alias: "Primary" });
    expect(commit).toHaveBeenCalledOnce();
    expect(events).toHaveLength(1);
  });

  it("retains the group and emits no change when persistence rejects a rename", async () => {
    const { accounts, commit, events } = createAccounts();
    const before = accounts.getGroup(group.accountGroupId);
    const failure = new PersistenceCommitError(new Error("IndexedDB transaction aborted"));
    commit.mockRejectedValueOnce(failure);

    await expect(accounts.rename({ accountGroupId: group.accountGroupId, alias: "Primary" })).rejects.toBe(failure);
    expect(accounts.getGroup(group.accountGroupId)).toEqual(before);
    expect(events).toEqual([]);
  });

  it("keeps hidden identities queryable while excluding them from account access choices", () => {
    const visibleGroupId = "56128651-0451-4057-801e-3b3d5b9fe409";
    const accountIds = [member.accountId, "eip155:6fac4d18c912343bf86fa7049364dd4e424ab9c0"];
    const { accounts } = createAccounts({
      groups: accountIds.map((_, accountIndex) => ({
        ...group,
        accountGroupId: accountIndex === 0 ? group.accountGroupId : visibleGroupId,
        source: { type: "bip39", keySourceId: "source-1", accountIndex },
        hidden: accountIndex === 0,
      })),
      records: accountIds.map((accountId, derivationIndex) => ({
        accountId,
        accountGroupId: derivationIndex === 0 ? group.accountGroupId : visibleGroupId,
        origin: { type: "hd", hdKeyringId: "hd-1", derivationIndex },
      })),
      selection: { accountGroupId: visibleGroupId },
    });

    expect(accounts.listSelectableAddresses("eip155:1").map(({ accountId }) => accountId)).toEqual([accountIds[1]]);
    expect(
      accounts.getGroupAddresses({ accountGroupId: group.accountGroupId }).map(({ accountId }) => accountId),
    ).toEqual([member.accountId]);
  });
});
