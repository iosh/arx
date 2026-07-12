import { describe, expect, it, vi } from "vitest";
import { createCoreMutationQueue } from "../persistence/mutationQueue.js";
import { createProviderChainSelections } from "./chainSelection.js";
import type { ProviderChainSelectionRecord } from "./persistence.js";

describe("ProviderChainSelections", () => {
  it("initializes a namespace from the wallet selection", async () => {
    let stored: ProviderChainSelectionRecord | null = null;
    const selections = createProviderChainSelections({
      reader: {
        get: vi.fn(async () => stored),
        listByOrigin: vi.fn(async () => []),
        listByChainRef: vi.fn(async () => []),
        listAll: vi.fn(async () => []),
      },
      mutations: createCoreMutationQueue({
        commit: vi.fn(async ([change]) => {
          if (change?.persistenceType === "providerChainSelection" && change.operation === "put") {
            stored = change.value;
          }
        }),
      }),
      networks: {
        getChain: () => ({
          source: "builtin",
          definition: {
            chainRef: "eip155:1",
            displayName: "Ethereum",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          },
        }),
        getWalletSelection: () => ({
          activeNamespace: "eip155",
          chainRefByNamespace: { eip155: "eip155:1" },
        }),
      },
    });

    await expect(selections.initialize({ origin: "https://app.example", namespace: "eip155" })).resolves.toEqual({
      origin: "https://app.example",
      namespace: "eip155",
      chainRef: "eip155:1",
    });
  });
});
