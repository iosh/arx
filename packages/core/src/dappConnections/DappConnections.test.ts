import { describe, expect, it } from "vitest";
import { ChainNamespaceMismatchError, NetworkNotFoundError } from "../networks/errors.js";
import { createDappConnections, selection } from "./__tests__/DappConnections.testSupport.js";
import { DappOriginInvalidError } from "./errors.js";
import { parseDappOrigin } from "./origin.js";

describe("DappConnections selections", () => {
  it("derives canonical HTTP origins and rejects unsupported source URLs", () => {
    expect(parseDappOrigin("https://DAPP.example:443/path?q=1")).toBe("https://dapp.example");
    expect(parseDappOrigin("http://localhost:5173/app")).toBe("http://localhost:5173");

    for (const sourceUrl of ["file:///wallet.html", "chrome-extension://wallet/page.html", "not a URL"]) {
      expect(() => parseDappOrigin(sourceUrl)).toThrow(DappOriginInvalidError);
    }
  });

  it("loads valid selections into synchronous indexes", () => {
    const first = selection("https://a.example", "eip155", "eip155:1");
    const second = selection("https://a.example", "solana", "solana:mainnet");
    const third = selection("https://b.example", "eip155", "eip155:1");
    const { dappConnections } = createDappConnections({ networkSelections: [third, second, first] });

    expect(dappConnections.getNetworkSelection(first)).toEqual(first);
    expect(dappConnections.listNetworkSelections()).toEqual([first, second, third]);
    expect(dappConnections.listNetworkSelectionsByOrigin("https://a.example")).toEqual([first, second]);
    expect(dappConnections.listNetworkSelectionsByChainRef("eip155:1")).toEqual([first, third]);
  });

  it("rejects invalid persisted selections during construction", () => {
    expect(() =>
      createDappConnections({ networkSelections: [selection("https://DAPP.example", "eip155", "eip155:1")] }),
    ).toThrow(DappOriginInvalidError);
    expect(() =>
      createDappConnections({ networkSelections: [selection("https://dapp.example", "eip155", "eip155:999")] }),
    ).toThrow(NetworkNotFoundError);
    expect(() =>
      createDappConnections({ networkSelections: [selection("https://dapp.example", "solana", "eip155:1")] }),
    ).toThrow(ChainNamespaceMismatchError);
  });

  it("activates standalone changes only after a successful commit", async () => {
    const initial = selection("https://dapp.example", "eip155", "eip155:1");
    const next = { ...initial, chainRef: "eip155:10" };
    const { dappConnections, commits, setCommitFailure } = createDappConnections({ networkSelections: [initial] });

    await dappConnections.selectNetwork(initial);
    expect(commits).toEqual([]);

    const failure = new Error("commit failed");
    setCommitFailure(failure);
    await expect(dappConnections.selectNetwork(next)).rejects.toBe(failure);
    expect(dappConnections.getNetworkSelection(initial)).toEqual(initial);

    setCommitFailure(null);
    await dappConnections.selectNetwork(next);
    expect(commits).toEqual([[{ persistenceType: "dappNetworkSelection", operation: "put", value: next }]]);
    expect(dappConnections.getNetworkSelection(initial)).toEqual(next);
  });

  it("builds coordination plans without activating them early", () => {
    const first = selection("https://a.example", "eip155", "eip155:1");
    const second = selection("https://a.example", "solana", "solana:mainnet");
    const third = selection("https://b.example", "eip155", "eip155:1");
    const { dappConnections } = createDappConnections({ networkSelections: [first, second, third] });

    const removal = dappConnections.prepareRemoveNetworkReferences("eip155:1");
    expect(removal.persistenceChanges).toHaveLength(2);
    expect(dappConnections.getNetworkSelection(first)).toEqual(first);
    removal.activate();
    expect(dappConnections.getNetworkSelection(first)).toBeNull();
    expect(dappConnections.getNetworkSelection(third)).toBeNull();

    const originRemoval = dappConnections.prepareRemoveOriginSelections(first.origin);
    if (!originRemoval) throw new Error("Expected an origin removal plan");
    expect(originRemoval.persistenceChanges).toHaveLength(1);
    originRemoval.activate();
    expect(dappConnections.listNetworkSelectionsByOrigin(first.origin)).toEqual([]);
    expect(dappConnections.listNetworkSelections()).toEqual([]);
  });
});
