import { describe, expect, it } from "vitest";
import { ADDRESS } from "../namespaces/eip155/__tests__/fixtures.js";
import { createDappConnections, EIP155_ACCOUNT_A, selection } from "./__tests__/DappConnections.testSupport.js";

describe("DappConnections selections", () => {
  it("activates standalone changes only after a successful commit", async () => {
    const initial = selection("https://dapp.example", "eip155", "eip155:1");
    const next = { ...initial, chainRef: "eip155:10" };
    const scope = { origin: initial.origin, namespace: initial.namespace };
    const { dappConnections, commits, setCommitFailure, stateChanges } = createDappConnections({
      networkSelections: [initial],
      permissions: [{ ...scope, accountIds: [EIP155_ACCOUNT_A] }],
    });
    dappConnections.openConnection(scope, "eip155:1");

    await dappConnections.selectNetwork(initial);
    expect(commits).toEqual([]);

    const failure = new Error("commit failed");
    setCommitFailure(failure);
    await expect(dappConnections.selectNetwork(next)).rejects.toBe(failure);
    expect(dappConnections.getNetworkSelection(initial)).toEqual(initial);
    expect(dappConnections.getConnectionState(initial, "eip155:1")).toEqual({
      chainRef: "eip155:1",
      accounts: [ADDRESS],
    });
    expect(stateChanges).toEqual([]);

    setCommitFailure(null);
    await dappConnections.selectNetwork(next);
    expect(commits).toEqual([[{ persistenceType: "dappNetworkSelection", operation: "put", value: next }]]);
    expect(dappConnections.getNetworkSelection(initial)).toEqual(next);
  });
});
