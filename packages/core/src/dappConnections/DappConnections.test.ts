import { describe, expect, it } from "vitest";
import type { Namespace } from "../namespaces/types.js";
import {
  ChainNamespaceMismatchError,
  type ChainRef,
  type Network,
  NetworkNotFoundError,
  type NetworksReader,
} from "../networks/index.js";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import type { PersistenceChange } from "../persistence/persistenceTypes.js";
import { DappConnections } from "./DappConnections.js";
import { DappOriginInvalidError } from "./errors.js";
import { parseDappOrigin } from "./origin.js";
import type { DappNetworkSelectionRecord } from "./persistence.js";

const installedNetworks: readonly Network[] = [
  {
    chainRef: "eip155:1",
    namespace: "eip155",
    source: "builtin",
    name: "Ethereum",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  {
    chainRef: "eip155:10",
    namespace: "eip155",
    source: "custom",
    name: "Optimism",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  {
    chainRef: "solana:mainnet",
    namespace: "solana",
    source: "builtin",
    name: "Solana",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
  },
];

const networksByChainRef = new Map(installedNetworks.map((network) => [network.chainRef, network]));
const networks = {
  get: (chainRef) => networksByChainRef.get(chainRef) ?? null,
} satisfies Pick<NetworksReader, "get">;

const selection = (origin: string, namespace: Namespace, chainRef: ChainRef): DappNetworkSelectionRecord => ({
  origin,
  namespace,
  chainRef,
});

const createDappConnections = (networkSelections: readonly DappNetworkSelectionRecord[] = []) => {
  const commits: PersistenceChange[][] = [];
  let commitFailure: Error | null = null;
  const dappConnections = new DappConnections({
    bootstrap: { networkSelections },
    networks,
    mutations: createCoreMutationQueue({
      commit: async (changes) => {
        if (commitFailure) throw commitFailure;
        commits.push([...changes]);
      },
    }),
  });

  return {
    dappConnections,
    commits,
    setCommitFailure: (failure: Error | null) => {
      commitFailure = failure;
    },
  };
};

describe("DappConnections", () => {
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
    const { dappConnections } = createDappConnections([third, second, first]);

    expect(
      dappConnections.getNetworkSelection({
        origin: first.origin,
        namespace: first.namespace,
      }),
    ).toEqual(first);
    expect(dappConnections.listNetworkSelections()).toEqual([first, second, third]);
    expect(dappConnections.listNetworkSelectionsByOrigin("https://a.example")).toEqual([first, second]);
    expect(dappConnections.listNetworkSelectionsByChainRef("eip155:1")).toEqual([first, third]);
  });

  it("rejects invalid persisted selections during construction", () => {
    expect(() => createDappConnections([selection("https://DAPP.example", "eip155", "eip155:1")])).toThrow(
      DappOriginInvalidError,
    );
    expect(() => createDappConnections([selection("https://dapp.example", "eip155", "eip155:999")])).toThrow(
      NetworkNotFoundError,
    );
    expect(() => createDappConnections([selection("https://dapp.example", "solana", "eip155:1")])).toThrow(
      ChainNamespaceMismatchError,
    );
  });

  it("activates standalone changes only after a successful commit", async () => {
    const initial = selection("https://dapp.example", "eip155", "eip155:1");
    const next = { ...initial, chainRef: "eip155:10" };
    const { dappConnections, commits, setCommitFailure } = createDappConnections([initial]);

    await dappConnections.selectNetwork(initial);
    expect(commits).toEqual([]);

    const failure = new Error("commit failed");
    setCommitFailure(failure);
    await expect(dappConnections.selectNetwork(next)).rejects.toBe(failure);
    expect(dappConnections.getNetworkSelection(initial)).toEqual(initial);

    setCommitFailure(null);
    await dappConnections.selectNetwork(next);
    expect(commits).toEqual([
      [
        {
          persistenceType: "dappNetworkSelection",
          operation: "put",
          value: next,
        },
      ],
    ]);
    expect(dappConnections.getNetworkSelection(initial)).toEqual(next);
  });

  it("builds coordination drafts without activating them early", () => {
    const first = selection("https://a.example", "eip155", "eip155:1");
    const second = selection("https://a.example", "solana", "solana:mainnet");
    const third = selection("https://b.example", "eip155", "eip155:1");
    const { dappConnections } = createDappConnections([first, second, third]);

    expect(
      dappConnections.prepareSelectNetworkIfMissing({
        ...first,
        chainRef: "eip155:10",
      }),
    ).toBeNull();

    const replacement = dappConnections.prepareReplaceNetworkSelections({
      chainRef: "eip155:1",
      replacementChainRef: "eip155:10",
    });
    if (!replacement) throw new Error("Expected a network replacement draft");
    expect(replacement.persistenceChanges).toHaveLength(2);
    expect(dappConnections.getNetworkSelection(first)).toEqual(first);
    dappConnections.applyCommittedUpdate(replacement);
    expect(dappConnections.getNetworkSelection(first)?.chainRef).toBe("eip155:10");

    const removal = dappConnections.prepareRemoveOriginSelections(first.origin);
    if (!removal) throw new Error("Expected an origin removal draft");
    expect(removal.persistenceChanges).toHaveLength(2);
    dappConnections.applyCommittedUpdate(removal);
    expect(dappConnections.listNetworkSelectionsByOrigin(first.origin)).toEqual([]);

    const reset = dappConnections.prepareRemoveAllNetworkSelections();
    if (!reset) throw new Error("Expected a selection reset draft");
    expect(reset.persistenceChanges).toHaveLength(1);
    dappConnections.applyCommittedUpdate(reset);
    expect(dappConnections.listNetworkSelections()).toEqual([]);
  });
});
